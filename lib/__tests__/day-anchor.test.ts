import { describe, it, expect } from "vitest";
import { anchorDaySchedule } from "../day-anchor";
import type { SavedPlace } from "@/schema/place";

// resolveCoordinates 在測試環境沒有 GOOGLE_MAPS_API_KEY（vitest 不載入 .env.local），
// 會立即回 null（不打網路），這讓「收藏對映不到」分支可以確定性測試。
const place = (over: Partial<SavedPlace> = {}): SavedPlace => ({
  placeId: "p1",
  name: "美術館",
  tags: [],
  note: "",
  location: { lat: 24.15, lng: 120.67 },
  googleTypes: [],
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe("anchorDaySchedule（specs/day-regenerate.md §1.3）", () => {
  it("收藏對映成功 → 寫入 placeId/lat/lng", async () => {
    const result = await anchorDaySchedule(
      [{ time: "10:00", title: "美術館", description: "x", type: "place" }],
      [place()],
      undefined,
    );
    expect(result[0]).toMatchObject({ placeId: "p1", lat: 24.15, lng: 120.67 });
  });

  it("優先用 location 對映（而非 title）", async () => {
    const result = await anchorDaySchedule(
      [{ time: "10:00", title: "去逛逛", description: "x", type: "place", location: "美術館" }],
      [place()],
      undefined,
    );
    expect(result[0]?.placeId).toBe("p1");
  });

  it("有 weekday 錨點且對映到收藏的營業時間資料 → 驗證並寫入 openingWarning", async () => {
    const closed = place({ openingHours: { "0": null, "1": "09:00-17:00" } });
    const result = await anchorDaySchedule(
      [{ time: "10:00", title: "美術館", description: "x", type: "place" }],
      [closed],
      0, // 週日公休
    );
    expect(result[0]?.openingWarning).toBe("當日（週日）公休");
  });

  it("沒有 weekday 錨點 → 即使有 openingHours 也不驗證", async () => {
    const closed = place({ openingHours: { "0": null } });
    const result = await anchorDaySchedule(
      [{ time: "10:00", title: "美術館", description: "x", type: "place" }],
      [closed],
      undefined,
    );
    expect(result[0]?.openingWarning).toBeUndefined();
  });

  it("收藏對映不到 → 落到 resolveCoordinates（測試環境無 API key，回 null）→ 無座標", async () => {
    const result = await anchorDaySchedule(
      [{ time: "10:00", title: "不存在的地方", description: "x", type: "place" }],
      [place()],
      undefined,
    );
    expect(result[0]?.placeId).toBeUndefined();
    expect(result[0]?.lat).toBeUndefined();
  });

  it("transport/rest 類型不處理", async () => {
    const result = await anchorDaySchedule(
      [{ time: "10:00", title: "移動", description: "x", type: "transport" }],
      [place()],
      undefined,
    );
    expect(result[0]?.placeId).toBeUndefined();
    expect(result[0]?.lat).toBeUndefined();
  });

  it("不改動原始欄位（time/title/description/type 原樣保留）", async () => {
    const result = await anchorDaySchedule(
      [{ time: "10:00", title: "美術館", description: "看展", type: "place", durationMin: 90 }],
      [place()],
      undefined,
    );
    expect(result[0]).toMatchObject({ time: "10:00", title: "美術館", description: "看展", durationMin: 90 });
  });
});
