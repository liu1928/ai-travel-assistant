// ⚠️ 伺服器端專用：查詢目的地假日（best-effort，查不到不影響行程生成）
// 台灣：TaiwanCalendar 開源資料（含台灣特有補班補假）
// 其他國家：Nager.Date 免費公開 API（免金鑰）

export type Holiday = { date: string; name: string }; // date: YYYY-MM-DD

// 從地址字串猜目的地國家（ISO 3166-1 alpha-2）。猜不到預設台灣。
export function guessCountry(texts: string[]): string {
  const joined = texts.join(" ");
  const rules: [RegExp, string][] = [
    [/日本|Japan|沖縄|沖繩|東京|大阪|京都|北海道|Okinawa|Tokyo|Osaka|Kyoto/i, "JP"],
    [/韓國|South Korea|Seoul|首爾|釜山/i, "KR"],
    [/泰國|Thailand|Bangkok|曼谷/i, "TH"],
    [/越南|Vietnam|Hanoi|河內|胡志明/i, "VN"],
    [/新加坡|Singapore/i, "SG"],
    [/馬來西亞|Malaysia|吉隆坡/i, "MY"],
    [/香港|Hong Kong/i, "HK"],
    [/美國|United States|USA|New York|紐約|洛杉磯/i, "US"],
  ];
  for (const [pattern, code] of rules) {
    if (pattern.test(joined)) return code;
  }
  return "TW";
}

type TaiwanCalendarEntry = {
  date: string; // YYYYMMDD
  isHoliday: boolean;
  description: string;
};

async function taiwanHolidays(year: number): Promise<Holiday[]> {
  const res = await fetch(
    `https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/${year}.json`,
  );
  if (!res.ok) return [];
  const data = (await res.json()) as TaiwanCalendarEntry[];
  return data
    .filter((d) => d.isHoliday && d.description.trim() !== "")
    .map((d) => ({
      date: `${d.date.slice(0, 4)}-${d.date.slice(4, 6)}-${d.date.slice(6, 8)}`,
      name: d.description,
    }));
}

type NagerHoliday = { date: string; localName: string; name: string };

async function nagerHolidays(countryCode: string, year: number): Promise<Holiday[]> {
  const res = await fetch(
    `https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`,
  );
  if (!res.ok) return [];
  const data = (await res.json()) as NagerHoliday[];
  return data.map((d) => ({ date: d.date, name: d.localName || d.name }));
}

async function holidaysOfYear(countryCode: string, year: number): Promise<Holiday[]> {
  try {
    if (countryCode === "TW") return await taiwanHolidays(year);
    return await nagerHolidays(countryCode, year);
  } catch {
    return [];
  }
}

// 查出「行程期間（含前後 1 天緩衝）」內的假日
export async function holidaysInRange(
  countryCode: string,
  startDate: string, // YYYY-MM-DD
  days: number,
): Promise<Holiday[]> {
  const start = new Date(`${startDate}T00:00:00`);
  if (Number.isNaN(start.getTime())) return [];

  const from = new Date(start);
  from.setDate(from.getDate() - 1);
  const to = new Date(start);
  to.setDate(to.getDate() + days); // days 天行程 + 1 天緩衝

  const years = new Set([from.getFullYear(), to.getFullYear()]);
  const all: Holiday[] = [];
  for (const year of years) {
    all.push(...(await holidaysOfYear(countryCode, year)));
  }

  return all
    .filter((h) => {
      const d = new Date(`${h.date}T00:00:00`);
      return d >= from && d <= to;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}
