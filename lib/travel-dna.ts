// ⚠️ 伺服器端專用
// 把使用者收藏的 tags 聚合成 Travel DNA：偏好分布 + 摘要敘述
import { listPlaces } from "./collection";
import { placeTag, type PlaceTag } from "@/schema/place";
import { ok, err, type Result } from "./result";

export type DnaError = { kind: "db_error"; message: string };

export type TagCount = { tag: PlaceTag; count: number; ratio: number };

export type TravelDna = {
  totalPlaces: number;
  tagCounts: TagCount[]; // 依 count 由高到低排序
  topTags: PlaceTag[]; // 前 3 名
  summary: string; // 一句話描述
};

function buildSummary(topTags: PlaceTag[], total: number): string {
  if (total === 0) return "還沒有收藏地點，先去收藏幾個喜歡的地方吧。";
  if (topTags.length === 0) return "收藏的地點都還沒有標籤，可以重新標籤看看。";
  const labels = topTags.join("、");
  return `你的收藏偏好 ${labels}，看起來是個喜歡這類行程的旅人。`;
}

export async function computeTravelDna(uid: string): Promise<Result<TravelDna, DnaError>> {
  const result = await listPlaces(uid);
  if (!result.ok) return err({ kind: "db_error", message: result.error.message });

  const places = result.value;
  const total = places.length;

  const counts = new Map<PlaceTag, number>();
  for (const tag of placeTag.options) counts.set(tag, 0);
  for (const place of places) {
    for (const tag of place.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  const tagCounts: TagCount[] = placeTag.options
    .map((tag) => ({
      tag,
      count: counts.get(tag) ?? 0,
      ratio: total > 0 ? (counts.get(tag) ?? 0) / total : 0,
    }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count);

  const topTags = tagCounts.slice(0, 3).map((t) => t.tag);

  return ok({
    totalPlaces: total,
    tagCounts,
    topTags,
    summary: buildSummary(topTags, total),
  });
}
