"use client";

// 航班/租車的共用 UI：顯示卡（BookingCards）+ 動態清單編輯器（BookingsFields）。
// /trip 生成表單與 /trips/[id] 編輯器共用，見 specs/flights-rentals.md §2.5。
import { useState } from "react";
import type { Flight, CarRental, Lodging } from "@/schema/trip";
import { nextAirline } from "@/lib/airlines";

// 表單草稿一律用字串，送出時經 draftsToBookings 轉成 schema 型別（空的可選欄位會被省略）
export type FlightDraft = {
  flightNo: string;
  airline: string;
  from: string;
  to: string;
  date: string;
  departTime: string;
  arriveTime: string;
  note: string;
};
export type CarRentalDraft = {
  company: string;
  pickupLocation: string;
  pickupDate: string;
  pickupTime: string;
  dropoffLocation: string;
  dropoffDate: string;
  dropoffTime: string;
  note: string;
};
export type LodgingDraft = {
  name: string;
  address: string;
  checkInDate: string;
  checkInTime: string;
  checkOutDate: string;
  checkOutTime: string;
  note: string;
};

export const emptyFlight = (): FlightDraft => ({
  flightNo: "", airline: "", from: "", to: "", date: "", departTime: "", arriveTime: "", note: "",
});
export const emptyRental = (): CarRentalDraft => ({
  company: "", pickupLocation: "", pickupDate: "", pickupTime: "",
  dropoffLocation: "", dropoffDate: "", dropoffTime: "", note: "",
});
export const emptyLodging = (): LodgingDraft => ({
  name: "", address: "", checkInDate: "", checkInTime: "", checkOutDate: "", checkOutTime: "", note: "",
});

export const flightToDraft = (f: Flight): FlightDraft => ({
  flightNo: f.flightNo, airline: f.airline ?? "", from: f.from, to: f.to,
  date: f.date ?? "", departTime: f.departTime, arriveTime: f.arriveTime, note: f.note ?? "",
});
export const rentalToDraft = (r: CarRental): CarRentalDraft => ({
  company: r.company ?? "", pickupLocation: r.pickupLocation, pickupDate: r.pickupDate ?? "",
  pickupTime: r.pickupTime, dropoffLocation: r.dropoffLocation, dropoffDate: r.dropoffDate ?? "",
  dropoffTime: r.dropoffTime, note: r.note ?? "",
});
export const lodgingToDraft = (l: Lodging): LodgingDraft => ({
  name: l.name, address: l.address ?? "", checkInDate: l.checkInDate ?? "", checkInTime: l.checkInTime ?? "",
  checkOutDate: l.checkOutDate ?? "", checkOutTime: l.checkOutTime ?? "", note: l.note ?? "",
});

const isFlightEmpty = (d: FlightDraft) =>
  Object.values(d).every((v) => v.trim() === "");
const isRentalEmpty = (d: CarRentalDraft) =>
  Object.values(d).every((v) => v.trim() === "");
const isLodgingEmpty = (d: LodgingDraft) =>
  Object.values(d).every((v) => v.trim() === "");

export type BookingsResult =
  | { ok: true; flights: Flight[]; carRentals: CarRental[]; lodgings: Lodging[] }
  | { ok: false; message: string };

