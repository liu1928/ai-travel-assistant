import { NextResponse } from "next/server";
import { requireUid } from "@/lib/auth";
import { listExpenses, createExpense } from "@/lib/expenses";
import { expenseInputSchema } from "@/schema/expense";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const uidResult = await requireUid(req);
  if (!uidResult.ok) {
    return NextResponse.json({ error: uidResult.error.message }, { status: 401 });
  }
  const { id: tripId } = await params;
  const result = await listExpenses(uidResult.value, tripId);
  if (!result.ok) {
    const msg = result.error.kind === "db_error" ? result.error.message : "讀取失敗";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  return NextResponse.json(result.value);
}

export async function POST(req: Request, { params }: Params) {
  const uidResult = await requireUid(req);
  if (!uidResult.ok) {
    return NextResponse.json({ error: uidResult.error.message }, { status: 401 });
  }
  const { id: tripId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "無效的 JSON" }, { status: 400 });
  }

  const parsed = expenseInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const result = await createExpense(uidResult.value, tripId, parsed.data);
  if (!result.ok) {
    const msg = result.error.kind === "db_error" ? result.error.message : "建立失敗";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  return NextResponse.json(result.value, { status: 201 });
}
