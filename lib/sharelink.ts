// ⚠️ 伺服器端專用
// 僅支援單一地點分享連結。清單連結請改用 Google Takeout 或 Chrome 擴充。
import { ok, err, type Result } from "./result";
import type { PlaceSearchResult } from "@/schema/place";

export type ShareLinkResult = {
  kind: "place";
  places: PlaceSearchResult[];
};

export type ShareLinkError =
  | { kind: "invalid_url" }
  | { kind: "unsupported"; reason: string }
  | { kind: "fetch_error"; message: string }
  | { kind: "missing_key" };

const DETAILS_FIELD_MASK = "id,displayName,formattedAddress,location,types,rating";
const SEARCH_FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.rating";
const BOT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function resolveUrl(input: string): Promise<Result<string, ShareLinkError>> {
  try {
    const res = await fetch(input, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": BOT_UA },
    });
    return ok(res.url);
  } catch (e) {
    return err({ kind: "fetch_error", message: e instanceof Error ? e.message : String(e) });
  }
}

function isMapsUrl(url: string): boolean {
  return (
    url.includes("google.com/maps") ||
    url.includes("maps.google.com") ||
    url.includes("maps.app.goo.gl")
  );
}

// 舊格式：URL 內直接含 ChIJ... 開頭的 place_id
function extractPlaceId(url: string): string | null {
  const m1 = url.match(/\/place\/[^/]+\/(ChIJ[A-Za-z0-9_-]+)/);
  if (m1) return m1[1];
  const m2 = url.match(/place_id=([A-Za-z0-9_-]+)/);
  if (m2) return m2[1];
  return null;
}

// 新格式：Google 現在多半用十六進位 CID pair（!1s0x...:0x...），不再是 ChIJ。
// 改用「地點名稱 + 精確座標」做 Text Search 座標偏向搜尋，跟 Takeout 匯入同一套邏輯。
function extractNameAndCoords(
  url: string,
): { name: string; lat: number; lng: number } | null {
  const nameMatch = url.match(/\/maps\/place\/([^/]+)\//);
  if (!nameMatch) return null;
  const name = decodeURIComponent(nameMatch[1].replace(/\+/g, " "));

  // 優先用 !3d<lat>!4d<lng>（精確標記座標）
  const preciseMatch = url.match(/!3d(-?[0-9.]+)!4d(-?[0-9.]+)/);
  if (preciseMatch) {
    return { name, lat: parseFloat(preciseMatch[1]), lng: parseFloat(preciseMatch[2]) };
  }

  // 退而求其次用 @lat,lng,zoom（地圖中心，通常也很接近）
  const atMatch = url.match(/@(-?[0-9.]+),(-?[0-9.]+),/);
  if (atMatch) {
    return { name, lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) };
  }

  return null;
}

async function fetchPlaceById(
  placeId: string,
  apiKey: string,
): Promise<PlaceSearchResult | null> {
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
      headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": DETAILS_FIELD_MASK },
    });
    if (!res.ok) return null;
    const d = (await res.json()) as {
      id?: string;
      displayName?: { text?: string };
      formattedAddress?: string;
      location?: { latitude?: number; longitude?: number };
      types?: string[];
      rating?: number;
    };
    if (!d.id) return null;
    return {
      placeId: d.id,
      name: d.displayName?.text ?? "未知地點",
      address: d.formattedAddress,
      location: { lat: d.location?.latitude ?? 0, lng: d.location?.longitude ?? 0 },
      googleTypes: d.types ?? [],
      rating: d.rating,
    };
  } catch {
    return null;
  }
}

async function searchByNameAndCoords(
  name: string,
  lat: number,
  lng: number,
  apiKey: string,
): Promise<PlaceSearchResult | null> {
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": SEARCH_FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: name,
        languageCode: "zh-TW",
        maxResultCount: 1,
        locationBias: {
          circle: { center: { latitude: lat, longitude: lng }, radius: 200 },
        },
      }),
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
      name: p.displayName?.text ?? name,
      address: p.formattedAddress,
      location: { lat: p.location?.latitude ?? lat, lng: p.location?.longitude ?? lng },
      googleTypes: p.types ?? [],
      rating: p.rating,
    };
  } catch {
    return null;
  }
}

export async function parseShareLink(
  rawUrl: string,
): Promise<Result<ShareLinkResult, ShareLinkError>> {
  try {
    new URL(rawUrl);
  } catch {
    return err({ kind: "invalid_url" });
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return err({ kind: "missing_key" });

  const resolved = await resolveUrl(rawUrl);
  if (!resolved.ok) return err(resolved.error);
  const finalUrl = resolved.value;

  if (!isMapsUrl(finalUrl)) {
    return err({
      kind: "unsupported",
      reason: `連結最終指向 ${new URL(finalUrl).hostname}，不是 Google Maps 網址`,
    });
  }

  // 舊格式：ChIJ... place_id
  const placeId = extractPlaceId(finalUrl);
  if (placeId) {
    const place = await fetchPlaceById(placeId, apiKey);
    if (place) return ok({ kind: "place", places: [place] });
  }

  // 新格式：名稱 + 座標 → Text Search 解析
  const nameCoords = extractNameAndCoords(finalUrl);
  if (nameCoords) {
    const place = await searchByNameAndCoords(nameCoords.name, nameCoords.lat, nameCoords.lng, apiKey);
    if (place) return ok({ kind: "place", places: [place] });
  }

  return err({
    kind: "unsupported",
    reason: "目前僅支援單一地點連結。清單請改用 Google Takeout 或 Chrome 擴充匯入。",
  });
}
