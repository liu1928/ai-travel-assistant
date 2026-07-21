import { describe, it, expect, afterEach, vi } from "vitest";
import { buildCarRentalLink } from "@/lib/car-rental-link";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildCarRentalLink", () => {
  it("無設定 NEXT_PUBLIC_RENTALCARS_AID → 產生不含 aid 的搜尋連結", () => {
    vi.stubEnv("NEXT_PUBLIC_RENTALCARS_AID", "");
    const url = buildCarRentalLink({ pickupLocation: "沖繩那霸機場", dropoffLocation: "沖繩那霸機場" });
    expect(url).toContain("https://www.rentalcars.com/search-results");
    expect(url).not.toContain("aid=");
  });

  it("有設定 NEXT_PUBLIC_RENTALCARS_AID → 帶 aid", () => {
    vi.stubEnv("NEXT_PUBLIC_RENTALCARS_AID", "12345");
    const url = buildCarRentalLink({ pickupLocation: "Tokyo", dropoffLocation: "Tokyo" });
    expect(url).toContain("aid=12345");
  });

  it("中文/空白地點正確 encode", () => {
    vi.stubEnv("NEXT_PUBLIC_RENTALCARS_AID", "");
    const url = buildCarRentalLink({ pickupLocation: "沖繩 那霸機場", dropoffLocation: "京都駅" });
    expect(url).toContain("locationName=%E6%B2%96%E7%B9%A9+%E9%82%A3%E9%9C%B8%E6%A9%9F%E5%A0%B4");
    expect(url).toContain("dropLocationName=%E4%BA%AC%E9%83%BD%E9%A7%85");
  });

  it("有帶取車/還車日期時間 → 正確拆解成 puDay/puMonth/puYear/puHour/puMinute", () => {
    vi.stubEnv("NEXT_PUBLIC_RENTALCARS_AID", "");
    const url = buildCarRentalLink({
      pickupLocation: "Tokyo",
      dropoffLocation: "Tokyo",
      pickupDate: "2026-09-25",
      pickupTime: "14:30",
      dropoffDate: "2026-09-28",
      dropoffTime: "11:00",
    });
    expect(url).toContain("puDay=25");
    expect(url).toContain("puMonth=9");
    expect(url).toContain("puYear=2026");
    expect(url).toContain("puHour=14");
    expect(url).toContain("puMinute=30");
    expect(url).toContain("doDay=28");
    expect(url).toContain("doMonth=9");
    expect(url).toContain("doYear=2026");
    expect(url).toContain("doHour=11");
    expect(url).toContain("doMinute=0");
  });

  it("沒帶日期時間 → 仍能組出合法連結（預設值降級，不是死連結）", () => {
    vi.stubEnv("NEXT_PUBLIC_RENTALCARS_AID", "");
    const url = buildCarRentalLink({ pickupLocation: "Tokyo", dropoffLocation: "Tokyo" });
    expect(url).toMatch(/puDay=\d+/);
    expect(url).toMatch(/puMonth=\d+/);
    expect(url).toMatch(/puYear=\d{4}/);
    expect(url).toContain("puHour=10");
    expect(url).toContain("puMinute=0");
  });

  it("driversAge/ftsType/intent 固定值都存在", () => {
    vi.stubEnv("NEXT_PUBLIC_RENTALCARS_AID", "");
    const url = buildCarRentalLink({ pickupLocation: "Tokyo", dropoffLocation: "Tokyo" });
    expect(url).toContain("intent=direct");
    expect(url).toContain("driversAge=30");
    expect(url).toContain("ftsType=C");
    expect(url).toContain("dropFtsType=C");
  });
});
