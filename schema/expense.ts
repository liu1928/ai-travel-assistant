import { z } from "zod";

export const currency = z.enum(["TWD", "USD", "JPY", "EUR"]);
export type Currency = z.infer<typeof currency>;

export const expenseCategory = z.enum([
  "transport",
  "lodging",
  "food",
  "sightseeing",
  "other",
]);
export type ExpenseCategory = z.infer<typeof expenseCategory>;

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const expenseInputSchema = z.object({
  label: z.string().min(1, "名稱不能為空"),
  amount: z.number().positive("金額必須大於 0"),
  currency,
  category: expenseCategory,
  date: z.string().regex(datePattern, "日期格式必須是 YYYY-MM-DD"),
});
export type ExpenseInput = z.infer<typeof expenseInputSchema>;

export const expenseSchema = expenseInputSchema.extend({
  id: z.string(),
  tripId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Expense = z.infer<typeof expenseSchema>;
