import { describe, it, expect } from "vitest";
import { currentTripDay, findNextStopIndex, todayLocalDateStr } from "../trip-day";

describe("currentTripDay（specs/trip-day-mode.md §1.1）", () => {
  it("今天是首日 → day 1", () => {
    expect(currentTripDay("2026-07-21", 3, "2026-07-21")).toBe(1);
  });

  it("今天是末日 → 對應天數", () => {
    expect(currentTripDay("2026-07-21", 3, "2026-07-23")).toBe(3);
  });

  it("今天在行程期間內 → 對應天數", () => {
    expect(currentTripDay("2026-07-21", 3, "2026-07-22")).toBe(2);
  });

  it("今天在行程開始之前 → null", () => {
    expect(currentTripDay("2026-07-21", 3, "2026-07-20")).toBeNull();
  });

  it("今天在行程結束之後 → null", () => {
    expect(currentTripDay("2026-07-21", 3, "2026-07-24")).toBeNull();
  });

  it("跨月的行程期間判斷正確", () => {
    expect(currentTripDay("2026-07-30", 5, "2026-08-02")).toBe(4);
  });

  it("缺 startDate（舊行程）→ null，行為與現在一致", () => {
    expect(currentTripDay(undefined, 3, "2026-07-21")).toBeNull();
  });

  it("startDate 格式不合 → null", () => {
    expect(currentTripDay("not-a-date", 3, "2026-07-21")).toBeNull();
  });
});

describe("findNextStopIndex — 依現在時刻找下一站", () => {
  const schedule = [{ time: "09:00" }, { time: "12:00" }, { time: "18:00" }];

  it("現在時刻早於全部行程 → 第一項", () => {
    expect(findNextStopIndex(schedule, "07:00")).toBe(0);
  });

  it("現在時刻在中間 → 下一個尚未到的項目", () => {
    expect(findNextStopIndex(schedule, "13:00")).toBe(2);
  });

  it("現在時刻剛好等於某項時間 → 該項本身（尚未開始視為下一站）", () => {
    expect(findNextStopIndex(schedule, "12:00")).toBe(1);
  });

  it("現在時刻晚於全部行程 → null", () => {
    expect(findNextStopIndex(schedule, "23:00")).toBeNull();
  });

  it("時刻格式不合 → null", () => {
    expect(findNextStopIndex(schedule, "not-a-time")).toBeNull();
  });
});

describe("todayLocalDateStr — 本地日期字串格式", () => {
  it("格式為 YYYY-MM-DD", () => {
    const d = new Date(2026, 6, 5); // 月份 0-based：6=七月
    expect(todayLocalDateStr(d)).toBe("2026-07-05");
  });

  it("月/日補零", () => {
    const d = new Date(2026, 0, 9); // 一月九號
    expect(todayLocalDateStr(d)).toBe("2026-01-09");
  });
});
