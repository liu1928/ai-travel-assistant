import { NextResponse, type NextRequest } from "next/server";
import { importTakeout } from "@/lib/takeout";
import { requireUid } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const auth = await requireUid(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error.message }, { status: 401 });

  let text: string;
  try {
    text = await req.text();
  } catch {
    return NextResponse.json({ error: "無法讀取上傳內容" }, { status: 400 });
  }
  if (!text.trim()) return NextResponse.json({ error: "檔案是空的" }, { status: 400 });

  const result = await importTakeout(auth.value, text);
  if (!result.ok) {
    const messages: Record<string, string> = {
      invalid_json: "不是合法的 JSON 檔案",
      invalid_format: "格式不符合 Takeout 規格",
    };
    return NextResponse.json({ error: messages[result.error.kind] ?? "匯入失敗" }, { status: 400 });
  }
  return NextResponse.json({ summary: result.value });
}
