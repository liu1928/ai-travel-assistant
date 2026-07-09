// ⚠️ 伺服器端專用：住宿建議（Google Places 旅宿查詢 + 地理重心 bias + 價位篩 + 訂房連結）。
// 見 specs/lodging-suggest.md。
import { placeSearchResultSchema, type PlaceSearchResult } from "@/schema/place";
import { ok, err, type Result } from "./result";
import { buildLodgingLink } from "./booking-link";

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.types",
  "places.rating",
  "places.priceLevel",
].join(",");

// Places priceLevel 是字串 enum → 對映成 0–4
const PRICE_LEVEL_NUM: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

export type LodgingSuggestion = {
  place: PlaceSearchResult;
  priceLevel?: number; // 0–4
  bookingUrl: string;
};
export type LodgingError = { kind: "missing_key" } | { kind: "api_error"; message: string };

type RawPlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  rating?: number;
  priceLevel?: string;
};

export async function suggestLodging(input: {
  location: string;
  center?: { lat: number; lng: number };
  maxPriceLevel?: number;
  checkIn?: string;
  checkOut?: string;
}): Promise<Result<LodgingSuggestion[], LodgingError>> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return err({ kind: "missing_key" });

  const reqBody: Record<string, unknown> = {
    textQuery: `${input.location} 飯店`,
    languageCode: "zh-TW",
    regionCode: "TW",
    maxResultCount: 12,
  };
  if (input.center) {
    reqBody.locationBias = {
      circle: { center: { latitude: input.center.lat, longitude: input.center.lng }, radius: 4000 },
    };
  }

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(reqBody),
    });
  } catch (e) {
    return err({ kind: "api_error", message: e instanceof Error ? e.message : String(e) });
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return err({ kind: "api_error", message: `Places ${res.status}: ${t.slice(0, 200)}` });
  }

  let data: { places?: RawPlace[] };
  try {
    data = (await res.json()) as { places?: RawPlace[] };
  } catch {
    return err({ kind: "api_error", message: "回應不是合法 JSON" });
  }

  const out: LodgingSuggestion[] = [];
  for (const raw of data.places ?? []) {
    const mapped = {
      placeId: raw.id ?? "",
      name: raw.displayName?.text ?? "",
      address: raw.formattedAddress,
      location: { lat: raw.location?.latitude ?? 0, lng: raw.location?.longitude ?? 0 },
      googleTypes: raw.types ?? [],
      rating: raw.rating,
    };
    const parsed = placeSearchResultSchema.safeParse(mapped);
    if (!parsed.success) continue;

    // 用 `in` 守未知 enum 值：不在對照表的 priceLevel → undefined（不會變成 runtime undefined 卻被當 number）
    const priceLevel = raw.priceLevel && raw.priceLevel in PRICE_LEVEL_NUM ? PRICE_LEVEL_NUM[raw.priceLevel] : undefined;
    // 價位篩：只在「有 maxPriceLevel 且該旅宿有 priceLevel」時才濾（缺 priceLevel 的保留、不誤刪）
    if (input.maxPriceLevel !== undefined && priceLevel !== undefined && priceLevel > input.maxPriceLevel) {
      continue;
    }

    out.push({
      place: parsed.data,
      priceLevel,
      bookingUrl: buildLodgingLink({
        query: parsed.data.name,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
      }),
    });
  }

  out.sort((a, b) => (b.place.rating ?? 0) - (a.place.rating ?? 0));
  return ok(out);
}
