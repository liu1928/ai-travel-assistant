// ⚠️ 伺服器端專用：共用匯入核心（名稱 → 真 place_id+座標 → 批次標籤 → 存）
import { tagPlaces, TAG_BATCH_SIZE } from "./tagging";
import { addPlace, listPlaces } from "./collection";
import { mapLimit, chunk } from "./concurrency";
import { envOr } from "./env";
import type { PlaceSearchResult, PlaceTag } from "@/schema/place";

export type ImportCandidate = { name: string; lat?: number; lng?: number };
export type ImportSummary = {
  success: number;
  skipped: number;
  failed: number;
  invalid: number;
  truncated: number; // 因超過單次上限被丟棄的筆數（>0 時前端要提示）
};

// 單次匯入上限：防 Takeout 上千筆一次放大 Places/Anthropic 成本。NaN/非正 → 退回 300。
const MAX_IMPORT = (() => {
  const n = Number(envOr("MAX_IMPORT_PER_REQUEST", "300"));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 300;
})();

const FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.rating";

async function resolve(c: ImportCandidate, apiKey: string): Promise<PlaceSearchResult | null> {
  const body: Record<string, unknown> = {
    textQuery: c.name,
    languageCode: "zh-TW",
    maxResultCount: 1,
  };
  if (typeof c.lat === "number" && typeof c.lng === "number" && (c.lat !== 0 || c.lng !== 0)) {
    body.locationBias = { circle: { center: { latitude: c.lat, longitude: c.lng }, radius: 2000 } };
  }
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as {
      places?: Array<{
        id?: string;
        displayName?: { text?: string };
        formattedAddress?: string;
        location?: { latitude?: number; longitude?: number };
        types?: string[];
        rating?: number;
      }>;
    };
    const p = d.places?.[0];
    if (!p?.id) return null;
    return {
      placeId: p.id,
      name: p.displayName?.text ?? c.name,
      address: p.formattedAddress,
      location: { lat: p.location?.latitude ?? c.lat ?? 0, lng: p.location?.longitude ?? c.lng ?? 0 },
      googleTypes: p.types ?? [],
      rating: p.rating,
    };
  } catch {
    return null;
  }
}

export async function importCandidates(
  uid: string,
  candidates: ImportCandidate[],
): Promise<ImportSummary> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const summary: ImportSummary = { success: 0, skipped: 0, failed: 0, invalid: 0, truncated: 0 };
  if (!apiKey) {
    summary.failed = candidates.length;
    return summary;
  }

  const validAll = candidates.filter((c) => c.name && c.name.trim().length >= 2);
  summary.invalid = candidates.length - validAll.length;

  // 上限截斷：只處理前 MAX_IMPORT 筆，其餘計入 truncated（前端提示分批）。
  const valid = validAll.slice(0, MAX_IMPORT);
  summary.truncated = validAll.length - valid.length;

  const resolved = await mapLimit(valid, 5, (c) => resolve(c, apiKey));

  const existing = await listPlaces(uid);
  const existingIds = new Set(existing.ok ? existing.value.map((p) => p.placeId) : []);

  const seen = new Set<string>();
  const toSave: PlaceSearchResult[] = [];
  for (const p of resolved) {
    if (!p) { summary.failed++; continue; }
    if (existingIds.has(p.placeId) || seen.has(p.placeId)) { summary.skipped++; continue; }
    seen.add(p.placeId);
    toSave.push(p);
  }

  // 分批標籤：每批獨立成敗（某批 err → 該批空標籤，可被「重新標籤」再試），
  // 且每批遠低於 max_tokens，避免截斷造成尾段靜默空標籤（見 tagging.ts alignBatchTags）。
  const tagsList: PlaceTag[][] = [];
  for (const batch of chunk(toSave, TAG_BATCH_SIZE)) {
    const r = await tagPlaces(batch);
    // 降級不靜默：記一行 warn（該批以空標籤存入，可被「重新標籤」再試）— GLM REVIEW 🐛-1。
    if (!r.ok) console.warn("[import] 批次標籤失敗，該批暫存空標籤：", r.error.kind);
    tagsList.push(...(r.ok ? r.value : batch.map(() => [])));
  }

  await mapLimit(toSave, 5, async (p, i) => {
    const saved = await addPlace(uid, p, tagsList[i] ?? []);
    if (saved.ok) summary.success++;
    else summary.failed++;
  });

  return summary;
}
