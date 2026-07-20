// ⚠️ 伺服器端專用：Frankfurter 匯率（免 Key，歐洲央行 ECB 資料）

/** 國家代碼（ISO 3166-1 alpha-2） → 貨幣代碼（ISO 4217） */
const COUNTRY_TO_CURRENCY: Record<string, string> = {
  JP: "JPY",
  KR: "KRW",
  TH: "THB",
  VN: "VND",
  SG: "SGD",
  MY: "MYR",
  HK: "HKD",
  US: "USD",
  AU: "AUD",
  GB: "GBP",
  DE: "EUR",
  FR: "EUR",
  IT: "EUR",
  ES: "EUR",
  TW: "TWD",
  CN: "CNY",
  ID: "IDR",
  PH: "PHP",
};

export function countryToCurrency(countryCode: string): string | null {
  return COUNTRY_TO_CURRENCY[countryCode] ?? null;
}

export type ExchangeRate = {
  from: string;  // 來源貨幣，例 "TWD"
  to: string;    // 目標貨幣，例 "JPY"
  rate: number;  // 1 from = rate to
};

/**
 * 取即時匯率（Frankfurter，免 Key）
 * 回傳 null 表示 API 失敗或不支援的貨幣對。
 */
export async function fetchExchangeRate(
  from: string,
  to: string,
): Promise<ExchangeRate | null> {
  if (from === to) return { from, to, rate: 1 };
  try {
    const url = `https://api.frankfurter.app/latest?from=${from}&to=${to}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { rates?: Record<string, number> };
    const rate = data.rates?.[to];
    if (typeof rate !== "number") return null;
    return { from, to, rate };
  } catch {
    return null;
  }
}

/**
 * 取多目標即時匯率（Frankfurter，免 Key）。回傳 `{ [to]: rate }`，語意為 1 from = rate to。
 * 與 from 相同的目標會被略過；失敗或全數不支援回傳空物件（best-effort）。
 */
export async function fetchExchangeRates(
  from: string,
  to: string[],
): Promise<Record<string, number>> {
  const targets = to.filter((t) => t !== from);
  if (targets.length === 0) return {};
  try {
    const url = `https://api.frankfurter.app/latest?from=${from}&to=${targets.join(",")}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return {};
    const data = (await res.json()) as { rates?: Record<string, number> };
    return data.rates ?? {};
  } catch {
    return {};
  }
}
