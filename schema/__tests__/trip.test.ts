import { describe, it, expect } from "vitest";
import { tripSchema } from "../trip";

const validTrip = {
  title: "台中城市放鬆行",
  location: "台中",
  style: "relax",
  summary: "週末台中悠閒兩天一夜",
  days: [
    {
      day: 1,
      schedule: [
        { time: "09:00", title: "早餐", description: "在地咖啡廳吃早午餐", type: "food" },
        {
          time: "10:30",
          title: "美術館",
          description: "散步看展",
          type: "place",
          location: "國立台灣美術館",
        },
      ],
    },
  ],
  insights: ["行程節奏適中"],
  budget: { min: 2000, max: 5000 },
};

describe("tripSchema", () => {
  it("接受合法行程", () => {
    expect(tripSchema.safeParse(validTrip).success).toBe(true);
  });

  it("拒絕非法 time 格式", () => {
    const bad = {
      ...validTrip,
      days: [
        {
          day: 1,
          schedule: [{ ...validTrip.days[0].schedule[0], time: "9am" }],
        },
      ],
    };
    expect(tripSchema.safeParse(bad).success).toBe(false);
  });

  it("拒絕 budget.max 小於 min", () => {
    const bad = { ...validTrip, budget: { min: 5000, max: 1000 } };
    expect(tripSchema.safeParse(bad).success).toBe(false);
  });

  it("拒絕未知的 style", () => {
    const bad = { ...validTrip, style: "luxury" };
    expect(tripSchema.safeParse(bad).success).toBe(false);
  });

  it("拒絕空的 days", () => {
    const bad = { ...validTrip, days: [] };
    expect(tripSchema.safeParse(bad).success).toBe(false);
  });
});
