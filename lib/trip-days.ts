// 天數推斷與覆蓋驗證（純函式，供 generateTrip 與單測使用）。
// 修正「一句話生成只出特殊需求那一天」：使用者沒填天數時從 prompt 推斷最低天數，
// 生成後檢查 days 覆蓋完整性（見 task/PLAN.md 修正一）。

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
