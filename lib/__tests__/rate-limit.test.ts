import { describe, it, expect } from "vitest";
import { decide, taipeiDate, secondsToTaipeiMidnight } from "@/lib/rate-limit";

/**
 * 用量護欄的決策邏輯抽成純函式，不碰 Firestore，可直接單測。
 * checkAndConsume 的 Firestore wiring 屬薄殼，手動實測（見 task/PLAN.md 驗收）。
 */
describe("decide (每日用量判定)", () => {
  const USER = 2;
  const GLOBAL = 10;

  it("預算內放行", () => {
    expect(decide(0, 0, 0.06, USER, GLOBAL)).toBe("ok");
    expect(decide(1.9, 5, 0.06, USER, GLOBAL)).toBe("ok");
  });

  it("剛好等於預算不擋，超過才擋", () => {
    // user：1.94 + 0.06 = 2.00，等於預算 → 放行
    expect(decide(1.94, 0, 0.06, USER, GLOBAL)).toBe("ok");
    // user：1.95 + 0.06 = 2.01 > 2 → 擋
    expect(decide(1.95, 0, 0.06, USER, GLOBAL)).toBe("rate_limited");
  });

  it("per-uid 超額 → rate_limited", () => {
    expect(decide(2, 0, 0.06, USER, GLOBAL)).toBe("rate_limited");
  });

  it("全域超額 → circuit_open", () => {
    expect(decide(0, 10, 0.06, USER, GLOBAL)).toBe("circuit_open");
  });

  it("全域熔斷優先於 per-uid 限流（兩者同時超額時回 circuit_open）", () => {
    expect(decide(5, 10, 0.06, USER, GLOBAL)).toBe("circuit_open");
  });

  // GLM REVIEW 🐛-1：checkAndConsume 會把 cost clamp 成非負（Math.max(0, cost)）。
  // 佐證「clamp 後的最壞情況（負數→0）不會繞過限流」：0 成本既不消費、也救不回已超額狀態。
  it("cost=0 不消費，也不會繞過已超額狀態（clamp 後最壞情況）", () => {
    expect(decide(1.99, 9.99, 0, USER, GLOBAL)).toBe("ok"); // 未達上限：0 成本放行
    expect(decide(2, 0, 0, USER, GLOBAL)).toBe("ok"); // user 剛好=預算，+0 不超過 → 放行
    expect(decide(2.5, 0, 0, USER, GLOBAL)).toBe("rate_limited"); // 已超額：0 成本不會把它救回放行
  });
});

describe("taipeiDate (UTC+8 日界)", () => {
  it("換算成台北日期字串 YYYY-MM-DD", () => {
    // 2026-07-09T00:00:00Z → 台北 08:00，同日
    expect(taipeiDate(Date.parse("2026-07-09T00:00:00Z"))).toBe("2026-07-09");
    // 2026-07-08T16:30:00Z → 台北 2026-07-09 00:30，跨到隔天
    expect(taipeiDate(Date.parse("2026-07-08T16:30:00Z"))).toBe("2026-07-09");
    // 2026-07-08T15:59:59Z → 台北 2026-07-08 23:59，還是當天
    expect(taipeiDate(Date.parse("2026-07-08T15:59:59Z"))).toBe("2026-07-08");
  });
});

describe("secondsToTaipeiMidnight (距下一個台北午夜秒數)", () => {
  it("台北午夜整點 → 一整天秒數", () => {
    // 台北 2026-07-09 00:00:00 = UTC 2026-07-08T16:00:00Z
    expect(secondsToTaipeiMidnight(Date.parse("2026-07-08T16:00:00Z"))).toBe(86_400);
  });

  it("台北 23:00 → 剩 1 小時", () => {
    // 台北 2026-07-09 23:00 = UTC 2026-07-09T15:00:00Z
    expect(secondsToTaipeiMidnight(Date.parse("2026-07-09T15:00:00Z"))).toBe(3_600);
  });

  it("回傳恆為正整數且 ≤ 一天", () => {
    const s = secondsToTaipeiMidnight(Date.parse("2026-07-09T07:23:11Z"));
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThanOrEqual(86_400);
    expect(Number.isInteger(s)).toBe(true);
  });
});
