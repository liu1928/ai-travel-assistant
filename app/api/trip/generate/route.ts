import { NextResponse, type NextRequest } from "next/server";
import { requireUid } from "@/lib/auth";
import { checkAndConsume, rateLimitHttp } from "@/lib/rate-limit";
import { generateTrip, type HolidayInfo } from "@/lib/anthropic";
import { listPlaces } from "@/lib/collection";
import { estimateLegs, resolveCoordinates, type TravelMode } from "@/lib/routes";
import { guessCountry, holidaysInRange } from "@/lib/holidays";
import { fetchWeatherForecast, geocodeCityName, type DailyWeather } from "@/lib/weather";
import { countryToCurrency, fetchExchangeRate, type ExchangeRate } from "@/lib/currency";
import { computeTravelDna } from "@/lib/travel-dna";
import {
  flightSchema,
  carRentalSchema,
  lodgingSchema,
  type TripStyle,
  type Flight,
  type CarRental,
  type Lodging,
  type SavedScheduleItem,
} from "@/schema/trip";
import type { SavedPlace } from "@/schema/place";
import { z } from "zod";

type Body = {
  prompt?: string;
  placeIds?: string[];
  days?: number;
  style?: TripStyle;
  budgetMin?: number;
  budgetMax?: number;
  travelMode?: TravelMode;
  startDate?: string; // YYYY-MM-DD
  flights?: unknown; // 使用者輸入的訂位資料，進來先過 zod
  carRentals?: unknown;
  lodgings?: unknown;
};

const flightsArraySchema = z.array(flightSchema);
const carRentalsArraySchema = z.array(carRentalSchema);
const lodgingsArraySchema = z.array(lodgingSchema);

const MODE_LABEL: Record<TravelMode, string> = {
  DRIVE: "開車",
  WALK: "步行",
  TRANSIT: "大眾運輸",
};

