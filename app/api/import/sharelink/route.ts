import { NextResponse, type NextRequest } from "next/server";
import { parseShareLink } from "@/lib/sharelink";
import { requireUid } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const auth = await requireUid(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error.message }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { url?: unknown } | null;
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!url) return NextResponse.json({ error: "請貼入分享連結" }, { status: 400 });

  const result = await parseShareLink(url);
  if (!result.ok) {
    const e = result.error;
    const msg = "reason" in e ? e.reason : "message" in e ? e.message : "解析失敗";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  return NextResponse.json({ kind: result.value.kind, places: result.value.places });
}
