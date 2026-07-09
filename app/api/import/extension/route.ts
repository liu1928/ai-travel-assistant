import { NextResponse, type NextRequest } from "next/server";
import { requireUid } from "@/lib/auth";
import { importCandidates, type ImportCandidate } from "@/lib/import-core";
import { checkAndConsume, rateLimitHttp } from "@/lib/rate-limit";

// Chrome Extension 從 chrome-extension:// origin 發請求，需要允許 CORS
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  const auth = await requireUid(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error.message },
      { status: 401, headers: CORS_HEADERS },
    );
  }

  const gate = await checkAndConsume(auth.value, "import_resolve");
  if (!gate.ok) {
    const { status, message, retryAfterSec } = rateLimitHttp(gate.error);
    return NextResponse.json(
      { error: message },
      { status, headers: { ...CORS_HEADERS, "Retry-After": String(retryAfterSec) } },
    );
  }

  const body = (await req.json().catch(() => null)) as {
    places?: Array<{ name?: unknown; lat?: unknown; lng?: unknown }>;
  } | null;

  if (!Array.isArray(body?.places) || body.places.length === 0) {
    return NextResponse.json(
      { error: "places 陣列是空的" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const candidates: ImportCandidate[] = body.places.map((p) => ({
    name: typeof p?.name === "string" ? p.name : "",
    lat: typeof p?.lat === "number" ? p.lat : undefined,
    lng: typeof p?.lng === "number" ? p.lng : undefined,
  }));

  const summary = await importCandidates(auth.value, candidates);
  return NextResponse.json({ summary }, { headers: CORS_HEADERS });
}
