import { NextResponse, type NextRequest } from "next/server";
import { requireUid } from "@/lib/auth";
import { checkAndConsume, rateLimitHttp } from "@/lib/rate-limit";
import { lookupFlight, todayTaipeiDate, daysDiff } from "@/lib/aerodatabox";

// 航班號 + 出發日 → 該日排定航線 + 起降時刻（AeroDataBox，真實資料）。按鈕觸發，走用量護欄。
// 見 specs/flight-lookup.md（2026-07-11 換源：帶日期查未來班表，解換季改時刻查不到的問題）。
export async function POST(req: NextRequest) {
  const auth = await requireUid(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error.message }, { status: 401 });

  const gate = await checkAndConsume(auth.value, "flight_lookup");
  if (!gate.ok) {
    const { status, message, retryAfterSec } = rateLimitHttp(gate.error);
    return NextResponse.json({ error: message }, { status, headers: { "Retry-After": String(retryAfterSec) } });
  }

  const body = (await req.json().catch(() => null)) as
    | { flightNo?: unknown; date?: unknown; mode?: unknown }
    | null;
  // 先正規化（trim/大寫/去空白）再驗證，讓 regex 與實際送 API 的字串一致
  const raw = typeof body?.flightNo === "string" ? body.flightNo : "";
  const flightNo = raw.trim().toUpperCase().replace(/\s+/g, "");
  // 不像航班號（2 碼英數代碼 + 1~4 位數字，可含班次尾碼字母）→ 400，不打 API 浪費額度
  if (!flightNo || !/^[0-9A-Z]{2}\d{1,4}[A-Z]?$/.test(flightNo)) {
    return NextResponse.json({ error: "請輸入有效的航班號（如 BR198）" }, { status: 400 });
  }
  // 出發日可選；有帶就必須是 YYYY-MM-DD（同上，先擋掉再打 API）
  const rawDate = typeof body?.date === "string" ? body.date.trim() : "";
  if (rawDate && !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    return NextResponse.json({ error: "日期格式不正確（需為 YYYY-MM-DD）" }, { status: 400 });
  }
  // mode 預設 "schedule"（既有行為零迴歸）；"status" 是即時動態查詢（specs/flight-day-status.md）——
  // 只在「今天」（出發地日期，以台灣時區近似，±1 天容忍時區落差）才有意義，也是額度保護的硬閘門。
  const mode = body?.mode === "status" ? "status" : "schedule";
  if (mode === "status" && rawDate && Math.abs(daysDiff(rawDate, todayTaipeiDate())) > 1) {
    return NextResponse.json({ error: "即時動態只能查詢今天出發的航班" }, { status: 400 });
  }

  const result = await lookupFlight(flightNo, rawDate || undefined);
  if (!result.ok) {
    switch (result.error.kind) {
      case "not_found":
        return NextResponse.json(
          { error: "查無此航班（該日期可能沒有班次，或資料源尚未收錄此航線排班——可改用下方欄位手動輸入）" },
          { status: 404 },
        );
      case "missing_key":
        return NextResponse.json({ error: "伺服器尚未設定 AeroDataBox 金鑰" }, { status: 500 });
      case "api_error":
        return NextResponse.json({ error: "航班查詢服務暫時無法使用" }, { status: 502 });
    }
  }
  return NextResponse.json(result.value);
}
