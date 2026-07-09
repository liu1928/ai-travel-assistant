import { NextResponse, type NextRequest } from "next/server";
import { requireUid } from "@/lib/auth";
import { checkAndConsume, rateLimitHttp } from "@/lib/rate-limit";
import { lookupFlight } from "@/lib/aviationstack";

// 航班號 → 航線 + 起降時刻（AviationStack，真實資料）。按鈕觸發，走用量護欄。
// 見 specs/flight-lookup.md。
export async function POST(req: NextRequest) {
  const auth = await requireUid(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error.message }, { status: 401 });

  const gate = await checkAndConsume(auth.value, "flight_lookup");
  if (!gate.ok) {
    const { status, message, retryAfterSec } = rateLimitHttp(gate.error);
    return NextResponse.json({ error: message }, { status, headers: { "Retry-After": String(retryAfterSec) } });
  }

  const body = (await req.json().catch(() => null)) as { flightNo?: unknown } | null;
  // 先正規化（trim/大寫/去空白）再驗證，讓 regex 與實際送 API 的字串一致
  const raw = typeof body?.flightNo === "string" ? body.flightNo : "";
  const flightNo = raw.trim().toUpperCase().replace(/\s+/g, "");
  // 不像航班號（2 碼英數代碼 + 1~4 位數字，可含班次尾碼字母）→ 400，不打 API 浪費額度
  if (!flightNo || !/^[0-9A-Z]{2}\d{1,4}[A-Z]?$/.test(flightNo)) {
    return NextResponse.json({ error: "請輸入有效的航班號（如 BR198）" }, { status: 400 });
  }

  const result = await lookupFlight(flightNo);
  if (!result.ok) {
    switch (result.error.kind) {
      case "not_found":
        return NextResponse.json({ error: "查無此航班（或今日無班次）" }, { status: 404 });
      case "missing_key":
        return NextResponse.json({ error: "伺服器尚未設定 AviationStack 金鑰" }, { status: 500 });
      case "api_error":
        return NextResponse.json({ error: "航班查詢服務暫時無法使用" }, { status: 502 });
    }
  }
  return NextResponse.json(result.value);
}
