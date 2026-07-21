import { NextResponse, type NextRequest } from "next/server";
import { requireUid } from "@/lib/auth";
import { getTrip } from "@/lib/trips";
import { generateIcs } from "@/lib/ics";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUid(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error.message }, { status: 401 });

  const { id } = await params;
  const result = await getTrip(auth.value, id);
  if (!result.ok) {
    const status = result.error.kind === "not_found" ? 404 : 502;
    return NextResponse.json({ error: "找不到行程" }, { status });
  }

  const ics = generateIcs(result.value);
  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="trip.ics"',
    },
  });
}
