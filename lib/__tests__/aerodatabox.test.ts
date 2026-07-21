import { describe, it, expect } from "vitest";
import { splitLocalDateTime, pickFlight, daysDiff, type AdbFlight } from "@/lib/aerodatabox";

/**
 * AeroDataBox 回應解析（純函式，不打 API）。
 * local 已是機場當地時間 → 就地取值；多筆取排定出發最早者。
 */
const row = (over: Partial<AdbFlight> = {}): AdbFlight => ({
  number: "BR 198",
  airline: { name: "EVA Air", iata: "BR" },
  departure: {
    airport: { name: "Taoyuan International", iata: "TPE" },
    scheduledTime: { utc: "2026-07-25 00:05Z", local: "2026-07-25 08:05+08:00" },
  },
  arrival: {
    airport: { name: "Narita International", iata: "NRT" },
    scheduledTime: { utc: "2026-07-25 03:20Z", local: "2026-07-25 12:20+09:00" },
  },
  ...over,
});

describe("splitLocalDateTime", () => {
  it("空白分隔（AeroDataBox 慣用格式）→ 取日期與 HH:mm，不做時區換算", () => {
    expect(splitLocalDateTime("2026-07-25 08:05+08:00")).toEqual({ date: "2026-07-25", hhmm: "08:05" });
  });

  it("ISO T 分隔也吃", () => {
    expect(splitLocalDateTime("2026-07-25T08:05:00+08:00")).toEqual({ date: "2026-07-25", hhmm: "08:05" });
  });

  it("缺值/亂格式 → undefined", () => {
    expect(splitLocalDateTime(undefined)).toBeUndefined();
    expect(splitLocalDateTime("")).toBeUndefined();
    expect(splitLocalDateTime("08:05")).toBeUndefined();
  });
});

describe("pickFlight", () => {
  it("單筆完整 → 組出結果（含 dataDate = 出發地當地日期）", () => {
    const r = pickFlight([row()], "BR198");
    expect(r).toEqual({
      airline: "長榮航空", // 第一層離線中文名優先於 API 的 "EVA Air"
      from: "Taoyuan International TPE",
      to: "Narita International NRT",
      departTime: "08:05",
      arriveTime: "12:20",
      dataDate: "2026-07-25",
    });
  });

  it("未知航空代碼 → 退用 API 英文名", () => {
    const r = pickFlight([row()], "ZZ123");
    expect(r?.airline).toBe("EVA Air");
  });

  it("多筆（同號一日多班/多航段）→ 取排定出發最早者", () => {
    const later = row({
      departure: {
        airport: { name: "Songshan", iata: "TSA" },
        scheduledTime: { local: "2026-07-25 15:30+08:00" },
      },
    });
    const r = pickFlight([later, row()], "BR198");
    expect(r?.departTime).toBe("08:05");
    expect(r?.from).toContain("TPE");
  });

  it("缺起降資訊的列被剔除；全部不可用 → undefined", () => {
    const broken = row({ arrival: undefined });
    expect(pickFlight([broken, row()], "BR198")?.arriveTime).toBe("12:20");
    expect(pickFlight([broken], "BR198")).toBeUndefined();
    expect(pickFlight([], "BR198")).toBeUndefined();
  });

  it("local 缺 → 退用 utc 字串取時刻（寧可有值讓使用者校對）", () => {
    const utcOnly = row({
      departure: {
        airport: { name: "Taoyuan International", iata: "TPE" },
        scheduledTime: { utc: "2026-07-25 00:05Z" },
      },
    });
    const r = pickFlight([utcOnly], "BR198");
    expect(r?.departTime).toBe("00:05");
    expect(r?.dataDate).toBe("2026-07-25");
  });

  it("機場名/代碼缺一用另一個", () => {
    const noName = row({
      departure: {
        airport: { iata: "TPE" },
        scheduledTime: { local: "2026-07-25 08:05+08:00" },
      },
    });
    expect(pickFlight([noName], "BR198")?.from).toBe("TPE");
  });

  it("缺 scheduledTime 時退用 predictedTime（尚無正式排班、僅即時追蹤的航班，實測 JX302 案例）", () => {
    const predictedOnly = row({
      departure: {
        airport: { name: "Taichung", iata: "RMQ" },
        predictedTime: { utc: "2026-07-11 04:29Z", local: "2026-07-11 12:29+08:00" },
      },
    });
    const r = pickFlight([predictedOnly], "JX302");
    expect(r?.departTime).toBe("12:29");
    expect(r?.dataDate).toBe("2026-07-11");
    expect(r?.from).toContain("RMQ");
  });

  it("scheduledTime 與 predictedTime 都有時，scheduledTime 優先", () => {
    const both = row({
      departure: {
        airport: { name: "Taipei", iata: "TPE" },
        scheduledTime: { local: "2026-07-25 08:05+08:00" },
        predictedTime: { local: "2026-07-25 08:20+08:00" },
      },
    });
    expect(pickFlight([both], "BR198")?.departTime).toBe("08:05");
  });

  it("scheduledTime 與 predictedTime 都缺（僅機場名，實測遠期未來日期案例）→ 該列被剔除", () => {
    const bothMissing = row({
      departure: { airport: { name: "Taychzhun" } },
    });
    expect(pickFlight([bothMissing], "JX302")).toBeUndefined();
  });
});

describe("pickFlight — 即時動態欄位（specs/flight-day-status.md，欄位名經 BR198 真實 API 呼叫核對）", () => {
  it("有 status/revisedTime/terminal/gate → 全部帶出", () => {
    const live = row({
      status: "Delayed",
      departure: {
        airport: { name: "Taoyuan International", iata: "TPE" },
        scheduledTime: { local: "2026-07-25 08:05+08:00" },
        revisedTime: { local: "2026-07-25 08:45+08:00" },
        terminal: "2",
        gate: "D17",
      },
      arrival: {
        airport: { name: "Narita International", iata: "NRT" },
        scheduledTime: { local: "2026-07-25 12:20+09:00" },
        revisedTime: { local: "2026-07-25 13:00+09:00" },
        terminal: "1S",
      },
    });
    const r = pickFlight([live], "BR198");
    expect(r?.status).toBe("Delayed");
    expect(r?.revisedDepartTime).toBe("08:45");
    expect(r?.revisedArriveTime).toBe("13:00");
    expect(r?.departTerminal).toBe("2");
    expect(r?.departGate).toBe("D17");
    expect(r?.arriveTerminal).toBe("1S");
  });

  it("未來日期（尚未進入即時追蹤）→ 這些欄位全部 undefined，不影響既有 schedule 欄位", () => {
    const r = pickFlight([row()], "BR198");
    expect(r?.status).toBeUndefined();
    expect(r?.revisedDepartTime).toBeUndefined();
    expect(r?.departTerminal).toBeUndefined();
    expect(r?.departTime).toBe("08:05"); // 既有欄位不受影響
  });
});

describe("daysDiff — 兩個 YYYY-MM-DD 相差天數（specs/flight-day-status.md 的 ±1 天容忍）", () => {
  it("同一天 → 0", () => {
    expect(daysDiff("2026-07-21", "2026-07-21")).toBe(0);
  });

  it("差一天（前一天/後一天）→ ±1", () => {
    expect(daysDiff("2026-07-22", "2026-07-21")).toBe(1);
    expect(daysDiff("2026-07-20", "2026-07-21")).toBe(-1);
  });

  it("差兩天以上 → 絕對值 > 1", () => {
    expect(Math.abs(daysDiff("2026-07-25", "2026-07-21"))).toBeGreaterThan(1);
  });
});
