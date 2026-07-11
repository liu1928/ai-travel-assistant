// 行程編輯的本地時間重排（純函式，免 LLM/API）。修正「編輯後時間不重排」：
// 進編輯模式時對原始排程算一次「有效時長」（跟著項目走），之後每次刪除/排序
// 以當天錨點時間依序累加時長重推所有 time。見 task/PLAN.md 修正二。

export const DEFAULT_DURATION_MIN = 60;
const DAY_END_MIN = 23 * 60 + 59;

/** "HH:mm" → 分鐘數；格式不合回 undefined */
export function timeToMin(t: string): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return undefined;
  return h * 60 + min;
}

/** 分鐘數 → "HH:mm"；超出 00:00–23:59 會 clamp（schema 的 time regex 不允許跨日） */
export function minToTime(m: number): string {
  const clamped = Math.max(0, Math.min(DAY_END_MIN, Math.round(m)));
  const h = Math.floor(clamped / 60);
  const mm = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

type DurationSource = { time: string; durationMin?: number };

/**
 * 每項有效時長，優先序：原始相鄰 time 差 → durationMin → 預設 60 分。
 * 差分優先（而非 durationMin 優先）：刪掉中間項目時，後面的項目剛好提前
 * 「被刪項目原本佔用的時段」，不會因 durationMin 與原排程有落差而讓
 * 沒動到的項目也跟著飄移；durationMin 補「末項沒有後繼可差分」與時間亂序的洞。
 */
export function effectiveDurations(schedule: DurationSource[]): number[] {
  return schedule.map((item, i) => {
    const cur = timeToMin(item.time);
    const next = i + 1 < schedule.length ? timeToMin(schedule[i + 1].time) : undefined;
    if (cur !== undefined && next !== undefined && next > cur) return next - cur;
    if (typeof item.durationMin === "number" && item.durationMin > 0) return Math.round(item.durationMin);
    return DEFAULT_DURATION_MIN;
  });
}

/** 把有效時長掛到每個項目上（effDurationMin 只在編輯狀態存在，儲存前要剝掉） */
export function attachDurations<T extends DurationSource>(schedule: T[]): (T & { effDurationMin: number })[] {
  const durations = effectiveDurations(schedule);
  return schedule.map((item, i) => ({ ...item, effDurationMin: durations[i] }));
}

/** 以錨點（當天開始分鐘數）依序累加時長，重推每項 time。超過 23:59 clamp 在 23:59。 */
export function reflowTimes<T extends { time: string; effDurationMin: number }>(
  schedule: T[],
  anchorMin: number,
): T[] {
  let t = anchorMin;
  return schedule.map((item) => {
    const out = { ...item, time: minToTime(t) };
    t += item.effDurationMin;
    return out;
  });
}

// Routes API 在生成時 push 進 insights 的車程文字（見 app/api/trip/generate/route.ts:174,183）。
// 編輯行程後這些數字已過期，儲存前濾掉，避免誤導。
const ROUTE_INSIGHT_RE = /^第\s*\d+\s*天(移動時間約|有地點無法定位)/;

/** 這條 insight 是不是生成當下的 Routes 車程資訊（編輯後即過期） */
export function isRouteInsight(s: string): boolean {
  return ROUTE_INSIGHT_RE.test(s);
}
