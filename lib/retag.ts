// ⚠️ 伺服器端專用：找出標籤是空的收藏地點，批次重新打標籤
import { listPlaces, updateTags } from "./collection";
import { tagPlaces, TAG_BATCH_SIZE } from "./tagging";
import { mapLimit, chunk } from "./concurrency";
import { ok, err, type Result } from "./result";
import type { PlaceTag } from "@/schema/place";

export type RetagEmptySummary = {
  checked: number;
  emptyFound: number;
  updated: number;
  failed: number;
};

export type RetagEmptyError = { kind: "db_error"; message: string };

export async function retagEmptyPlaces(
  uid: string,
): Promise<Result<RetagEmptySummary, RetagEmptyError>> {
  const listResult = await listPlaces(uid);
  if (!listResult.ok) {
    return err({ kind: "db_error", message: listResult.error.message });
  }

  const all = listResult.value;
  const empty = all.filter((p) => p.tags.length === 0);

  const summary: RetagEmptySummary = {
    checked: all.length,
    emptyFound: empty.length,
    updated: 0,
    failed: 0,
  };

  if (empty.length === 0) return ok(summary);

  // 分批標籤（每批獨立成敗），避免一次把大量空標籤地點塞進單一呼叫被截斷。
  const tagsList: PlaceTag[][] = [];
  for (const batch of chunk(empty, TAG_BATCH_SIZE)) {
    const r = await tagPlaces(batch);
    if (!r.ok) console.warn("[retag] 批次標籤失敗，該批這輪維持空標籤：", r.error.kind);
    tagsList.push(...(r.ok ? r.value : batch.map(() => [])));
  }

  await mapLimit(empty, 5, async (place, i) => {
    const tags = tagsList[i] ?? [];
    if (tags.length === 0) {
      summary.failed++;
      return;
    }
    const saved = await updateTags(uid, place.placeId, tags);
    if (saved.ok) summary.updated++;
    else summary.failed++;
  });

  return ok(summary);
}
