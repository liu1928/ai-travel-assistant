"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import type { PlaceSearchResult } from "@/schema/place";
import { useAuth, signInWithGoogle, authedFetch, auth } from "@/lib/use-auth";

type ImportSummary = { success: number; skipped: number; failed: number; invalid: number; truncated: number };
type ShareResult = { kind: "place"; places: PlaceSearchResult[] };

type TakeoutState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; summary: ImportSummary }
  | { status: "error"; message: string };

type ShareState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "preview"; result: ShareResult }
  | { status: "importing" }
  | { status: "done"; count: number }
  | { status: "error"; message: string };

type TokenState = { status: "idle" | "loading" | "ready" | "error"; token?: string; message?: string };

export default function ImportPage() {
  const { user, loading } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [takeout, setTakeout] = useState<TakeoutState>({ status: "idle" });
  const [shareUrl, setShareUrl] = useState("");
  const [share, setShare] = useState<ShareState>({ status: "idle" });
  const [token, setToken] = useState<TokenState>({ status: "idle" });

  async function handleTakeout(file: File) {
    setTakeout({ status: "loading" });
    try {
      const text = await file.text();
      const res = await authedFetch("/api/import/takeout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
      });
      const data = (await res.json()) as { summary?: ImportSummary; error?: string };
      if (!res.ok) throw new Error(data.error ?? "匯入失敗");
      setTakeout({ status: "done", summary: data.summary as ImportSummary });
    } catch (e) {
      setTakeout({ status: "error", message: e instanceof Error ? e.message : "匯入失敗" });
    }
  }

  async function handleSharePreview() {
    if (!shareUrl.trim()) return;
    setShare({ status: "loading" });
    try {
      const res = await authedFetch("/api/import/sharelink", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: shareUrl }),
      });
      const data = (await res.json()) as ShareResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "解析失敗");
      setShare({ status: "preview", result: data });
    } catch (e) {
      setShare({ status: "error", message: e instanceof Error ? e.message : "解析失敗" });
    }
  }

  async function handleShareImport(places: PlaceSearchResult[]) {
    setShare({ status: "importing" });
    let count = 0;
    for (const place of places) {
      try {
        const res = await authedFetch("/api/collection", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ place }),
        });
        if (res.ok) count++;
      } catch {
        // 單筆失敗不中斷
      }
    }
    setShare({ status: "done", count });
  }

  async function copyToken() {
    setToken({ status: "loading" });
    try {
      const t = await auth.currentUser?.getIdToken(true);
      if (!t) throw new Error("尚未登入");
      setToken({ status: "ready", token: t });
    } catch (e) {
      setToken({ status: "error", message: e instanceof Error ? e.message : "取得 token 失敗" });
    }
  }

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-neutral-400">載入中…</main>;
  }
  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-5">
        <p className="mb-4 text-sm text-neutral-500">請先登入才能匯入。</p>
        <button onClick={() => void signInWithGoogle()} className="rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-teal-800">用 Google 登入</button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <div className="mb-8 flex items-center gap-3">
        <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-700 transition-colors">← 返回收藏</Link>
      </div>

      <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 mb-1">匯入地點</h1>
      <p className="text-sm text-neutral-500 mb-10">從 Google Takeout、分享連結或 Chrome 擴充把地點帶進來。</p>

      <section className="mb-10">
        <h2 className="text-sm font-semibold text-neutral-900 mb-1">Google Takeout</h2>
        <p className="text-xs text-neutral-500 mb-4">
          前往 <a href="https://takeout.google.com" target="_blank" rel="noreferrer" className="underline">takeout.google.com</a> 匯出「已儲存的地點」，上傳 <code>已儲存的地點.json</code>。
        </p>

        <div
          className="rounded-lg border-2 border-dashed border-neutral-300 px-6 py-10 text-center cursor-pointer hover:border-teal-400 transition-colors"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void handleTakeout(f); }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) void handleTakeout(f); }}
          />
          {takeout.status === "idle" && <p className="text-sm text-neutral-500">拖放 JSON 檔案，或點此選取</p>}
          {takeout.status === "loading" && <p className="text-sm text-neutral-500">匯入中，請稍候…</p>}
          {takeout.status === "done" && (
            <div className="text-sm">
              <p className="font-medium text-teal-700 mb-1">匯入完成 ✓</p>
              <p className="text-neutral-500">
                成功 {takeout.summary.success}・跳過 {takeout.summary.skipped}・失敗 {takeout.summary.failed}・無效 {takeout.summary.invalid}
              </p>
              {takeout.summary.truncated > 0 && (
                <p className="mt-1 text-amber-600">
                  超過單次上限，已匯入前面的地點，剩餘 {takeout.summary.truncated} 筆請分批再匯入一次。
                </p>
              )}
            </div>
          )}
          {takeout.status === "error" && <p className="text-sm text-red-600">{takeout.message}</p>}
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-sm font-semibold text-neutral-900 mb-1">Google Maps 分享連結</h2>
        <p className="text-xs text-neutral-500 mb-4">僅支援單一地點連結。整份清單請改用 Takeout 或下方的 Chrome 擴充。</p>

        <div className="flex gap-2 mb-4">
          <input
            value={shareUrl}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setShareUrl(e.target.value)}
            placeholder="貼入 maps.app.goo.gl/... 連結"
            className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          />
          <button
            onClick={() => void handleSharePreview()}
            disabled={!shareUrl.trim() || share.status === "loading"}
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-40 transition-colors"
          >
            {share.status === "loading" ? "解析中…" : "解析"}
          </button>
        </div>

        {share.status === "error" && <p className="text-sm text-red-600 mb-3">{share.message}</p>}

        {share.status === "preview" && (
          <div className="rounded-lg border border-neutral-200 p-4">
            <p className="text-xs text-neutral-500 mb-2">找到 {share.result.places.length} 個地點</p>
            <ul className="space-y-1 mb-4">
              {share.result.places.map((p) => (
                <li key={p.placeId} className="text-sm text-neutral-800">
                  {p.name}
                  {p.address && <span className="text-neutral-400 ml-1 text-xs">{p.address}</span>}
                </li>
              ))}
            </ul>
            <button onClick={() => void handleShareImport(share.result.places)} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 transition-colors">確認匯入</button>
          </div>
        )}

        {share.status === "importing" && <p className="text-sm text-neutral-500">匯入中…</p>}
        {share.status === "done" && <p className="text-sm text-teal-700 font-medium">已加入 {share.count} 個地點 ✓</p>}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-neutral-900 mb-1">Chrome 擴充（整份清單）</h2>
        <p className="text-xs text-neutral-500 mb-4">
          在 Google Maps 開啟你的收藏清單，用 Atlas 擴充一鍵讀取整份清單。擴充需要登入憑證才能寫入，複製下方 Token 貼到擴充的「設定」頁（效期 1 小時）。
        </p>
        <button
          onClick={() => void copyToken()}
          disabled={token.status === "loading"}
          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 transition-colors disabled:opacity-40"
        >
          {token.status === "loading" ? "取得中…" : "顯示登入 Token"}
        </button>
        {token.status === "ready" && token.token && (
          <div className="mt-3">
            <p className="text-xs text-neutral-500 mb-1">全選後複製，貼到 Extension 設定頁：</p>
            <textarea
              readOnly
              value={token.token}
              rows={3}
              onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              className="w-full rounded-md border border-neutral-300 px-2.5 py-2 text-xs font-mono text-neutral-700 outline-none focus:border-teal-500 cursor-pointer"
            />
            <p className="text-xs text-neutral-400 mt-1">點文字框即可全選 · 效期約 1 小時</p>
          </div>
        )}
        {token.status === "error" && <p className="mt-2 text-sm text-red-600">{token.message}</p>}
      </section>
    </main>
  );
}
