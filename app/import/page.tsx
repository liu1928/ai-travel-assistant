"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import type { PlaceSearchResult } from "@/schema/place";
import { useAuth, authedFetch, auth } from "@/lib/use-auth";
import { GoogleSignInButton } from "@/components/google-signin";

type ImportSummary = { success: number; skipped: number; failed: number; invalid: number; truncated: number; rateLimited: boolean };
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

type ScoredCandidate = {
  place: PlaceSearchResult;
  tags: string[];
  fitScore: number;
  fitStars: number;
  isGapFiller: boolean;
  reason: string;
  lowConfidence: boolean;
};
type InspirationState =
  | { status: "idle" }
  | { status: "analyzing" }
  | { status: "preview"; items: ScoredCandidate[]; truncated: number; resolveFailed: number; selected: Set<string>; error?: string }
  | { status: "confirming" }
  | { status: "done"; summary: { success: number; skipped: number; failed: number } }
  | { status: "error"; message: string };

export default function ImportPage() {
  const { user, loading } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [takeout, setTakeout] = useState<TakeoutState>({ status: "idle" });
  const [shareUrl, setShareUrl] = useState("");
  const [share, setShare] = useState<ShareState>({ status: "idle" });
  const [token, setToken] = useState<TokenState>({ status: "idle" });
  const [inspText, setInspText] = useState("");
  const [insp, setInsp] = useState<InspirationState>({ status: "idle" });

  async function handleAnalyze() {
    const text = inspText.trim();
    if (!text) return;
    setInsp({ status: "analyzing" });
    try {
      const res = await authedFetch("/api/import/inspiration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = (await res.json()) as { items?: ScoredCandidate[]; truncated?: number; resolveFailed?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "分析失敗");
      const items = (data.items ?? []).slice().sort((a, b) => b.fitScore - a.fitScore);
      // 預設勾選：高契合 + 補盲區（後者恆低星，不加會讓策展缺口這個賣點預設不被勾）
      const selected = new Set(items.filter((i) => i.fitStars >= 4 || i.isGapFiller).map((i) => i.place.placeId));
      setInsp({ status: "preview", items, truncated: data.truncated ?? 0, resolveFailed: data.resolveFailed ?? 0, selected });
    } catch (e) {
      setInsp({ status: "error", message: e instanceof Error ? e.message : "分析失敗" });
    }
  }

  function toggleInsp(placeId: string) {
    setInsp((prev) => {
      if (prev.status !== "preview") return prev;
      const selected = new Set(prev.selected);
      if (selected.has(placeId)) selected.delete(placeId);
      else selected.add(placeId);
      return { ...prev, selected };
    });
  }

  async function handleInspConfirm() {
    if (insp.status !== "preview") return;
    const preview = insp;
    const chosen = preview.items.filter((i) => preview.selected.has(i.place.placeId));
    if (chosen.length === 0) return;
    setInsp({ status: "confirming" });
    try {
      const tags: Record<string, string[]> = {};
      for (const c of chosen) tags[c.place.placeId] = c.tags;
      const res = await authedFetch("/api/import/inspiration/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ places: chosen.map((c) => c.place), tags }),
      });
      const data = (await res.json()) as { summary?: { success: number; skipped: number; failed: number }; error?: string };
      if (!res.ok || !data.summary) throw new Error(data.error ?? "收藏失敗");
      setInsp({ status: "done", summary: data.summary });
    } catch (e) {
      // 保留預覽與勾選，讓使用者直接重試「批次收藏」，不必重跑昂貴的分析（重扣額度）
      setInsp({ ...preview, error: e instanceof Error ? e.message : "收藏失敗" });
    }
  }

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
        <GoogleSignInButton />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <div className="mb-8 flex items-center gap-3">
        <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-700 transition-colors">← 返回收藏</Link>
      </div>

      <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 mb-1">匯入地點</h1>
      <p className="text-sm text-neutral-500 mb-10">貼一段別人的遊記讓 AI 用你的品味過濾，或從 Google Takeout、分享連結、Chrome 擴充把地點帶進來。</p>

      <section className="mb-10">
        <h2 className="text-sm font-semibold text-neutral-900 mb-1">✨ 貼靈感（AI 用你的品味過濾）</h2>
        <p className="text-xs text-neutral-500 mb-4">
          貼一段遊記／IG 貼文／景點清單，AI 抽出地點並對照你的 Travel DNA 給契合度評分，勾選喜歡的一鍵收藏。
        </p>

        <textarea
          value={inspText}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInspText(e.target.value)}
          rows={5}
          placeholder="把別人的遊記或景點清單貼進來，例如「這趟沖繩去了古宇利大橋、瀨長島、美國村…」"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        />
        <button
          onClick={() => void handleAnalyze()}
          disabled={!inspText.trim() || insp.status === "analyzing"}
          className="mt-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-40 transition-colors"
        >
          {insp.status === "analyzing" ? "分析中…" : "分析"}
        </button>

        {insp.status === "error" && <p className="mt-3 text-sm text-red-600">{insp.message}</p>}

        {insp.status === "preview" && (
          <div className="mt-4">
            {/* 交代地點去向（不靜默消失）：超上限略過 + 地圖找不到 */}
            {(insp.truncated > 0 || insp.resolveFailed > 0) && (
              <p className="mb-2 text-xs text-amber-600">
                {insp.truncated > 0 && `地點太多，略過了 ${insp.truncated} 個。`}
                {insp.resolveFailed > 0 && `有 ${insp.resolveFailed} 個在地圖上找不到，已略過。`}
              </p>
            )}
            {insp.error && <p className="mb-2 text-sm text-red-600">{insp.error}</p>}
            {insp.items.length === 0 ? (
              <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-6 text-center text-sm text-neutral-500">
                沒有從這段文字抽到可定位的地點，換一段試試。
              </p>
            ) : (
              <>
                <ul className="space-y-2">
                  {insp.items.map((c) => (
                    <li key={c.place.placeId} className="rounded-lg border border-neutral-200 px-3 py-2.5">
                      <label className="flex cursor-pointer items-start gap-2.5">
                        <input
                          type="checkbox"
                          checked={insp.selected.has(c.place.placeId)}
                          onChange={() => toggleInsp(c.place.placeId)}
                          className="mt-1 accent-teal-700"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-neutral-900">{c.place.name}</span>
                            <span className="text-xs text-amber-500">{"★".repeat(c.fitStars)}{"☆".repeat(5 - c.fitStars)}</span>
                            {c.isGapFiller && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs text-violet-700 ring-1 ring-inset ring-violet-200">補盲區</span>}
                            {c.lowConfidence && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700 ring-1 ring-inset ring-amber-200">請確認</span>}
                          </span>
                          {c.place.address && <span className="block truncate text-xs text-neutral-400">{c.place.address}</span>}
                          <span className="mt-1 flex flex-wrap items-center gap-1.5">
                            {c.tags.map((t) => (
                              <span key={t} className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">{t}</span>
                            ))}
                          </span>
                          <span className="mt-1 block text-xs text-neutral-500">{c.reason}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => void handleInspConfirm()}
                  disabled={insp.selected.size === 0}
                  className="mt-3 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-40 transition-colors"
                >
                  批次收藏（{insp.selected.size}）
                </button>
              </>
            )}
          </div>
        )}

        {insp.status === "confirming" && <p className="mt-3 text-sm text-neutral-500">收藏中…</p>}
        {insp.status === "done" && (
          <div className="mt-3">
            <p className="text-sm text-teal-700 font-medium">
              已收藏 {insp.summary.success} 個{insp.summary.skipped > 0 && `・跳過 ${insp.summary.skipped} 個（已在收藏）`}
              {insp.summary.failed > 0 && `・失敗 ${insp.summary.failed} 個`}
            </p>
            <Link href="/" className="mt-1 inline-block text-sm text-teal-700 underline hover:text-teal-900">
              回收藏頁查看 →
            </Link>
          </div>
        )}
      </section>

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
              {takeout.summary.rateLimited && (
                <p className="mt-1 text-amber-600">
                  今日匯入筆數已達上限，本次未匯入。請明天再匯入。
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
