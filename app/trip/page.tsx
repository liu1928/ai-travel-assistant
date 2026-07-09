"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth, authedFetch } from "@/lib/use-auth";
import { GoogleSignInButton } from "@/components/google-signin";
import type { SavedPlace } from "@/schema/place";
import type { Flight, CarRental, Lodging } from "@/schema/trip";
import {
  BookingCards,
  BookingsFields,
  draftsToBookings,
  type FlightDraft,
  type CarRentalDraft,
  type LodgingDraft,
} from "@/components/bookings";

type TripStyle = "relax" | "food" | "nature" | "city";
type TravelMode = "DRIVE" | "WALK" | "TRANSIT";

type ScheduleItem = {
  time: string;
  title: string;
  description: string;
  type: "transport" | "food" | "place" | "rest";
  location?: string;
};
type TripDay = { day: number; schedule: ScheduleItem[] };
type Trip = {
  title: string;
  location: string;
  style: TripStyle;
  summary: string;
  days: TripDay[];
  insights: string[];
  budget: { min: number; max: number };
  flights?: Flight[];
  carRentals?: CarRental[];
  lodgings?: Lodging[];
};

type GenState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; trip: Trip }
  | { status: "error"; message: string };

type SaveState = { status: "idle" | "saving" | "error"; message?: string };

const STYLE_LABEL: Record<TripStyle, string> = {
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

export default function TripGeneratePage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center text-sm text-neutral-400">
          載入中…
        </main>
      }
    >
      <TripGenerateInner />
    </Suspense>
  );
}

