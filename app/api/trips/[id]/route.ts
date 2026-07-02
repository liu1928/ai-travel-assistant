import { NextResponse, type NextRequest } from "next/server";
import { requireUid } from "@/lib/auth";
import { getTrip, deleteTrip } from "@/lib/trips";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUid(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error.message }, { status: 401 });

  const { id } = await params;
  const result = await getTrip(auth.value, id);
  if (!result.ok) {
    const status = result.error.kind === "not_found" ? 404 : 502;
    const message = result.error.kind === "db_error" ? result.error.message : "找不到行程";
    return NextResponse.json({ error: message }, { status });
  }
  return NextResponse.json({ trip: result.value });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUid(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error.message }, { status: 401 });

  const { id } = await params;
  const result = await deleteTrip(auth.value, id);
  if (!result.ok) {
    const message = result.error.kind === "db_error" ? result.error.message : "刪除失敗";
    return NextResponse.json({ error: message }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
