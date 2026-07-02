import { NextResponse, type NextRequest } from "next/server";
import { searchPlaces, type PlacesError } from "@/lib/places";
import { requireUid } from "@/lib/auth";

function describe(e: PlacesError): { status: number; message: string } {
  switch (e.kind) {
    case "missing_key":
      return { status: 500, message: "伺服器尚未設定 Google Maps 金鑰" };
    case "api_error":
      return { status: 502, message: `Places API 錯誤（${e.status}）` };
    case "bad_response":
      return { status: 502, message: e.message };
    default: {
      const _x: never = e;
      return { status: 500, message: String(_x) };
    }
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUid(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error.message }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { query?: unknown } | null;
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  if (!query) return NextResponse.json({ error: "請輸入搜尋關鍵字" }, { status: 400 });

  const result = await searchPlaces(query);
  if (!result.ok) {
    const { status, message } = describe(result.error);
    return NextResponse.json({ error: message }, { status });
  }
  return NextResponse.json({ places: result.value });
}
