import { NextResponse, type NextRequest } from "next/server";
import { requireUid } from "@/lib/auth";
import { listPlaces, updateTags } from "@/lib/collection";
import { tagPlace } from "@/lib/tagging";

export async function POST(req: NextRequest) {
  const auth = await requireUid(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error.message }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { placeId?: unknown } | null;
  const placeId = typeof body?.placeId === "string" ? body.placeId : "";
  if (!placeId) return NextResponse.json({ error: "缺少 placeId" }, { status: 400 });

  const list = await listPlaces(auth.value);
  if (!list.ok) return NextResponse.json({ error: list.error.message }, { status: 502 });
  const place = list.value.find((p) => p.placeId === placeId);
  if (!place) return NextResponse.json({ error: "找不到地點" }, { status: 404 });

  const tagged = await tagPlace(place);
  const tags = tagged.ok ? tagged.value : [];
  const saved = await updateTags(auth.value, placeId, tags);
  if (!saved.ok) return NextResponse.json({ error: saved.error.message }, { status: 502 });
  return NextResponse.json({ tags });
}