function TripGenerateInner() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialGroup = searchParams.get("group") ?? "";

  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [groupFilter, setGroupFilter] = useState<string>(initialGroup);
  const [prompt, setPrompt] = useState("");
  const [startDate, setStartDate] = useState("");
  const [days, setDays] = useState<number | "">("");
  const [style, setStyle] = useState<TripStyle | "">("");
  const [budgetMin, setBudgetMin] = useState<number | "">("");
  const [budgetMax, setBudgetMax] = useState<number | "">("");
  const [travelMode, setTravelMode] = useState<TravelMode>("DRIVE");
  const [flightDrafts, setFlightDrafts] = useState<FlightDraft[]>([]);
  const [rentalDrafts, setRentalDrafts] = useState<CarRentalDraft[]>([]);
  const [lodgingDrafts, setLodgingDrafts] = useState<LodgingDraft[]>([]);

  const [gen, setGen] = useState<GenState>({ status: "idle" });
  const [save, setSave] = useState<SaveState>({ status: "idle" });

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const res = await authedFetch("/api/collection");
      const data = (await res.json()) as { places?: SavedPlace[] };
      if (res.ok) setPlaces(data.places ?? []);
    })();
  }, [user]);

  useEffect(() => {
    if (!initialGroup || places.length === 0) return;
    const ids = places.filter((p) => p.group === initialGroup).map((p) => p.placeId);
    if (ids.length > 0) setSelectedIds(new Set(ids));
  }, [initialGroup, places]);

  function toggleSelect(placeId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(placeId)) next.delete(placeId);
      else next.add(placeId);
      return next;
    });
  }

  async function handleGenerate() {
    if (!prompt.trim() && selectedIds.size === 0) {
      setGen({ status: "error", message: "請至少輸入一句話，或勾選幾個收藏地點" });
      return;
    }
    const bookings = draftsToBookings(flightDrafts, rentalDrafts, lodgingDrafts);
    if (!bookings.ok) {
      setGen({ status: "error", message: bookings.message });
      return;
    }
    setGen({ status: "loading" });
    setSave({ status: "idle" });
    try {
      const res = await authedFetch("/api/trip/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim() || undefined,
          placeIds: selectedIds.size > 0 ? [...selectedIds] : undefined,
          days: days === "" ? undefined : days,
          style: style || undefined,
          budgetMin: budgetMin === "" ? undefined : budgetMin,
          budgetMax: budgetMax === "" ? undefined : budgetMax,
          travelMode,
          startDate: startDate || undefined,
          flights: bookings.flights.length > 0 ? bookings.flights : undefined,
          carRentals: bookings.carRentals.length > 0 ? bookings.carRentals : undefined,
          lodgings: bookings.lodgings.length > 0 ? bookings.lodgings : undefined,
        }),
      });
      const data = (await res.json()) as { trip?: Trip; error?: string };
      if (!res.ok || !data.trip) throw new Error(data.error ?? "生成失敗");
      setGen({ status: "done", trip: data.trip });
    } catch (e) {
      setGen({ status: "error", message: e instanceof Error ? e.message : "生成失敗" });
    }
  }

  async function handleSave() {
    if (gen.status !== "done") return;
    setSave({ status: "saving" });
    try {
      const res = await authedFetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trip: gen.trip }),
      });
      const data = (await res.json()) as { trip?: { id: string }; error?: string };
      if (!res.ok || !data.trip) throw new Error(data.error ?? "儲存失敗");
      router.push(`/trips/${data.trip.id}`);
    } catch (e) {
      setSave({ status: "error", message: e instanceof Error ? e.message : "儲存失敗" });
    }
  }

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-neutral-400">載入中…</main>;
  }
  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-5">
        <p className="mb-4 text-sm text-neutral-500">請先登入才能生成行程。</p>
        <GoogleSignInButton />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <div className="mb-8 flex items-center justify-between">
        <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-700 transition-colors">← 返回收藏</Link>
        <Link href="/trips" className="text-sm text-neutral-400 hover:text-neutral-700 transition-colors">查看已存行程 →</Link>
      </div>

      <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 mb-1">產生行程</h1>
      <p className="text-sm text-neutral-500 mb-8">寫一句話，或從收藏挑幾個地點，讓 AI 幫你排行程。</p>

      <div className="mb-4">
        <label className="mb-1 block text-xs font-medium text-neutral-500">一句話描述（可留空）</label>
        <textarea
          value={prompt}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPrompt(e.target.value)}
          rows={2}
          placeholder="例如：週末想去台中放鬆"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        />
      </div>

      {places.length > 0 && (() => {
        const groups = [...new Set(places.map((p) => p.group).filter(Boolean))] as string[];
        const filtered = groupFilter ? places.filter((p) => p.group === groupFilter) : places;
        return (
          <div className="mb-4">
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-medium text-neutral-500">
                從收藏挑選地點（已選 {selectedIds.size}）
              </label>
              {groups.length > 0 && (
                <select
                  value={groupFilter}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setGroupFilter(e.target.value)}
                  className="rounded-md border border-neutral-200 px-2 py-0.5 text-xs text-neutral-600 outline-none"
                >
                  <option value="">全部群組</option>
                  {groups.map((g) => <option key={g} value={g}>📁 {g}</option>)}
                </select>
              )}
            </div>
            <div className="max-h-48 overflow-y-auto rounded-lg border border-neutral-200 p-2">
              {filtered.map((p) => (
                <label key={p.placeId} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-neutral-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(p.placeId)}
                    onChange={() => toggleSelect(p.placeId)}
                    className="accent-teal-700"
                  />
                  <span className="text-neutral-800">{p.name}</span>
                  {p.group && !groupFilter && (
                    <span className="text-xs text-neutral-400">{p.group}</span>
                  )}
                </label>
              ))}
            </div>
          </div>
        );
      })()}

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-500">出發日期（可留空）</label>
          <input
            type="date"
            value={startDate}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setStartDate(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          />
          <p className="mt-1 text-xs text-neutral-400">填了會自動偵測當地連假、避開人潮</p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-500">天數</label>
          <input
            type="number"
            min={1}
            value={days}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDays(e.target.value === "" ? "" : Number(e.target.value))}
            placeholder="不填由 AI 判斷"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-500">風格</label>
          <select
            value={style}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setStyle(e.target.value as TripStyle | "")}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            <option value="">不指定</option>
            <option value="relax">放鬆</option>
            <option value="food">美食</option>
            <option value="nature">自然</option>
            <option value="city">城市</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-500">預算下限</label>
          <input
            type="number"
            min={0}
            value={budgetMin}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBudgetMin(e.target.value === "" ? "" : Number(e.target.value))}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-neutral-500">預算上限</label>
          <input
            type="number"
            min={0}
            value={budgetMax}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBudgetMax(e.target.value === "" ? "" : Number(e.target.value))}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          />
        </div>
      </div>

      <div className="mb-6">
        <label className="mb-1 block text-xs font-medium text-neutral-500">交通方式（用於估算實際車程）</label>
        <select
          value={travelMode}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setTravelMode(e.target.value as TravelMode)}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        >
          <option value="DRIVE">開車</option>
          <option value="WALK">步行</option>
          <option value="TRANSIT">大眾運輸</option>
        </select>
      </div>

      <div className="mb-6">
        <BookingsFields
          flights={flightDrafts}
          rentals={rentalDrafts}
          lodgings={lodgingDrafts}
          onFlightsChange={setFlightDrafts}
          onRentalsChange={setRentalDrafts}
          onLodgingsChange={setLodgingDrafts}
        />
      </div>

      <button
        onClick={() => void handleGenerate()}
        disabled={gen.status === "loading"}
        className="w-full rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-40 transition-colors"
      >
        {gen.status === "loading" ? "生成中，請稍候…" : "生成行程"}
      </button>

      {gen.status === "error" && <p className="mt-3 text-sm text-red-600">{gen.message}</p>}

      {gen.status === "done" && (
        <section className="mt-10">
          <div className="mb-4 rounded-lg border border-neutral-200 bg-neutral-50 px-5 py-4">
            <h2 className="text-lg font-semibold text-neutral-900">{gen.trip.title}</h2>
            <p className="mt-1 text-sm text-neutral-600">{gen.trip.summary}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-neutral-500">
              <span>{gen.trip.location}</span>
              <span>·</span>
              <span>{STYLE_LABEL[gen.trip.style]}</span>
              <span>·</span>
              <span>預算 {gen.trip.budget.min}~{gen.trip.budget.max} 元</span>
            </div>
          </div>

          <BookingCards flights={gen.trip.flights} carRentals={gen.trip.carRentals} lodgings={gen.trip.lodgings} />

          {gen.trip.days.map((day) => (
            <div key={day.day} className="mb-6">
              <h3 className="mb-2 text-sm font-semibold text-neutral-800">第 {day.day} 天</h3>
              <ul className="space-y-2">
                {day.schedule.map((item, i) => (
                  <li key={i} className="flex gap-3 rounded-lg border border-neutral-200 px-3 py-2.5">
                    <span className="shrink-0 text-xs font-mono text-neutral-400 pt-0.5">{item.time}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-neutral-900">
                        {item.title}
                        <span className="ml-2 text-xs text-neutral-400">{TYPE_LABEL[item.type]}</span>
                      </p>
                      <p className="text-xs text-neutral-500">{item.description}</p>
                      {(item.type === "place" || item.type === "food") && (
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
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {gen.trip.insights.length > 0 && (
            <div className="mb-6 rounded-lg bg-amber-50 px-4 py-3">
              <ul className="space-y-1 text-xs text-amber-800">
                {gen.trip.insights.map((insight, i) => (
                  <li key={i}>💡 {insight}</li>
                ))}
              </ul>
            </div>
          )}

          <button
            onClick={() => void handleSave()}
            disabled={save.status === "saving"}
            className="w-full rounded-lg border border-teal-700 px-4 py-2.5 text-sm font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-40 transition-colors"
          >
            {save.status === "saving" ? "儲存中…" : "儲存行程"}
          </button>
          {save.status === "error" && <p className="mt-2 text-sm text-red-600">{save.message}</p>}
        </section>
      )}
    </main>
  );
}
