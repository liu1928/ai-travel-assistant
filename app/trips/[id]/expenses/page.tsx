"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth, authedFetch } from "@/lib/use-auth";
import { GoogleSignInButton } from "@/components/google-signin";
import type { Expense, ExpenseCategory, Currency } from "@/schema/expense";

// ───────── constants ─────────

const CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: "transport", label: "交通" },
  { value: "lodging", label: "住宿" },
  { value: "food", label: "餐飲" },
  { value: "sightseeing", label: "景點" },
  { value: "other", label: "其他" },
];

const CURRENCIES: Currency[] = ["TWD", "USD", "JPY", "EUR"];

const CATEGORY_EMOJI: Record<ExpenseCategory, string> = {
  transport: "✈️",
  lodging: "🏨",
  food: "🍜",
  sightseeing: "🗺️",
  other: "📦",
};

// ───────── form defaults ─────────

const TODAY = new Date().toISOString().slice(0, 10);

type FormState = {
  label: string;
  amount: string;
  currency: Currency;
  category: ExpenseCategory;
  date: string;
};

const defaultForm = (): FormState => ({
  label: "",
  amount: "",
  currency: "TWD",
  category: "food",
  date: TODAY,
});

// ───────── computed totals ─────────

type ByCurrency = Record<Currency, number>;
type ByCategory = { category: ExpenseCategory; total: ByCurrency }[];

function computeSummary(expenses: Expense[]): { byCurrency: ByCurrency; byCategory: ByCategory } {
  const byCurrency: ByCurrency = { TWD: 0, USD: 0, JPY: 0, EUR: 0 };
  const catMap = new Map<ExpenseCategory, ByCurrency>();

  for (const e of expenses) {
    byCurrency[e.currency] = (byCurrency[e.currency] ?? 0) + e.amount;
    if (!catMap.has(e.category)) {
      catMap.set(e.category, { TWD: 0, USD: 0, JPY: 0, EUR: 0 });
    }
    const cat = catMap.get(e.category)!;
    cat[e.currency] = (cat[e.currency] ?? 0) + e.amount;
  }

  const byCategory: ByCategory = CATEGORIES.filter((c) => catMap.has(c.value)).map((c) => ({
    category: c.value,
    total: catMap.get(c.value)!,
  }));

  return { byCurrency, byCategory };
}