// 全空的草稿直接略過；非空的草稿缺必填欄位 → 回錯誤訊息（不靜默丟掉，見 spec §3）
export function draftsToBookings(
  flightDrafts: FlightDraft[],
  rentalDrafts: CarRentalDraft[],
  lodgingDrafts: LodgingDraft[],
): BookingsResult {
  const flights: Flight[] = [];
  for (let i = 0; i < flightDrafts.length; i++) {
    const d = flightDrafts[i];
    if (isFlightEmpty(d)) continue;
    if (!d.flightNo.trim() || !d.from.trim() || !d.to.trim() || !d.departTime || !d.arriveTime) {
      return { ok: false, message: `第 ${i + 1} 筆航班缺少必填欄位（航班號、出發地、目的地、起飛/抵達時間）` };
    }
    flights.push({
      flightNo: d.flightNo.trim(),
      from: d.from.trim(),
      to: d.to.trim(),
      departTime: d.departTime,
      arriveTime: d.arriveTime,
      ...(d.airline.trim() ? { airline: d.airline.trim() } : {}),
      ...(d.date ? { date: d.date } : {}),
      ...(d.note.trim() ? { note: d.note.trim() } : {}),
    });
  }

  const carRentals: CarRental[] = [];
  for (let i = 0; i < rentalDrafts.length; i++) {
    const d = rentalDrafts[i];
    if (isRentalEmpty(d)) continue;
    if (!d.pickupLocation.trim() || !d.pickupTime || !d.dropoffLocation.trim() || !d.dropoffTime) {
      return { ok: false, message: `第 ${i + 1} 筆租車缺少必填欄位（取車/還車地點與時間）` };
    }
    carRentals.push({
      pickupLocation: d.pickupLocation.trim(),
      pickupTime: d.pickupTime,
      dropoffLocation: d.dropoffLocation.trim(),
      dropoffTime: d.dropoffTime,
      ...(d.company.trim() ? { company: d.company.trim() } : {}),
      ...(d.pickupDate ? { pickupDate: d.pickupDate } : {}),
      ...(d.dropoffDate ? { dropoffDate: d.dropoffDate } : {}),
      ...(d.note.trim() ? { note: d.note.trim() } : {}),
    });
  }

  const lodgings: Lodging[] = [];
  for (let i = 0; i < lodgingDrafts.length; i++) {
    const d = lodgingDrafts[i];
    if (isLodgingEmpty(d)) continue;
    if (!d.name.trim()) {
      return { ok: false, message: `第 ${i + 1} 筆住宿缺少必填欄位（住宿名稱）` };
    }
    lodgings.push({
      name: d.name.trim(),
      ...(d.address.trim() ? { address: d.address.trim() } : {}),
      ...(d.checkInDate ? { checkInDate: d.checkInDate } : {}),
      ...(d.checkInTime ? { checkInTime: d.checkInTime } : {}),
      ...(d.checkOutDate ? { checkOutDate: d.checkOutDate } : {}),
      ...(d.checkOutTime ? { checkOutTime: d.checkOutTime } : {}),
      ...(d.note.trim() ? { note: d.note.trim() } : {}),
    });
  }

  return { ok: true, flights, carRentals, lodgings };
}

// --- 顯示卡（唯讀）---

