// ⚠️ 伺服器端專用：費用的 Firestore CRUD
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "./firebase";
import { ok, err, type Result } from "./result";
import type { ExpenseInput, Expense } from "../schema/expense";

export type ExpenseError =
  | { kind: "db_error"; message: string }
  | { kind: "not_found" };

function expensesCol(uid: string, tripId: string) {
  return db()
    .collection("users")
    .doc(uid)
    .collection("trips")
    .doc(tripId)
    .collection("expenses");
}

function toExpense(doc: FirebaseFirestore.DocumentSnapshot): Expense {
  const d = doc.data()!;
  return {
    id: doc.id,
    tripId: d.tripId,
    label: d.label,
    amount: d.amount,
    currency: d.currency,
    category: d.category,
    date: d.date,
    createdAt:
      d.createdAt instanceof Timestamp
        ? d.createdAt.toDate().toISOString()
        : d.createdAt,
    updatedAt:
      d.updatedAt instanceof Timestamp
        ? d.updatedAt.toDate().toISOString()
        : d.updatedAt,
  };
}

export async function createExpense(
  uid: string,
  tripId: string,
  input: ExpenseInput
): Promise<Result<Expense, ExpenseError>> {
  try {
    const col = expensesCol(uid, tripId);
    const now = FieldValue.serverTimestamp();
    const ref = await col.add({ ...input, tripId, createdAt: now, updatedAt: now });
    const snap = await ref.get();
    return ok(toExpense(snap));
  } catch (e) {
    return err({ kind: "db_error", message: String(e) });
  }
}

export async function listExpenses(
  uid: string,
  tripId: string
): Promise<Result<Expense[], ExpenseError>> {
  try {
    const snap = await expensesCol(uid, tripId).orderBy("date", "asc").get();
    return ok(snap.docs.map(toExpense));
  } catch (e) {
    return err({ kind: "db_error", message: String(e) });
  }
}

export async function updateExpense(
  uid: string,
  tripId: string,
  expenseId: string,
  patch: Partial<ExpenseInput>
): Promise<Result<Expense, ExpenseError>> {
  try {
    const ref = expensesCol(uid, tripId).doc(expenseId);
    const snap = await ref.get();
    if (!snap.exists) return err({ kind: "not_found" });
    await ref.update({ ...patch, updatedAt: FieldValue.serverTimestamp() });
    const updated = await ref.get();
    return ok(toExpense(updated));
  } catch (e) {
    return err({ kind: "db_error", message: String(e) });
  }
}

export async function deleteExpense(
  uid: string,
  tripId: string,
  expenseId: string
): Promise<Result<null, ExpenseError>> {
  try {
    const ref = expensesCol(uid, tripId).doc(expenseId);
    const snap = await ref.get();
    if (!snap.exists) return err({ kind: "not_found" });
    await ref.delete();
    return ok(null);
  } catch (e) {
    return err({ kind: "db_error", message: String(e) });
  }
}
