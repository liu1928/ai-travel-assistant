import { NextResponse, type NextRequest } from "next/server";
import { requireUid } from "@/lib/auth";
import { computeTravelDna } from "@/lib/travel-dna";

export async function GET(req: NextRequest) {
  const auth = await requireUid(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error.message }, { status: 401 });

  const result = await computeTravelDna(auth.value);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 502 });

  return NextResponse.json(result.value);
}
