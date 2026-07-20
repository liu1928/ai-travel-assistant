// ⚠️ 伺服器端專用：Open-Meteo 天氣預報（免 Key）
export type DailyWeather = {
  date: string;           // YYYY-MM-DD
  maxTempC: number;
  minTempC: number;
  precipitationMm: number;
  description: string;    // 中文天氣描述
};

type GeoResult = {
  results?: { latitude: number; longitude: number; name: string }[];
};

/** 城市名 → 座標（Open-Meteo Geocoding，免 Key） */
export async function geocodeCityName(
  name: string,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=zh`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const data = (await res.json()) as GeoResult;
    const first = data.results?.[0];
    if (!first) return null;
    return { lat: first.latitude, lng: first.longitude };
  } catch {
    return null;
  }
}

// WMO 天氣碼 → 中文描述（https://open-meteo.com/en/docs/weathercode）
const WMO_DESC: Record<number, string> = {
  0: "晴天", 1: "大致晴朗", 2: "局部多雲", 3: "陰天",
  45: "有霧", 48: "結冰霧",
  51: "輕毛毛雨", 53: "毛毛雨", 55: "大毛毛雨",
  61: "小雨", 63: "中雨", 65: "大雨",
  71: "小雪", 73: "中雪", 75: "大雪", 77: "冰晶",
  80: "陣雨", 81: "中陣雨", 82: "強陣雨",
  85: "小陣雪", 86: "大陣雪",
  95: "雷雨", 96: "雷雨夾雹", 99: "強雷雨夾雹",
};

function wmoDesc(code: number): string {
  return WMO_DESC[code] ?? "未知天氣";
}

/**
 * 取指定座標的逐日天氣預報（Open-Meteo，免 Key）
 * @param days 最多取幾天，上限 16
 */
export async function fetchWeatherForecast(
  lat: number,
  lng: number,
  startDate: string,  // YYYY-MM-DD
  days: number,
): Promise<DailyWeather[]> {
  const cap = Math.min(Math.max(1, days), 16);
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lng}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode` +
      `&start_date=${startDate}&forecast_days=${cap}&timezone=auto`;

    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];

    const data = (await res.json()) as {
      daily?: {
        time?: string[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_sum?: number[];
        weathercode?: number[];
      };
    };
    const d = data.daily;
    if (!d?.time) return [];

    return d.time.slice(0, cap).map((date, i) => ({
      date,
      maxTempC: Math.round(d.temperature_2m_max?.[i] ?? 0),
      minTempC: Math.round(d.temperature_2m_min?.[i] ?? 0),
      precipitationMm: Math.round((d.precipitation_sum?.[i] ?? 0) * 10) / 10,
      description: wmoDesc(d.weathercode?.[i] ?? 0),
    }));
  } catch {
    return [];
  }
}

/**
 * 天氣宜人度評分（越高越好）：降雨最傷分，高溫/低溫與偏離舒適溫度（約 23°C）扣分。
 * 供「最佳出遊日」從未來預報中挑體感最好的一天。
 */
export function scoreDayWeather(w: DailyWeather): number {
  let score = 100;
  score -= w.precipitationMm * 4;
  if (w.maxTempC > 30) score -= (w.maxTempC - 30) * 5;
  if (w.minTempC < 10) score -= (10 - w.minTempC) * 4;
  const avg = (w.maxTempC + w.minTempC) / 2;
  score -= Math.abs(avg - 23) * 2;
  return score;
}
