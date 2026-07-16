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

// 展開頁 HTML 只在第四層 fallback 用到；GET 已把 body 傳完，text() 只是讀
// buffer，零額外網路成本。上限截斷防巨頁吃記憶體（text() 已解碼成字串，
// slice 是字元截斷、不會切出無效 UTF-8）。
const HTML_MAX_CHARS = 512 * 1024;

async function resolveUrl(
  input: string,
): Promise<Result<{ url: string; html: string }, ShareLinkError>> {
  try {
    const res = await fetch(input, {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": BOT_UA },
      // 沒有 timeout 會讓惡意/慢速目標把請求掛住。5 秒足夠短連結轉址。
      signal: AbortSignal.timeout(5000),
    });
    // 非 2xx（錯誤頁）的 body 不可信——URL 解析各層照走，但別讓第四層
    // 從錯誤頁 HTML 撈名稱
    const html = res.ok ? (await res.text().catch(() => "")).slice(0, HTML_MAX_CHARS) : "";
    return ok({ url: res.url, html });
  } catch (e) {
    return err({ kind: "fetch_error", message: e instanceof Error ? e.message : String(e) });
  }
}

// SSRF 防護：只有這些網域的「輸入連結」才准 fetch。
// maps.app.goo.gl / goo.gl 是短連結；其餘走 google 主網域（含國別 TLD）。
const ALLOWED_INPUT_HOSTS = new Set(["maps.app.goo.gl", "goo.gl"]);
const GOOGLE_MAPS_HOST = /^(www\.|maps\.)?google\.(com|co\.[a-z]{2}|[a-z]{2,3})$/;

// 驗證「使用者貼進來、還沒 fetch 的原始連結」是不是可信的 Google Maps 網域。
// 必須是 https，且 host 命中白名單——擋掉 http://、file://、以及指向內網
// （如 metadata.google.internal）的任意 URL。轉址後的最終網址另由 isMapsUrl 再驗一次。
export function isAllowedInputUrl(u: URL): boolean {
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  return ALLOWED_INPUT_HOSTS.has(host) || GOOGLE_MAPS_HOST.test(host);
}

// 轉址後的最終網址驗證：解析出 hostname 精確比對，不用 includes 子字串。
// 否則 https://attacker.com/?x=google.com/maps 這種把可信字串塞進 query/path 的
// 連結會騙過檢查。國別網域沿用 GOOGLE_MAPS_HOST。
export function isMapsUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === "maps.app.goo.gl" || host === "goo.gl" || GOOGLE_MAPS_HOST.test(host);
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
// 改用「地點名稱 + 座標（若有）」做 Text Search，跟 Takeout 匯入同一套邏輯。
// 2026-07 起手機分享連結展開後常「只有名稱＋地址、完全沒有座標」
// （無 !3d!4d 也無 @lat,lng）——但名稱段本身含完整地址，直接全文搜尋即可命中，
// 所以座標是 optional：有就做 200m 偏向、沒有就純文字查。
export function extractNameAndCoords(
  url: string,
): { name: string; coords: { lat: number; lng: number } | null } | null {
  const nameMatch = url.match(/\/maps\/place\/([^/]+)\//);
  if (!nameMatch) return null;
  const name = decodeURIComponent(nameMatch[1].replace(/\+/g, " "));

  // 優先用 !3d<lat>!4d<lng>（精確標記座標）
  const preciseMatch = url.match(/!3d(-?[0-9.]+)!4d(-?[0-9.]+)/);
  if (preciseMatch) {
    return {
      name,
      coords: { lat: parseFloat(preciseMatch[1]), lng: parseFloat(preciseMatch[2]) },
    };
  }

  // 退而求其次用 @lat,lng,zoom（地圖中心，通常也很接近）
  const atMatch = url.match(/@(-?[0-9.]+),(-?[0-9.]+),/);
  if (atMatch) {
    return {
      name,
      coords: { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) },
    };
  }

  // 無座標：名稱（含地址）仍可用 Text Search 解析
  return { name, coords: null };
}

