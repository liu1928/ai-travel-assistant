import { describe, it, expect } from "vitest";
import {
  timeToMin,
  minToTime,
  effectiveDurations,
  attachDurations,
  reflowTimes,
  isRouteInsight,
  DEFAULT_DURATION_MIN,
} from "@/lib/trip-edit";

/** 編輯本地時間重排（修正「刪除/排序後時間不跟著變」）的純函式驗證。 */
const item = (time: string, durationMin?: number) => ({
  time,
  title: "x",
  description: "x",
  type: "place" as const,
  ...(durationMin !== undefined ? { durationMin } : {}),
});

describe("timeToMin / minToTime", () => {
  it("互轉與補零", () => {
    expect(timeToMin("09:30")).toBe(570);
    expect(timeToMin("9:30")).toBe(570); // 單位數小時也吃（生成端偶有）
    expect(minToTime(570)).toBe("09:30");
    expect(minToTime(0)).toBe("00:00");
  });

  it("非法格式 → undefined", () => {
    expect(timeToMin("")).toBeUndefined();
    expect(timeToMin("25:00")).toBeUndefined();
    expect(timeToMin("aa:bb")).toBeUndefined();
  });

  it("minToTime 超界 clamp 在 00:00–23:59", () => {
    expect(minToTime(24 * 60 + 30)).toBe("23:59");
    expect(minToTime(-10)).toBe("00:00");
  });
});

describe("effectiveDurations — 有效時長（差分優先 → durationMin → 預設）", () => {
  it("相鄰 time 差優先（舊行程沒有 durationMin 也能重排）", () => {
    const durs = effectiveDurations([item("09:00"), item("12:00"), item("14:00")]);
    expect(durs[0]).toBe(180);
    expect(durs[1]).toBe(120);
  });

  it("差分優先於 durationMin（刪中間項時，後項剛好提前被刪項原佔的時段）", () => {
    const durs = effectiveDurations([item("09:00", 30), item("12:00")]);
    expect(durs[0]).toBe(180); // 不是 30
  });

  it("末項沒有後繼 → 用 durationMin", () => {
    const durs = effectiveDurations([item("09:00"), item("12:00", 45)]);
    expect(durs[1]).toBe(45);
  });

  it("末項沒有 durationMin → 預設 60", () => {
    const durs = effectiveDurations([item("09:00"), item("12:00")]);
    expect(durs[1]).toBe(DEFAULT_DURATION_MIN);
  });

  it("時間亂序（差分 ≤ 0）→ 退用 durationMin / 預設", () => {
    const durs = effectiveDurations([item("14:00", 90), item("10:00")]);
    expect(durs[0]).toBe(90);
    const durs2 = effectiveDurations([item("14:00"), item("10:00")]);
    expect(durs2[0]).toBe(DEFAULT_DURATION_MIN);
  });
});

describe("attachDurations + reflowTimes — 編輯重排劇本", () => {
  it("刪掉中午項目 → 下午項目提前其原佔時段", () => {
    const draft = attachDurations([item("09:00"), item("12:00"), item("14:00")]);
    // 刪 index 1（12:00–14:00 佔 120 分）
    const after = reflowTimes(
      draft.filter((_, i) => i !== 1),
      9 * 60,
    );
    expect(after.map((s) => s.time)).toEqual(["09:00", "12:00"]); // 14:00 提前到 12:00
  });

  it("交換相鄰兩項 → 時間跟著位置重推（不再出現 14:00 排在 10:00 前）", () => {
    const draft = attachDurations([item("09:00"), item("10:00"), item("14:00")]);
    const swapped = [draft[1], draft[0], draft[2]];
    const after = reflowTimes(swapped, 9 * 60);
    // 時長跟著項目走：item1（原 10:00→14:00 佔 240）排第一 → 09:00；item0（原佔 60）→ 13:00
    expect(after.map((s) => s.time)).toEqual(["09:00", "13:00", "14:00"]);
    const mins = after.map((s) => timeToMin(s.time)!);
    expect([...mins].sort((a, b) => a - b)).toEqual(mins); // 單調遞增
  });

  it("累加超過 23:59 → clamp（不產生非法 time）", () => {
    const draft = attachDurations([item("22:00", 90), item("23:30", 90)]);
    const after = reflowTimes(draft, 23 * 60);
    expect(after[0].time).toBe("23:00");
    expect(after[1].time).toBe("23:59"); // 24:30 clamp
  });

  it("attachDurations 不改原欄位，只額外掛 effDurationMin", () => {
    const src = [item("09:00", 30)];
    const draft = attachDurations(src);
    expect(draft[0].durationMin).toBe(30);
    expect(draft[0].title).toBe("x");
    expect(typeof draft[0].effDurationMin).toBe("number");
  });
});

describe("isRouteInsight — 過期車程 insights 判別", () => {
  it("命中生成端兩種車程文字", () => {
    expect(isRouteInsight("第 2 天移動時間約 45 分鐘（開車）")).toBe(true);
    expect(isRouteInsight("第 1 天有地點無法定位，未估移動時間")).toBe(true);
  });

  it("AI 提醒不命中（不能誤刪）", () => {
    expect(isRouteInsight("記得帶雨具，午後易有雷陣雨")).toBe(false);
    expect(isRouteInsight("第 2 天行程較滿，建議早點出門")).toBe(false);
  });
});
