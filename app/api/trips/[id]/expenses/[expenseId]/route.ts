import { NextResponse } from "next/server";
import { requireUid } from "@/lib/auth";
import { updateExpense, deleteExpense } from "@/lib/expenses";
import { expenseInputSchema } from "@/schema/expense";

type Params = { params: Promise<{ id: string; expenseId: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const uidResult = await requireUid(req);
  if (!uidResult.ok) {
    return NextResponse.json({ error: uidResult.error.message }, { status: 401 });
  }
  const { id: tripId, expenseId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "無效的 JSON" }, { status: 400 });
  }

  const parsed = expenseInputSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  const result = await updateExpense(uidResult.value, tripId, expenseId, parsed.data);
  if (!result.ok) {
    if (result.error.kind === "not_found") {
      return NextResponse.json({ error: "找不到此費用" }, { status: 404 });
    }
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }
  return NextResponse.json(result.value);
}

export async function DELETE(req: Request, { params }: Params) {
  const uidResult = await requireUid(req);
  if (!uidResult.ok) {
    return NextResponse.json({ error: uidResult.error.message }, { status: 401 });
  }
  const { id: tripId, expenseId } = await params;

  const result = await deleteExpense(uidResult.value, tripId, expenseId);
  if (!result.ok) {
    if (result.error.kind === "not_found") {
      return NextResponse.json({ error: "找不到此費用" }, { status: 404 });
    }
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }
  return new NextResponse(null, { status: 204 });
}
