import { describe, it, expect } from "vitest";
import { resolveDayMapItems } from "../day-map";

describe("resolveDayMapItems（specs/map-view.md §1.3）", () => {
  it("item 已有持久化座標 → 直接使用", () => {
    const { items, excludedCount } = resolveDayMapItems(
      [{ time: "09:00", title: "美術館", type: "place", lat: 24.15, lng: 120.67 }],
      null,
    );
    expect(items).toEqual([{ time: "09:00", title: "美術館", lat: 24.15, lng: 120.67 }]);
    expect(excludedCount).toBe(0);
  });

  it("舊行程無座標 → 用 title 對映收藏清單座標", () => {
    const coords = new Map([["古宇利蝦蝦飯", { lat: 26.7, lng: 128.0 }]]);
    const { items, excludedCount } = resolveDayMapItems(
      [{ time: "12:00", title: "古宇利蝦蝦飯", type: "food" }],
      coords,
    );
    expect(items).toEqual([{ time: "12:00", title: "古宇利蝦蝦飯", lat: 26.7, lng: 128.0 }]);
    expect(excludedCount).toBe(0);
  });

  it("優先用 location 對映（而非 title）", () => {
    const coords = new Map([["國立台灣美術館", { lat: 24.15, lng: 120.67 }]]);
    const { items } = resolveDayMapItems(
      [{ time: "10:00", title: "美術館", type: "place", location: "國立台灣美術館" }],
      coords,
    );
    expect(items[0]?.lat).toBe(24.15);
  });

  it("都對不到 → 排除，計入 excludedCount", () => {
    const { items, excludedCount } = resolveDayMapItems(
      [{ time: "14:00", title: "不知名景點", type: "place" }],
      new Map(),
    );
    expect(items).toHaveLength(0);
    expect(excludedCount).toBe(1);
  });

  it("collectionCoords 為 null（尚未載入）且無持久化座標 → 排除", () => {
    const { items, excludedCount } = resolveDayMapItems(
      [{ time: "14:00", title: "不知名景點", type: "place" }],
      null,
    );
    expect(items).toHaveLength(0);
    expect(excludedCount).toBe(1);
  });

  it("transport/rest 類型不計入分母（無座標屬正常）", () => {
    const { items, excludedCount } = resolveDayMapItems(
      [
        { time: "09:00", title: "搭車移動", type: "transport" },
        { time: "12:00", title: "休息", type: "rest" },
      ],
      new Map(),
    );
    expect(items).toHaveLength(0);
    expect(excludedCount).toBe(0);
  });

  it("混合案例：部分有座標、部分對映到、部分排除", () => {
    const coords = new Map([["B店", { lat: 1, lng: 2 }]]);
    const { items, excludedCount } = resolveDayMapItems(
      [
        { time: "09:00", title: "A店", type: "place", lat: 10, lng: 20 },
        { time: "10:00", title: "B店", type: "food" },
        { time: "11:00", title: "C店", type: "place" },
        { time: "12:00", title: "移動", type: "transport" },
      ],
      coords,
    );
    expect(items).toHaveLength(2);
    expect(excludedCount).toBe(1);
  });
});
