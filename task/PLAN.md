# PLAN — Foundation Hardening 項目 A：每日用量護欄（Firestore token bucket）

> 任務來源：`specs/foundation-hardening.md` 項目 A（本 session 與 peanut 議定的升級藍圖第一步）。
> `task/SPEC.md`（行程生成規格）不受本輪影響，維持不動。
> 依 CLAUDE.md Executor 流程：實作 → 自我驗證(test/typecheck/lint) → GLM 異質審查 → 寫 REPORT 後停，等 peanut 驗收。
> 本檔覆寫上一輪（sharelink SSRF + 清理，已 commit，git 歷史保留）。

## 本輪範圍（只做 A）

把 `COSTS.md` 只是「建議去 GCP 設 budget alert」的成本護欄，變成**程式層硬限流**：per-uid 每日預算 + 全域每日熔斷，後端用**既有 firebase-admin Firestore 當 token bucket，零新依賴**。

**不含**本 spec 的 B（匯入上限）/ C（車程 coords bug）/ D（批次標籤）/ E（記帳入口）——各自獨立任務，見文末 §不在本輪。

## 實作前查證結論（已讀過真實程式碼）

1. **攔截點統一**：9 個付費 route 開頭都是
   ```ts
   const auth = await requireUid(req);
   if (!auth.ok) return NextResponse.json({ error: auth.error.message }, { status: 401 });
   ```
   → 護欄一律插在這兩行之後、`auth.value` 即 uid。已核對：`places` / `trip/generate` / `import/{takeout,sharelink,extension}` / `collection`(POST) / `collection/retag` / `collection/retag-empty`。
2. **client 不直連 Firestore**（全走 Admin SDK，見 `lib/firebase.ts` / FIREBASE.md）→ `usage` 集合**天然不可被 client 觸及**。故 `firestore.rules` 鎖 `usage/**` 只是縱深防禦，非功能必需 → 拆成選配步驟、需 peanut 批准部署（禁動清單）。
3. **計費粒度**：takeout/sharelink 的候選筆數在 lib 內部才知道，route 拿不到。本輪採**每請求固定計費**（gate 一律插在 `requireUid` 後），最單純、好審。逐筆計費（cost = 單價 × 筆數）留給項目 B——B 引入 `MAX_IMPORT` 後筆數才有界且可知。**A 限制「請求頻率/次數」，B 限制「單次大小」，兩者相乘才是完整成本上界**。
4. **時區**：台灣無 DST，日界用 UTC+8 offset 直接算，不引時區庫。
5. **`Result` 型別**（`lib/result.ts`）：`ok(v)` / `err(e)`，呼叫端 `if (r.ok)` 收窄——沿用。
6. **prompt caching / Cloud Run timeout**：上一輪已查證不在本輪範圍，不動。

## 會動的檔案

| 檔案 | 改動 | 需 GLM review？ |
|---|---|---|
| `lib/quotas.ts` | 新增：成本表 + 每日預算設定（envOr 可覆寫，NaN 防呆） | 是 |
| `lib/rate-limit.ts` | 新增：純函式 `decide()` + `checkAndConsume()` 交易 + `rateLimitHttp()` | 是 |
| `lib/__tests__/rate-limit.test.ts` | 新增：`decide()` / 時間換算純邏輯單測 | 是 |
| `app/api/places/route.ts` | 插 gate（`places_search`） | 是 |
| `app/api/trip/generate/route.ts` | 插 gate（`trip_generate`） | 是 |
| `app/api/import/takeout/route.ts` | 插 gate（`import_resolve`） | 是 |
| `app/api/import/sharelink/route.ts` | 插 gate（`import_resolve`） | 是 |
| `app/api/import/extension/route.ts` | 插 gate（`import_resolve`，回錯需併 `CORS_HEADERS`） | 是 |
| `app/api/collection/route.ts` | POST 插 gate（`tagging_batch`）；GET/PATCH/DELETE 不動 | 是 |
| `app/api/collection/retag/route.ts` | 插 gate（`tagging_batch`） | 是 |
| `app/api/collection/retag-empty/route.ts` | 插 gate（`tagging_batch`） | 是 |
| `.env.example` | 加 `QUOTA_USER_DAILY_USD` / `QUOTA_GLOBAL_DAILY_USD` 註解（≤3 行設定微調） | 否 |
| `firestore.rules`（選配 A-6） | 新增進 repo，鎖 `usage/**`；**部署需 peanut 批准** | 視情況 |

