import { timeToMin } from "./trip-edit";

// 天數推斷與覆蓋驗證（純函式，供 generateTrip、前端與單測使用）。
// 修正「一句話生成只出特殊需求那一天」：使用者沒填天數時從 prompt 推斷最低天數，
// 生成後檢查 days 覆蓋完整性（見 task/PLAN.md 修正一）。
//
// 本檔也處理「行程對不上使用者提到的星期幾/時段」（2026-07-11 加）：
// - extractWeekdaySignal：抽 prompt 裡的「週三/星期三/禮拜三」訊號，前端用來擋下「沒填出發日期
//   卻提到星期幾」的請求（沒有錨點日期，星期幾在數學上算不出對應第幾天）。
// - expectedDayForWeekday + checkWeekdayTimeSignal：有錨點（startDate）時，生成後驗證該星期幾
//   對應的 day 確實存在、且（若使用者也提到時段）該天有行程落在對應時間窗。

const CN_DIGIT: Record<string, number> = {
  一: 1, 兩: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

// 「3」「三」「十」「十二」「二十一」→ 正整數；解析不了回 undefined
function numFrom(s: string): number | undefined {
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n > 0 && n <= 365 ? n : undefined;
  }
  const m = /^([一兩二三四五六七八九])?(十)?([一二三四五六七八九])?$/.exec(s);
  if (!m || (!m[1] && !m[2])) return undefined;
  if (!m[2]) return m[1] ? CN_DIGIT[m[1]] : undefined;
  return (m[1] ? CN_DIGIT[m[1]] : 1) * 10 + (m[3] ? CN_DIGIT[m[3]] : 0);
}

const NUM = "\\d+|[一兩二三四五六七八九十]{1,3}";
// 使用者明示的天數訊號；取全部命中的最大值當「最低天數」。
// 「今天/明天/半天」不會誤中：數字捕捉群組只吃數字與中文數字。
const PATTERNS: RegExp[] = [
  new RegExp(`第\\s*(${NUM})\\s*[天日]`, "g"), // 第三天、第 2 日
  new RegExp(`(${NUM})\\s*天`, "g"), // 五天、5 天（含「五天四夜」的天數部分）
  new RegExp(`(${NUM})\\s*日遊`, "g"), // 三日遊
];

// 慣用語/時間指涉裡的「N 天」不是行程天數（GLM REVIEW 2026-07-11 ⚠️-1），先剔除再匹配
const IDIOM_RE = /三天兩頭|一天到晚|三天打魚|兩天曬網|這兩天|前兩天|過兩天/g;

/** 從一句話推斷最低天數；沒有天數訊號回 undefined（維持 AI 自由判斷） */
export function inferMinDays(text: string): number | undefined {
  const cleaned = text.replace(IDIOM_RE, "");
  let max: number | undefined;
  for (const re of PATTERNS) {
    for (const m of cleaned.matchAll(re)) {
      const n = numFrom(m[1]);
      if (n !== undefined && (max === undefined || n > max)) max = n;
    }
  }
  return max;
}

export type DayCoverageCheck = { ok: true } | { ok: false; reason: string };

/**
 * days 覆蓋完整性：day 編號必須從 1 開始連續（不跳號、不重複）；
 * exactDays（使用者指定天數）→ 必須恰好；minDays（prompt 推斷）→ 至少。
 */
export function checkDayCoverage(
  dayNumbers: number[],
  opts: { exactDays?: number; minDays?: number } = {},
): DayCoverageCheck {
  if (dayNumbers.length === 0) return { ok: false, reason: "days 為空" };
  const sorted = [...dayNumbers].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] !== i + 1) {
      return { ok: false, reason: `day 編號必須從 1 開始且連續（目前為 ${sorted.join("、")}）` };
    }
  }
  if (opts.exactDays !== undefined && sorted.length !== opts.exactDays) {
    return { ok: false, reason: `需要恰好 ${opts.exactDays} 天，目前為 ${sorted.length} 天` };
  }
  if (opts.minDays !== undefined && sorted.length < opts.minDays) {
    return { ok: false, reason: `依使用者輸入至少需要 ${opts.minDays} 天，目前只有 ${sorted.length} 天` };
  }
  return { ok: true };
}

