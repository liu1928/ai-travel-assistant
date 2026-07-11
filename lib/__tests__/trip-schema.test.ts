import { describe, it, expect } from "vitest";
import { tripSchema, tripWithBookingsSchema, scheduleItemSchema } from "@/schema/trip";

/** 修正一/二的 schema 層：day 連續性 superRefine + durationMin 可選欄位。 */
const makeTrip = (dayNumbers: number[]) => ({
  title: "測試行程",
  location: "台北",
  style: "relax",
  summary: "x",
  days: dayNumbers.map((day) => ({
    day,
    schedule: [{ time: "09:00", title: "x", description: "x", type: "place" }],
  })),
  insights: [],
  budget: { min: 0, max: 100 },
});

describe("tripSchema — day 連續性", () => {
  it("day 從 1 開始連續 → 通過", () => {
    expect(tripSchema.safeParse(makeTrip([1, 2, 3])).success).toBe(true);
  });

  it("只有 {day: 3} → 擋下（AI 只輸出特殊需求那天的症狀）", () => {
    const r = tripSchema.safeParse(makeTrip([3]));
    expect(r.success).toBe(false);
  });

  it("跳號 [1, 3] → 擋下", () => {
    expect(tripSchema.safeParse(makeTrip([1, 3])).success).toBe(false);
  });

  it("tripWithBookingsSchema（PATCH 編輯路徑）繼承同一約束", () => {
    expect(tripWithBookingsSchema.safeParse(makeTrip([2])).success).toBe(false);
    expect(tripWithBookingsSchema.safeParse(makeTrip([1, 2])).success).toBe(true);
  });
});

describe("scheduleItemSchema — durationMin", () => {
  const base = { time: "09:00", title: "x", description: "x", type: "place" };

  it("可省略（舊資料相容免遷移）", () => {
    expect(scheduleItemSchema.safeParse(base).success).toBe(true);
  });

  it("正整數合法；0/負數/小數/超過一天不合法", () => {
    expect(scheduleItemSchema.safeParse({ ...base, durationMin: 90 }).success).toBe(true);
    expect(scheduleItemSchema.safeParse({ ...base, durationMin: 1440 }).success).toBe(true);
    expect(scheduleItemSchema.safeParse({ ...base, durationMin: 0 }).success).toBe(false);
    expect(scheduleItemSchema.safeParse({ ...base, durationMin: -5 }).success).toBe(false);
    expect(scheduleItemSchema.safeParse({ ...base, durationMin: 1.5 }).success).toBe(false);
    expect(scheduleItemSchema.safeParse({ ...base, durationMin: 1441 }).success).toBe(false);
  });
});
