import { NextResponse, type NextRequest } from "next/server";
import { requireUid } from "@/lib/auth";
import { geocodeCityName, fetchWeatherForecast, scoreDayWeather } from "@/lib/weather";

// 最佳出遊日：掃未來 16 天預報，回體感最好的一天 + 完整預報（Open-Meteo，免 Key）。
export async function GET(req: NextRequest) {
  const auth = await requireUid(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error.message }, { status: 401 });

  const city = req.nextUrl.searchParams.get("city")?.trim();
  if (!city) return NextResponse.json({ error: "缺少 city 參數" }, { status: 400 });

  const coords = await geocodeCityName(city);
  if (!coords) return NextResponse.json({ forecast: [], best: null });

  const today = new Date().toISOString().slice(0, 10);
  const forecast = await fetchWeatherForecast(coords.lat, coords.lng, today, 16);
  if (forecast.length === 0) return NextResponse.json({ forecast: [], best: null });

  let best = forecast[0];
  let bestScore = scoreDayWeather(best);
  for (const w of forecast.slice(1)) {
    const s = scoreDayWeather(w);
    if (s > bestScore) {
      best = w;
      bestScore = s;
    }
  }
  return NextResponse.json({ forecast, best });
}
