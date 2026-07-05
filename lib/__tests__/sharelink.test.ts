import { describe, it, expect } from "vitest";
import { isAllowedInputUrl, isMapsUrl } from "@/lib/sharelink";

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
