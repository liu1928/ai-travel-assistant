// ⚠️ 伺服器端專用：per-uid + 全域 每日用量護欄（Firestore token bucket，零新依賴）
// 見 specs/foundation-hardening.md 項目 A、task/PLAN.md。
// 決策邏輯抽成純函式 decide()/時間換算，供單元測試（不必 mock Firestore）。
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./firebase";
import { ok, err, type Result } from "./result";
import {
  SERVICE_COST_USD,
  USER_DAILY_BUDGET_USD,
  GLOBAL_DAILY_BUDGET_USD,
  USER_DAILY_IMPORT_LIMIT,
  GLOBAL_DAILY_IMPORT_LIMIT,
  type PaidService,
} from "./quotas";

export type RateLimitError =
  | { kind: "rate_limited"; scope: "user"; retryAfterSec: number }
  | { kind: "circuit_open"; scope: "global"; retryAfterSec: number };

// ── 純函式（單元測試目標）────────────────────────────────────────────
export type Verdict = "ok" | "rate_limited" | "circuit_open";

/** 全域熔斷優先於 per-uid 限流；剛好等於預算不擋，超過才擋。 */
export function decide(
  userCost: number,
  globalCost: number,
  cost: number,
  userBudget: number,
  globalBudget: number,
): Verdict {
  if (globalCost + cost > globalBudget) return "circuit_open";
  if (userCost + cost > userBudget) return "rate_limited";
  return "ok";
}

// 台灣 UTC+8、無 DST，日界直接用 offset 算，不引時區庫。
export function taipeiDate(now: number): string {
  return new Date(now + 8 * 3600_000).toISOString().slice(0, 10); // YYYY-MM-DD
}
export function secondsToTaipeiMidnight(now: number): number {
  const msIntoDay = (now + 8 * 3600_000) % 86_400_000;
  return Math.ceil((86_400_000 - msIntoDay) / 1000);
}

// ── Firestore token bucket ──────────────────────────────────────────
/**
 * 在 requireUid 成功後、呼叫付費 API 前呼叫。
 * cost 預設取 SERVICE_COST_USD[service]。
 * fail-open：限流基礎設施本身故障（Firestore 交易失敗）時放行 + log，
 * 不因 Firestore 抖動就擋掉所有服務（peanut 定，2026-07-09）。
 */
export async function checkAndConsume(
  uid: string,
  service: PaidService,
  cost: number = SERVICE_COST_USD[service],
): Promise<Result<null, RateLimitError>> {
  const now = Date.now();
  const date = taipeiDate(now);
  // 夾成非負：cost 由伺服器端決定，但 clamp 杜絕「負數往下扣、繞過限流」（GLM REVIEW 🐛-1）。
  // 0 合法（本次無付費工作，如 item B 傳入 0 筆的匯入）→ 放行且不扣款。
  const spend = Math.max(0, cost);
  const userRef = db().collection("usage").doc(`${uid}__${date}`);
  const globalRef = db().collection("usage").doc(`__global__${date}`);

  try {
    return await db().runTransaction(async (tx) => {
      const [u, g] = await Promise.all([tx.get(userRef), tx.get(globalRef)]); // reads before writes
      const userCost = (u.data()?.estCostUsd ?? 0) as number;
      const globalCost = (g.data()?.estCostUsd ?? 0) as number;

      const verdict = decide(
        userCost,
        globalCost,
        spend,
        USER_DAILY_BUDGET_USD,
        GLOBAL_DAILY_BUDGET_USD,
      );
      if (verdict === "circuit_open") {
        return err({ kind: "circuit_open", scope: "global", retryAfterSec: secondsToTaipeiMidnight(now) });
      }
      if (verdict === "rate_limited") {
        return err({ kind: "rate_limited", scope: "user", retryAfterSec: secondsToTaipeiMidnight(now) });
      }

      const inc = {
        estCostUsd: FieldValue.increment(spend),
        count: FieldValue.increment(1),
        updatedAt: now,
      };
      tx.set(userRef, inc, { merge: true });
      tx.set(globalRef, inc, { merge: true });
      return ok(null);
    });
  } catch (e) {
    console.error("[rate-limit] fail-open", e instanceof Error ? e.message : String(e));
    return ok(null);
  }
}

/**
 * 匯入以「筆數」計（與 $ 預算不同維度，記在同一 usage doc 的 importCount 欄位）。
 * per-uid 對照 USER_DAILY_IMPORT_LIMIT、全域對照 GLOBAL_DAILY_IMPORT_LIMIT——因為匯入的
 * Places 成本不進 $ 全域熔斷（estCostUsd），故另設全域筆數熔斷封住跨使用者累積放大。
 * 複用純函式 decide（importCount 當「成本」、limit 當「預算」）。fail-open 同 checkAndConsume。
 */
export async function checkAndConsumeImports(
  uid: string,
  count: number,
): Promise<Result<null, RateLimitError>> {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return ok(null);
  const now = Date.now();
  const date = taipeiDate(now);
  const userRef = db().collection("usage").doc(`${uid}__${date}`);
  const globalRef = db().collection("usage").doc(`__global__${date}`);
  try {
    return await db().runTransaction(async (tx) => {
      const [u, g] = await Promise.all([tx.get(userRef), tx.get(globalRef)]);
      const userCount = (u.data()?.importCount ?? 0) as number;
      const globalCount = (g.data()?.importCount ?? 0) as number;
      const verdict = decide(userCount, globalCount, n, USER_DAILY_IMPORT_LIMIT, GLOBAL_DAILY_IMPORT_LIMIT);
      if (verdict === "circuit_open") {
        return err({ kind: "circuit_open", scope: "global", retryAfterSec: secondsToTaipeiMidnight(now) });
      }
      if (verdict === "rate_limited") {
        return err({ kind: "rate_limited", scope: "user", retryAfterSec: secondsToTaipeiMidnight(now) });
      }
      const inc = { importCount: FieldValue.increment(n), updatedAt: now };
      tx.set(userRef, inc, { merge: true });
      tx.set(globalRef, inc, { merge: true });
      return ok(null);
    });
  } catch (e) {
    console.error("[rate-limit] imports fail-open", e instanceof Error ? e.message : String(e));
    return ok(null);
  }
}

/** 純對映：不 import next，讓 route 自行組 NextResponse（沿用 places route 的 describe 風格）。 */
export function rateLimitHttp(e: RateLimitError): {
  status: number;
  message: string;
  retryAfterSec: number;
} {
  return e.kind === "circuit_open"
    ? { status: 503, message: "系統今日已達總量上限，請稍後再試", retryAfterSec: e.retryAfterSec }
    : { status: 429, message: "今日用量已達上限，請明天再試", retryAfterSec: e.retryAfterSec };
}
