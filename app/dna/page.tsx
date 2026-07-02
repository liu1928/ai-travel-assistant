"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth, signInWithGoogle, authedFetch } from "@/lib/use-auth";

type TagCount = { tag: string; count: number; ratio: number };
type TravelDna = { totalPlaces: number; tagCounts: TagCount[]; topTags: string[]; summary: string };

type DnaState =
  | { status: "loading" }
  | { status: "ready"; data: TravelDna }
  | { status: "error"; message: string };

const TAG_COLOR: Record<string, string> = {
  海景: "bg-sky-500",
  河岸: "bg-cyan-500",
  山林: "bg-emerald-500",
  咖啡: "bg-amber-500",
  美食: "bg-orange-500",
  夜景: "bg-indigo-500",
  城市: "bg-slate-500",
  文化: "bg-rose-500",
  親子: "bg-lime-500",
  住宿: "bg-stone-500",
};

export default function DnaPage() {
  const { user, loading } = useAuth();
  const [dna, setDna] = useState<DnaState>({ status: "loading" });

  useEffect(() => {
    if (!user) return;
    void (async () => {
      try {
        const res = await authedFetch("/api/dna");
        const data = (await res.json()) as TravelDna & { error?: string };
        if (!res.ok) throw new Error(data.error ?? "讀取失敗");
        setDna({ status: "ready", data });
      } catch (e) {
        setDna({ status: "error", message: e instanceof Error ? e.message : "讀取失敗" });
      }
    })();
  }, [user]);

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-neutral-400">載入中…</main>;
  }
  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-5">
        <p className="mb-4 text-sm text-neutral-500">請先登入才能查看 Travel DNA。</p>
        <button onClick={() => void signInWithGoogle()} className="rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-teal-800">用 Google 登入</button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <div className="mb-8 flex items-center gap-3">
        <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-700 transition-colors">← 返回收藏</Link>
      </div>

      <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 mb-1">Travel DNA</h1>
      <p className="text-sm text-neutral-500 mb-10">根據你的收藏，整理出的旅行偏好。</p>

      {dna.status === "loading" && <p className="text-sm text-neutral-400">分析中…</p>}
      {dna.status === "error" && <p className="text-sm text-red-600">{dna.message}</p>}

      {dna.status === "ready" && (
        <>
          <div className="mb-10 rounded-lg border border-neutral-200 bg-neutral-50 px-5 py-4">
            <p className="text-sm text-neutral-800">{dna.data.summary}</p>
            <p className="mt-1 text-xs text-neutral-400">共 {dna.data.totalPlaces} 個收藏地點</p>
          </div>

          {dna.data.tagCounts.length === 0 ? (
            <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500">
              還沒有足夠的標籤資料，去收藏更多地點，或幫現有地點重新標籤。
            </p>
          ) : (
            <ul className="space-y-3">
              {dna.data.tagCounts.map((t) => (
                <li key={t.tag}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium text-neutral-800">{t.tag}</span>
                    <span className="text-neutral-400">{t.count} 個・{Math.round(t.ratio * 100)}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100">
                    <div
                      className={`h-full rounded-full ${TAG_COLOR[t.tag] ?? "bg-neutral-400"}`}
                      style={{ width: `${Math.max(t.ratio * 100, 3)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
