import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUid } from "@/lib/auth";
import { checkAndConsume, rateLimitHttp } from "@/lib/rate-limit";
import { getTrip, updateTrip } from "@/lib/trips";
import { regenerateDay } from "@/lib/anthropic";
import { anchorDaySchedule } from "@/lib/day-anchor";
import { weekdayForDay, dateForDay } from "@/lib/trip-days";
import { listPlaces } from "@/lib/collection";

const bodySchema = z.object({
  day: z.number().int().positive(),
  feedback: z.string().max(200).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUid(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error.message }, { status: 401 });

  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });

  const tripResult = await getTrip(auth.value, id);
  if (!tripResult.ok) {
    const status = tripResult.error.kind === "not_found" ? 404 : 502;
    return NextResponse.json({ error: "找不到行程" }, { status });
  }
  const trip = tripResult.value;

  const dayIdx = parsed.data.day - 1;
  if (dayIdx < 0 || dayIdx >= trip.days.length) {
    return NextResponse.json({ error: "day 超出行程天數範圍" }, { status: 400 });
  }

  const gate = await checkAndConsume(auth.value, "day_regenerate");
  if (!gate.ok) {
    const { status, message, retryAfterSec } = rateLimitHttp(gate.error);
    return NextResponse.json({ error: message }, { status, headers: { "Retry-After": String(retryAfterSec) } });
  }

  const targetDay = trip.days[dayIdx];
  // 其他天已排地點（去重），防止重複排點——單日重生最大風險。
  const otherDaysPlaces = [
    ...new Set(
      trip.days
        .filter((_, i) => i !== dayIdx)
        .flatMap((d) => d.schedule.filter((s) => s.type === "place" || s.type === "food").map((s) => s.location ?? s.title)),
    ),
  ];

  const dayDate = trip.startDate ? dateForDay(trip.startDate, parsed.data.day) : undefined;
  const weekday = trip.startDate ? weekdayForDay(trip.startDate, parsed.data.day) : undefined;
  const dayWeather = dayDate ? trip.weather?.find((w) => w.date === dayDate) : undefined;
  const dayFlights = dayDate ? trip.flights?.filter((f) => f.date === dayDate) : undefined;
  const dayLodgings = dayDate
    ? trip.lodgings?.filter((l) => l.checkInDate === dayDate || l.checkOutDate === dayDate)
    : undefined;

  const result = await regenerateDay({
    tripSummary: { title: trip.title, location: trip.location, style: trip.style, summary: trip.summary, budget: trip.budget },
    otherDaysPlaces,
    currentSchedule: targetDay.schedule,
    feedback: parsed.data.feedback,
    dayDate,
    weekday,
    dayWeather,
    dayFlights,
    dayLodgings,
  });

  if (!result.ok) {
    const messages: Record<string, string> = {
      missing_key: "伺服器尚未設定 Anthropic 金鑰",
      missing_input: "缺少必要輸入",
      refusal: "AI 無法重新編排這一天，請調整回饋內容",
      api_error: "重新編排失敗，請稍後再試",
    };
    console.error("[regenerate-day]", JSON.stringify(result.error));
    return NextResponse.json({ error: messages[result.error.kind] ?? "重新編排失敗" }, { status: 400 });
  }

  // 先錨定再落庫：重生的那天立刻補座標/公休驗證，地圖/驗證不因重生而失效。
  const placesResult = await listPlaces(auth.value);
  const places = placesResult.ok ? placesResult.value : [];
  const anchoredSchedule = await anchorDaySchedule(result.value, places, weekday);

  const newDays = trip.days.map((d, i) => (i === dayIdx ? { ...d, schedule: anchoredSchedule } : d));
  const updateResult = await updateTrip(auth.value, id, { ...trip, days: newDays });
  if (!updateResult.ok) {
    return NextResponse.json({ error: "儲存失敗，原行程未變動" }, { status: 502 });
  }

  return NextResponse.json({ trip: updateResult.value });
}
