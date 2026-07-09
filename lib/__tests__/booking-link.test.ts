import { describe, it, expect, afterEach, vi } from "vitest";
import { buildLodgingLink } from "@/lib/booking-link";

// process.env.NEXT_PUBLIC_* 在測試裡直接讀 process.env（Next.js 於 build 內嵌，測試環境用真 env）
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildLodgingLink", () => {
  it("無任何變現 env → 純 Booking 搜尋連結", () => {
    vi.stubEnv("NEXT_PUBLIC_STAY22_AID", "");
    vi.stubEnv("NEXT_PUBLIC_BOOKING_AID", "");
    vi.stubEnv("NEXT_PUBLIC_TRAVELPAYOUTS_MARKER", "");
    const url = buildLodgingLink({ query: "沖繩" });
    expect(url).toContain("https://www.booking.com/searchresults.html");
    expect(url).toContain("ss=%E6%B2%96%E7%B9%A9"); // 沖繩 encode
    expect(url).toContain("group_adults=2");
    expect(url).not.toContain("aid=");
  });

  it("中文/空白 encode + 帶日期", () => {
    vi.stubEnv("NEXT_PUBLIC_STAY22_AID", "");
    vi.stubEnv("NEXT_PUBLIC_BOOKING_AID", "");
    vi.stubEnv("NEXT_PUBLIC_TRAVELPAYOUTS_MARKER", "");
    const url = buildLodgingLink({ query: "ANA Crowne Plaza Okinawa", checkIn: "2026-09-25", checkOut: "2026-09-28", adults: 3 });
    expect(url).toContain("checkin=2026-09-25");
    expect(url).toContain("checkout=2026-09-28");
    expect(url).toContain("group_adults=3");
    expect(url).toContain("ss=ANA+Crowne+Plaza+Okinawa"); // 空白 → +
  });

  it("有 NEXT_PUBLIC_STAY22_AID → 走 Stay22 Allez 深連結（優先）", () => {
    vi.stubEnv("NEXT_PUBLIC_STAY22_AID", "myaid");
    vi.stubEnv("NEXT_PUBLIC_BOOKING_AID", "shouldNotWin");
    const url = buildLodgingLink({ query: "沖繩", checkIn: "2026-09-25", checkOut: "2026-09-28" });
    expect(url).toContain("https://www.stay22.com/allez/roam");
    expect(url).toContain("aid=myaid");
    expect(url).toContain("address=%E6%B2%96%E7%B9%A9");
    expect(url).toContain("checkin=2026-09-25");
    expect(url).not.toContain("shouldNotWin");
  });

  it("只有 NEXT_PUBLIC_BOOKING_AID → Booking 帶 aid", () => {
    vi.stubEnv("NEXT_PUBLIC_STAY22_AID", "");
    vi.stubEnv("NEXT_PUBLIC_BOOKING_AID", "12345");
    vi.stubEnv("NEXT_PUBLIC_TRAVELPAYOUTS_MARKER", "");
    const url = buildLodgingLink({ query: "沖繩" });
    expect(url).toContain("booking.com/searchresults");
    expect(url).toContain("aid=12345");
  });

  it("只有 NEXT_PUBLIC_TRAVELPAYOUTS_MARKER → Travelpayouts 包裝 booking URL", () => {
    vi.stubEnv("NEXT_PUBLIC_STAY22_AID", "");
    vi.stubEnv("NEXT_PUBLIC_BOOKING_AID", "");
    vi.stubEnv("NEXT_PUBLIC_TRAVELPAYOUTS_MARKER", "mk1");
    const url = buildLodgingLink({ query: "沖繩" });
    expect(url).toContain("tp.media/r?marker=mk1");
    expect(url).toContain("u="); // 內嵌 encode 過的 booking URL
    expect(url).toContain("booking.com");
  });
});
