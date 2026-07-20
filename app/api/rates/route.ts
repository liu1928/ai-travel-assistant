import { NextResponse, type NextRequest } from "next/server";
import { requireUid } from "@/lib/auth";
import { fetchExchangeRates } from "@/lib/currency";

// 記帳頁換算用：回「base → 記帳支援外幣」的即時匯率（1 base = rate 該外幣）。
// 記帳幣別 = TWD/USD/JPY/EUR（schema/expense.ts），base 以外的即為需換算的外幣。
const SUPPORTED = ["USD", "JPY", "EUR"];

export async function GET(req: NextRequest) {
  const auth = await requireUid(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error.message }, { status: 401 });

  const base = req.nextUrl.searchParams.get("base") ?? "TWD";
  const rates = await fetchExchangeRates(base, SUPPORTED);
  return NextResponse.json({ base, rates });
}
