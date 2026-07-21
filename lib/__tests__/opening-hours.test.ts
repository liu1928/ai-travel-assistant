import { describe, it, expect } from "vitest";
import { compressOpeningHours, formatOpeningHoursSummary, checkScheduleAgainstHours } from "../opening-hours";

describe("compressOpeningHours — Google periods 壓縮成 per-weekday 字串", () => {
  it("全週 24h 特例（單一 period、day0/hour0/minute0、無 close）", () => {
    const map = compressOpeningHours([{ open: { day: 0, hour: 0, minute: 0 } }]);
    for (let d = 0; d < 7; d++) expect(map[String(d)]).toBe("24h");
  });

  it("單日單時段", () => {
    const map = compressOpeningHours([
      { open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } },
    ]);
    expect(map["1"]).toBe("09:00-17:00");
    expect(map["2"]).toBe(null);
  });

  it("單日多時段（午休）合併成逗號分隔", () => {
    const map = compressOpeningHours([
      { open: { day: 2, hour: 9, minute: 0 }, close: { day: 2, hour: 14, minute: 0 } },
      { open: { day: 2, hour: 17, minute: 0 }, close: { day: 2, hour: 21, minute: 0 } },
    ]);
    expect(map["2"]).toBe("09:00-14:00,17:00-21:00");
  });

  it("跨午夜時段歸屬 open 那天，close 時間原樣記錄", () => {
    const map = compressOpeningHours([
      { open: { day: 5, hour: 22, minute: 0 }, close: { day: 6, hour: 2, minute: 0 } },
    ]);
    expect(map["5"]).toBe("22:00-02:00");
    expect(map["6"]).toBe(null);
  });

  it("沒有任何 period → 全部公休", () => {
    const map = compressOpeningHours([]);
    for (let d = 0; d < 7; d++) expect(map[String(d)]).toBe(null);
  });

  it("一般 period 意外缺 close（非全週特例）→ 該天防禦性視為 24h", () => {
    const map = compressOpeningHours([
      { open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } },
      { open: { day: 3, hour: 0, minute: 0 } }, // 缺 close，但不是全週特例（periods.length !== 1）
    ]);
    expect(map["1"]).toBe("09:00-17:00");
    expect(map["3"]).toBe("24h");
  });

  it("同一天先出現缺 close 的 period、後面又有正常時段 → 不混成髒資料，維持 24h", () => {
    const map = compressOpeningHours([
      { open: { day: 2, hour: 0, minute: 0 } }, // 缺 close，防禦性判 24h
      { open: { day: 2, hour: 17, minute: 0 }, close: { day: 2, hour: 21, minute: 0 } },
    ]);
    expect(map["2"]).toBe("24h");
  });
});

describe("formatOpeningHoursSummary — 壓縮映射轉人類可讀摘要", () => {
  it("全週相同時段 → 合併成一段", () => {
    const hours = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), "09:00-17:00"]));
    expect(formatOpeningHoursSummary(hours)).toBe("週一–週日 09:00-17:00");
  });

  it("週一公休，其餘正常營業（相鄰合併，週一單獨）", () => {
    const hours: Record<string, string | null> = {
      "0": "11:00-21:00",
      "1": null,
      "2": "11:00-21:00",
      "3": "11:00-21:00",
      "4": "11:00-21:00",
      "5": "11:00-21:00",
      "6": "11:00-21:00",
    };
    expect(formatOpeningHoursSummary(hours)).toBe("週一 公休；週二–週日 11:00-21:00");
  });

  it("全週 24h", () => {
    const hours = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), "24h"]));
    expect(formatOpeningHoursSummary(hours)).toBe("週一–週日 24小時營業");
  });

  it("全週公休", () => {
    const hours = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), null]));
    expect(formatOpeningHoursSummary(hours)).toBe("週一–週日 公休");
  });
});

describe("checkScheduleAgainstHours — 生成後公休/時段驗證", () => {
  const hours = {
    "0": null, // 週日公休
    "1": "09:00-17:00",
    "2": "09:00-14:00,17:00-21:00",
    "3": "24h",
    "5": "22:00-02:00", // 跨午夜
  };

  it("hours 缺席（無資料）→ 不驗", () => {
    expect(checkScheduleAgainstHours({ time: "10:00" }, 1, undefined)).toBeUndefined();
  });

  it("該天缺席（map 沒有該 key）→ 不驗", () => {
    expect(checkScheduleAgainstHours({ time: "10:00" }, 4, hours)).toBeUndefined();
  });

  it("該天公休 → 回傳警示", () => {
    expect(checkScheduleAgainstHours({ time: "10:00" }, 0, hours)).toBe("當日（週日）公休");
  });

  it("24h → 不驗", () => {
    expect(checkScheduleAgainstHours({ time: "03:00" }, 3, hours)).toBeUndefined();
  });

  it("時段內（含 durationMin）→ 不驗", () => {
    expect(checkScheduleAgainstHours({ time: "10:00", durationMin: 60 }, 1, hours)).toBeUndefined();
  });

  it("時段外（超過打烊時間）→ 回傳警示", () => {
    const r = checkScheduleAgainstHours({ time: "16:30", durationMin: 60 }, 1, hours);
    expect(r).toBe("不在營業時間內（週一 09:00-17:00）");
  });

  it("開始時間就在打烊後 → 回傳警示", () => {
    expect(checkScheduleAgainstHours({ time: "18:00" }, 1, hours)).toBe("不在營業時間內（週一 09:00-17:00）");
  });

  it("多時段：落在午休空檔 → 回傳警示", () => {
    expect(checkScheduleAgainstHours({ time: "15:00" }, 2, hours)).toBe(
      "不在營業時間內（週二 09:00-14:00,17:00-21:00）",
    );
  });

  it("多時段：落在第二段（晚餐）→ 不驗", () => {
    expect(checkScheduleAgainstHours({ time: "18:00", durationMin: 60 }, 2, hours)).toBeUndefined();
  });

  it("跨午夜範圍：23:00 開始（涵蓋到隔天 02:00）→ 不驗", () => {
    expect(checkScheduleAgainstHours({ time: "23:00", durationMin: 60 }, 5, hours)).toBeUndefined();
  });

  it("沒有 durationMin 時預設 60 分鐘", () => {
    // 16:30 + 60 = 17:30，超過 17:00 打烊
    expect(checkScheduleAgainstHours({ time: "16:30" }, 1, hours)).toBe(
      "不在營業時間內（週一 09:00-17:00）",
    );
  });

  it("time 格式不合 → 不驗", () => {
    expect(checkScheduleAgainstHours({ time: "9am" }, 1, hours)).toBeUndefined();
  });
});
