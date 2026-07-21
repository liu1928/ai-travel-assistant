// 單日路線圖的座標解析（純函式，供單測）。specs/map-view.md §1.3。
export type DayMapItem = { time: string; title: string; lat: number; lng: number };

type ScheduleLike = {
  time: string;
  title: string;
  type: string;
  location?: string;
  lat?: number;
  lng?: number;
};

/**
 * 座標優先序：① item 持久化 lat/lng（schedule-anchoring）② 舊行程降級：
 * 以 title/location 名稱對映收藏清單座標 ③ 都沒有 → 排除，計入 excludedCount。
 * 只數 place/food 類型（transport/rest 本來就沒有點，不計入分母，見 spec §2）。
 */
export function resolveDayMapItems(
  schedule: ScheduleLike[],
  collectionCoords: Map<string, { lat: number; lng: number }> | null,
): { items: DayMapItem[]; excludedCount: number } {
  const items: DayMapItem[] = [];
  let excludedCount = 0;

  for (const s of schedule) {
    if (s.type !== "place" && s.type !== "food") continue;

    if (typeof s.lat === "number" && typeof s.lng === "number") {
      items.push({ time: s.time, title: s.title, lat: s.lat, lng: s.lng });
      continue;
    }
    const known = collectionCoords?.get(s.location ?? s.title);
    if (known) {
      items.push({ time: s.time, title: s.title, lat: known.lat, lng: known.lng });
    } else {
      excludedCount++;
    }
  }

  return { items, excludedCount };
}
