// 訂房連結（可插拔變現）。純函式、可 client/server 共用。見 specs/lodging-suggest.md。
// 依 NEXT_PUBLIC_ 環境變數決定變現商（優先序 Stay22 > Booking aid > Travelpayouts）；
// 都沒設 → 產純 Booking 搜尋連結（可用、無佣金）。NEXT_PUBLIC_ 於 build 時內嵌，client 也讀得到。

export type LodgingLinkInput = {
  query: string; // 目的地或旅宿名
  checkIn?: string; // YYYY-MM-DD
  checkOut?: string; // YYYY-MM-DD
  adults?: number; // 預設 2
};

function bookingSearchUrl(input: LodgingLinkInput, aid?: string): string {
  const p = new URLSearchParams();
  p.set("ss", input.query);
  if (input.checkIn) p.set("checkin", input.checkIn);
  if (input.checkOut) p.set("checkout", input.checkOut);
  p.set("group_adults", String(input.adults ?? 2));
  if (aid) p.set("aid", aid);
  return `https://www.booking.com/searchresults.html?${p.toString()}`;
}

export function buildLodgingLink(input: LodgingLinkInput): string {
  const stay22 = process.env.NEXT_PUBLIC_STAY22_AID;
  const bookingAid = process.env.NEXT_PUBLIC_BOOKING_AID;
  const tpMarker = process.env.NEXT_PUBLIC_TRAVELPAYOUTS_MARKER;

  // Stay22（推薦；聚合多 OTA）。實際 host/參數以 Stay22 官方文件為準，這裡是可運作的預設格式。
  if (stay22) {
    const p = new URLSearchParams();
    p.set("aid", stay22);
    p.set("address", input.query);
    if (input.checkIn) p.set("checkin", input.checkIn);
    if (input.checkOut) p.set("checkout", input.checkOut);
    p.set("adults", String(input.adults ?? 2));
    return `https://www.stay22.com/embed/gm?${p.toString()}`;
  }
  // Booking 原生 affiliate id
  if (bookingAid) return bookingSearchUrl(input, bookingAid);
  // Travelpayouts redirect 包裝一個 booking URL（格式以 Travelpayouts 文件為準）
  if (tpMarker) {
    const dest = encodeURIComponent(bookingSearchUrl(input));
    return `https://tp.media/r?marker=${encodeURIComponent(tpMarker)}&u=${dest}`;
  }
  // 都沒設 → 純 Booking 搜尋連結（無佣金）
  return bookingSearchUrl(input);
}
