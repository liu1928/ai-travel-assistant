// ⚠️ 伺服器端專用：收藏地點營業時間快取 + 公休驗證（specs/opening-hours.md）
// Places Details Enterprise SKU（regularOpeningHours + businessStatus 免費順帶）。
import { ok, err, type Result } from "./result";
import { timeToMin } from "./trip-edit";
import { classifyStatus, type PlaceStatusError } from "./place-status";
import { updateOpeningHours } from "./collection";
import { checkAndConsume } from "./rate-limit";
import { SERVICE_COST_USD } from "./quotas";
import { mapLimit } from "./concurrency";
import { envOr } from "./env";
import type { SavedPlace, BusinessStatus } from "@/schema/place";

export type OpeningHoursMap = Record<string, string | null>;

const WEEKDAY_ZH = ["日", "一", "二", "三", "四", "五", "六"];
const pad = (n: number) => String(n).padStart(2, "0");

type Point = { day: number; hour: number; minute: number };
type Period = { open: Point; close?: Point };

/**
 * Google `regularOpeningHours.periods[]` → 壓縮成 per-weekday 字串（純函式，供單測）。
 * 全週 24h 特例：單一 period、open={day:0,hour:0,minute:0}、無 close
 * （Google Places API (New) 官方文件明定的表示法，經 Context7 查證）。
 * 一般 period 若意外缺 close（理論上只有上述特例才會發生）防禦性視為當天 24h。
 * 跨午夜時段（close < open）歸屬 open 那天，不處理前一天延伸到隔天凌晨的反向情形（spec 已知限制）。
 */
export function compressOpeningHours(periods: Period[]): OpeningHoursMap {
  const map: OpeningHoursMap = {};
  for (let d = 0; d < 7; d++) map[String(d)] = null;
  if (periods.length === 0) return map;

  const always24h =
    periods.length === 1 &&
    !periods[0].close &&
    periods[0].open.day === 0 &&
    periods[0].open.hour === 0 &&
    periods[0].open.minute === 0;
  if (always24h) {
    for (let d = 0; d < 7; d++) map[String(d)] = "24h";
    return map;
  }

  const byDay: string[][] = Array.from({ length: 7 }, () => []);
  for (const p of periods) {
    if (byDay[p.open.day][0] === "24h") continue; // 該天已標 24h，忽略後續片段（防禦性，理論上不會與此並存）
    if (!p.close) {
      byDay[p.open.day] = ["24h"];
      continue;
    }
    const openStr = `${pad(p.open.hour)}:${pad(p.open.minute)}`;
    const closeStr = `${pad(p.close.hour)}:${pad(p.close.minute)}`;
    byDay[p.open.day].push(`${openStr}-${closeStr}`);
  }
  for (let d = 0; d < 7; d++) {
    if (byDay[d].length > 0) map[String(d)] = byDay[d].join(",");
  }
  return map;
}

/** 壓縮映射 → 人類可讀摘要，相鄰同值的星期幾合併（供 prompt 注入，週一起算）。 */
export function formatOpeningHoursSummary(hours: OpeningHoursMap): string {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const segments: string[] = [];
  let i = 0;
  while (i < order.length) {
    const val = hours[String(order[i])] ?? null;
    let j = i;
    while (j + 1 < order.length && (hours[String(order[j + 1])] ?? null) === val) j++;
    const label = val === null ? "公休" : val === "24h" ? "24小時營業" : val;
    const dayLabel =
      j === i ? `週${WEEKDAY_ZH[order[i]]}` : `週${WEEKDAY_ZH[order[i]]}–週${WEEKDAY_ZH[order[j]]}`;
    segments.push(`${dayLabel} ${label}`);
    i = j + 1;
  }
  return segments.join("；");
}

export type OpeningHoursError = PlaceStatusError;

