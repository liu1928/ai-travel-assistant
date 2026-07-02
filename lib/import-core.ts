// ⚠️ 伺服器端專用：共用匯入核心（名稱 → 真 place_id+座標 → 批次標籤 → 存）
import { tagPlaces } from "./tagging";
import { addPlace, listPlaces } from "./collection";
import { mapLimit } from "./concurrency";
import type { PlaceSearchResult } from "@/schema/place";

export type ImportCandidate = { name: string; lat?: number; lng?: number };
export type ImportSummary = { success: number; skipped: number; failed: number; invalid: number };

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
  const summary: ImportSummary = { success: 0, skipped: 0, failed: 0, invalid: 0 };
  if (!apiKey) {
    summary.failed = candidates.length;
    return summary;
  }

  const valid = candidates.filter((c) => c.name && c.name.trim().length >= 2);
  summary.invalid = candidates.length - valid.length;

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

  const tagsResult = await tagPlaces(toSave);
  const tagsList = tagsResult.ok ? tagsResult.value : toSave.map(() => []);

  await mapLimit(toSave, 5, async (p, i) => {
    const saved = await addPlace(uid, p, tagsList[i] ?? []);
    if (saved.ok) summary.success++;
    else summary.failed++;
  });

  return summary;
}
