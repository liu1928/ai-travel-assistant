import { describe, it, expect } from "vitest";
import { inferMinDays, checkDayCoverage } from "@/lib/trip-days";

/**
 * 修正「一句話生成只出特殊需求那一天」的兩個純函式：
 * inferMinDays 從 prompt 抽天數訊號當最低天數；checkDayCoverage 驗生成結果的天數覆蓋。
 */
describe("inferMinDays — 從一句話推斷最低天數", () => {
  it("「第三天」→ 3（使用者提到第 N 天，總天數至少 N）", () => {
    expect(inferMinDays("第三天要去迪士尼")).toBe(3);
  });

  it("「第 2 天」阿拉伯數字含空白 → 2", () => {
    expect(inferMinDays("第 2 天想去環球影城")).toBe(2);
  });

  it("「五天四夜」→ 5（取天數不取夜數）", () => {
    expect(inferMinDays("東京五天四夜")).toBe(5);
  });

  it("「3天2夜」阿拉伯數字 → 3", () => {
    expect(inferMinDays("沖繩3天2夜親子行")).toBe(3);
  });

  it("「去東京玩5天」純天數 → 5", () => {
    expect(inferMinDays("去東京玩5天")).toBe(5);
  });

  it("「三日遊」→ 3", () => {
    expect(inferMinDays("台南三日遊")).toBe(3);
  });

  it("多個訊號取最大：「第三天…五天四夜」→ 5", () => {
    expect(inferMinDays("五天四夜，第三天要去迪士尼")).toBe(5);
  });

  it("中文十位數：「十二天」→ 12、「二十一天」→ 21", () => {
    expect(inferMinDays("環島十二天")).toBe(12);
    expect(inferMinDays("長住二十一天")).toBe(21);
  });

  it("沒有天數訊號 → undefined（維持 AI 自由判斷）", () => {
    expect(inferMinDays("週末想去台中放鬆")).toBeUndefined();
  });

  it("「今天/明天」不會誤中（今/明不是數字）", () => {
    expect(inferMinDays("今天好想出去玩，明天出發")).toBeUndefined();
  });

  it("慣用語不當天數訊號：三天兩頭/一天到晚/這兩天", () => {
    expect(inferMinDays("三天兩頭想出去走走")).toBeUndefined();
    expect(inferMinDays("一天到晚想出國")).toBeUndefined();
    expect(inferMinDays("這兩天想出國散心")).toBeUndefined();
  });

  it("慣用語剔除後仍能抓到真訊號", () => {
    expect(inferMinDays("這兩天在想，來規劃五天四夜好了")).toBe(5);
  });
});

describe("checkDayCoverage — days 覆蓋完整性", () => {
  it("從 1 開始連續 → ok", () => {
    expect(checkDayCoverage([1, 2, 3]).ok).toBe(true);
    expect(checkDayCoverage([1]).ok).toBe(true);
  });

  it("順序打亂但集合連續 → ok（只驗集合不驗排列）", () => {
    expect(checkDayCoverage([2, 1, 3]).ok).toBe(true);
  });

  it("不從 1 開始 → fail（AI 只回 {day: 3} 的症狀）", () => {
    const r = checkDayCoverage([3]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("從 1 開始");
  });

  it("跳號 → fail", () => {
    expect(checkDayCoverage([1, 3]).ok).toBe(false);
  });

  it("重複編號 → fail", () => {
    expect(checkDayCoverage([1, 1, 2]).ok).toBe(false);
  });

  it("空陣列 → fail", () => {
    expect(checkDayCoverage([]).ok).toBe(false);
  });

  it("exactDays：天數不符 → fail、相符 → ok", () => {
    expect(checkDayCoverage([1, 2], { exactDays: 5 }).ok).toBe(false);
    expect(checkDayCoverage([1, 2, 3, 4, 5], { exactDays: 5 }).ok).toBe(true);
    // 超出也算不符（使用者指定恰好）
    expect(checkDayCoverage([1, 2, 3], { exactDays: 2 }).ok).toBe(false);
  });

  it("minDays：少於下限 → fail、達標或超過 → ok", () => {
    expect(checkDayCoverage([1], { minDays: 3 }).ok).toBe(false);
    expect(checkDayCoverage([1, 2, 3], { minDays: 3 }).ok).toBe(true);
    expect(checkDayCoverage([1, 2, 3, 4], { minDays: 3 }).ok).toBe(true);
  });
});
