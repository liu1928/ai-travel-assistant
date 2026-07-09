"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth, authedFetch } from "@/lib/use-auth";
import { GoogleSignInButton } from "@/components/google-signin";

type SavedTrip = {
  id: string;
  title: string;
  location: string;
  style: string;
  summary: string;
  createdAt: number;
};

type ListState =
  | { status: "loading" }
  | { status: "ready"; trips: SavedTrip[] }
  | { status: "error"; message: string };

export default function TripsListPage() {
  const { user, loading } = useAuth();
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    void loadTrips();
  }, [user]);

  async function loadTrips() {
    try {
      const res = await authedFetch("/api/trips");
      const data = (await res.json()) as { trips?: SavedTrip[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "讀取失敗");
      setList({ status: "ready", trips: data.trips ?? [] });
    } catch (e) {
      setList({ status: "error", message: e instanceof Error ? e.message : "讀取失敗" });
    }
  }

  async function handleDelete(id: string) {
    setBusyId(id);
    try {
      const res = await authedFetch(`/api/trips/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("刪除失敗");
      if (list.status === "ready") {
        setList({ status: "ready", trips: list.trips.filter((t) => t.id !== id) });
      }
    } catch {
      // 忽略單筆刪除失敗
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-neutral-400">載入中…</main>;
  }
  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-5">
        <p className="mb-4 text-sm text-neutral-500">請先登入才能查看已存行程。</p>
        <GoogleSignInButton />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <div className="mb-8 flex items-center justify-between">
        <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-700 transition-colors">← 返回收藏</Link>
        <Link href="/trip" className="text-sm text-teal-700 hover:text-teal-800 transition-colors">+ 產生新行程</Link>
      </div>

      <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 mb-1">我的行程</h1>
      <p className="text-sm text-neutral-500 mb-10">已儲存的旅行計畫。</p>

      {list.status === "loading" && <p className="text-sm text-neutral-400">載入中…</p>}
      {list.status === "error" && <p className="text-sm text-red-600">{list.message}</p>}

      {list.status === "ready" && list.trips.length === 0 && (
        <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500">
          還沒有已存行程。去<Link href="/trip" className="text-teal-700 underline">產生一個</Link>吧。
        </p>
      )}

      {list.status === "ready" && list.trips.length > 0 && (
        <ul className="space-y-3">
          {list.trips.map((t) => (
            <li key={t.id} className="rounded-lg border border-neutral-200 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <Link href={`/trips/${t.id}`} className="min-w-0">
                  <p className="truncate text-sm font-medium text-neutral-900">{t.title}</p>
                  <p className="truncate text-xs text-neutral-500">{t.summary}</p>
                  <p className="mt-1 text-xs text-neutral-400">{t.location} · {new Date(t.createdAt).toLocaleDateString("zh-TW")}</p>
                </Link>
                <div className="flex shrink-0 items-center gap-3">
                  <Link
                    href={`/trips/${t.id}/expenses`}
                    className="text-xs font-medium text-teal-700 hover:text-teal-900 transition-colors"
                  >
                    💰 記帳
                  </Link>
                  <button
                    onClick={() => void handleDelete(t.id)}
                    disabled={busyId === t.id}
                    className="text-xs text-neutral-400 hover:text-red-600 disabled:opacity-40"
                  >
                    刪除
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