export function BookingCards({ flights, carRentals, lodgings }: { flights?: Flight[]; carRentals?: CarRental[]; lodgings?: Lodging[] }) {
  const hasFlights = !!flights && flights.length > 0;
  const hasRentals = !!carRentals && carRentals.length > 0;
  const hasLodgings = !!lodgings && lodgings.length > 0;
  if (!hasFlights && !hasRentals && !hasLodgings) return null;

  return (
    <div className="mb-4 space-y-3">
      {hasFlights && (
        <div className="rounded-lg border border-neutral-200 px-4 py-3">
          <h3 className="mb-2 text-xs font-semibold text-neutral-500 uppercase tracking-wide">✈️ 航班</h3>
          <ul className="space-y-1.5 text-sm text-neutral-800">
            {flights.map((f, i) => (
              <li key={i}>
                <span className="font-medium">
                  {f.airline ? `${f.airline} ` : ""}{f.flightNo}
                </span>{" "}
                {f.from} → {f.to}
                <span className="ml-2 text-neutral-500">
                  {f.date ? `${f.date} ` : ""}{f.departTime}–{f.arriveTime}
                </span>
                {f.note && <span className="ml-1 text-xs text-neutral-400">（{f.note}）</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {hasRentals && (
        <div className="rounded-lg border border-neutral-200 px-4 py-3">
          <h3 className="mb-2 text-xs font-semibold text-neutral-500 uppercase tracking-wide">🚗 租車</h3>
          <ul className="space-y-1.5 text-sm text-neutral-800">
            {carRentals.map((r, i) => (
              <li key={i}>
                {r.company && <span className="font-medium">{r.company}：</span>}
                {r.pickupDate ? `${r.pickupDate} ` : ""}{r.pickupTime} {r.pickupLocation} 取車 →{" "}
                {r.dropoffDate ? `${r.dropoffDate} ` : ""}{r.dropoffTime} {r.dropoffLocation} 還車
                {r.note && <span className="ml-1 text-xs text-neutral-400">（{r.note}）</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {hasLodgings && (
        <div className="rounded-lg border border-neutral-200 px-4 py-3">
          <h3 className="mb-2 text-xs font-semibold text-neutral-500 uppercase tracking-wide">🏨 住宿</h3>
          <ul className="space-y-1.5 text-sm text-neutral-800">
            {lodgings.map((l, i) => (
              <li key={i}>
                <span className="font-medium">{l.name}</span>
                {l.address && <span className="ml-1 text-xs text-neutral-400">{l.address}</span>}
                {(l.checkInDate || l.checkInTime || l.checkOutDate || l.checkOutTime) && (
                  <span className="ml-2 text-neutral-500">
                    {l.checkInDate || l.checkInTime ? `${l.checkInDate ?? ""} ${l.checkInTime ?? ""} 入住` : ""}
                    {l.checkOutDate || l.checkOutTime ? ` → ${l.checkOutDate ?? ""} ${l.checkOutTime ?? ""} 退房` : ""}
                  </span>
                )}
                {l.note && <span className="ml-1 text-xs text-neutral-400">（{l.note}）</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// --- 動態清單編輯器 ---

const inputCls =
  "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-teal-500";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-0.5 block text-xs text-neutral-400">{label}</label>
      {children}
    </div>
  );
}

export function BookingsFields({
  flights,
  rentals,
  lodgings,
  onFlightsChange,
  onRentalsChange,
  onLodgingsChange,
  defaultOpen = false,
}: {
  flights: FlightDraft[];
  rentals: CarRentalDraft[];
  lodgings: LodgingDraft[];
  onFlightsChange: (next: FlightDraft[]) => void;
  onRentalsChange: (next: CarRentalDraft[]) => void;
  onLodgingsChange: (next: LodgingDraft[]) => void;
  defaultOpen?: boolean;
}) {
  const [flightsOpen, setFlightsOpen] = useState(defaultOpen || flights.length > 0);
  const [rentalsOpen, setRentalsOpen] = useState(defaultOpen || rentals.length > 0);
  const [lodgingsOpen, setLodgingsOpen] = useState(defaultOpen || lodgings.length > 0);

  const setFlight = (i: number, key: keyof FlightDraft, value: string) => {
    onFlightsChange(flights.map((f, idx) => (idx === i ? { ...f, [key]: value } : f)));
  };
  // 打航班號時用 IATA 代碼離線帶出航空公司名（見 nextAirline：不蓋手填、改代碼會更新/清掉 autofill 值）
  const setFlightNo = (i: number, value: string) => {
    onFlightsChange(
      flights.map((f, idx) =>
        idx === i ? { ...f, flightNo: value, airline: nextAirline(f.flightNo, f.airline, value) } : f,
      ),
    );
  };
  const setRental = (i: number, key: keyof CarRentalDraft, value: string) => {
    onRentalsChange(rentals.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  };
  const setLodging = (i: number, key: keyof LodgingDraft, value: string) => {
    onLodgingsChange(lodgings.map((l, idx) => (idx === i ? { ...l, [key]: value } : l)));
  };

  return (
    <div className="space-y-4">
      <div>
        <button
          type="button"
          onClick={() => setFlightsOpen((v) => !v)}
          className="mb-2 flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-700"
        >
          <span>{flightsOpen ? "▾" : "▸"}</span> ✈️ 航班資訊（可選{flights.length > 0 ? `，${flights.length} 筆` : ""}）
        </button>
        {flightsOpen && (
          <div className="space-y-3">
            {flights.map((d, i) => (
              <div key={i} className="rounded-lg border border-neutral-200 p-3">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="航班號 *">
                    <input value={d.flightNo} onChange={(e) => setFlightNo(i, e.target.value)} placeholder="BR198" className={inputCls} />
                  </Field>
                  <Field label="航空公司">
                    <input value={d.airline} onChange={(e) => setFlight(i, "airline", e.target.value)} placeholder="長榮" className={inputCls} />
                  </Field>
                  <Field label="出發地 *">
                    <input value={d.from} onChange={(e) => setFlight(i, "from", e.target.value)} placeholder="台北 TPE" className={inputCls} />
                  </Field>
                  <Field label="目的地 *">
                    <input value={d.to} onChange={(e) => setFlight(i, "to", e.target.value)} placeholder="沖繩 OKA" className={inputCls} />
                  </Field>
                  <Field label="日期">
                    <input type="date" value={d.date} onChange={(e) => setFlight(i, "date", e.target.value)} className={inputCls} />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="起飛 *">
                      <input type="time" value={d.departTime} onChange={(e) => setFlight(i, "departTime", e.target.value)} className={inputCls} />
                    </Field>
                    <Field label="抵達 *">
                      <input type="time" value={d.arriveTime} onChange={(e) => setFlight(i, "arriveTime", e.target.value)} className={inputCls} />
                    </Field>
                  </div>
                  <div className="col-span-2">
                    <Field label="備註">
                      <input value={d.note} onChange={(e) => setFlight(i, "note", e.target.value)} className={inputCls} />
                    </Field>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onFlightsChange(flights.filter((_, idx) => idx !== i))}
                  className="mt-2 text-xs text-neutral-400 hover:text-red-600"
                >
                  刪除這筆航班
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => onFlightsChange([...flights, emptyFlight()])}
              className="rounded-lg border border-dashed border-neutral-300 px-3 py-1.5 text-xs text-neutral-500 hover:border-teal-500 hover:text-teal-700"
            >
              ＋ 新增航班
            </button>
          </div>
        )}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setRentalsOpen((v) => !v)}
          className="mb-2 flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-700"
        >
          <span>{rentalsOpen ? "▾" : "▸"}</span> 🚗 租車資訊（可選{rentals.length > 0 ? `，${rentals.length} 筆` : ""}）
        </button>
        {rentalsOpen && (
          <div className="space-y-3">
            {rentals.map((d, i) => (
              <div key={i} className="rounded-lg border border-neutral-200 p-3">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="取車地點 *">
                    <input value={d.pickupLocation} onChange={(e) => setRental(i, "pickupLocation", e.target.value)} placeholder="那霸機場" className={inputCls} />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="取車日期">
                      <input type="date" value={d.pickupDate} onChange={(e) => setRental(i, "pickupDate", e.target.value)} className={inputCls} />
                    </Field>
                    <Field label="取車時間 *">
                      <input type="time" value={d.pickupTime} onChange={(e) => setRental(i, "pickupTime", e.target.value)} className={inputCls} />
                    </Field>
                  </div>
                  <Field label="還車地點 *">
                    <input value={d.dropoffLocation} onChange={(e) => setRental(i, "dropoffLocation", e.target.value)} placeholder="那霸機場" className={inputCls} />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="還車日期">
                      <input type="date" value={d.dropoffDate} onChange={(e) => setRental(i, "dropoffDate", e.target.value)} className={inputCls} />
                    </Field>
                    <Field label="還車時間 *">
                      <input type="time" value={d.dropoffTime} onChange={(e) => setRental(i, "dropoffTime", e.target.value)} className={inputCls} />
                    </Field>
                  </div>
                  <Field label="租車公司">
                    <input value={d.company} onChange={(e) => setRental(i, "company", e.target.value)} placeholder="OTS" className={inputCls} />
                  </Field>
                  <Field label="備註">
                    <input value={d.note} onChange={(e) => setRental(i, "note", e.target.value)} className={inputCls} />
                  </Field>
                </div>
                <button
                  type="button"
                  onClick={() => onRentalsChange(rentals.filter((_, idx) => idx !== i))}
                  className="mt-2 text-xs text-neutral-400 hover:text-red-600"
                >
                  刪除這筆租車
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => onRentalsChange([...rentals, emptyRental()])}
              className="rounded-lg border border-dashed border-neutral-300 px-3 py-1.5 text-xs text-neutral-500 hover:border-teal-500 hover:text-teal-700"
            >
              ＋ 新增租車
            </button>
          </div>
        )}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setLodgingsOpen((v) => !v)}
          className="mb-2 flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-700"
        >
          <span>{lodgingsOpen ? "▾" : "▸"}</span> 🏨 住宿資訊（可選{lodgings.length > 0 ? `，${lodgings.length} 筆` : ""}）
        </button>
        {lodgingsOpen && (
          <div className="space-y-3">
            {lodgings.map((d, i) => (
              <div key={i} className="rounded-lg border border-neutral-200 p-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2">
                    <Field label="住宿名稱 *">
                      <input value={d.name} onChange={(e) => setLodging(i, "name", e.target.value)} placeholder="那霸 ○○飯店" className={inputCls} />
                    </Field>
                  </div>
                  <div className="col-span-2">
                    <Field label="地址">
                      <input value={d.address} onChange={(e) => setLodging(i, "address", e.target.value)} className={inputCls} />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="入住日期">
                      <input type="date" value={d.checkInDate} onChange={(e) => setLodging(i, "checkInDate", e.target.value)} className={inputCls} />
                    </Field>
                    <Field label="入住時間">
                      <input type="time" value={d.checkInTime} onChange={(e) => setLodging(i, "checkInTime", e.target.value)} className={inputCls} />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="退房日期">
                      <input type="date" value={d.checkOutDate} onChange={(e) => setLodging(i, "checkOutDate", e.target.value)} className={inputCls} />
                    </Field>
                    <Field label="退房時間">
                      <input type="time" value={d.checkOutTime} onChange={(e) => setLodging(i, "checkOutTime", e.target.value)} className={inputCls} />
                    </Field>
                  </div>
                  <div className="col-span-2">
                    <Field label="備註">
                      <input value={d.note} onChange={(e) => setLodging(i, "note", e.target.value)} className={inputCls} />
                    </Field>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onLodgingsChange(lodgings.filter((_, idx) => idx !== i))}
                  className="mt-2 text-xs text-neutral-400 hover:text-red-600"
                >
                  刪除這筆住宿
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => onLodgingsChange([...lodgings, emptyLodging()])}
              className="rounded-lg border border-dashed border-neutral-300 px-3 py-1.5 text-xs text-neutral-500 hover:border-teal-500 hover:text-teal-700"
            >
              ＋ 新增住宿
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
