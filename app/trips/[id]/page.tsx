"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { useAuth, authedFetch } from "@/lib/use-auth";
import { GoogleSignInButton } from "@/components/google-signin";
import { resolveDayMapItems } from "@/lib/day-map";
import type { Flight, CarRental, Lodging, DailyWeather, ExchangeRate } from "@/schema/trip";
import { buildLodgingLink } from "@/lib/booking-link";
import { attachDurations, reflowTimes, timeToMin, isRouteInsight } from "@/lib/trip-edit";
import {
  BookingCards,
  BookingsFields,
  draftsToBookings,
  flightToDraft,
  rentalToDraft,
  lodgingToDraft,
  type FlightDraft,
  type CarRentalDraft,
  type LodgingDraft,
} from "@/components/bookings";

// Leaflet 依賴 window，一律 dynamic + ssr:false（specs/map-view.md）
const DayRouteMap = dynamic(() => import("@/components/day-route-map"), { ssr: false });

type ScheduleItem = {
  time: string;
  title: string;
  description: string;
  type: "transport" | "food" | "place" | "rest";
  location?: string;
  durationMin?: number;
  placeId?: string;
  lat?: number;
  lng?: number;
  openingWarning?: string;
};
type TripDay = { day: number; schedule: ScheduleItem[] };
// 編輯草稿：每項掛「有效時長」（進編輯模式時差分算出，跟著項目走），
// anchorMin = 當天第一項的原始開始時間，刪除/排序後以此錨點重排所有 time。
type DraftItem = ScheduleItem & { effDurationMin: number };
type DraftDay = { day: number; anchorMin: number; schedule: DraftItem[] };
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
  lodgings?: Lodging[];
  weather?: DailyWeather[];
  exchangeRate?: ExchangeRate;
  startDate?: string;
  createdAt: number;
};

type ViewState =
  | { status: "loading" }
  | { status: "ready"; trip: SavedTrip }
  | { status: "error"; message: string };

type LodgingItem = {
  place: { placeId: string; name: string; address?: string; rating?: number };
  priceLevel?: number;
  bookingUrl: string;
};
type LodgingState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; items: LodgingItem[] }
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

// 天氣描述（lib/weather.ts 產的中文字串）→ emoji，純關鍵字比對
function weatherEmoji(description: string): string {
  if (description.includes("雷")) return "⛈️";
  if (description.includes("雪") || description.includes("冰")) return "🌨️";
  if (description.includes("雨") || description.includes("毛毛")) return "🌧️";
  if (description.includes("霧")) return "🌫️";
  if (description.includes("陰")) return "☁️";
  if (description.includes("多雲") || description.includes("大致晴")) return "⛅";
  if (description.includes("晴")) return "☀️";
  return "🌡️";
}

// 降雨量門檻：超過視為「雨天」，行程頁標記提醒帶傘（mm/日）
const RAIN_ALERT_MM = 5;

