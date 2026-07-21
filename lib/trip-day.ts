// 旅途模式：行程期間的「今日」判斷（純函式，供單測）。specs/trip-day-mode.md §1.1。
import { timeToMin } from "./trip-edit";

/** client 本地日期字串 YYYY-MM-DD（本地時區，非 UTC——旅途中裝置時區跟人走，本地日就是行程日）。 */
export function todayLocalDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 今天是行程第幾天（1-based）；`startDate` 缺席（舊行程）或今天不在行程期間 → null，
 * 頁面行為與現在完全一致（specs/trip-day-mode.md §2「增強而非改版」）。
 * 固定用 UTC 午夜比較日期字串本身（同 lib/trip-days.ts 的 dateForDay/daysDiff 慣例），
 * 避免時區/DST 讓日期差算錯——`today` 本身已是呼叫端算好的本地日字串，這裡只做日期算術。
 */
export function currentTripDay(
  startDate: string | undefined,
  totalDays: number,
  today: string,
): number | null {
  if (!startDate) return null;
  const start = new Date(`${startDate}T00:00:00Z`);
  const t = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(t.getTime())) return null;
  const diffDays = Math.round((t.getTime() - start.getTime()) / 86_400_000);
  const day = diffDays + 1;
  return day >= 1 && day <= totalDays ? day : null;
}

/** 依現在時刻（HH:mm）找當天排程「下一站」的索引；都已過或時刻解析失敗 → null。 */
export function findNextStopIndex(schedule: { time: string }[], nowHHMM: string): number | null {
  const nowMin = timeToMin(nowHHMM);
  if (nowMin === undefined) return null;

  let best: number | null = null;
  let bestMin = Infinity;
  schedule.forEach((s, i) => {
    const m = timeToMin(s.time);
    if (m !== undefined && m >= nowMin && m < bestMin) {
      bestMin = m;
      best = i;
    }
  });
  return best;
}
