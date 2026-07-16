import { describe, it, expect } from "vitest";
import {
  extractNameAndCoords,
  extractNameFromHtml,
  isAllowedInputUrl,
  isMapsUrl,
} from "@/lib/sharelink";

/**
 * SSRF 防護的核心：只有可信的 Google Maps／短連結網域、且為 https，
 * 才准對「使用者貼進來的原始連結」發出 fetch。
 */
describe("isAllowedInputUrl (SSRF guard)", () => {
  const allow = (s: string) => isAllowedInputUrl(new URL(s));

  it("接受 Google Maps 短連結與主網域（https）", () => {
    expect(allow("https://maps.app.goo.gl/abc123")).toBe(true);
    expect(allow("https://goo.gl/maps/xyz")).toBe(true);
    expect(allow("https://www.google.com/maps/place/Foo")).toBe(true);
    expect(allow("https://google.com/maps")).toBe(true);
    expect(allow("https://maps.google.com/?q=1")).toBe(true);
    expect(allow("https://maps.google.co.jp/place/Bar")).toBe(true);
    expect(allow("https://www.google.de/maps")).toBe(true);
  });

  it("擋掉內網探測目標（SSRF 主要威脅）", () => {
    expect(allow("http://metadata.google.internal/computeMetadata/v1/")).toBe(false);
    expect(allow("https://metadata.google.internal/")).toBe(false);
    expect(allow("http://169.254.169.254/")).toBe(false);
    expect(allow("http://localhost:8080/")).toBe(false);
    expect(allow("https://127.0.0.1/")).toBe(false);
  });

  it("擋掉非 https 協定", () => {
    expect(allow("http://www.google.com/maps")).toBe(false);
    expect(allow("ftp://google.com/maps")).toBe(false);
  });

  it("擋掉把 google 當子字串的偽造網域", () => {
    expect(allow("https://google.evil.com/maps")).toBe(false);
    expect(allow("https://maps.google.com.evil.com/")).toBe(false);
    expect(allow("https://notgoogle.com/maps")).toBe(false);
    expect(allow("https://google.evil.jp/")).toBe(false);
  });
});

/**
 * isMapsUrl 驗證「轉址後的最終網址」。用 hostname 精確比對，
 * 不能被塞在 query/path 裡的可信字串騙過。
 */
describe("isMapsUrl (post-redirect guard)", () => {
  it("接受轉址後的 Google Maps 網址", () => {
    expect(isMapsUrl("https://www.google.com/maps/place/Foo")).toBe(true);
    expect(isMapsUrl("https://maps.google.com/?q=1")).toBe(true);
    expect(isMapsUrl("https://maps.google.co.jp/place/Bar")).toBe(true);
    expect(isMapsUrl("https://maps.app.goo.gl/abc")).toBe(true);
  });

  it("擋掉把可信字串塞進 query/path 的偽造網址", () => {
    expect(isMapsUrl("https://attacker.com/?x=google.com/maps")).toBe(false);
    expect(isMapsUrl("https://attacker.com/maps.google.com/")).toBe(false);
    expect(isMapsUrl("not a url")).toBe(false);
  });
});

/**
 * 短連結展開後的地點抽取。2026-07 起 Google 手機分享連結展開後
 * 常「只有名稱＋地址、無任何座標」——座標必須是 optional，
 * 否則單一地點連結會被誤判成不支援（2026-07-16 實際案例）。
 */
describe("extractNameAndCoords", () => {
  it("有 !3d!4d 精確座標時抓座標", () => {
    const r = extractNameAndCoords(
      "https://www.google.com/maps/place/Foo+Bar/@25.03,121.56,17z/data=!3m1!4b1!4m6!3m5!1s0xabc:0xdef!8m2!3d25.033976!4d121.564472!16s",
    );
    expect(r).not.toBeNull();
    expect(r!.name).toBe("Foo Bar");
    expect(r!.coords).toEqual({ lat: 25.033976, lng: 121.564472 });
  });

  it("無 !3d!4d 時退用 @lat,lng 地圖中心", () => {
    const r = extractNameAndCoords(
      "https://www.google.com/maps/place/Foo/@25.03,121.56,17z/data=!4m2!3m1!1s0xabc:0xdef",
    );
    expect(r!.coords).toEqual({ lat: 25.03, lng: 121.56 });
  });

  it("新版無座標連結：仍回傳名稱、coords 為 null（2026-07-16 蝦蝦飯案例）", () => {
    const r = extractNameAndCoords(
      "https://www.google.com/maps/place/%E5%8F%A4%E5%AE%87%E5%88%A9%E8%9D%A6%E8%9D%A6%E9%A3%AF314+Kouri,+Nakijin,+Kunigami+District,+Okinawa+905-0406%E6%97%A5%E6%9C%AC/data=!4m2!3m1!1s0x34e459cce077ea71:0x681dbc4657cd58e5!18m1!1e1?utm_source=mstt_1",
    );
    expect(r).not.toBeNull();
    expect(r!.name).toBe("古宇利蝦蝦飯314 Kouri, Nakijin, Kunigami District, Okinawa 905-0406日本");
    expect(r!.coords).toBeNull();
  });

  it("URL 沒有 /maps/place/ 段時回 null", () => {
    expect(extractNameAndCoords("https://www.google.com/maps/@25.03,121.56,15z")).toBeNull();
    expect(extractNameAndCoords("https://maps.google.com/?cid=123")).toBeNull();
  });
});

/**
 * 第四層保底：URL 結構完全認不得時，從展開頁 HTML 內嵌的
 * ["0x<hex>:0x<hex>","<名稱+地址>"] pair 抓名稱。與 URL 結構是獨立來源。
 */
describe("extractNameFromHtml", () => {
  const CID = "0x34e459cce077ea71:0x681dbc4657cd58e5";
  const NAME = "古宇利蝦蝦飯314 Kouri, Nakijin, Kunigami District, Okinawa 905-0406日本";

  it("以 URL 中的 CID 精確配對 HTML pair（未跳脫形態）", () => {
    const html = `xx,null,["${CID}","${NAME}"],null`;
    const url = `https://www.google.com/maps/place/x/data=!4m2!3m1!1s${CID}`;
    expect(extractNameFromHtml(html, url)).toBe(NAME);
  });

  it("容忍 \\\" 跳脫形態（頁面內嵌 JS 字串）", () => {
    const html = `'\\n[[\\"${CID}\\",\\"${NAME}\\"]]'`;
    const url = `https://www.google.com/maps/place/x/data=!1s${CID}`;
    expect(extractNameFromHtml(html, url)).toBe(NAME);
  });

  it("URL 無 CID 時退用第一組 pair", () => {
    const html = `["0xaaa1:0xbbb2","第一個地點"] ["0xccc3:0xddd4","第二個地點"]`;
    expect(extractNameFromHtml(html, "https://maps.google.com/?cid=123")).toBe("第一個地點");
  });

  it("URL 有 CID 但 HTML 配不到 → null（不亂抓別的地點）", () => {
    const html = `["0xaaa1:0xbbb2","別的地點"]`;
    const url = `https://www.google.com/maps/place/x/data=!1s0xeee5:0xfff6`;
    expect(extractNameFromHtml(html, url)).toBeNull();
  });

  it("HTML 無 pair 時回 null", () => {
    expect(extractNameFromHtml("<html>Google Maps</html>", "https://maps.google.com/")).toBeNull();
  });
});