> 超過 3 檔 → 本 PLAN 即為 CLAUDE.md 要求的「條列計畫請 peanut 確認再動手」的產物。

## 步驟

### A-1 `lib/quotas.ts`（設定）

```ts
import { envOr } from "./env";

// 每次呼叫的「預估成本」美金（粗估上界，只為相對比較與熔斷，非精算帳單）。對照 COSTS.md。
export const SERVICE_COST_USD = {
  places_search: 0.02,
  trip_generate: 0.06,
  tagging_batch: 0.01,
  import_resolve: 0.05, // 每請求固定（本輪）；B 落地後改逐筆
} as const;
export type PaidService = keyof typeof SERVICE_COST_USD;

// NaN 防呆：envOr 回非數字時退回預設
function numEnv(key: string, def: number): number {
  const n = Number(envOr(key, String(def)));
  return Number.isFinite(n) && n > 0 ? n : def;
}
export const USER_DAILY_BUDGET_USD = numEnv("QUOTA_USER_DAILY_USD", 2);   // peanut 定
export const GLOBAL_DAILY_BUDGET_USD = numEnv("QUOTA_GLOBAL_DAILY_USD", 10); // peanut 定
```

### A-2 `lib/rate-limit.ts`（核心）

分三塊，**把決策邏輯抽成純函式 `decide()` 當測試縫**（Firestore wiring 薄、手動驗）：

```ts
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./firebase";
import { ok, err, type Result } from "./result";
import {
  SERVICE_COST_USD, USER_DAILY_BUDGET_USD, GLOBAL_DAILY_BUDGET_USD, type PaidService,
} from "./quotas";

export type RateLimitError =
  | { kind: "rate_limited"; scope: "user"; retryAfterSec: number }
  | { kind: "circuit_open"; scope: "global"; retryAfterSec: number };

// ── 純函式（單測目標）──
export type Verdict = "ok" | "rate_limited" | "circuit_open";
export function decide(
  userCost: number, globalCost: number, cost: number,
  userBudget: number, globalBudget: number,
): Verdict {
  if (globalCost + cost > globalBudget) return "circuit_open"; // 先全域
  if (userCost + cost > userBudget) return "rate_limited";
  return "ok";
}

// 台灣 UTC+8、無 DST
export function taipeiDate(now: number): string {
  return new Date(now + 8 * 3600_000).toISOString().slice(0, 10); // YYYY-MM-DD
}
export function secondsToTaipeiMidnight(now: number): number {
  const msIntoDay = (now + 8 * 3600_000) % 86_400_000;
  return Math.ceil((86_400_000 - msIntoDay) / 1000);
}

// ── Firestore token bucket ──
export async function checkAndConsume(
  uid: string,
  service: PaidService,
  cost: number = SERVICE_COST_USD[service],
): Promise<Result<null, RateLimitError>> {
  const now = Date.now();
  const date = taipeiDate(now);
  const userRef = db().collection("usage").doc(`${uid}__${date}`);
  const globalRef = db().collection("usage").doc(`__global__${date}`);
  try {
    return await db().runTransaction(async (tx) => {
      const [u, g] = await Promise.all([tx.get(userRef), tx.get(globalRef)]); // reads first
      const userCost = (u.data()?.estCostUsd ?? 0) as number;
      const globalCost = (g.data()?.estCostUsd ?? 0) as number;
      const verdict = decide(userCost, globalCost, cost, USER_DAILY_BUDGET_USD, GLOBAL_DAILY_BUDGET_USD);
      if (verdict === "circuit_open")
        return err({ kind: "circuit_open", scope: "global", retryAfterSec: secondsToTaipeiMidnight(now) });
      if (verdict === "rate_limited")
        return err({ kind: "rate_limited", scope: "user", retryAfterSec: secondsToTaipeiMidnight(now) });
      const inc = { estCostUsd: FieldValue.increment(cost), count: FieldValue.increment(1), updatedAt: now };
      tx.set(userRef, inc, { merge: true });
      tx.set(globalRef, inc, { merge: true });
      return ok(null);
    });
  } catch (e) {
    // fail-open：限流基礎設施本身故障不該擋掉所有服務（見 §需 peanut 拍板）
    console.error("[rate-limit] fail-open", e instanceof Error ? e.message : String(e));
    return ok(null);
  }
}

// 純對映（不 import next，保持 lib 乾淨；route 自行組 NextResponse）
export function rateLimitHttp(e: RateLimitError): { status: number; message: string; retryAfterSec: number } {
  return e.kind === "circuit_open"
    ? { status: 503, message: "系統今日已達總量上限，請稍後再試", retryAfterSec: e.retryAfterSec }
    : { status: 429, message: "今日用量已達上限，請明天再試", retryAfterSec: e.retryAfterSec };
}
```

