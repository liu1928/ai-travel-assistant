// ⚠️ 伺服器端專用：使用 GOOGLE_MAPS_API_KEY。
import { placeSearchResultSchema, type PlaceSearchResult } from "@/schema/place";
import { ok, err, type Result } from "./result";

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

// Field mask 必填；只取需要的欄位以壓低 SKU 與回應大小。
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.types",
  "places.rating",
].join(",");

export type PlacesError =
  | { kind: "missing_key" }
  | { kind: "api_error"; status: number; message: string }
  | { kind: "bad_response"; message: string };

type RawPlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  rating?: number;
};

export async function searchPlaces(
  query: string,
): Promise<Result<PlaceSearchResult[], PlacesError>> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return err({ kind: "missing_key" });

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: query,
        languageCode: "zh-TW",
        regionCode: "TW",
        maxResultCount: 10,
      }),
    });
  } catch (e) {
    return err({
      kind: "api_error",
      status: 0,
      message: e instanceof Error ? e.message : String(e),
    });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return err({ kind: "api_error", status: res.status, message: text.slice(0, 300) });
  }

  let data: { places?: RawPlace[] };
  try {
    data = (await res.json()) as { places?: RawPlace[] };
  } catch {
    return err({ kind: "bad_response", message: "回應不是合法 JSON" });
  }

  const results: PlaceSearchResult[] = [];
  for (const raw of data.places ?? []) {
    const mapped = {
      placeId: raw.id ?? "",
      name: raw.displayName?.text ?? "",
      address: raw.formattedAddress,
      location: {
        lat: raw.location?.latitude ?? 0,
        lng: raw.location?.longitude ?? 0,
      },
      googleTypes: raw.types ?? [],
      rating: raw.rating,
    };
    const parsed = placeSearchResultSchema.safeParse(mapped);
    if (parsed.success) results.push(parsed.data);
  }

  return ok(results);
}
