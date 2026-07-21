import { describe, it, expect } from "vitest";
import { generateIcs } from "../ics";
import type { SavedTrip } from "../trips";

const baseTrip = (over: Partial<SavedTrip> = {}): SavedTrip => ({
  id: "trip1",
  title: "沖繩三日遊",
  location: "沖繩",
  style: "relax",
  summary: "放鬆行",
  days: [
    {
      day: 1,
      schedule: [
        { time: "09:00", title: "早餐", description: "在地咖啡廳", type: "food" },
        { time: "10:30", title: "美術館，展覽", description: "看展，散步", type: "place", durationMin: 90 },
      ],
    },
  ],
  insights: [],
  budget: { min: 2000, max: 5000 },
  flights: [],
  carRentals: [],
  lodgings: [],
  weather: [],
  createdAt: 0,
  ...over,
});

function extractLines(ics: string): string[] {
  // 摺行後的續行以單一空白開頭，先反摺回單行再逐行比對，方便測試斷言
  const raw = ics.split("\r\n");
  const unfolded: string[] = [];
  for (const line of raw) {
    if (line.startsWith(" ") && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else if (line !== "") {
      unfolded.push(line);
    }
  }
  return unfolded;
}

describe("generateIcs（specs/export-offline.md §a）", () => {
  it("基本結構：VCALENDAR/VERSION/PRODID 齊全", () => {
    const ics = generateIcs(baseTrip({ startDate: "2026-07-25" }));
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(ics).toContain("VERSION:2.0");
    expect(ics.trim().endsWith("END:VCALENDAR")).toBe(true);
  });

  it("有 startDate → 每個 schedule item 產生一個 VEVENT，日期正確換算", () => {
    const lines = extractLines(generateIcs(baseTrip({ startDate: "2026-07-25" })));
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(2);
    expect(lines).toContain("DTSTART:20260725T090000");
    expect(lines).toContain("DTEND:20260725T100000"); // 早餐無 durationMin，預設 60 分
    expect(lines).toContain("DTSTART:20260725T103000");
    expect(lines).toContain("DTEND:20260725T120000"); // durationMin=90
  });

  it("無 startDate → 不產生 schedule VEVENT，改附 X-COMMENT 說明", () => {
    const ics = generateIcs(baseTrip());
    expect(ics).not.toContain("BEGIN:VEVENT");
    expect(ics).toContain("X-COMMENT:");
  });

  it("無 startDate 但有航班/住宿 → 仍匯出航班/住宿事件", () => {
    const trip = baseTrip({
      flights: [{ flightNo: "BR198", from: "TPE", to: "OKA", date: "2026-07-25", departTime: "09:00", arriveTime: "11:00" }],
    });
    const lines = extractLines(generateIcs(trip));
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(1);
    expect(lines.some((l) => l.startsWith("SUMMARY:") && l.includes("BR198"))).toBe(true);
  });

  it("航班缺 date → 該筆略過（缺欄位降級），不噴錯", () => {
    const trip = baseTrip({
      flights: [{ flightNo: "BR198", from: "TPE", to: "OKA", departTime: "09:00", arriveTime: "11:00" }],
    });
    const lines = extractLines(generateIcs(trip));
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(0);
  });

  it("住宿只有 checkInDate（無 checkOutDate）→ 只產生入住事件", () => {
    const trip = baseTrip({
      lodgings: [{ name: "那霸飯店", checkInDate: "2026-07-25", checkInTime: "15:00" }],
    });
    const lines = extractLines(generateIcs(trip));
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(1);
    expect(lines.some((l) => l.startsWith("SUMMARY:") && l.includes("入住"))).toBe(true);
  });

  it("跨午夜的 durationMin 正確進位到隔天日期", () => {
    const trip = baseTrip({
      startDate: "2026-07-25",
      days: [
        { day: 1, schedule: [{ time: "23:30", title: "夜遊", description: "x", type: "place", durationMin: 90 }] },
      ],
    });
    const lines = extractLines(generateIcs(trip));
    expect(lines).toContain("DTSTART:20260725T233000");
    expect(lines).toContain("DTEND:20260726T010000"); // 23:30+90min = 隔天 01:00
  });

  it("SUMMARY/DESCRIPTION 跳脫逗號分號換行", () => {
    const trip = baseTrip({
      startDate: "2026-07-25",
      days: [
        { day: 1, schedule: [{ time: "10:00", title: "A, B; C", description: "第一行\n第二行", type: "place" }] },
      ],
    });
    const ics = generateIcs(trip);
    expect(ics).toContain("SUMMARY:A\\, B\\; C");
    expect(ics).toContain("第一行\\n第二行");
  });

  it("超長文字（中文）觸發摺行，摺行不切在多位元組字元中間，反摺後內容還原正確", () => {
    const longDesc = "測試摺行".repeat(30); // 遠超過 75 bytes（中文每字 3 bytes）
    const trip = baseTrip({
      startDate: "2026-07-25",
      days: [{ day: 1, schedule: [{ time: "10:00", title: "x", description: longDesc, type: "place" }] }],
    });
    const ics = generateIcs(trip);
    const rawLines = ics.split("\r\n");
    // 確認真的有摺行（DESCRIPTION 內容跨多行、續行以空白開頭）
    const descStart = rawLines.findIndex((l) => l.startsWith("DESCRIPTION:"));
    expect(rawLines[descStart + 1]?.startsWith(" ")).toBe(true);
    // 反摺後還原成原始文字，確認沒有切壞多位元組字元
    const unfolded = extractLines(ics).find((l) => l.startsWith("DESCRIPTION:"));
    expect(unfolded).toBe(`DESCRIPTION:${longDesc}`);
  });

  it("UID 帶 tripId 且不同事件不重複", () => {
    const ics = generateIcs(baseTrip({ startDate: "2026-07-25" }));
    const uids = ics.split("\r\n").filter((l) => l.startsWith("UID:"));
    expect(new Set(uids).size).toBe(uids.length);
    expect(uids[0]).toContain("trip1-");
  });
});
