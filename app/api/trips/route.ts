import { NextResponse, type NextRequest } from "next/server";
import { requireUid } from "@/lib/auth";
import { saveTrip, listTrips } from "@/lib/trips";
import { tripWithBookingsSchema } from "@/schema/trip";

export async function GET(req: NextRequest) {
  const auth = await requireUid(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error.message }, { status: 401 });

  const result = await listTrips(auth.value);
  if (!result.ok) {
    const message = result.error.kind === "db_error" ? result.error.message : "讀取失敗";
    return NextResponse.json({ error: message }, { status: 502 });
  }
  return NextResponse.json({ trips: result.value });
}

export async function POST(req: NextRequest) {
  const auth = await requireUid(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error.message }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { trip?: unknown } | null;
  const parsed = tripWithBookingsSchema.safeParse(body?.trip);
  if (!parsed.success) {
    return NextResponse.json({ error: "行程資料格式不正確" }, { status: 400 });
  }

  const saved = await saveTrip(auth.value, parsed.data);
  if (!saved.ok) {
    const message = saved.error.kind === "db_error" ? saved.error.message : "儲存失敗";
    return NextResponse.json({ error: message }, { status: 502 });
  }
  return NextResponse.json({ trip: saved.value });
}
