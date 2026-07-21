// 行程地理計算（純函式，供單測）。從 app/api/lodging/suggest/route.ts 抽出，
// 供住宿建議與租車建議共用（specs/lodging-suggest.md、specs/car-rental-suggest.md）。
import type { SavedTripDay } from "@/schema/trip";

/**
 * 把 schedule 的 place/food stop 名對照收藏地點取座標，算地理重心（零額外 Places 成本，
 * 沿用已錨定的收藏座標）。對不到任何座標時回 undefined（呼叫端降級成純地點字串查詢）。
 */
export function computeTripCentroid(
  days: SavedTripDay[],
  placesByName: Map<string, { lat: number; lng: number }>,
): { lat: number; lng: number } | undefined {
  const pts: { lat: number; lng: number }[] = [];
  for (const day of days) {
    for (const s of day.schedule) {
      if (s.type !== "place" && s.type !== "food") continue;
      const loc = placesByName.get(s.location ?? s.title);
      if (loc) pts.push(loc);
    }
  }
  if (pts.length === 0) return undefined;
  return {
    lat: pts.reduce((sum, p) => sum + p.lat, 0) / pts.length,
    lng: pts.reduce((sum, p) => sum + p.lng, 0) / pts.length,
  };
}
