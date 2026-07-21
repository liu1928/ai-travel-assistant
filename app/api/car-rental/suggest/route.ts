import { NextResponse, type NextRequest } from "next/server";
import { requireUid } from "@/lib/auth";
import { checkAndConsume, rateLimitHttp } from "@/lib/rate-limit";
import { getTrip } from "@/lib/trips";
import { listPlaces } from "@/lib/collection";
import { suggestCarRentals } from "@/lib/car-rentals";
import { computeTripCentroid } from "@/lib/trip-geo";

// 租車建議：以行程地理重心（schedule 地點對照收藏座標）查 Places 租車據點，掛租車連結。
// 沿用「places_search」既有護欄桶（跟住宿建議同一個成本類別，見 lib/quotas.ts）。
export async function POST(req: NextRequest) {
  const auth = await requireUid(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error.message }, { status: 401 });

  const gate = await checkAndConsume(auth.value, "places_search");
  if (!gate.ok) {
    const { status, message, retryAfterSec } = rateLimitHttp(gate.error);
    return NextResponse.json({ error: message }, { status, headers: { "Retry-After": String(retryAfterSec) } });
  }

  const body = (await req.json().catch(() => null)) as { tripId?: unknown } | null;
  const tripId = typeof body?.tripId === "string" ? body.tripId : "";
  if (!tripId) return NextResponse.json({ error: "缺少 tripId" }, { status: 400 });

  const tripRes = await getTrip(auth.value, tripId);
  if (!tripRes.ok) {
    const notFound = tripRes.error.kind === "not_found";
    return NextResponse.json(
      { error: notFound ? "找不到行程" : "讀取行程失敗" },
      { status: notFound ? 404 : 502 },
    );
  }
  const trip = tripRes.value;

  let center: { lat: number; lng: number } | undefined;
  const coll = await listPlaces(auth.value);
  if (!coll.ok) {
    console.warn("[car-rental] 讀收藏失敗，改用 location 字串查", coll.error.message);
  } else {
    const byName = new Map(coll.value.map((p) => [p.name, p.location]));
    center = computeTripCentroid(trip.days, byName);
  }

  const result = await suggestCarRentals({ location: trip.location, center });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error.kind === "missing_key" ? "伺服器尚未設定 Google Maps 金鑰" : "查詢租車失敗" },
      { status: 502 },
    );
  }
  return NextResponse.json({ items: result.value });
}