export async function POST(req: NextRequest) {
  const auth = await requireUid(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error.message }, { status: 401 });

  const gate = await checkAndConsume(auth.value, "trip_generate");
  if (!gate.ok) {
    const { status, message, retryAfterSec } = rateLimitHttp(gate.error);
    return NextResponse.json({ error: message }, { status, headers: { "Retry-After": String(retryAfterSec) } });
  }

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });

  // 航班/租車是使用者主動輸入的主要資料：格式錯 → 400 明講，不做 best-effort 吞掉
  let flights: Flight[] = [];
  if (body.flights !== undefined) {
    const parsed = flightsArraySchema.safeParse(body.flights);
    if (!parsed.success) {
      return NextResponse.json({ error: "航班或租車資料格式不正確" }, { status: 400 });
    }
    flights = parsed.data;
  }
  let carRentals: CarRental[] = [];
  if (body.carRentals !== undefined) {
    const parsed = carRentalsArraySchema.safeParse(body.carRentals);
    if (!parsed.success) {
      return NextResponse.json({ error: "航班或租車資料格式不正確" }, { status: 400 });
    }
    carRentals = parsed.data;
  }
  let lodgings: Lodging[] = [];
  if (body.lodgings !== undefined) {
    const parsed = lodgingsArraySchema.safeParse(body.lodgings);
    if (!parsed.success) {
      return NextResponse.json({ error: "住宿資料格式不正確" }, { status: 400 });
    }
    lodgings = parsed.data;
  }

  let places: SavedPlace[] = [];
  // 歇業地點排除（specs/place-freshness.md §1.5）：永久歇業/已下架直接剔除不排進生成；
  // 暫停營業不剔除（資訊時效性存疑），只在 lib/anthropic.ts 的 prompt 行尾加提醒。
  let excludedClosedNames: string[] = [];
  if (body.placeIds && body.placeIds.length > 0) {
    const all = await listPlaces(auth.value);
    if (all.ok) {
      const idSet = new Set(body.placeIds);
      const selected = all.value.filter((p) => idSet.has(p.placeId));
      places = selected.filter(
        (p) => p.businessStatus !== "CLOSED_PERMANENTLY" && p.businessStatus !== "NOT_FOUND",
      );
      excludedClosedNames = selected
        .filter((p) => p.businessStatus === "CLOSED_PERMANENTLY" || p.businessStatus === "NOT_FOUND")
        .map((p) => p.name);
    }
  }

  // best-effort：查行程期間當地假日（查不到不影響生成）
  let holidays: HolidayInfo[] = [];
  if (body.startDate) {
    try {
      const countryTexts = [
        ...places.map((p) => p.address ?? ""),
        ...places.map((p) => p.name),
        body.prompt ?? "",
      ];
      const country = guessCountry(countryTexts);
      holidays = await holidaysInRange(country, body.startDate, body.days ?? 2);
    } catch {
      // 假日是加值資訊，失敗不影響主要生成結果
    }
  }

  // best-effort：天氣預報（Open-Meteo，免 Key）
  let weather: DailyWeather[] = [];
  if (body.startDate && body.days && body.days > 0) {
    try {
      // 優先用第一個已有座標的收藏地點，否則從 prompt/地點名 geocode 城市
      const firstPlace = places.find((p) => p.location?.lat && p.location?.lng);
      let coords: { lat: number; lng: number } | null = firstPlace?.location ?? null;
      if (!coords) {
        // 從 prompt 抓第一個城市關鍵字
        const cityHint = [body.prompt ?? "", ...places.map((p) => p.name)]
          .join(" ")
          .match(/([^\s、，,]+[市區城町村]|Tokyo|Osaka|Seoul|Bangkok|Singapore|KL|Kuala Lumpur|Hong Kong)/i)?.[0];
        if (cityHint) coords = await geocodeCityName(cityHint);
      }
      if (coords) {
        weather = await fetchWeatherForecast(coords.lat, coords.lng, body.startDate, body.days);
      }
    } catch {
      // best-effort，失敗不影響生成
    }
  }

  // best-effort：目的地匯率（Frankfurter，免 Key）
  let exchangeRate: ExchangeRate | undefined;
  try {
    const countryTexts = [
      ...places.map((p) => p.address ?? ""),
      ...places.map((p) => p.name),
      body.prompt ?? "",
    ];
    const country = guessCountry(countryTexts);
    const destCurrency = countryToCurrency(country);
    if (destCurrency && destCurrency !== "TWD") {
      const rate = await fetchExchangeRate("TWD", destCurrency);
      if (rate) exchangeRate = rate;
    }
  } catch {
    // best-effort
  }

  // best-effort：使用者長期偏好畫像（查不到不影響生成，比照 holidays/Routes 降級）。
  // DNA 失敗 = 個人化整層失效（比假日更有感），故留一行 warn 供觀測（GLM REVIEW ❓-1）。
  const dnaResult = await computeTravelDna(auth.value);
  if (!dnaResult.ok) console.warn("[trip/generate] DNA 降級：", dnaResult.error.message);
  const dna = dnaResult.ok ? dnaResult.value : undefined;

  const result = await generateTrip({
    prompt: body.prompt,
    places,
    // 防直打 API 的浮點/非正數 days 汙染天數硬指令與 max_tokens 計算（UI 只會送正整數）
    days:
      typeof body.days === "number" && Number.isInteger(body.days) && body.days > 0
        ? body.days
        : undefined,
    style: body.style,
    budgetMin: body.budgetMin,
    budgetMax: body.budgetMax,
    startDate: body.startDate,
    holidays,
    flights,
    carRentals,
    lodgings,
    dna,
    weather,
    exchangeRate,
  });

  if (!result.ok) {
    const messages: Record<string, string> = {
      missing_key: "伺服器尚未設定 Anthropic 金鑰",
      missing_input: "請至少輸入一句話或選擇收藏地點",
      refusal: "AI 無法根據目前輸入生成行程，請調整內容",
      api_error: "行程生成失敗，請稍後再試",
    };
    console.error("[trip/generate]", JSON.stringify(result.error));
    return NextResponse.json(
      { error: messages[result.error.kind] ?? "生成失敗" },
      { status: 400 },
    );
  }

  const trip = result.value;

  if (excludedClosedNames.length > 0) {
    trip.insights.push(`已自動排除歇業地點：${excludedClosedNames.join("、")}`);
  }

  // best-effort：用 Routes API 補相鄰景點的實際車程，失敗不影響主要結果
  try {
    const placeByName = new Map(places.map((p) => [p.name, p]));
    const mode: TravelMode = body.travelMode ?? "DRIVE";

    for (const day of trip.days) {
      // 型別放寬到 SavedScheduleItem（scheduleItemSchema 的 server 附掛超集）以便就地寫回
      // placeId/lat/lng；AI 輸出的 schedule 本身沒有這些欄位，只是這裡要順手存下解析結果
      // （specs/schedule-anchoring.md）。stops 跟 day.schedule 共用物件參照，寫入即生效。
      const scheduleItems = day.schedule as SavedScheduleItem[];
      const stops = scheduleItems.filter((s) => s.type === "place" || s.type === "food");
      const coords: { lat: number; lng: number }[] = [];

      // 任一 stop 定位失敗就整天跳過車程估計——不可壓縮 coords，否則把
      // A→(定位失敗的 B)→C 當成 A→C 直算，移動時間會被系統性低估（對應錯位）。
      // 但寫回 placeId/lat/lng 跟這個判斷解耦：已經解析成功的 stop 照樣存，不因同一天
      // 其他 stop 失敗而放棄（見 specs/schedule-anchoring.md §1.3）。
      let allResolved = true;
      for (const stop of stops) {
        const known = placeByName.get(stop.location ?? stop.title);
        if (known) {
          stop.placeId = known.placeId;
          stop.lat = known.location.lat;
          stop.lng = known.location.lng;
          coords.push(known.location);
          continue;
        }
        const resolved = await resolveCoordinates(stop.location ?? stop.title);
        if (resolved) {
          stop.lat = resolved.lat;
          stop.lng = resolved.lng;
          coords.push(resolved);
        } else {
          allResolved = false;
        }
      }

      // ⚠️ 下面兩種 push 的文案是 lib/trip-edit.ts ROUTE_INSIGHT_RE 的過濾對象
      //（編輯儲存時清掉過期車程資訊）——改字要兩邊同步。
      if (!allResolved) {
        trip.insights.push(`第 ${day.day} 天有地點無法定位，未估移動時間`);
        continue;
      }
      if (coords.length < 2) continue;

      const legs = await estimateLegs(coords, mode);
      if (legs.ok && legs.value.length > 0) {
        const totalMin = legs.value.reduce((sum, l) => sum + l.durationMin, 0);
        if (totalMin > 0) {
          trip.insights.push(`第 ${day.day} 天移動時間約 ${totalMin} 分鐘（${MODE_LABEL[mode]}）`);
        }
      }
    }
  } catch {
    // Routes 是加值資訊，不影響主要生成結果
  }

  // 使用者輸入的訂位資料 + 生成當下抓的天氣/匯率快照 + 出發日一併附掛回傳
  //（AI 輸出本身不含這些，見 specs/flights-rentals.md §3、specs/schedule-anchoring.md；
  // exchangeRate/startDate 為 undefined 時 JSON 自動略過）
  return NextResponse.json({
    trip: { ...trip, flights, carRentals, lodgings, weather, exchangeRate, startDate: body.startDate },
  });
}
