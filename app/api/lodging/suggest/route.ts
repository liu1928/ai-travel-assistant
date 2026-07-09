import { NextResponse, type NextRequest } from "next/server";
import { requireUid } from "@/lib/auth";
import { checkAndConsume, rateLimitHttp } from "@/lib/rate-limit";
import { getTrip } from "@/lib/trips";
import { listPlaces } from "@/lib/collection";
import { suggestLodging } from "@/lib/lodging";

// 住宿建議：以行程地理重心（schedule 地點對照收藏座標）查 Places 旅宿，依價位篩、掛訂房連結。
export async function POST(req: NextRequest) {
  const auth = await requireUid(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error.message }, { status: 401 });

  const gate = await checkAndConsume(auth.value, "places_search");
  if (!gate.ok) {
    const { status, message, retryAfterSec } = rateLimitHttp(gate.error);
    return NextResponse.json({ error: message }, { status, headers: { "Retry-After": String(retryAfterSec) } });
  }

  const body = (await req.json().catch(() => null)) as { tripId?: unknown; maxPriceLevel?: unknown } | null;
  const tripId = typeof body?.tripId === "string" ? body.tripId : "";
  if (!tripId) return NextResponse.json({ error: "缺少 tripId" }, { status: 400 });
  const maxPriceLevel = typeof body?.maxPriceLevel === "number" ? body.maxPriceLevel : undefined;

  const tripRes = await getTrip(auth.value, tripId);
  if (!tripRes.ok) {
    const notFound = tripRes.error.kind === "not_found";
    return NextResponse.json(
      { error: notFound ? "找不到行程" : "讀取行程失敗" },
      { status: notFound ? 404 : 502 },
    );
  }
  const trip = tripRes.value;

  // 地理重心：把 schedule 的 place/food stop 名對照收藏取座標，算質心（零額外 Places 成本）
  let center: { lat: number; lng: number } | undefined;
  const coll = await listPlaces(auth.value);
  if (!coll.ok) {
    console.warn("[lodging] 讀收藏失敗，改用 location 字串查", coll.error.message);
  } else {
    const byName = new Map(coll.value.map((p) => [p.name, p.location]));
    const pts: { lat: number; lng: number }[] = [];
    for (const day of trip.days) {
      for (const s of day.schedule) {
        if (s.type !== "place" && s.type !== "food") continue;
        const loc = byName.get(s.location ?? s.title);
        if (loc) pts.push(loc);
      }
    }
    if (pts.length > 0) {
      center = {
        lat: pts.reduce((sum, p) => sum + p.lat, 0) / pts.length,
        lng: pts.reduce((sum, p) => sum + p.lng, 0) / pts.length,
      };
    }
  }

  const result = await suggestLodging({ location: trip.location, center, maxPriceLevel });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error.kind === "missing_key" ? "伺服器尚未設定 Google Maps 金鑰" : "查詢住宿失敗" },
      { status: 502 },
    );
  }
  return NextResponse.json({ items: result.value });
}
