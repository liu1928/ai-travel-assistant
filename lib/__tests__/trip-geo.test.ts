import { describe, it, expect } from "vitest";
import { computeTripCentroid } from "../trip-geo";
import type { SavedTripDay } from "@/schema/trip";

describe("computeTripCentroid", () => {
  it("沒有任何 stop 對映到收藏座標 → undefined", () => {
    const days: SavedTripDay[] = [
      { day: 1, schedule: [{ time: "09:00", title: "不在收藏裡", description: "x", type: "place" }] },
    ];
    expect(computeTripCentroid(days, new Map())).toBeUndefined();
  });

  it("單筆對映到 → 回傳該座標", () => {
    const days: SavedTripDay[] = [
      { day: 1, schedule: [{ time: "09:00", title: "美術館", description: "x", type: "place" }] },
    ];
    const placesByName = new Map([["美術館", { lat: 24.15, lng: 120.67 }]]);
    expect(computeTripCentroid(days, placesByName)).toEqual({ lat: 24.15, lng: 120.67 });
  });

  it("多筆對映到 → 算平均值", () => {
    const days: SavedTripDay[] = [
      {
        day: 1,
        schedule: [
          { time: "09:00", title: "A", description: "x", type: "place" },
          { time: "12:00", title: "B", description: "x", type: "food" },
        ],
      },
    ];
    const placesByName = new Map([
      ["A", { lat: 0, lng: 0 }],
      ["B", { lat: 10, lng: 20 }],
    ]);
    expect(computeTripCentroid(days, placesByName)).toEqual({ lat: 5, lng: 10 });
  });

  it("優先用 location 對映（而非 title）", () => {
    const days: SavedTripDay[] = [
      { day: 1, schedule: [{ time: "09:00", title: "去逛逛", description: "x", type: "place", location: "美術館" }] },
    ];
    const placesByName = new Map([["美術館", { lat: 24.15, lng: 120.67 }]]);
    expect(computeTripCentroid(days, placesByName)).toEqual({ lat: 24.15, lng: 120.67 });
  });

  it("transport/rest 類型不計入（本來就沒有點）", () => {
    const days: SavedTripDay[] = [
      {
        day: 1,
        schedule: [
          { time: "09:00", title: "移動", description: "x", type: "transport" },
          { time: "12:00", title: "美術館", description: "x", type: "place" },
        ],
      },
    ];
    const placesByName = new Map([
      ["移動", { lat: 999, lng: 999 }], // 就算收藏裡剛好有同名地點，transport 類型也不該被採用
      ["美術館", { lat: 24.15, lng: 120.67 }],
    ]);
    expect(computeTripCentroid(days, placesByName)).toEqual({ lat: 24.15, lng: 120.67 });
  });

  it("跨多天累加平均", () => {
    const days: SavedTripDay[] = [
      { day: 1, schedule: [{ time: "09:00", title: "A", description: "x", type: "place" }] },
      { day: 2, schedule: [{ time: "09:00", title: "B", description: "x", type: "place" }] },
    ];
    const placesByName = new Map([
      ["A", { lat: 0, lng: 0 }],
      ["B", { lat: 20, lng: 40 }],
    ]);
    expect(computeTripCentroid(days, placesByName)).toEqual({ lat: 10, lng: 20 });
  });
});
