// ⚠️ 伺服器端專用：單日排程的座標/公休錨定（specs/day-regenerate.md §1.3）
// 從 app/api/trip/generate/route.ts 的 Routes 迴圈抽出「錨定」這部分邏輯（不含車程估計），
// 供單日重生複用；主生成路徑刻意不改動，降低對既有已測試核心功能的迴歸風險。
import { resolveCoordinates } from "./routes";
import { checkScheduleAgainstHours } from "./opening-hours";
import type { ScheduleItem, SavedScheduleItem } from "@/schema/trip";
import type { SavedPlace } from "@/schema/place";

/**
 * 逐項寫回 placeId/lat/lng（收藏對映優先，其次 resolveCoordinates 模糊比對）+
 * openingWarning（有 weekday 錨點且對映到收藏地點的營業時間資料才驗）。
 * transport/rest 類型不處理（本來就沒有點）。
 */
export async function anchorDaySchedule(
  schedule: ScheduleItem[],
  places: SavedPlace[],
  weekday: number | undefined,
): Promise<SavedScheduleItem[]> {
  const placeByName = new Map(places.map((p) => [p.name, p]));
  const result: SavedScheduleItem[] = [];

  for (const item of schedule) {
    const out: SavedScheduleItem = { ...item };

    if (item.type === "place" || item.type === "food") {
      const known = placeByName.get(item.location ?? item.title);
      if (known) {
        out.placeId = known.placeId;
        out.lat = known.location.lat;
        out.lng = known.location.lng;
        if (weekday !== undefined && known.openingHours) {
          const warning = checkScheduleAgainstHours(out, weekday, known.openingHours);
          if (warning) out.openingWarning = warning;
        }
      } else {
        const resolved = await resolveCoordinates(item.location ?? item.title);
        if (resolved) {
          out.lat = resolved.lat;
          out.lng = resolved.lng;
        }
      }
    }

    result.push(out);
  }

  return result;
}
