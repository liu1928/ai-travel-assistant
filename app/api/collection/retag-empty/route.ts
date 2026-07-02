import { NextResponse, type NextRequest } from "next/server";
import { requireUid } from "@/lib/auth";
import { retagEmptyPlaces } from "@/lib/retag";

export async function POST(req: NextRequest) {
  const auth = await requireUid(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error.message }, { status: 401 });

  const result = await retagEmptyPlaces(auth.value);
  if (!result.ok) {
    return NextResponse.json({ error: result.error.message }, { status: 502 });
  }
  return NextResponse.json({ summary: result.value });
}
