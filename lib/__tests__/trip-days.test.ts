import { describe, it, expect } from "vitest";
import {
  inferMinDays,
  checkDayCoverage,
  extractWeekdaySignal,
  extractTimeOfDaySignal,
  expectedDayForWeekday,
  checkWeekdayTimeSignal,
  weekdayForDay,
} from "@/lib/trip-days";

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

describe("extractWeekdaySignal — 抽「週幾」訊號", () => {
  it("「週三」「星期三」「禮拜三」都能抽到 weekday=3、weekOffset=0", () => {
    expect(extractWeekdaySignal("週三早上去美麗海水族館")).toEqual({ weekday: 3, weekOffset: 0 });
    expect(extractWeekdaySignal("星期三早上去美麗海水族館")).toEqual({ weekday: 3, weekOffset: 0 });
    expect(extractWeekdaySignal("禮拜三早上去美麗海水族館")).toEqual({ weekday: 3, weekOffset: 0 });
  });

  it("週日/週天都對應 weekday=0（JS Date.getDay 慣例）", () => {
    expect(extractWeekdaySignal("週日去海邊")).toEqual({ weekday: 0, weekOffset: 0 });
    expect(extractWeekdaySignal("禮拜天去海邊")).toEqual({ weekday: 0, weekOffset: 0 });
  });

  it("「下週三」「下星期三」「下禮拜三」都能抽到 weekOffset=1（GLM REVIEW 2026-07-11 🐛-1 修正）", () => {
    expect(extractWeekdaySignal("下週三去美麗海水族館")).toEqual({ weekday: 3, weekOffset: 1 });
    expect(extractWeekdaySignal("下星期三去美麗海水族館")).toEqual({ weekday: 3, weekOffset: 1 });
    expect(extractWeekdaySignal("下禮拜三去美麗海水族館")).toEqual({ weekday: 3, weekOffset: 1 });
  });

  it("「下下週三」→ weekOffset=2", () => {
    expect(extractWeekdaySignal("下下週三去美麗海水族館")).toEqual({ weekday: 3, weekOffset: 2 });
  });

  it("沒有星期幾訊號 → undefined", () => {
    expect(extractWeekdaySignal("週末想去台中放鬆")).toBeUndefined();
    expect(extractWeekdaySignal("五天四夜東京行")).toBeUndefined();
  });
});

describe("extractTimeOfDaySignal — 抽時段訊號", () => {
  it("抓得到七種時段關鍵字", () => {
    expect(extractTimeOfDaySignal("早上去水族館")).toBe("早上");
    expect(extractTimeOfDaySignal("下午茶")).toBe("下午");
    expect(extractTimeOfDaySignal("凌晨出發")).toBe("凌晨");
  });

  it("沒有時段訊號 → undefined", () => {
    expect(extractTimeOfDaySignal("週三去美麗海水族館")).toBeUndefined();
  });
});

describe("expectedDayForWeekday — 錨點換算對應第幾天", () => {
  it("startDate 當天就是目標星期幾 → day 1", () => {
    // 2026-07-13 是週一
    expect(expectedDayForWeekday("2026-07-13", 1)).toBe(1);
  });

  it("目標星期幾在 startDate 之後 → 對應天數", () => {
    // 2026-07-13（週一）之後的第一個週三 → day 3
    expect(expectedDayForWeekday("2026-07-13", 3)).toBe(3);
  });

  it("目標星期幾比 startDate 早（跨週）→ 折回下一輪", () => {
    // 2026-07-15（週三）之後的第一個週一 → day 6
    expect(expectedDayForWeekday("2026-07-15", 1)).toBe(6);
  });

  it("startDate 格式不合 → undefined", () => {
    expect(expectedDayForWeekday("not-a-date", 3)).toBeUndefined();
  });

  it("weekOffset=1（下週）在算出的 day 上再加 7", () => {
    // 2026-07-13（週一）之後的第一個週三是 day 3；「下週三」要再 +7 = day 10
    expect(expectedDayForWeekday("2026-07-13", 3, 1)).toBe(10);
  });

  it("weekOffset=2（下下週）再加 14", () => {
    expect(expectedDayForWeekday("2026-07-13", 3, 2)).toBe(17);
  });

  it("weekOffset 省略時等同 0（回歸不破）", () => {
    expect(expectedDayForWeekday("2026-07-13", 3)).toBe(expectedDayForWeekday("2026-07-13", 3, 0));
  });
});

describe("weekdayForDay — day N 對應星期幾（specs/opening-hours.md）", () => {
  it("day 1 = startDate 當天", () => {
    // 2026-07-13 是週一（1）
    expect(weekdayForDay("2026-07-13", 1)).toBe(1);
  });

  it("day N 依序遞增，跨週日（0）不出錯", () => {
    // 2026-07-13（週一）：day1=一(1) day2=二(2) ... day7=日(0) day8=一(1)
    expect(weekdayForDay("2026-07-13", 7)).toBe(0);
    expect(weekdayForDay("2026-07-13", 8)).toBe(1);
  });

  it("startDate 本身是週日 → day1=0", () => {
    // 2026-07-19 是週日
    expect(weekdayForDay("2026-07-19", 1)).toBe(0);
  });

  it("startDate 格式不合 → undefined", () => {
    expect(weekdayForDay("not-a-date", 1)).toBeUndefined();
  });
});

describe("checkWeekdayTimeSignal — 驗證星期幾/時段是否被遵守", () => {
  const days = (schedules: string[][]) =>
    schedules.map((times, i) => ({
      day: i + 1,
      schedule: times.map((time) => ({ time })),
    }));

  it("expectedDay 為 undefined（沒提到星期幾或沒錨點）→ 直接放行", () => {
    expect(checkWeekdayTimeSignal(days([["09:00"]]), {}).ok).toBe(true);
  });

  it("expectedDay 對應的天不存在（行程太短）→ fail", () => {
    const r = checkWeekdayTimeSignal(days([["09:00"], ["09:00"]]), { expectedDay: 3 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("只有 2 天");
  });

  it("只驗星期幾（無 timeKeyword）：day 存在即通過，不管時段", () => {
    expect(checkWeekdayTimeSignal(days([["09:00"], ["23:00"]]), { expectedDay: 2 }).ok).toBe(true);
  });

  it("有 timeKeyword：目標天有落在時間窗內的行程 → ok", () => {
    const r = checkWeekdayTimeSignal(days([["09:00"], ["08:00", "14:00"]]), {
      expectedDay: 2,
      timeKeyword: "早上",
    });
    expect(r.ok).toBe(true);
  });

  it("有 timeKeyword：目標天沒有行程落在時間窗內 → fail", () => {
    const r = days([["09:00"], ["14:00", "20:00"]]);
    const result = checkWeekdayTimeSignal(r, { expectedDay: 2, timeKeyword: "早上" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("早上");
  });
});
