// 租車連結（可插拔變現）。純函式、可 client/server 共用、零網路呼叫。見 specs/car-rental-suggest.md。
// NEXT_PUBLIC_RENTALCARS_AID 有設 → 掛 Rentalcars Connect（Booking.com 的 B2B 租車聯盟計畫）
// 的聯盟 ID；沒設 → 產同一個搜尋連結但不帶 aid（可用、無佣金）。
// URL 格式經實際瀏覽器操作 rentalcars.com 搜尋一次核對（非憑文件猜測），aid 參數名稱對齊
// Booking.com 旗下 cars.booking.com 的既有慣例（跟 lib/booking-link.ts 的 aid 用法一致）。

export type CarRentalLinkInput = {
  pickupLocation: string;
  dropoffLocation: string;
  pickupDate?: string; // YYYY-MM-DD
  pickupTime?: string; // HH:mm
  dropoffDate?: string; // YYYY-MM-DD
  dropoffTime?: string; // HH:mm
};

function splitDate(dateStr: string | undefined, fallbackDaysFromNow: number): { year: number; month: number; day: number } {
  if (dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    if (y && m && d) return { year: y, month: m, day: d };
  }
  const d = new Date();
  d.setDate(d.getDate() + fallbackDaysFromNow);
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

function splitTime(timeStr: string | undefined): { hour: number; minute: number } {
  if (timeStr) {
    const [h, m] = timeStr.split(":").map(Number);
    if (!Number.isNaN(h) && !Number.isNaN(m)) return { hour: h, minute: m };
  }
  return { hour: 10, minute: 0 }; // 沒有時間資料時的常見預設（上午 10 點取車）
}

function rentalcarsSearchUrl(input: CarRentalLinkInput, aid?: string): string {
  const pu = splitDate(input.pickupDate, 30); // 沒填日期 → 預設 30 天後（避免落在過去日期）
  const dropoff = splitDate(input.dropoffDate, 33); // 預設比取車多 3 天
  const puTime = splitTime(input.pickupTime);
  const dropoffTime = splitTime(input.dropoffTime);

  const p = new URLSearchParams();
  p.set("intent", "direct");
  p.set("locationName", input.pickupLocation);
  p.set("dropLocationName", input.dropoffLocation);
  p.set("driversAge", "30"); // 沒有使用者年齡資料，用常見預設值
  p.set("puDay", String(pu.day));
  p.set("puMonth", String(pu.month));
  p.set("puYear", String(pu.year));
  p.set("puHour", String(puTime.hour));
  p.set("puMinute", String(puTime.minute));
  p.set("doDay", String(dropoff.day));
  p.set("doMonth", String(dropoff.month));
  p.set("doYear", String(dropoff.year));
  p.set("doHour", String(dropoffTime.hour));
  p.set("doMinute", String(dropoffTime.minute));
  p.set("ftsType", "C");
  p.set("dropFtsType", "C");
  if (aid) p.set("aid", aid);
  return `https://www.rentalcars.com/search-results?${p.toString()}`;
}

export function buildCarRentalLink(input: CarRentalLinkInput): string {
  const aid = process.env.NEXT_PUBLIC_RENTALCARS_AID;
  return rentalcarsSearchUrl(input, aid);
}