### A-3 各 route 插入（統一 pattern）

在 `if (!auth.ok) ...` 之後插：

```ts
import { checkAndConsume, rateLimitHttp } from "@/lib/rate-limit";
// ...
const gate = await checkAndConsume(auth.value, "places_search"); // service 依 route 對照 §會動的檔案
if (!gate.ok) {
  const { status, message, retryAfterSec } = rateLimitHttp(gate.error);
  return NextResponse.json({ error: message }, { status, headers: { "Retry-After": String(retryAfterSec) } });
}
```

- **extension route 例外**：回錯要併現有 `CORS_HEADERS`：
  ```ts
  return NextResponse.json({ error: message }, { status, headers: { ...CORS_HEADERS, "Retry-After": String(retryAfterSec) } });
  ```
- 只動 `collection` 的 **POST**（加地點會打 `tagPlace`）；GET/PATCH/DELETE 不限流。

### A-4 測試 `lib/__tests__/rate-limit.test.ts`

只測純函式（不碰 Firestore）：
- `decide()`：user 超額→`rate_limited`；global 超額→`circuit_open`（且全域優先於 user）；剛好等於 budget 不擋、超過才擋。
- `taipeiDate()` / `secondsToTaipeiMidnight()`：給固定 epoch 驗換算（含跨日邊界）。

### A-5 `.env.example`

加註解兩行：`QUOTA_USER_DAILY_USD`（預設 2）、`QUOTA_GLOBAL_DAILY_USD`（預設 20）。用 Write 工具，不用 Set-Content。

### A-6（選配，需 peanut 批准）`firestore.rules`

把 rules 落進 repo：`usage/** → allow read, write: if false;`（只 Admin SDK 寫）。**不自動部署**——`firebase deploy --only firestore:rules` 屬禁動清單，等 peanut 指示。功能上 client 本就碰不到 `usage`，此步為縱深防禦，可與 A 主體分開。

## peanut 已拍板（2026-07-09，鎖定）

1. **Quota 值**：`USER_DAILY_USD=2` / `GLOBAL_DAILY_USD=10`（程式 default 直接寫這兩個值，env 仍可覆寫）。
2. **fail-open**（Firestore 交易本身失敗時放行 + log）——已採用。
3. **A-6 rules 這輪一起做**：`firestore.rules` 進 repo + `firebase.json` 掛 firestore 區塊。⚠️ 實際 `firebase deploy --only firestore:rules` 由 peanut 執行（禁動清單，不自動部署），本輪只產出檔案 + 交付部署指令。

## 驗收

```bash
pnpm typecheck && pnpm test && pnpm lint   # 全綠才算完成
```

實測：
1. 把 `QUOTA_USER_DAILY_USD` 設極小（如 0.01）→ 打一次 `/api/trip/generate` 後再打 → 第二次回 `429` 帶 `Retry-After`；`/api/dna`、`GET /api/collection` 不受影響。
2. 把 `QUOTA_GLOBAL_DAILY_USD` 設極小 → 任一付費入口回 `503`。
3. 還原正常 quota → 一般使用（搜尋、生成、匯入、標籤）行為與現在一致。
4. extension route 被限流時回應仍帶 CORS headers（不破跨網域）。
5. 不設任何 quota 環境變數 → 用預設值，既有流程不變。

完成後：`git add -N` 新檔 → `git diff > task/diff.patch` → GLM `review_code` → 原封寫入 `task/REVIEW.md` → 仲裁真 P0/P1 → 才寫 `task/REPORT.md` → 停，等 peanut 驗收。

## 不在本輪（後續獨立任務）

- **B** 匯入筆數上限 + 標籤分批（`import-core.ts` / extension / import page）
- **C** 車程 `coords` 壓縮 bug（`trip/generate/route.ts`）
- **D** 批次標籤靜默空標籤（`tagging.ts` / `retag.ts`）
- **E** 記帳頁入口（`trips/[id]` / `trips` 頁）
- 逐筆計費（cost × 筆數）、成本感知優雅降級、Places/Routes 快取 → 見各 spec 的「已知限制」
