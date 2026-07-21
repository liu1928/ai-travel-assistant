// ⚠️ 伺服器端專用：抓單一地點的 Google 歇業狀態（Places Details，Pro SKU）
// 見 specs/place-freshness.md §1.2。呼叫風格比照 lib/sharelink.ts 的 fetchPlaceById。
import { ok, err, type Result } from "./result";
import type { BusinessStatus } from "@/schema/place";

export type PlaceStatusError =
  | { kind: "missing_key" }
  | { kind: "api_error"; message: string };

const FIELD_MASK = "id,businessStatus";

/**
 * 把 HTTP 狀態 + 回應 body 分類成 BusinessStatus（純函式，供單測，不碰網路）。
 * 404 = place 已從 Google 下架，不是 Google 明講的「歇業」，但 UI 同等級警示；
 * 判斷順序刻意把 404 放最前面，body 內容一律忽略（GLM REVIEW 建議：唯一決策來源）。
 * 缺欄位或 BUSINESS_STATUS_UNSPECIFIED（含 Google 未提供資訊時）視同正常營業，不標警示。
 */
export function classifyStatus(
  httpStatus: number,
  body: { businessStatus?: string } | null,
): Result<BusinessStatus, PlaceStatusError> {
  if (httpStatus === 404) return ok("NOT_FOUND");
  if (httpStatus < 200 || httpStatus >= 300) {
    return err({ kind: "api_error", message: `Places API ${httpStatus}` });
  }
  if (body?.businessStatus === "CLOSED_TEMPORARILY" || body?.businessStatus === "CLOSED_PERMANENTLY") {
    return ok(body.businessStatus);
  }
  return ok("OPERATIONAL");
}

export async function fetchBusinessStatus(
  placeId: string,
): Promise<Result<BusinessStatus, PlaceStatusError>> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return err({ kind: "missing_key" });

  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
      headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": FIELD_MASK },
    });
    // 一律嘗試讀 body 再交給 classifyStatus 統一判斷（含 404）：body 解析失敗時退 null，
    // classifyStatus 判斷順序保證 404/非 2xx 都會先於讀 body.businessStatus 短路，不會誤判。
    const data = (await res.json().catch(() => null)) as { businessStatus?: string } | null;
    return classifyStatus(res.status, data);
  } catch (e) {
    return err({ kind: "api_error", message: e instanceof Error ? e.message : String(e) });
  }
}