export async function fetchOpeningHours(
  placeId: string,
): Promise<Result<{ openingHours: OpeningHoursMap | undefined; businessStatus: BusinessStatus }, OpeningHoursError>> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return err({ kind: "missing_key" });

  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}?languageCode=zh-TW`, {
      headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "id,regularOpeningHours,businessStatus" },
    });
    const data = (await res.json().catch(() => null)) as {
      regularOpeningHours?: { periods?: Period[] };
      businessStatus?: string;
    } | null;

    const statusResult = classifyStatus(res.status, data ? { businessStatus: data.businessStatus } : null);
    if (!statusResult.ok) return err(statusResult.error);

    // regularOpeningHours 欄位整個缺席 = 沒有公開營業時間資料，不能當「全公休」（會誤標每個排程）。
    const oh = data?.regularOpeningHours;
    const openingHours = oh ? compressOpeningHours(oh.periods ?? []) : undefined;

    return ok({ openingHours, businessStatus: statusResult.value });
  } catch (e) {
    return err({ kind: "api_error", message: e instanceof Error ? e.message : String(e) });
  }
}

const OPENING_HOURS_TTL_MS = Number(envOr("OPENING_HOURS_TTL_DAYS", "7")) * 86_400_000;
const OPENING_HOURS_MAX_PLACES = Number(envOr("OPENING_HOURS_MAX_PLACES", "20"));

/**
 * TTL 快取 + cap 補強收藏地點的營業時間（best-effort：任何步驟失敗都回傳原陣列，不阻擋生成）。
 * businessStatus 免費順帶更新（specs/place-freshness.md），與 openingHoursCheckedAt 同次 Firestore 寫入。
 */
export async function ensureOpeningHours(uid: string, places: SavedPlace[]): Promise<SavedPlace[]> {
  const now = Date.now();
  const stale = places.filter(
    (p) => !p.openingHoursCheckedAt || now - p.openingHoursCheckedAt > OPENING_HOURS_TTL_MS,
  );
  const batch = stale.slice(0, OPENING_HOURS_MAX_PLACES);
  if (batch.length === 0) return places;

  const gate = await checkAndConsume(uid, "opening_hours", batch.length * SERVICE_COST_USD.opening_hours);
  if (!gate.ok) return places; // 配額不足：跳過補強，不阻擋生成（best-effort）

  const updates = new Map<string, { openingHours?: OpeningHoursMap; businessStatus?: BusinessStatus }>();
  await mapLimit(batch, 4, async (place) => {
    const result = await fetchOpeningHours(place.placeId);
    if (!result.ok) return;
    updates.set(place.placeId, result.value);
    await updateOpeningHours(uid, place.placeId, {
      openingHours: result.value.openingHours,
      checkedAt: now,
      businessStatus: result.value.businessStatus,
    });
  });

  return places.map((p) => {
    const u = updates.get(p.placeId);
    if (!u) return p;
    return {
      ...p,
      openingHours: u.openingHours ?? p.openingHours,
      openingHoursCheckedAt: now,
      businessStatus: u.businessStatus ?? p.businessStatus,
      statusCheckedAt: now,
    };
  });
}

/**
 * 生成後驗證單一排程項目是否落在營業時間內（純函式，供單測）。
 * hours 缺席、該天缺席、"24h" → 不驗（undefined）；null → 公休；一般時段比對 time+durationMin
 * （預設 60 分，同 lib/trip-edit.ts 慣例）；跨午夜時段 close<=open 時展開成隔天時間比對。
 */
export function checkScheduleAgainstHours(
  item: { time: string; durationMin?: number },
  weekday: number,
  hours: OpeningHoursMap | undefined,
): string | undefined {
  if (!hours) return undefined;
  const dayHours = hours[String(weekday)];
  if (dayHours === undefined) return undefined;
  if (dayHours === null) return `當日（週${WEEKDAY_ZH[weekday]}）公休`;
  if (dayHours === "24h") return undefined;

  const startMin = timeToMin(item.time);
  if (startMin === undefined) return undefined;
  const endMin = startMin + (item.durationMin ?? 60);

  const ranges = dayHours.split(",").map((r) => {
    const [o, c] = r.split("-");
    const openMin = timeToMin(o) ?? 0;
    const closeRaw = timeToMin(c) ?? 24 * 60;
    const closeMin = closeRaw <= openMin ? closeRaw + 24 * 60 : closeRaw;
    return [openMin, closeMin] as const;
  });

  const covered = ranges.some(([o, c]) => startMin >= o && endMin <= c);
  return covered ? undefined : `不在營業時間內（週${WEEKDAY_ZH[weekday]} ${dayHours}）`;
}