// 依整趟天氣預報產打包提醒（純衍生，無副作用）
function buildPackingList(weather: DailyWeather[]): string[] {
  if (weather.length === 0) return [];
  const items: string[] = [];
  const maxT = Math.max(...weather.map((w) => w.maxTempC));
  const minT = Math.min(...weather.map((w) => w.minTempC));
  const wettest = Math.max(...weather.map((w) => w.precipitationMm));
  if (maxT >= 28) items.push("☀️ 短袖薄衫、防曬乳、太陽眼鏡");
  if (maxT >= 30) items.push("💧 隨身補水，注意中暑");
  if (minT <= 15) items.push("🧥 外套（早晚偏涼）");
  if (minT <= 5) items.push("🧣 厚外套、圍巾、保暖配件");
  if (wettest >= RAIN_ALERT_MM) items.push("☔ 雨傘或輕便雨衣");
  if (maxT - minT >= 10) items.push("🌡️ 日夜溫差大，建議洋蔥式穿搭");
  return items;
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
  const [draftDays, setDraftDays] = useState<DraftDay[]>([]);
  const [saving, setSaving] = useState(false);
  // 單日路線圖（specs/map-view.md）：哪些天展開地圖 + 舊行程降級用的收藏座標對映（懶載入，全頁共用一次）
  const [mapOpenDays, setMapOpenDays] = useState<Set<number>>(new Set());
  const [collectionCoords, setCollectionCoords] = useState<Map<string, { lat: number; lng: number }> | null>(null);
  // 單日重生（specs/day-regenerate.md）：哪天展開回饋輸入 + 送出狀態
  const [regenOpenDay, setRegenOpenDay] = useState<number | null>(null);
  const [regenFeedback, setRegenFeedback] = useState("");
  const [regenState, setRegenState] = useState<
    | { status: "idle" }
    | { status: "running"; day: number }
    | { status: "error"; day: number; message: string }
  >({ status: "idle" });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [icsError, setIcsError] = useState<string | null>(null);
  const [offlineBanner, setOfflineBanner] = useState(false);

  // 航班/租車有自己的編輯模式：儲存後補填不重新生成（specs/flights-rentals.md §2.5）
  const [editingBookings, setEditingBookings] = useState(false);
  const [flightDrafts, setFlightDrafts] = useState<FlightDraft[]>([]);
  const [rentalDrafts, setRentalDrafts] = useState<CarRentalDraft[]>([]);
  const [lodgingDrafts, setLodgingDrafts] = useState<LodgingDraft[]>([]);
  const [savingBookings, setSavingBookings] = useState(false);
  const [bookingsError, setBookingsError] = useState<string | null>(null);

  // 住宿建議（Places 錨定行程地理重心 + 價位篩 + 訂房 deep-link）
  const [maxPriceLevel, setMaxPriceLevel] = useState<number | undefined>(undefined);
  const [lodging, setLodging] = useState<LodgingState>({ status: "idle" });

  async function findLodging(tripId: string) {
    setLodging({ status: "loading" });
    try {
      const res = await authedFetch("/api/lodging/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tripId, maxPriceLevel }),
      });
      const data = (await res.json()) as { items?: LodgingItem[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "查詢住宿失敗");
      setLodging({ status: "ready", items: data.items ?? [] });
    } catch (e) {
      setLodging({ status: "error", message: e instanceof Error ? e.message : "查詢住宿失敗" });
    }
  }

  useEffect(() => {
    if (!user) return;
    void (async () => {
      try {
        const res = await authedFetch(`/api/trips/${params.id}`);
        const data = (await res.json()) as { trip?: SavedTrip; error?: string };
        if (!res.ok || !data.trip) throw new Error(data.error ?? "讀取失敗");
        setView({ status: "ready", trip: data.trip });
        // 離線時能讀到資料代表是 service worker 的 cache fallback（specs/export-offline.md §c
        // 故障模式：「fallback cache 無標示」），提示使用者這不一定是最新資料。
        setOfflineBanner(!navigator.onLine);
      } catch (e) {
        const message = !navigator.onLine
          ? "目前離線，且尚未瀏覽過此行程，無法離線查看"
          : e instanceof Error
            ? e.message
            : "讀取失敗";
        setView({ status: "error", message });
      }
    })();
  }, [user, params.id]);

  function startEdit() {
    if (view.status !== "ready") return;
    setDraftDays(
      view.trip.days.map((d) => ({
        day: d.day,
        anchorMin: timeToMin(d.schedule[0]?.time ?? "") ?? 9 * 60,
        schedule: attachDurations(d.schedule),
      })),
    );
    setSaveError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setSaveError(null);
  }

  // 收藏座標對映：只在第一次展開地圖時打一次（免費 Firestore 讀），供舊行程（無持久化座標）的名稱降級對映。
  async function loadCollectionCoords() {
    if (collectionCoords) return;
    try {
      const res = await authedFetch("/api/collection");
      const data = (await res.json()) as { places?: { name: string; location: { lat: number; lng: number } }[] };
      const map = new Map<string, { lat: number; lng: number }>();
      for (const p of data.places ?? []) map.set(p.name, p.location);
      setCollectionCoords(map);
    } catch {
      setCollectionCoords(new Map()); // 失敗也設空 map，避免每次展開都重打；地圖走「排除」路徑降級
    }
  }

  // 單日重生（specs/day-regenerate.md）：失敗不動 Firestore/畫面，成功以回傳整份 trip 更新 state。
  async function submitRegenerateDay(day: number) {
    setRegenState({ status: "running", day });
    try {
      const res = await authedFetch(`/api/trips/${params.id}/regenerate-day`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day, feedback: regenFeedback.trim() || undefined }),
      });
      const data = (await res.json()) as { trip?: SavedTrip; error?: string };
      if (!res.ok || !data.trip) throw new Error(data.error ?? "重新編排失敗");
      setView({ status: "ready", trip: data.trip });
      setRegenOpenDay(null);
      setRegenFeedback("");
      setRegenState({ status: "idle" });
    } catch (e) {
      setRegenState({ status: "error", day, message: e instanceof Error ? e.message : "重新編排失敗" });
    }
  }

  function toggleDayMap(day: number) {
    setMapOpenDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) {
        next.delete(day);
      } else {
        next.add(day);
        void loadCollectionCoords();
      }
      return next;
    });
  }

  // 刪除/排序後立即以當天錨點重排時間（所見即所得），時長跟著項目走
  function removeItem(dayIdx: number, itemIdx: number) {
    setDraftDays((prev) =>
      prev.map((d, di) => {
        if (di !== dayIdx) return d;
        const schedule = d.schedule.filter((_, i) => i !== itemIdx);
        return { ...d, schedule: reflowTimes(schedule, d.anchorMin) };
      }),
    );
  }

  function moveItem(dayIdx: number, itemIdx: number, direction: -1 | 1) {
    setDraftDays((prev) =>
      prev.map((d, di) => {
        if (di !== dayIdx) return d;
        const target = itemIdx + direction;
        if (target < 0 || target >= d.schedule.length) return d;
        const schedule = [...d.schedule];
        [schedule[itemIdx], schedule[target]] = [schedule[target], schedule[itemIdx]];
        return { ...d, schedule: reflowTimes(schedule, d.anchorMin) };
      }),
    );
  }

  async function saveEdit() {
    if (view.status !== "ready") return;
    // 刪到空的天在儲存時移除並重新連續編號（schema 要求每天至少 1 項、day 從 1 連續）；
    // effDurationMin 是編輯期的 UI 欄位，剝掉才符合 tripSchema
    const cleanedDays = draftDays
      .filter((d) => d.schedule.length > 0)
      .map((d, i) => ({
        day: i + 1,
        schedule: d.schedule.map(({ effDurationMin: _effDurationMin, ...item }) => item),
      }));
    if (cleanedDays.length === 0) {
      setSaveError("行程至少要保留一個項目");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const updatedTrip = {
        ...view.trip,
        days: cleanedDays,
        // 生成當下的車程 insights 在編輯後已過期，儲存前濾掉（AI 提醒保留）
        insights: view.trip.insights.filter((s) => !isRouteInsight(s)),
      };
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
    setLodgingDrafts((view.trip.lodgings ?? []).map(lodgingToDraft));
    setBookingsError(null);
    setEditingBookings(true);
  }

  async function saveBookings() {
    if (view.status !== "ready") return;
    const bookings = draftsToBookings(flightDrafts, rentalDrafts, lodgingDrafts);
    if (!bookings.ok) {
      setBookingsError(bookings.message);
      return;
    }
    setSavingBookings(true);
    setBookingsError(null);
    try {
      const updatedTrip = {
        ...view.trip,
        flights: bookings.flights,
        carRentals: bookings.carRentals,
        lodgings: bookings.lodgings,
      };
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

  // GET 需要帶 auth header（authedFetch），不能用裸連結下載，改走 blob + 暫時 object URL 觸發下載。
  async function exportIcs() {
    if (view.status !== "ready") return;
    setIcsError(null);
    try {
      const res = await authedFetch(`/api/trips/${view.trip.id}/ics`);
      if (!res.ok) throw new Error("匯出失敗");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "trip.ics";
      // 掛進 DOM 再點擊（部分瀏覽器對未掛載元素的下載觸發不穩定）；延遲撤銷 object URL，
      // 避免瀏覽器還沒真正開始讀取 blob 資料就被撤銷導致下載失敗/空檔（GLM REVIEW）。
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setIcsError(e instanceof Error ? e.message : "匯出失敗");
    }
  }

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-neutral-400">載入中…</main>;
  }
  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-5">
        <p className="mb-4 text-sm text-neutral-500">請先登入才能查看行程。</p>
        <GoogleSignInButton />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <div className="mb-8 flex items-center justify-between print:hidden">
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
          {offlineBanner && (
            <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 print:hidden">
              📴 離線資料，可能非最新
            </p>
          )}
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
                {view.trip.exchangeRate && (
                  <>
                    <span>·</span>
                    <span className="text-teal-600">
                      ≈ {Math.round(view.trip.budget.min * view.trip.exchangeRate.rate).toLocaleString()}~
                      {Math.round(view.trip.budget.max * view.trip.exchangeRate.rate).toLocaleString()}{" "}
                      {view.trip.exchangeRate.to}
                      <span className="ml-1 text-neutral-400">
                        (1 TWD≈
                        {view.trip.exchangeRate.rate < 1
                          ? view.trip.exchangeRate.rate.toFixed(4)
                          : view.trip.exchangeRate.rate.toFixed(2)}{" "}
                        {view.trip.exchangeRate.to})
                      </span>
                    </span>
                  </>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2 print:hidden">
              {!editing && (
                <button onClick={startEdit} className="text-xs text-teal-700 hover:text-teal-900">編輯</button>
              )}
              <button onClick={() => void exportIcs()} className="text-xs text-teal-700 hover:text-teal-900">
                匯出行事曆 (.ics)
              </button>
              <button onClick={() => window.print()} className="text-xs text-teal-700 hover:text-teal-900">
                列印 / 存 PDF
              </button>
              <button onClick={() => void handleDelete()} className="text-xs text-neutral-400 hover:text-red-600">刪除</button>
              {icsError && <p className="text-xs text-red-600">{icsError}</p>}
            </div>
          </div>

          <div className="mb-4">
            {!editingBookings ? (
              <>
                <BookingCards
                  flights={view.trip.flights}
                  carRentals={view.trip.carRentals}
                  lodgings={view.trip.lodgings}
                />
                <button
                  onClick={startBookingsEdit}
                  className="text-xs text-teal-700 hover:text-teal-900 print:hidden"
                >
                  {(view.trip.flights?.length ?? 0) > 0 ||
                  (view.trip.carRentals?.length ?? 0) > 0 ||
                  (view.trip.lodgings?.length ?? 0) > 0
                    ? "編輯航班/租車/住宿"
                    : "＋ 新增航班/租車/住宿"}
                </button>
              </>
            ) : (
              <div className="rounded-lg border border-neutral-200 p-4">
                <BookingsFields
                  flights={flightDrafts}
                  rentals={rentalDrafts}
                  lodgings={lodgingDrafts}
                  onFlightsChange={setFlightDrafts}
                  onRentalsChange={setRentalDrafts}
                  onLodgingsChange={setLodgingDrafts}
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

          {/* 住宿建議 */}
          <div className="mb-6 rounded-lg border border-neutral-200 p-4 print:hidden">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-neutral-800">🏨 住宿建議</h3>
              <a
                href={buildLodgingLink({ query: view.trip.location })}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-xs text-teal-700 hover:text-teal-900"
              >
                在 Booking 看這區所有住宿 →
              </a>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={maxPriceLevel ?? ""}
                onChange={(e) => setMaxPriceLevel(e.target.value === "" ? undefined : Number(e.target.value))}
                className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
              >
                <option value="">不限價位</option>
                <option value="1">$ 平價</option>
                <option value="2">$$ 中等</option>
                <option value="3">$$$ 高級</option>
              </select>
              <button
                onClick={() => void findLodging(view.trip.id)}
                disabled={lodging.status === "loading"}
                className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-40"
              >
                {lodging.status === "loading" ? "搜尋中…" : `找 ${view.trip.location} 的住宿`}
              </button>
            </div>
            {lodging.status === "error" && <p className="mt-2 text-sm text-red-600">{lodging.message}</p>}
            {lodging.status === "ready" &&
              (lodging.items.length === 0 ? (
                <p className="mt-2 text-sm text-neutral-500">查無符合的住宿，換個價位或稍後再試。</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {lodging.items.map((it) => (
                    <li
                      key={it.place.placeId}
                      className="flex items-start justify-between gap-3 rounded-lg border border-neutral-100 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-neutral-900">
                          {it.place.name}
                          {typeof it.place.rating === "number" && (
                            <span className="ml-2 text-xs text-amber-500">⭐{it.place.rating}</span>
                          )}
                          {typeof it.priceLevel === "number" && (
                            <span className="ml-1 text-xs text-neutral-400">{"$".repeat(Math.max(1, it.priceLevel))}</span>
                          )}
                        </p>
                        {it.place.address && <p className="truncate text-xs text-neutral-400">{it.place.address}</p>}
                      </div>
                      <a
                        href={it.bookingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-xs font-medium text-teal-700 hover:text-teal-900"
                      >
                        訂房 →
                      </a>
                    </li>
                  ))}
                </ul>
              ))}
          </div>

          {saveError && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{saveError}</p>}

          {!editing && buildPackingList(view.trip.weather ?? []).length > 0 && (
            <div className="mb-6 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3">
              <h3 className="mb-2 text-sm font-semibold text-sky-800">🎒 打包提醒（依天氣預報）</h3>
              <ul className="space-y-1 text-xs text-sky-700">
                {buildPackingList(view.trip.weather ?? []).map((it, i) => (
                  <li key={i}>{it}</li>
                ))}
              </ul>
            </div>
          )}

          {(editing ? draftDays : view.trip.days).map((day, dayIdx) => {
            // 天氣以陣列索引對齊天數（生成當下 weather 就是從 startDate 連續 days 天）。
            // 編輯模式、或曾刪天導致天數與 weather 陣列長度不符時，一律不顯示逐日天氣，
            // 避免索引位移對到錯誤日期（打包清單走整趟聚合不受影響）。GLM REVIEW。
            const dayWeather =
              !editing && view.trip.weather && view.trip.weather.length === view.trip.days.length
                ? view.trip.weather[day.day - 1]
                : undefined;
            const dayMapResolved = mapOpenDays.has(day.day)
              ? resolveDayMapItems(day.schedule, collectionCoords)
              : null;
            return (
            <div key={day.day} className="mb-6 print:break-inside-avoid">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-neutral-800">第 {day.day} 天</h2>
                {!editing && (
                  <button
                    onClick={() => toggleDayMap(day.day)}
                    className="rounded-full border border-neutral-300 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-50 print:hidden"
                  >
                    {mapOpenDays.has(day.day) ? "收合地圖" : "🗺️ 地圖"}
                  </button>
                )}
                {!editing && (
                  <button
                    onClick={() => {
                      setRegenOpenDay(regenOpenDay === day.day ? null : day.day);
                      setRegenFeedback("");
                    }}
                    className="rounded-full border border-neutral-300 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-50 print:hidden"
                  >
                    {regenOpenDay === day.day ? "取消重排" : "🔄 重排這一天"}
                  </button>
                )}
                {dayWeather && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-700 ring-1 ring-sky-100">
                    <span>{weatherEmoji(dayWeather.description)}</span>
                    <span>{dayWeather.description}</span>
                    <span className="text-sky-500">
                      {dayWeather.minTempC}–{dayWeather.maxTempC}°C
                    </span>
                    {dayWeather.precipitationMm >= RAIN_ALERT_MM && (
                      <span className="font-medium text-sky-600">☔{dayWeather.precipitationMm}mm 記得帶傘</span>
                    )}
                  </span>
                )}
              </div>
              {dayMapResolved && (
                <div className="mb-3 print:hidden">
                  <DayRouteMap items={dayMapResolved.items} />
                  {dayMapResolved.excludedCount > 0 && (
                    <p className="mt-1 text-xs text-neutral-400">
                      {dayMapResolved.excludedCount} 個項目無座標，未顯示
                    </p>
                  )}
                </div>
              )}
              {regenOpenDay === day.day && (
                <div className="mb-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 print:hidden">
                  <textarea
                    value={regenFeedback}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRegenFeedback(e.target.value)}
                    maxLength={200}
                    rows={2}
                    placeholder="例：下午太趕，想多留咖啡時間（留空＝直接換一批不同排程）"
                    disabled={regenState.status === "running" && regenState.day === day.day}
                    className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-50"
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => void submitRegenerateDay(day.day)}
                      disabled={regenState.status === "running" && regenState.day === day.day}
                      className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-40"
                    >
                      {regenState.status === "running" && regenState.day === day.day ? "重新編排中…" : "送出"}
                    </button>
                    <button
                      onClick={() => { setRegenOpenDay(null); setRegenFeedback(""); }}
                      className="text-xs text-neutral-400 hover:text-neutral-700"
                    >
                      取消
                    </button>
                  </div>
                  {regenState.status === "error" && regenState.day === day.day && (
                    <p className="mt-2 text-xs text-red-600">{regenState.message}</p>
                  )}
                </div>
              )}
              <ul className="space-y-2">
                {day.schedule.map((item, i) => (
                  <li key={i} className="flex gap-3 rounded-lg border border-neutral-200 px-3 py-2.5">
                    <span className="shrink-0 text-xs font-mono text-neutral-400 pt-0.5">{item.time}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-neutral-900">
                        {item.title}
                        <span className="ml-2 text-xs text-neutral-400">{TYPE_LABEL[item.type]}</span>
                      </p>
                      {item.openingWarning && (
                        <p className="mt-0.5 text-xs font-medium text-amber-600">⚠️ {item.openingWarning}</p>
                      )}
                      <p className="text-xs text-neutral-500">{item.description}</p>
                      {!editing && (item.type === "place" || item.type === "food") && (
                        <a
                          href={navUrl(item)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-block text-xs text-teal-700 hover:text-teal-900 print:hidden"
                        >
                          🧭 導航
                        </a>
                      )}
                    </div>
                    {editing && (
                      <div className="flex shrink-0 items-start gap-1 print:hidden">
                        <button onClick={() => moveItem(dayIdx, i, -1)} disabled={i === 0} className="text-xs text-neutral-400 hover:text-neutral-700 disabled:opacity-30">↑</button>
                        <button onClick={() => moveItem(dayIdx, i, 1)} disabled={i === day.schedule.length - 1} className="text-xs text-neutral-400 hover:text-neutral-700 disabled:opacity-30">↓</button>
                        <button onClick={() => removeItem(dayIdx, i)} className="text-xs text-neutral-400 hover:text-red-600">✕</button>
                      </div>
                    )}
                  </li>
                ))}
                {editing && day.schedule.length === 0 && (
                  <li className="rounded-lg border border-dashed border-neutral-300 px-3 py-3 text-center text-xs text-neutral-400">
                    這天已經沒有行程了（儲存時會移除此天並重新編號）
                  </li>
                )}
              </ul>
            </div>
            );
          })}

          {editing ? (
            <div>
              <p className="mb-2 text-xs text-neutral-400">
                刪除或排序後，會以當天第一項的原始時間為錨點自動重排各項時間
              </p>
              <div className="flex gap-2">
                <button onClick={() => void saveEdit()} disabled={saving} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-40">
                  {saving ? "儲存中…" : "儲存變更"}
                </button>
                <button onClick={cancelEdit} disabled={saving} className="rounded-lg border border-neutral-300 px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-40">
                  取消
                </button>
              </div>
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