// 中文星期幾字元 → JS Date.getDay() 慣例（0=日, 1=一, ..., 6=六）
const WEEKDAY_CHAR: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
// 「下」「下下」修飾詞要吃進來——沒吃的話「下週三」會被當成「週三」算成最近一次週三，
// 驗證會誤判為通過（比不驗更糟：使用者拿到錯週的行程，還被系統背書成「符合要求」）。
// GLM REVIEW 2026-07-11 🐛-1 抓到，見 lib/__tests__/trip-days.test.ts。
const WEEKDAY_RE = /(下下|下)?(?:週|星期|禮拜)([一二三四五六日天])/;

export type WeekdaySignal = { weekday: number; weekOffset: number };

/**
 * 從一句話抽「週三/下週三/下下週三/星期三/禮拜三」訊號；沒有訊號回 undefined。
 * weekday：0(日)-6(六)；weekOffset：0=本週、1=下週、2=下下週（各 +7 天）。
 * 只認第一個命中——多個不同星期幾同時出現是罕見輸入，不特別處理（見 task/MEMORY.md）。
 */
export function extractWeekdaySignal(text: string): WeekdaySignal | undefined {
  const m = WEEKDAY_RE.exec(text);
  if (!m) return undefined;
  const weekOffset = m[1] === "下下" ? 2 : m[1] === "下" ? 1 : 0;
  return { weekday: WEEKDAY_CHAR[m[2]], weekOffset };
}

// 時段關鍵字 → [開始分鐘, 結束分鐘]（含端點）
export const TIME_WINDOWS: Record<string, [number, number]> = {
  凌晨: [0, 5 * 60 + 59],
  早上: [6 * 60, 11 * 60 + 59],
  上午: [6 * 60, 11 * 60 + 59],
  中午: [11 * 60, 13 * 60],
  下午: [12 * 60, 17 * 60 + 59],
  晚上: [18 * 60, 21 * 60 + 59],
  深夜: [22 * 60, 23 * 60 + 59],
};

/** 從一句話抽時段關鍵字（早上/上午/中午/下午/晚上/凌晨/深夜）；沒有回 undefined */
export function extractTimeOfDaySignal(text: string): string | undefined {
  for (const kw of Object.keys(TIME_WINDOWS)) {
    if (text.includes(kw)) return kw;
  }
  return undefined;
}

/**
 * 以 startDate 為錨點（day 1 = startDate），算出目標星期幾對應第幾天（1-based）。
 * 取「從 day 1 起第一次出現該星期幾」的那一天，再加 weekOffset*7 天（「下週三」等修飾詞）。
 * startDate 格式不合回 undefined。
 */
export function expectedDayForWeekday(
  startDate: string,
  targetWeekday: number,
  weekOffset = 0,
): number | undefined {
  const d = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return undefined;
  const diff = (targetWeekday - d.getDay() + 7) % 7;
  return diff + 1 + weekOffset * 7;
}

/**
 * day N（1-based）對應星期幾（0=日…6=六），以 startDate 為 day 1 錨點推算。
 * startDate 格式不合回 undefined（specs/opening-hours.md 生成後驗證用）。
 */
export function weekdayForDay(startDate: string, day: number): number | undefined {
  const d = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return undefined;
  return (d.getDay() + (day - 1)) % 7;
}

/**
 * 驗證使用者提到的星期幾（換算成 expectedDay）在生成結果中確實存在；若同時提到時段，
 * 該天要有至少一項行程的 time 落在對應時間窗。expectedDay 為 undefined（沒提到星期幾，
 * 或沒有 startDate 錨點算不出）時視為不適用、直接放行——這是本檢查刻意的保守範圍：
 * 沒有錨點就無法可靠驗證，寧可不驗也不要用錯誤的猜測擋掉合法生成結果。
 */
export function checkWeekdayTimeSignal(
  days: { day: number; schedule: { time: string }[] }[],
  opts: { expectedDay?: number; timeKeyword?: string },
): DayCoverageCheck {
  if (opts.expectedDay === undefined) return { ok: true };
  const target = days.find((d) => d.day === opts.expectedDay);
  if (!target) {
    return {
      ok: false,
      reason: `使用者提到的星期幾對應第 ${opts.expectedDay} 天，但行程只有 ${days.length} 天，缺少該天的行程`,
    };
  }
  if (opts.timeKeyword) {
    const window = TIME_WINDOWS[opts.timeKeyword];
    const hasMatch = target.schedule.some((s) => {
      const min = timeToMin(s.time);
      return min !== undefined && min >= window[0] && min <= window[1];
    });
    if (!hasMatch) {
      return {
        ok: false,
        reason: `使用者提到第 ${opts.expectedDay} 天要在「${opts.timeKeyword}」，但該天沒有任何行程排在這個時段`,
      };
    }
  }
  return { ok: true };
}
