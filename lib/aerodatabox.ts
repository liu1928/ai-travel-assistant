// ⚠️ 伺服器端專用：AeroDataBox 航班查詢（航班號 + 出發日 → 該日排定航線與起降時刻）。
// 2026-07-11 取代 AviationStack（lib/aviationstack.ts 保留備查）：免費層即可用
// 「航班號＋未來日期」直查班表（未來最遠 365 天），回應自帶 {utc, local} 雙時區時間，
// 不需自己換算時區。見 specs/flight-lookup.md「換源 AeroDataBox」節。
import { airlineFromFlightNo } from "./airlines";
import { ok, err, type Result } from "./result";
import { envOr } from "./env";

export type FlightLookupResult = {
  airline?: string;
  from: string; // "Taoyuan International TPE" 風格（airport + iata）
  to: string;
  departTime: string; // HH:mm（機場當地）
  arriveTime: string; // HH:mm（機場當地，跨日不另計）
  dataDate: string; // 這筆班表的出發地當地日期 YYYY-MM-DD——讓前端標示資料屬於哪一天
};
export type FlightLookupError =
  | { kind: "missing_key" }
  | { kind: "not_found" } // 該日查無此航班
  | { kind: "api_error"; message: string };

// AeroDataBox FlightContract（只宣告會用到的欄位；回應是「陣列」——同號一日多班/多航段會多筆）
type AdbAirport = { name?: string; iata?: string };
type AdbTime = { utc?: string; local?: string }; // local 例："2026-07-25 08:05+08:00"
type AdbMovement = { airport?: AdbAirport; scheduledTime?: AdbTime };
export type AdbFlight = {
  number?: string;
  airline?: { name?: string; iata?: string };
  departure?: AdbMovement;
  arrival?: AdbMovement;
};

/**
 * "2026-07-25 08:05+08:00" / "2026-07-25T08:05:00+08:00" → { date, hhmm }。
 * 就地取值不做時區換算——AeroDataBox 的 local 已是機場當地時間（與 AviationStack
 * scheduled 是 UTC 的舊坑不同）。格式不符回 undefined。
 */
export function splitLocalDateTime(s: string | undefined): { date: string; hhmm: string } | undefined {
  if (!s) return undefined;
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(s);
  return m ? { date: m[1], hhmm: m[2] } : undefined;
}

// 固定時區/格式 → 模組層共用一個 formatter（GLM REVIEW 第 2 輪建議）
const TAIPEI_DATE_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" });

// `${airport} ${iata}`；任一缺就用有的那個；都缺 → 空字串（呼叫端當該筆不可用）
function airportLabel(a: AdbAirport | undefined): string {
  return [a?.name, a?.iata]
    .filter((x): x is string => typeof x === "string" && x.trim() !== "")
    .join(" ")
    .trim();
}

/**
 * 從回傳列挑一筆可用航班組成結果（純函式，供單測）：
 * 缺起降機場或時刻的列剔除；多筆（同號一日多班、多航段）取排定出發最早者。
 * local 缺時退用 utc 字串取時刻（極少見；此時 HH:mm 為 UTC，寧可有值讓使用者校對）。
 */
export function pickFlight(rows: AdbFlight[], flightNo: string): FlightLookupResult | undefined {
  const candidates = rows
    .map((row) => {
      const dep = splitLocalDateTime(row.departure?.scheduledTime?.local ?? row.departure?.scheduledTime?.utc);
      const arr = splitLocalDateTime(row.arrival?.scheduledTime?.local ?? row.arrival?.scheduledTime?.utc);
      const from = airportLabel(row.departure?.airport);
      const to = airportLabel(row.arrival?.airport);
      if (!dep || !arr || !from || !to) return undefined;
      return { row, dep, arr, from, to };
    })
    .filter((c): c is NonNullable<typeof c> => c !== undefined)
    .sort((a, b) => `${a.dep.date} ${a.dep.hhmm}`.localeCompare(`${b.dep.date} ${b.dep.hhmm}`));

  const best = candidates[0];
  if (!best) return undefined;

  // 航空公司：第一層離線中文名優先，沒有再用 API 英文名（與舊 AviationStack 行為一致）
  const airline = airlineFromFlightNo(flightNo) ?? (best.row.airline?.name?.trim() || undefined);
  return {
    airline,
    from: best.from,
    to: best.to,
    departTime: best.dep.hhmm,
    arriveTime: best.arr.hhmm,
    dataDate: best.dep.date,
  };
}

export async function lookupFlight(
  flightNo: string,
  dateLocal?: string, // YYYY-MM-DD（出發地當地日期）；未填 → 以台灣時區今日近似「今天這班」
): Promise<Result<FlightLookupResult, FlightLookupError>> {
  const key = process.env.AERODATABOX_API_KEY;
  if (!key || key.trim() === "") return err({ kind: "missing_key" });

  const base = envOr("AERODATABOX_BASE_URL", "https://aerodatabox.p.rapidapi.com").replace(/\/+$/, "");
  let host: string;
  try {
    host = new URL(base).host;
  } catch {
    return err({ kind: "api_error", message: "AERODATABOX_BASE_URL 不是合法網址" });
  }

  const iata = flightNo.trim().toUpperCase().replace(/\s+/g, "");
  if (!iata) return err({ kind: "not_found" });
  // 未填日期 → 以台灣時區的今日近似「今天這班」。用 UTC 會在台北 00:00–08:00 查到前一天
  // 的班表（GLM REVIEW 2026-07-11 ⚠️-1）；使用者主要在台灣，前端也會提示補日期。
  const date = dateLocal ?? TAIPEI_DATE_FMT.format(new Date());

  // dateLocalRole=Departure：date 一律當「出發日」解讀，紅眼班不會因抵達日吻合被撈進來
  const url = `${base}/flights/number/${encodeURIComponent(iata)}/${date}?dateLocalRole=Departure`;

  let res: Response;
  try {
    res = await fetch(url, { headers: { "x-rapidapi-key": key, "x-rapidapi-host": host } });
  } catch (e) {
    return err({ kind: "api_error", message: e instanceof Error ? e.message : String(e) });
  }
  // AeroDataBox 查無該日班次回 204（無內容）或 404
  if (res.status === 204 || res.status === 404) return err({ kind: "not_found" });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return err({ kind: "api_error", message: `AeroDataBox ${res.status}: ${t.slice(0, 200)}` });
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return err({ kind: "api_error", message: "回應不是合法 JSON" });
  }
  if (!Array.isArray(json)) return err({ kind: "api_error", message: "回應格式非預期（不是陣列）" });

  const picked = pickFlight(json as AdbFlight[], iata);
  if (!picked) return err({ kind: "not_found" });
  return ok(picked);
}
