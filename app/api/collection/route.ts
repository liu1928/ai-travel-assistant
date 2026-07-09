import { NextResponse, type NextRequest } from "next/server";
import { addPlace, listPlaces, deletePlace, updateNote, setGroup } from "@/lib/collection";
import { tagPlace } from "@/lib/tagging";
import { placeSearchResultSchema } from "@/schema/place";
import { requireUid } from "@/lib/auth";
import { checkAndConsume, rateLimitHttp } from "@/lib/rate-limit";

export async function GET(req: NextRequest) {
  const auth = await requireUid(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error.message }, { status: 401 });
  const result = await listPlaces(auth.value);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 502 });
  return NextResponse.json({ places: result.value });
}

export async function POST(req: NextRequest) {
  const auth = await requireUid(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error.message }, { status: 401 });

  const gate = await checkAndConsume(auth.value, "tagging_batch");
  if (!gate.ok) {
    const { status, message, retryAfterSec } = rateLimitHttp(gate.error);
    return NextResponse.json({ error: message }, { status, headers: { "Retry-After": String(retryAfterSec) } });
  }

  const body = (await req.json().catch(() => null)) as { place?: unknown } | null;
  const parsed = placeSearchResultSchema.safeParse(body?.place);
  if (!parsed.success) return NextResponse.json({ error: "地點資料格式不正確" }, { status: 400 });

  const tagged = await tagPlace(parsed.data);
  const tags = tagged.ok ? tagged.value : [];
  const saved = await addPlace(auth.value, parsed.data, tags);
  if (!saved.ok) return NextResponse.json({ error: saved.error.message }, { status: 502 });
  return NextResponse.json({ place: saved.value, tagged: tagged.ok });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireUid(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error.message }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    placeId?: unknown;
    note?: unknown;
    group?: unknown;
  } | null;

  const placeId = typeof body?.placeId === "string" ? body.placeId : "";
  if (!placeId) return NextResponse.json({ error: "缺少 placeId" }, { status: 400 });

  // group 更新
  if (body !== null && "group" in body) {
    const group = typeof body.group === "string" ? body.group : undefined;
    const result = await setGroup(auth.value, placeId, group);
    if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 502 });
    return NextResponse.json({ ok: true });
  }

  // note 更新
  const note = typeof body?.note === "string" ? body.note : "";
  const result = await updateNote(auth.value, placeId, note);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 502 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUid(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error.message }, { status: 401 });
  const placeId = new URL(req.url).searchParams.get("placeId") ?? "";
  if (!placeId) return NextResponse.json({ error: "缺少 placeId" }, { status: 400 });
  const result = await deletePlace(auth.value, placeId);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 502 });
  return NextResponse.json({ ok: true });
}
