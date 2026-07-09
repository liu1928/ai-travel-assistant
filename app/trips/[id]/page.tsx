"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth, signInWithGoogle, authedFetch } from "@/lib/use-auth";
import type { Flight, CarRental } from "@/schema/trip";
import {
  BookingCards,
  BookingsFields,
  draftsToBookings,
  flightToDraft,
  rentalToDraft,
  type FlightDraft,
  type CarRentalDraft,
} from "@/components/bookings";

type ScheduleItem = {
  time: string;
  title: string;
  description: string;
  type: "transport" | "food" | "place" | "rest";
  location?: string;
};
type TripDay = { day: number; schedule: ScheduleItem[] };
type SavedTrip = {
  id: string;
  title: string;
  location: string;
  style: "relax" | "food" | "nature" | "city";
  summary: string;
  days: TripDay[];
  insights: string[];
  budget: { min: number; max: number };
  flights?: Flight[];
  carRentals?: CarRental[];
  createdAt: number;
};

type ViewState =
  | { status: "loading" }
  | { status: "ready"; trip: SavedTrip }
  | { status: "error"; message: string };

const STYLE_LABEL: Record<SavedTrip["style"], string> = {
  relax: "放鬆",
  food: "美食",
  nature: "自然",
  city: "城市",
};
const TYPE_LABEL: Record<ScheduleItem["type"], string> = {
  transport: "移動",
  food: "美食",
  place: "景點",
  rest: "休息",
};

