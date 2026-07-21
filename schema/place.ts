import { z } from "zod";

// 固定標籤分類（提案清單，可調整）。AI 只能從這組挑，不可自創。
export const placeTag = z.enum([
  "海景",
  "河岸",
  "山林",
  "咖啡",
  "美食",
  "夜景",
  "城市",
  "文化",
  "親子",
  "住宿",
]);
export type PlaceTag = z.infer<typeof placeTag>;

// Places API 搜尋回來的單一地點（尚未標籤、未收藏）。
export const placeSearchResultSchema = z.object({
  placeId: z.string().min(1),
  name: z.string().min(1),
  address: z.string().optional(),
  location: z.object({ lat: z.number(), lng: z.number() }),
  googleTypes: z.array(z.string()),
  rating: z.number().optional(),
});
export type PlaceSearchResult = z.infer<typeof placeSearchResultSchema>;

// 歇業狀態（specs/place-freshness.md）。NOT_FOUND = Details 回 404（place 已從 Google 下架），
// 不是 Google 明講的狀態，但 UI 同等級警示；全 optional，舊資料免遷移。
export const businessStatus = z.enum([
  "OPERATIONAL",
  "CLOSED_TEMPORARILY",
  "CLOSED_PERMANENTLY",
  "NOT_FOUND",
]);
export type BusinessStatus = z.infer<typeof businessStatus>;

// 收藏進 Firestore 的地點 = 搜尋結果 + 標籤 + 備註 + 群組 + 時間戳 + 歇業狀態。
export const savedPlaceSchema = placeSearchResultSchema.extend({
  tags: z.array(placeTag),
  note: z.string(),
  group: z.string().optional(), // 自訂群組名稱，例如「沖繩」「台中規劃」
  createdAt: z.number(), // epoch ms
  updatedAt: z.number(),
  businessStatus: businessStatus.optional(),
  statusCheckedAt: z.number().optional(), // epoch ms，上次檢查歇業狀態的時間
});
export type SavedPlace = z.infer<typeof savedPlaceSchema>;

// AI 標籤的 structured output（只回標籤）。
export const taggingResultSchema = z.object({
  tags: z.array(placeTag).min(1).max(4),
});
export type TaggingResult = z.infer<typeof taggingResultSchema>;
