"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth, signInWithGoogle, authedFetch } from "@/lib/use-auth";

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

export default function TripViewPage() {
  const { user, loading } = useAuth();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [view, setView] = useState<ViewState>({ status: "loading" });

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
        <Link
          href={`/trips/${params.id}/expenses`}
          className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
        >
          💰 費用記帳
        </Link>
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
            <button onClick={() => void handleDelete()} className="shrink-0 text-xs text-neutral-400 hover:text-red-600">刪除</button>
          </div>

          {view.trip.days.map((day) => (
            <div key={day.day} className="mb-6">
              <h2 className="mb-2 text-sm font-semibold text-neutral-800">第 {day.day} 天</h2>
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
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {view.trip.insights.length > 0 && (
            <div className="rounded-lg bg-amber-50 px-4 py-3">
              <ul className="space-y-1 text-xs text-amber-800">
                {view.trip.insights.map((insight, i) => (
                  <li key={i}>💡 {insight}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </main>
  );
}