function navUrl(item: ScheduleItem): string {
  const q = item.location ?? item.title;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

const SPLIT_BILL_URL = process.env.NEXT_PUBLIC_SPLIT_BILL_URL;

function buildSplitBillHref(base: string, trip: SavedTrip): string {
  const params = new URLSearchParams({
    from: "atlas",
    title: trip.title,
    days: String(trip.days.length),
    budget: String(trip.budget.max),
  });
  return `${base.replace(/\/$/, "")}/?${params.toString()}`;
}

export default function TripViewPage() {
  const { user, loading } = useAuth();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [view, setView] = useState<ViewState>({ status: "loading" });

  const [editing, setEditing] = useState(false);
  const [draftDays, setDraftDays] = useState<TripDay[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 航班/租車有自己的編輯模式：儲存後補填不重新生成（specs/flights-rentals.md §2.5）
  const [editingBookings, setEditingBookings] = useState(false);
  const [flightDrafts, setFlightDrafts] = useState<FlightDraft[]>([]);
  const [rentalDrafts, setRentalDrafts] = useState<CarRentalDraft[]>([]);
  const [savingBookings, setSavingBookings] = useState(false);
  const [bookingsError, setBookingsError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      try {
        const res = await authedFetch(`/api/trips/${params.id}`);
        const data = (await res.json()) as { trip?: SavedTrip; error?: string };
        if (!res.ok || !data.trip) throw new Error(data.error ?? "讀取失敗");
        setView({ status: "ready", trip: data.trip });
      } catch (e) {
        setView({ status: "error", message: e instanceof Error ? e.message : "讀取失敗" });
      }
    })();
  }, [user, params.id]);

  function startEdit() {
    if (view.status !== "ready") return;
    setDraftDays(view.trip.days.map((d) => ({ day: d.day, schedule: [...d.schedule] })));
    setSaveError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setSaveError(null);
  }

  function removeItem(dayIdx: number, itemIdx: number) {
    setDraftDays((prev) => {
      const next = prev.map((d) => ({ ...d, schedule: [...d.schedule] }));
      next[dayIdx].schedule.splice(itemIdx, 1);
      return next;
    });
  }

  function moveItem(dayIdx: number, itemIdx: number, direction: -1 | 1) {
    setDraftDays((prev) => {
      const next = prev.map((d) => ({ ...d, schedule: [...d.schedule] }));
      const schedule = next[dayIdx].schedule;
      const target = itemIdx + direction;
      if (target < 0 || target >= schedule.length) return prev;
      [schedule[itemIdx], schedule[target]] = [schedule[target], schedule[itemIdx]];
      return next;
    });
  }

  async function saveEdit() {
    if (view.status !== "ready") return;
    setSaving(true);
    setSaveError(null);
    try {
      const updatedTrip = { ...view.trip, days: draftDays };
      const res = await authedFetch(`/api/trips/${view.trip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trip: updatedTrip }),
      });
      const data = (await res.json()) as { trip?: SavedTrip; error?: string };
      if (!res.ok || !data.trip) throw new Error(data.error ?? "儲存失敗");
      setView({ status: "ready", trip: data.trip });
      setEditing(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  }

  function startBookingsEdit() {
    if (view.status !== "ready") return;
    setFlightDrafts((view.trip.flights ?? []).map(flightToDraft));
    setRentalDrafts((view.trip.carRentals ?? []).map(rentalToDraft));
    setBookingsError(null);
    setEditingBookings(true);
  }

  async function saveBookings() {
    if (view.status !== "ready") return;
    const bookings = draftsToBookings(flightDrafts, rentalDrafts);
    if (!bookings.ok) {
      setBookingsError(bookings.message);
      return;
    }
    setSavingBookings(true);
    setBookingsError(null);
    try {
      const updatedTrip = { ...view.trip, flights: bookings.flights, carRentals: bookings.carRentals };
      const res = await authedFetch(`/api/trips/${view.trip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trip: updatedTrip }),
      });
      const data = (await res.json()) as { trip?: SavedTrip; error?: string };
      if (!res.ok || !data.trip) throw new Error(data.error ?? "儲存失敗");
      setView({ status: "ready", trip: data.trip });
      setEditingBookings(false);
    } catch (e) {
      setBookingsError(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setSavingBookings(false);
    }
  }

  async function handleDelete() {
    if (view.status !== "ready") return;
    try {
      await authedFetch(`/api/trips/${view.trip.id}`, { method: "DELETE" });
      router.push("/trips");
    } catch {
      // 忽略
    }
  }

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-neutral-400">載入中…</main>;
  }
  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-5">
        <p className="mb-4 text-sm text-neutral-500">請先登入才能查看行程。</p>
        <button onClick={() => void signInWithGoogle()} className="rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-teal-800">用 Google 登入</button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <div className="mb-8 flex items-center justify-between">
        <Link href="/trips" className="text-sm text-neutral-400 hover:text-neutral-700 transition-colors">← 返回行程列表</Link>
        {view.status === "ready" && (
          <div className="flex items-center gap-4">
            <Link
              href={`/trips/${view.trip.id}/expenses`}
              className="text-sm font-medium text-teal-700 hover:text-teal-900 transition-colors"
            >
              💰 記帳
            </Link>
            {SPLIT_BILL_URL && (
              <a
                href={buildSplitBillHref(SPLIT_BILL_URL, view.trip)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-emerald-700 hover:text-emerald-900 transition-colors"
              >
                去分帳 →
              </a>
            )}
          </div>
        )}
      </div>

      {view.status === "loading" && <p className="text-sm text-neutral-400">載入中…</p>}
      {view.status === "error" && <p className="text-sm text-red-600">{view.message}</p>}

      {view.status === "ready" && (
        <>
          <div className="mb-4 flex items-start justify-between rounded-lg border border-neutral-200 bg-neutral-50 px-5 py-4">
            <div>
              <h1 className="text-lg font-semibold text-neutral-900">{view.trip.title}</h1>
              <p className="mt-1 text-sm text-neutral-600">{view.trip.summary}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-500">
                <span>{view.trip.location}</span>
                <span>·</span>
                <span>{STYLE_LABEL[view.trip.style]}</span>
                <span>·</span>
                <span>預算 {view.trip.budget.min}~{view.trip.budget.max} 元</span>
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              {!editing && (
                <button onClick={startEdit} className="text-xs text-teal-700 hover:text-teal-900">編輯</button>
              )}
              <button onClick={() => void handleDelete()} className="text-xs text-neutral-400 hover:text-red-600">刪除</button>
            </div>
          </div>

          <div className="mb-4">
            {!editingBookings ? (
              <>
                <BookingCards flights={view.trip.flights} carRentals={view.trip.carRentals} />
                <button
                  onClick={startBookingsEdit}
                  className="text-xs text-teal-700 hover:text-teal-900"
                >
                  {(view.trip.flights?.length ?? 0) > 0 || (view.trip.carRentals?.length ?? 0) > 0
                    ? "編輯航班/租車"
                    : "＋ 新增航班/租車"}
                </button>
              </>
            ) : (
              <div className="rounded-lg border border-neutral-200 p-4">
                <BookingsFields
                  flights={flightDrafts}
                  rentals={rentalDrafts}
                  onFlightsChange={setFlightDrafts}
                  onRentalsChange={setRentalDrafts}
                  defaultOpen
                />
                {bookingsError && (
                  <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{bookingsError}</p>
                )}
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={() => void saveBookings()}
                    disabled={savingBookings}
                    className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-40"
                  >
                    {savingBookings ? "儲存中…" : "儲存"}
                  </button>
                  <button
                    onClick={() => { setEditingBookings(false); setBookingsError(null); }}
                    disabled={savingBookings}
                    className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-40"
                  >
                    取消
                  </button>
                  <span className="text-xs text-neutral-400">補填只做記錄，不會重排時間軸</span>
                </div>
              </div>
            )}
          </div>

          {saveError && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{saveError}</p>}

          {(editing ? draftDays : view.trip.days).map((day, dayIdx) => (
            <div key={day.day} className="mb-6">
              <h2 className="mb-2 text-sm font-semibold text-neutral-800">第 {day.day} 天</h2>
              <ul className="space-y-2">
                {day.schedule.map((item, i) => (
                  <li key={i} className="flex gap-3 rounded-lg border border-neutral-200 px-3 py-2.5">
                    <span className="shrink-0 text-xs font-mono text-neutral-400 pt-0.5">{item.time}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-neutral-900">
                        {item.title}
                        <span className="ml-2 text-xs text-neutral-400">{TYPE_LABEL[item.type]}</span>
                      </p>
                      <p className="text-xs text-neutral-500">{item.description}</p>
                      {!editing && (item.type === "place" || item.type === "food") && (
                        <a
                          href={navUrl(item)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-block text-xs text-teal-700 hover:text-teal-900"
                        >
                          🧭 導航
                        </a>
                      )}
                    </div>
                    {editing && (
                      <div className="flex shrink-0 items-start gap-1">
                        <button onClick={() => moveItem(dayIdx, i, -1)} disabled={i === 0} className="text-xs text-neutral-400 hover:text-neutral-700 disabled:opacity-30">↑</button>
                        <button onClick={() => moveItem(dayIdx, i, 1)} disabled={i === day.schedule.length - 1} className="text-xs text-neutral-400 hover:text-neutral-700 disabled:opacity-30">↓</button>
                        <button onClick={() => removeItem(dayIdx, i)} className="text-xs text-neutral-400 hover:text-red-600">✕</button>
                      </div>
                    )}
                  </li>
                ))}
                {editing && day.schedule.length === 0 && (
                  <li className="rounded-lg border border-dashed border-neutral-300 px-3 py-3 text-center text-xs text-neutral-400">
                    這天已經沒有行程了
                  </li>
                )}
              </ul>
            </div>
          ))}

          {editing ? (
            <div className="flex gap-2">
              <button onClick={() => void saveEdit()} disabled={saving} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-40">
                {saving ? "儲存中…" : "儲存變更"}
              </button>
              <button onClick={cancelEdit} disabled={saving} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-40">
                取消
              </button>
            </div>
          ) : (
            view.trip.insights.length > 0 && (
              <div className="rounded-lg bg-amber-50 px-4 py-3">
                <ul className="space-y-1 text-xs text-amber-800">
                  {view.trip.insights.map((insight, i) => (
                    <li key={i}>💡 {insight}</li>
                  ))}
                </ul>
              </div>
            )
          )}
        </>
      )}
    </main>
  );
}
