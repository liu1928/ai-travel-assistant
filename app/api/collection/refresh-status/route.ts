import { NextResponse, type NextRequest } from "next/server";
import { requireUid } from "@/lib/auth";
import { checkAndConsume, rateLimitHttp } from "@/lib/rate-limit";
import { listPlaces, updatePlaceStatus } from "@/lib/collection";
import { fetchBusinessStatus } from "@/lib/place-status";
import { mapLimit } from "@/lib/concurrency";
import { SERVICE_COST_USD } from "@/lib/quotas";
import { envOr } from "@/lib/env";

// env 可調：TTL 天數、單次批次上限。見 specs/place-freshness.md §1.3。
const STATUS_TTL_MS = Number(envOr("STATUS_TTL_DAYS", "7")) * 86_400_000;
const REFRESH_STATUS_CAP = Number(envOr("REFRESH_STATUS_CAP", "50"));

export async function POST(req: NextRequest) {
  const auth = await requireUid(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error.message }, { status: 401 });

  const listResult = await listPlaces(auth.value);
  if (!listResult.ok) return NextResponse.json({ error: listResult.error.message }, { status: 502 });

  const now = Date.now();
  const stale = listResult.value
    .filter((p) => !p.statusCheckedAt || now - p.statusCheckedAt > STATUS_TTL_MS)
    .sort((a, b) => (a.statusCheckedAt ?? 0) - (b.statusCheckedAt ?? 0));

  const batch = stale.slice(0, REFRESH_STATUS_CAP);
  const remaining = stale.length - batch.length;

  // 無過期筆時不呼叫 checkAndConsume：本次無付費工作，不該計入用量護欄。
  if (batch.length === 0) {
    return NextResponse.json({ scanned: 0, updated: 0, closedFound: 0, failed: 0, remaining: 0 });
  }

  const gate = await checkAndConsume(auth.value, "places_status", batch.length * SERVICE_COST_USD.places_status);
  if (!gate.ok) {
    const { status, message, retryAfterSec } = rateLimitHttp(gate.error);
    return NextResponse.json({ error: message }, { status, headers: { "Retry-After": String(retryAfterSec) } });
  }

  let updated = 0;
  let closedFound = 0;
  let failed = 0;

  await mapLimit(batch, 4, async (place) => {
    const statusResult = await fetchBusinessStatus(place.placeId);
    if (!statusResult.ok) {
      failed++;
      return;
    }
    const saved = await updatePlaceStatus(auth.value, place.placeId, statusResult.value, now);
    if (!saved.ok) {
      failed++;
      return;
    }
    updated++;
    if (statusResult.value === "CLOSED_PERMANENTLY" || statusResult.value === "NOT_FOUND") closedFound++;
  });

  return NextResponse.json({ scanned: batch.length, updated, closedFound, failed, remaining });
}
