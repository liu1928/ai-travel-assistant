import { NextResponse, type NextRequest } from "next/server";
import { requireUid } from "@/lib/auth";
import { addPlace, listPlaces } from "@/lib/collection";
import { placeSearchResultSchema, placeTag } from "@/schema/place";
import { z } from "zod";

// 前端把預覽結果原樣送回；伺服器 zod 驗證擋竄改，再冪等寫入。不重打 Places/標籤、不扣 importCount。
const bodySchema = z.object({
  places: z.array(placeSearchResultSchema).min(1),
  tags: z.record(z.string(), z.array(placeTag)).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireUid(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error.message }, { status: 401 });

  const raw = (await req.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "收藏資料格式不正確" }, { status: 400 });

  const { places, tags } = parsed.data;

  const existing = await listPlaces(auth.value);
  const existingIds = new Set(existing.ok ? existing.value.map((p) => p.placeId) : []);

  const summary = { success: 0, skipped: 0, failed: 0 };
  const seen = new Set<string>();
  for (const place of places) {
    if (existingIds.has(place.placeId) || seen.has(place.placeId)) {
      summary.skipped++;
      continue;
    }
    seen.add(place.placeId);
    const saved = await addPlace(auth.value, place, tags?.[place.placeId] ?? []);
    if (saved.ok) summary.success++;
    else summary.failed++;
  }

  return NextResponse.json({ summary });
}
