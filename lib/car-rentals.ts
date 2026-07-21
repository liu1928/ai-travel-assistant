// ⚠️ 伺服器端專用：租車建議（Google Places 租車據點查詢 + 地理重心 bias + 租車連結）。
// 見 specs/car-rental-suggest.md；架構仿 lib/lodging.ts（住宿建議）。
import { placeSearchResultSchema, type PlaceSearchResult } from "@/schema/place";
import { ok, err, type Result } from "./result";
import { buildCarRentalLink } from "./car-rental-link";

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

// Places priceLevel 是字串 enum → 對映成 0–4（租車行極少填此欄位，保留 best-effort 帶出，不篩選）
const PRICE_LEVEL_NUM: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

export type CarRentalSuggestion = {
  place: PlaceSearchResult;
  priceLevel?: number; // 0–4，best-effort（租車行少填，不做篩選用途）
  bookingUrl: string;
};
export type CarRentalSearchError = { kind: "missing_key" } | { kind: "api_error"; message: string };

type RawPlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  rating?: number;
  priceLevel?: string;
};

export async function suggestCarRentals(input: {
  location: string;
  center?: { lat: number; lng: number };
}): Promise<Result<CarRentalSuggestion[], CarRentalSearchError>> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return err({ kind: "missing_key" });

  const reqBody: Record<string, unknown> = {
    textQuery: `${input.location} 租車`,
    includedType: "car_rental", // 真實 Places 類型，比純關鍵字精準（避免混進洗車行/修車廠）
    // Text Search 預設只在「適用時」套用 includedType（Google 文件用詞），不是強制過濾；
    // 要保證真的只回 car_rental 類型結果需要 strictTypeFiltering（經 Context7 查證 API 文件）。
    strictTypeFiltering: true,
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

  const out: CarRentalSuggestion[] = [];
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

    const priceLevel = raw.priceLevel && raw.priceLevel in PRICE_LEVEL_NUM ? PRICE_LEVEL_NUM[raw.priceLevel] : undefined;

    out.push({
      place: parsed.data,
      priceLevel,
      bookingUrl: buildCarRentalLink({
        pickupLocation: parsed.data.name,
        dropoffLocation: parsed.data.name,
      }),
    });
  }

  out.sort((a, b) => (b.place.rating ?? 0) - (a.place.rating ?? 0));
  return ok(out);
}
