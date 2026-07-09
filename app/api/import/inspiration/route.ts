import { NextResponse, type NextRequest } from "next/server";
import { requireUid } from "@/lib/auth";
import { checkAndConsume, rateLimitHttp } from "@/lib/rate-limit";
import { extractAndScore, type InspirationError } from "@/lib/inspiration";

const MAX_TEXT = 8000;

function describe(e: InspirationError): { status: number; message: string } {
  switch (e.kind) {
    case "missing_key":
      return { status: 500, message: "伺服器尚未設定 Anthropic 金鑰" };
    case "missing_maps_key":
      return { status: 500, message: "伺服器尚未設定 Google Maps 金鑰" };
    case "dna_error":
      return { status: 502, message: "讀取你的偏好資料失敗，請稍後再試" };
    case "rate_limited":
      return { status: 429, message: "今日匯入筆數已達上限，請明天再試" };
    case "refusal":
      return { status: 502, message: "AI 無法從這段文字抽出地點" };
    case "api_error":
      return { status: 502, message: "分析失敗，請稍後再試" };
    default: {
      const _x: never = e;
      return { status: 500, message: String(_x) };
    }
  }
}

// 預覽：抽地點 + 契合度評分。不寫入 DB（人工勾選後由 confirm route 寫入）。
export async function POST(req: NextRequest) {
  const auth = await requireUid(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error.message }, { status: 401 });

  // AI 抽取的 $ 費（解析的 importCount 額度在 extractAndScore 內另扣）
  const gate = await checkAndConsume(auth.value, "tagging_batch");
  if (!gate.ok) {
    const { status, message, retryAfterSec } = rateLimitHttp(gate.error);
    return NextResponse.json({ error: message }, { status, headers: { "Retry-After": String(retryAfterSec) } });
  }

  const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "請貼入一段文字" }, { status: 400 });
  if (text.length > MAX_TEXT) {
    return NextResponse.json({ error: `文字太長（上限 ${MAX_TEXT} 字），請縮短` }, { status: 400 });
  }

  const result = await extractAndScore(auth.value, text);
  if (!result.ok) {
    const { status, message } = describe(result.error);
    return NextResponse.json({ error: message }, { status });
  }
  return NextResponse.json(result.value);
}