// 第四層保底：URL 路徑完全抓不到名稱時（未來 Google 再改 URL 結構），改從
// 展開頁 HTML 的內嵌資料抓 ["0x<hex>:0x<hex>","<名稱+地址>"] pair——這與 URL
// 結構是兩套獨立來源，同時改掉的機率低。若 URL 帶 hex CID 就精確配對，
// 否則取第一組。HTML 中同一 pair 有 `\"` 跳脫與未跳脫兩種形態，regex 都容忍。
export function extractNameFromHtml(html: string, finalUrl: string): string | null {
  const cidMatch = finalUrl.match(/0x[0-9a-f]+:0x[0-9a-f]+/i);
  const pairRe = /\[\\?"(0x[0-9a-f]+:0x[0-9a-f]+)\\?",\\?"([^"\\]{2,300})\\?"/gi;
  let first: string | null = null;
  for (const m of html.matchAll(pairRe)) {
    if (first === null) first = m[2];
    if (cidMatch && m[1].toLowerCase() === cidMatch[0].toLowerCase()) return m[2];
  }
  // URL 有 CID 但 HTML 配不到 → 回 null 而非 first：寧可解析失敗，也不要
  // 抓到頁面上「別的地點」（推薦清單等）——保底層的錯誤結果比沒結果更糟。
  // URL 無 CID 時才退用第一組（展開頁的主體就是這個地點）。
  return cidMatch ? null : first;
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
  coords: { lat: number; lng: number } | null,
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
        // 座標可信時做 200m 偏向；新版無座標連結靠名稱內含的完整地址命中
        ...(coords
          ? {
              locationBias: {
                circle: {
                  center: { latitude: coords.lat, longitude: coords.lng },
                  radius: 200,
                },
              },
            }
          : {}),
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
      location: {
        lat: p.location?.latitude ?? coords?.lat ?? 0,
        lng: p.location?.longitude ?? coords?.lng ?? 0,
      },
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
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return err({ kind: "invalid_url" });
  }

  // SSRF 防線：先確認網域，再 fetch。舊版是 fetch(rawUrl) 之後才用 isMapsUrl 檢查，
  // 等於請求已經送出去才攔——本站跑在 Cloud Run 上，會讓攻擊者能探測內網。
  if (!isAllowedInputUrl(parsed)) {
    return err({
      kind: "unsupported",
      reason: "只接受 Google Maps 分享連結（maps.app.goo.gl 或 google.com/maps）",
    });
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return err({ kind: "missing_key" });

  const resolved = await resolveUrl(rawUrl);
  if (!resolved.ok) return err(resolved.error);
  const { url: finalUrl, html } = resolved.value;

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

  // 新格式：名稱（＋座標，若有）→ Text Search 解析
  const nameCoords = extractNameAndCoords(finalUrl);
  if (nameCoords) {
    const place = await searchByNameAndCoords(nameCoords.name, nameCoords.coords, apiKey);
    if (place) return ok({ kind: "place", places: [place] });
  }

  // 第四層保底：URL 結構認不得時，從展開頁 HTML 內嵌資料抓名稱
  const htmlName = extractNameFromHtml(html, finalUrl);
  if (htmlName) {
    const place = await searchByNameAndCoords(htmlName, null, apiKey);
    if (place) return ok({ kind: "place", places: [place] });
  }

  // Google 改 URL/頁面格式時，這行 log 是最快的診斷入口——直接看展開後的
  // 完整網址長什麼樣，不必重現使用者的連結（2026-07-16 事故教訓）。
  console.error("[sharelink] all extractors failed, finalUrl:", finalUrl);

  return err({
    kind: "unsupported",
    reason: "目前僅支援單一地點連結。清單請改用 Google Takeout 或 Chrome 擴充匯入。",
  });
}