function formatAmount(currency: Currency, amount: number): string {
  const decimals = currency === "JPY" ? 0 : 2;
  return amount.toLocaleString("zh-TW", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// 各外幣依即時匯率折回 TWD。rates 語意：1 TWD = rates[X] X，故 1 X = 1/rates[X] TWD。
// 缺任一「有金額卻查不到匯率」的幣別就回 null——寧可不顯示，也不給漏算的錯誤總額。
function totalInTwd(byCurrency: ByCurrency, rates: Record<string, number> | null): number | null {
  if (!rates) return null;
  let total = byCurrency.TWD || 0; // 防 byCurrency 形狀變動時 NaN 傳播（GLM REVIEW）
  for (const c of ["USD", "JPY", "EUR"] as const) {
    if (byCurrency[c] <= 0) continue;
    const rate = rates[c];
    if (!rate || rate <= 0) return null;
    total += byCurrency[c] / rate;
  }
  return total;
}

// ───────── component ─────────

export default function ExpensesPage() {
  const { user, loading } = useAuth();
  const params = useParams<{ id: string }>();
  const tripId = params.id;

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [rates, setRates] = useState<Record<string, number> | null>(null);
  const [budgetMax, setBudgetMax] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // ── fetch ──
  const fetchExpenses = useCallback(async () => {
    if (!user) return;
    setFetchError(null);
    try {
      const res = await authedFetch(`/api/trips/${tripId}/expenses`);
      const data = await res.json() as Expense[] | { error: string };
      if (!res.ok) throw new Error((data as { error: string }).error ?? "讀取失敗");
      setExpenses(data as Expense[]);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "讀取失敗");
    }
  }, [user, tripId]);

  useEffect(() => {
    void fetchExpenses();
  }, [fetchExpenses]);

  // best-effort：即時匯率（換算 TWD 總計）＋ 行程預算上限（超支預警）。取不到就不顯示。
  useEffect(() => {
    if (!user) return;
    void (async () => {
      try {
        const [ratesRes, tripRes] = await Promise.all([
          authedFetch("/api/rates?base=TWD"),
          authedFetch(`/api/trips/${tripId}`),
        ]);
        if (ratesRes.ok) {
          const d = (await ratesRes.json()) as { rates?: Record<string, number> };
          setRates(d.rates ?? {});
        }
        if (tripRes.ok) {
          const d = (await tripRes.json()) as { trip?: { budget?: { max?: number } } };
          if (typeof d.trip?.budget?.max === "number") setBudgetMax(d.trip.budget.max);
        }
      } catch {
        // 加值資訊，失敗不影響記帳主功能
      }
    })();
  }, [user, tripId]);

  // ── submit (create or update) ──
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const amount = parseFloat(form.amount);
    if (!form.label.trim()) return setFormError("請輸入名稱");
    if (isNaN(amount) || amount <= 0) return setFormError("金額必須大於 0");

    setSubmitting(true);
    try {
      const payload = {
        label: form.label.trim(),
        amount,
        currency: form.currency,
        category: form.category,
        date: form.date,
      };

      if (editingId) {
        const res = await authedFetch(`/api/trips/${tripId}/expenses/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const d = await res.json() as { error: string };
          throw new Error(d.error);
        }
      } else {
        const res = await authedFetch(`/api/trips/${tripId}/expenses`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const d = await res.json() as { error: string };
          throw new Error(d.error);
        }
      }

      setForm(defaultForm());
      setEditingId(null);
      await fetchExpenses();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(exp: Expense) {
    setEditingId(exp.id);
    setForm({
      label: exp.label,
      amount: String(exp.amount),
      currency: exp.currency,
      category: exp.category,
      date: exp.date,
    });
    setFormError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(defaultForm());
    setFormError(null);
  }

  async function handleDelete(expenseId: string) {
    try {
      await authedFetch(`/api/trips/${tripId}/expenses/${expenseId}`, { method: "DELETE" });
      if (editingId === expenseId) cancelEdit();
      await fetchExpenses();
    } catch {
      // 靜默失敗
    }
  }

  // ── guards ──
  if (loading) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-neutral-400">載入中…</main>;
  }
  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-5">
        <p className="mb-4 text-sm text-neutral-500">請先登入才能查看費用。</p>
        <GoogleSignInButton />
      </main>
    );
  }

  const { byCurrency, byCategory } = computeSummary(expenses);
  const hasTotals = Object.values(byCurrency).some((v) => v > 0);
  const twdTotal = totalInTwd(byCurrency, rates);
  const overBudget = twdTotal !== null && budgetMax !== null && twdTotal > budgetMax;

  return (
    <main className="mx-auto max-w-xl px-5 py-12">
      {/* nav */}
      <div className="mb-8 flex items-center gap-3">
        <Link href={`/trips/${tripId}`} className="text-sm text-neutral-400 hover:text-neutral-700 transition-colors">
          ← 返回行程
        </Link>
        <span className="text-neutral-300">/</span>
        <h1 className="text-sm font-semibold text-neutral-800">費用記帳</h1>
      </div>

      {/* ── 新增 / 編輯表單 ── */}
      <section className="mb-8 rounded-xl border border-neutral-200 bg-neutral-50 px-5 py-5">
        <h2 className="mb-4 text-sm font-semibold text-neutral-700">
          {editingId ? "編輯費用" : "新增費用"}
        </h2>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
          {/* 名稱 */}
          <input
            type="text"
            placeholder="費用名稱（如：午餐、捷運）"
            value={form.label}
            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-teal-500 focus:outline-none"
          />

          {/* 金額 + 幣別 */}
          <div className="flex gap-2">
            <input
              type="number"
              min="0.01"
              step="0.01"
              placeholder="金額"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              className="flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-teal-500 focus:outline-none"
            />
            <select
              value={form.currency}
              onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value as Currency }))}
              className="rounded-lg border border-neutral-200 px-2 py-2 text-sm text-neutral-700 focus:border-teal-500 focus:outline-none"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* 分類 + 日期 */}
          <div className="flex gap-2">
            <select
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as ExpenseCategory }))}
              className="flex-1 rounded-lg border border-neutral-200 px-2 py-2 text-sm text-neutral-700 focus:border-teal-500 focus:outline-none"
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {CATEGORY_EMOJI[c.value]} {c.label}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              className="rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-700 focus:border-teal-500 focus:outline-none"
            />
          </div>

          {formError && <p className="text-xs text-red-600">{formError}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-lg bg-teal-700 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50"
            >
              {submitting ? "儲存中…" : editingId ? "更新" : "新增"}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={cancelEdit}
                className="rounded-lg border border-neutral-200 px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100"
              >
                取消
              </button>
            )}
          </div>
        </form>
      </section>

      {/* ── 費用列表 ── */}
      {fetchError && <p className="mb-4 text-sm text-red-600">{fetchError}</p>}

      {expenses.length === 0 && !fetchError && (
        <p className="mb-8 text-center text-sm text-neutral-400">還沒有費用記錄，從上方新增吧！</p>
      )}

      {expenses.length > 0 && (
        <ul className="mb-8 space-y-2">
          {expenses.map((exp) => (
            <li
              key={exp.id}
              className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${
                editingId === exp.id ? "border-teal-400 bg-teal-50" : "border-neutral-200 bg-white"
              }`}
            >
              <span className="text-base">{CATEGORY_EMOJI[exp.category]}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-900">{exp.label}</p>
                <p className="text-xs text-neutral-400">{exp.date} · {CATEGORIES.find((c) => c.value === exp.category)?.label}</p>
              </div>
              <span className="shrink-0 text-sm font-semibold text-neutral-700">
                {exp.currency} {formatAmount(exp.currency, exp.amount)}
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => startEdit(exp)}
                  className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                >
                  編輯
                </button>
                <button
                  onClick={() => void handleDelete(exp.id)}
                  className="rounded px-2 py-1 text-xs text-neutral-400 hover:bg-red-50 hover:text-red-600"
                >
                  刪除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ── 統計摘要 ── */}
      {hasTotals && (
        <section className="rounded-xl border border-neutral-200 bg-neutral-50 px-5 py-4">
          <h2 className="mb-3 text-sm font-semibold text-neutral-700">費用統計</h2>

          {/* 各幣別合計 */}
          <div className="mb-4 flex flex-wrap gap-3">
            {CURRENCIES.filter((c) => byCurrency[c] > 0).map((c) => (
              <div key={c} className="rounded-lg bg-white border border-neutral-200 px-3 py-2 text-center">
                <p className="text-xs text-neutral-400">{c}</p>
                <p className="text-sm font-semibold text-neutral-900">{formatAmount(c, byCurrency[c])}</p>
              </div>
            ))}
          </div>

          {/* 折合 TWD 總計 + 超支預警 */}
          {twdTotal !== null && (
            <div
              className={`mb-4 rounded-lg border px-4 py-3 ${
                overBudget ? "border-red-300 bg-red-50" : "border-teal-200 bg-teal-50"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-neutral-500">全部折合 TWD</span>
                <span className={`text-base font-semibold ${overBudget ? "text-red-700" : "text-teal-800"}`}>
                  ≈ {formatAmount("TWD", Math.round(twdTotal))}
                </span>
              </div>
              {budgetMax !== null && (
                <p className={`mt-1 text-xs ${overBudget ? "text-red-600" : "text-neutral-400"}`}>
                  {overBudget
                    ? `⚠️ 已超出行程預算上限（${formatAmount("TWD", budgetMax)} 元）`
                    : `行程預算上限 ${formatAmount("TWD", budgetMax)} 元`}
                </p>
              )}
              <p className="mt-1 text-[11px] text-neutral-400">依即時匯率換算，僅供參考</p>
            </div>
          )}

          {/* 分類明細 */}
          <div className="space-y-2">
            {byCategory.map(({ category, total }) => (
              <div key={category} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 text-neutral-600">
                  {CATEGORY_EMOJI[category]}
                  <span>{CATEGORIES.find((c) => c.value === category)?.label}</span>
                </span>
                <span className="text-neutral-700 text-xs">
                  {CURRENCIES.filter((c) => total[c] > 0)
                    .map((c) => `${c} ${formatAmount(c, total[c])}`)
                    .join(" + ")}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
