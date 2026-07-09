import { describe, it, expect } from "vitest";
import { hhmmFromScheduled } from "../aviationstack";

describe("hhmmFromScheduled", () => {
  it("有 timezone：把 UTC instant 轉成機場當地 HH:mm（09:00 UTC = 17:00 台北）", () => {
    expect(hhmmFromScheduled("2026-07-09T09:00:00+00:00", "Asia/Taipei")).toBe("17:00");
  });

  it("有 timezone：東京（00:50 UTC = 09:50 東京）", () => {
    expect(hhmmFromScheduled("2026-09-25T00:50:00+00:00", "Asia/Tokyo")).toBe("09:50");
  });

  it("跨日：14:50 UTC = 22:50 台北", () => {
    expect(hhmmFromScheduled("2026-09-25T14:50:00+00:00", "Asia/Taipei")).toBe("22:50");
  });

  it("scheduled 缺時區標記時當 UTC 解析（補 Z）：09:00 → 17:00 台北", () => {
    expect(hhmmFromScheduled("2026-07-09T09:00:00", "Asia/Taipei")).toBe("17:00");
  });

  it("午夜輸出 00:00 而非 24:00（hourCycle h23）：16:00 UTC = 隔日 00:00 台北", () => {
    expect(hhmmFromScheduled("2026-09-25T16:00:00+00:00", "Asia/Taipei")).toBe("00:00");
  });

  it("缺 timezone：fallback 取 ISO T 後 5 碼（不轉時區）", () => {
    expect(hhmmFromScheduled("2026-09-25T10:00:00+08:00")).toBe("10:00");
    expect(hhmmFromScheduled("2026-09-25T23:50:00+08:00")).toBe("23:50");
  });

  it("無效 timezone：fallback 取 ISO T 後 5 碼，不丟例外", () => {
    expect(hhmmFromScheduled("2026-09-25T10:00:00+08:00", "Not/AZone")).toBe("10:00");
  });

  it("異常字串 / 空字串 → 空字串（best-effort，不丟例外）", () => {
    expect(hhmmFromScheduled("garbage", "Asia/Taipei")).toBe("");
    expect(hhmmFromScheduled("garbage")).toBe("");
    expect(hhmmFromScheduled("")).toBe("");
    expect(hhmmFromScheduled("", "Asia/Taipei")).toBe("");
  });
});
