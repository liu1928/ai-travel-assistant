// ⚠️ 伺服器端專用：AviationStack 航班查詢（帶航線 + 起降時刻，真實 API 非 AI）。
// 見 specs/flight-lookup.md。航班 autofill 第二層（第一層＝離線帶航空公司名 lib/airlines.ts）。
import { airlineFromFlightNo } from "./airlines";
import { ok, err, type Result } from "./result";
import { envOr } from "./env";

export type FlightLookupResult = {
  airline?: string;
  from: string; // "Taoyuan International TPE" 風格（airport + iata）
  to: string;
  departTime: string; // HH:mm（機場當地）
  arriveTime: string; // HH:mm（機場當地，跨日不另計，見 spec §7）
};
export type FlightLookupError =
  | { kind: "missing_key" }
  | { kind: "not_found" } // API 回空 data / 缺 dep·arr
  | { kind: "api_error"; message: string };

type AsEndpoint = { airport?: string; iata?: string; timezone?: string; scheduled?: string };
type AsRow = {
  departure?: AsEndpoint;
  arrival?: AsEndpoint;
  airline?: { name?: string; iata?: string };
  flight?: { iata?: string; number?: string };
};
type AsResponse = {
  data?: AsRow[];
  error?: { code?: number; type?: string; message?: string; info?: string };
};

/**
 * 把 AviationStack 的 `scheduled`（實測是 UTC，如 `2026-07-09T09:00:00+00:00`）轉成
 * 機場當地 HH:mm。⚠️ 不能直接切字串——09:00 UTC = 17:00 台北。
 * 純函式（供單測）：有 timezone → 用 Intl 轉當地時區；缺/無效 → fallback 取 ISO `T` 後 5 碼。
 * hourCycle:"h23" 保證 00–23（避免 en-GB 午夜輸出 "24:00"）。Node 24 內建 full ICU 支援 IANA tz。
 */
export function hhmmFromScheduled(scheduledIso: string, timezone?: string): string {
  if (!scheduledIso) return "";
  if (timezone && timezone.trim() !== "") {
    // AviationStack 的 scheduled 是 UTC；若字串缺時區標記（Z/±hh:mm），補 Z 強制以 UTC 解析，
    // 否則 new Date() 會當「伺服器本地時間」→ 換算全錯。
    const hasTz = /(?:Z|[+-]\d{2}:?\d{2})$/.test(scheduledIso);
    const d = new Date(hasTz ? scheduledIso : `${scheduledIso}Z`);
    if (!Number.isNaN(d.getTime())) {
      try {
        return new Intl.DateTimeFormat("en-GB", {
          timeZone: timezone,
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(d);
      } catch {
        // 無效 timezone（RangeError）→ 落到下方 fallback
      }
    }
  }
  // fallback：無 timezone（或無效）→ 取 ISO `T` 後的 HH:mm，不轉時區
  const m = scheduledIso.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : "";
}

// `${airport} ${iata}`；任一缺就用有的那個；都缺 → 空字串（呼叫端當 not_found）
function airportLabel(a: AsEndpoint): string {
  return [a.airport, a.iata]
    .filter((x): x is string => typeof x === "string" && x.trim() !== "")
    .join(" ")
    .trim();
}

export async function lookupFlight(
  flightNo: string,
): Promise<Result<FlightLookupResult, FlightLookupError>> {
  const key = process.env.AVIATIONSTACK_API_KEY;
  if (!key || key.trim() === "") return err({ kind: "missing_key" });

  // 免費方案只支援 http（付費才 https）→ BASE 走 env，預設 https。
  const base = envOr("AVIATIONSTACK_BASE_URL", "https://api.aviationstack.com/v1").replace(/\/+$/, "");
  const iata = flightNo.trim().toUpperCase().replace(/\s+/g, "");
  if (!iata) return err({ kind: "not_found" });

  const url = `${base}/flights?access_key=${encodeURIComponent(key)}&flight_iata=${encodeURIComponent(iata)}`;

  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    return err({ kind: "api_error", message: e instanceof Error ? e.message : String(e) });
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return err({ kind: "api_error", message: `AviationStack ${res.status}: ${t.slice(0, 200)}` });
  }

  let json: AsResponse;
  try {
    json = (await res.json()) as AsResponse;
  } catch {
    return err({ kind: "api_error", message: "回應不是合法 JSON" });
  }
  // 免費方案超額 / 參數錯等，AviationStack 常回 200 + { error: {...} }
  if (json.error) {
    return err({ kind: "api_error", message: json.error.message ?? json.error.type ?? "AviationStack error" });
  }

  const row = json.data?.[0];
  const dep = row?.departure;
  const arr = row?.arrival;
  if (!row || !dep || !arr) return err({ kind: "not_found" });

  const from = airportLabel(dep);
  const to = airportLabel(arr);
  const departTime = hhmmFromScheduled(dep.scheduled ?? "", dep.timezone);
  const arriveTime = hhmmFromScheduled(arr.scheduled ?? "", arr.timezone);
  // 任一關鍵欄位解析不出 → 當查無（best-effort，不丟例外）
  if (!from || !to || !departTime || !arriveTime) return err({ kind: "not_found" });

  // 航空公司：第一層離線中文名優先，沒有再用 API 英文名
  const airline = airlineFromFlightNo(iata) ?? (row.airline?.name?.trim() || undefined);

  return ok({ airline, from, to, departTime, arriveTime });
}
