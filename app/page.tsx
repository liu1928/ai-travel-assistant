"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { SavedPlace, PlaceSearchResult, PlaceTag } from "@/schema/place";
import { useAuth, signOutUser, authedFetch } from "@/lib/use-auth";
import { GoogleSignInButton } from "@/components/google-signin";

// Leaflet 依賴 window，一律 dynamic + ssr:false（specs/map-view.md）
const CollectionMap = dynamic(() => import("@/components/collection-map"), { ssr: false });

const TAG_STYLE: Record<string, string> = {
  海景: "bg-sky-50 text-sky-700 ring-sky-200",
  河岸: "bg-cyan-50 text-cyan-700 ring-cyan-200",
  山林: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  咖啡: "bg-amber-50 text-amber-800 ring-amber-200",
  美食: "bg-orange-50 text-orange-700 ring-orange-200",
  夜景: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  城市: "bg-slate-100 text-slate-700 ring-slate-300",
  文化: "bg-rose-50 text-rose-700 ring-rose-200",
  親子: "bg-lime-50 text-lime-700 ring-lime-200",
  住宿: "bg-stone-100 text-stone-700 ring-stone-300",
};
const FALLBACK_TAG = "bg-neutral-100 text-neutral-700 ring-neutral-300";

function Tag({ label }: { label: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TAG_STYLE[label] ?? FALLBACK_TAG}`}>
      {label}
    </span>
  );
}

function SignIn() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-5">
      <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Atlas</h1>
      <p className="mt-1 mb-8 text-sm text-neutral-500">把地點收進來，之後變成旅行。</p>
      <GoogleSignInButton />
    </main>
  );
}

export default function Home() {
  const { user, loading } = useAuth();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [saved, setSaved] = useState<SavedPlace[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [batchRetag, setBatchRetag] = useState<
    | { status: "idle" }
    | { status: "running" }
    | { status: "done"; checked: number; emptyFound: number; updated: number; failed: number }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const [refreshStatus, setRefreshStatus] = useState<
    | { status: "idle" }
    | { status: "running" }
    | { status: "done"; scanned: number; updated: number; closedFound: number; failed: number; remaining: number }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const [collectionView, setCollectionView] = useState<"list" | "map">("list");

  // 群組成員編輯
  const [memberEditGroup, setMemberEditGroup] = useState<string | null>(null);
  const [memberDraft, setMemberDraft] = useState<Set<string>>(new Set());
  const [savingMembers, setSavingMembers] = useState(false);

  const savedIds = new Set(saved.map((p) => p.placeId));

  async function loadCollection() {
    try {
      const res = await authedFetch("/api/collection");
      const data = (await res.json()) as { places?: SavedPlace[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "讀取收藏失敗");
      setSaved(data.places ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "讀取收藏失敗");
    }
  }

  useEffect(() => {
    if (user) void loadCollection();
  }, [user]);

  async function doSearch() {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setError(null);
    try {
      const res = await authedFetch("/api/places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const data = (await res.json()) as { places?: PlaceSearchResult[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "搜尋失敗");
      setResults(data.places ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "搜尋失敗");
    } finally {
      setSearching(false);
    }
  }

  async function addToCollection(place: PlaceSearchResult) {
    setBusyId(place.placeId);
    setError(null);
    try {
      const res = await authedFetch("/api/collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ place }),
      });
      const data = (await res.json()) as { place?: SavedPlace; error?: string };
      if (!res.ok || !data.place) throw new Error(data.error ?? "加入失敗");
      setSaved((prev) => [data.place as SavedPlace, ...prev.filter((p) => p.placeId !== place.placeId)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加入失敗");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(placeId: string) {
    setBusyId(placeId);
    setError(null);
    try {
      const res = await authedFetch(`/api/collection?placeId=${encodeURIComponent(placeId)}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "刪除失敗");
      }
      setSaved((prev) => prev.filter((p) => p.placeId !== placeId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "刪除失敗");
    } finally {
      setBusyId(null);
    }
  }

  async function retag(placeId: string) {
    setBusyId(placeId);
    setError(null);
    try {
      const res = await authedFetch("/api/collection/retag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId }),
      });
      const data = (await res.json()) as { tags?: PlaceTag[]; error?: string };
      if (!res.ok || !data.tags) throw new Error(data.error ?? "重新標籤失敗");
      setSaved((prev) => prev.map((p) => (p.placeId === placeId ? { ...p, tags: data.tags as PlaceTag[] } : p)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "重新標籤失敗");
    } finally {
      setBusyId(null);
    }
  }

  async function saveNote(placeId: string) {
    setBusyId(placeId);
    setError(null);
    try {
      const res = await authedFetch("/api/collection", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId, note: noteDraft }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "儲存備註失敗");
      }
      setSaved((prev) => prev.map((p) => (p.placeId === placeId ? { ...p, note: noteDraft } : p)));
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存備註失敗");
    } finally {
      setBusyId(null);
    }
  }

  async function saveGroup(placeId: string) {
    setBusyId(placeId);
    setError(null);
    try {
      const res = await authedFetch("/api/collection", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId, group: groupDraft.trim() || undefined }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "設定群組失敗");
      }
      const newGroup = groupDraft.trim() || undefined;
      setSaved((prev) => prev.map((p) => (p.placeId === placeId ? { ...p, group: newGroup } : p)));
      setEditingGroup(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "設定群組失敗");
    } finally {
      setBusyId(null);
    }
  }

  function startMemberEdit(groupName: string) {
    const currentIds = new Set(saved.filter((p) => p.group === groupName).map((p) => p.placeId));
    setMemberDraft(currentIds);
    setMemberEditGroup(groupName);
  }

  async function saveMemberEdit(groupName: string) {
    setSavingMembers(true);
    setError(null);
    const currentIds = new Set(saved.filter((p) => p.group === groupName).map((p) => p.placeId));
    const toAdd = [...memberDraft].filter((id) => !currentIds.has(id));
    const toRemove = [...currentIds].filter((id) => !memberDraft.has(id));

    // 每個地點各自送出、各自成功/失敗，避免一個失敗導致其他已成功的變更被誤判為沒存
    const changes: { placeId: string; group: string | undefined }[] = [
      ...toAdd.map((placeId) => ({ placeId, group: groupName })),
      ...toRemove.map((placeId) => ({ placeId, group: undefined })),
    ];

    const results = await Promise.allSettled(
      changes.map(({ placeId, group }) =>
        authedFetch("/api/collection", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ placeId, group: group ?? "" }),
        }).then((res) => {
          if (!res.ok) throw new Error(placeId);
        })
      )
    );

    const succeeded = changes.filter((_, i) => results[i]?.status === "fulfilled");
    const failedCount = changes.length - succeeded.length;

    if (succeeded.length > 0) {
      const changeMap = new Map(succeeded.map((c) => [c.placeId, c.group]));
      setSaved((prev) =>
        prev.map((p) => (changeMap.has(p.placeId) ? { ...p, group: changeMap.get(p.placeId) } : p))
      );
    }

    if (failedCount > 0) {
      setError(`${failedCount} 個地點更新群組失敗，請重試`);
      // 保留編輯器開啟：memberDraft 不變，下次儲存只會重試還沒成功的變更
    } else {
      setMemberEditGroup(null);
    }
    setSavingMembers(false);
  }

  async function runBatchRetag() {
    setBatchRetag({ status: "running" });
    try {
      const res = await authedFetch("/api/collection/retag-empty", { method: "POST" });
      const data = (await res.json()) as {
        summary?: { checked: number; emptyFound: number; updated: number; failed: number };
        error?: string;
      };
      if (!res.ok || !data.summary) throw new Error(data.error ?? "批次重新標籤失敗");
      setBatchRetag({ status: "done", ...data.summary });
      if (data.summary.updated > 0) await loadCollection();
    } catch (e) {
      setBatchRetag({ status: "error", message: e instanceof Error ? e.message : "批次重新標籤失敗" });
    }
  }

  async function runRefreshStatus() {
    setRefreshStatus({ status: "running" });
    try {
      const res = await authedFetch("/api/collection/refresh-status", { method: "POST" });
      const data = (await res.json()) as {
        scanned?: number; updated?: number; closedFound?: number; failed?: number; remaining?: number;
        error?: string;
      };
      if (!res.ok || data.scanned === undefined) throw new Error(data.error ?? "檢查歇業狀態失敗");
      setRefreshStatus({
        status: "done",
        scanned: data.scanned,
        updated: data.updated ?? 0,
        closedFound: data.closedFound ?? 0,
        failed: data.failed ?? 0,
        remaining: data.remaining ?? 0,
      });
      if ((data.updated ?? 0) > 0) await loadCollection();
    } catch (e) {
      setRefreshStatus({ status: "error", message: e instanceof Error ? e.message : "檢查歇業狀態失敗" });
    }
  }

  // 依群組分組，未分類放最後
  const groupMap = new Map<string, SavedPlace[]>();
  const ungrouped: SavedPlace[] = [];
  for (const p of saved) {
    if (p.group) {
      const arr = groupMap.get(p.group) ?? [];
      arr.push(p);
      groupMap.set(p.group, arr);
    } else {
      ungrouped.push(p);
    }
  }
  const groups = [...groupMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  function PlaceCard({ p }: { p: SavedPlace }) {
    return (
      <li className="rounded-lg border border-neutral-200 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-sm font-medium text-neutral-900">{p.name}</p>
              {(p.businessStatus === "CLOSED_PERMANENTLY" || p.businessStatus === "NOT_FOUND") && (
                <span className="shrink-0 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">已歇業</span>
              )}
              {p.businessStatus === "CLOSED_TEMPORARILY" && (
                <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">暫停營業</span>
              )}
            </div>
            {p.address && <p className="truncate text-xs text-neutral-500">{p.address}</p>}
          </div>
          <button onClick={() => void remove(p.placeId)} disabled={busyId === p.placeId} className="shrink-0 text-xs text-neutral-400 transition-colors hover:text-red-600 disabled:opacity-40">刪除</button>
        </div>

        {/* 群組 */}
        {editingGroup === p.placeId ? (
          <div className="mt-2 flex items-center gap-2">
            <input
              value={groupDraft}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGroupDraft(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") void saveGroup(p.placeId); if (e.key === "Escape") setEditingGroup(null); }}
              placeholder="輸入群組名稱（留空移除）"
              autoFocus
              className="flex-1 rounded-md border border-neutral-300 px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            />
            <button onClick={() => void saveGroup(p.placeId)} disabled={busyId === p.placeId} className="text-xs text-teal-700 hover:text-teal-900 disabled:opacity-40">確定</button>
            <button onClick={() => setEditingGroup(null)} className="text-xs text-neutral-400 hover:text-neutral-700">取消</button>
          </div>
        ) : (
          <button
            onClick={() => { setEditingGroup(p.placeId); setGroupDraft(p.group ?? ""); }}
            className="mt-1.5 text-xs text-neutral-400 hover:text-teal-700 transition-colors"
          >
            {p.group ? `📁 ${p.group}` : "＋ 加入群組"}
          </button>
        )}

        {/* 標籤 */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {p.tags.map((t) => <Tag key={t} label={t} />)}
          <button
            onClick={() => void retag(p.placeId)}
            disabled={busyId === p.placeId}
            className="rounded-full px-2 py-0.5 text-xs text-neutral-400 hover:text-teal-700 disabled:opacity-40"
          >
            {busyId === p.placeId ? "標籤中…" : "↻ 重新標籤"}
          </button>
        </div>

        {/* 備註 */}
        {editing === p.placeId ? (
          <div className="mt-3">
            <textarea
              value={noteDraft}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNoteDraft(e.target.value)}
              rows={2}
              placeholder="寫點備註…"
              className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
            />
            <div className="mt-1.5 flex gap-2">
              <button onClick={() => void saveNote(p.placeId)} disabled={busyId === p.placeId} className="rounded-md bg-teal-700 px-3 py-1 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-40">儲存</button>
              <button onClick={() => setEditing(null)} className="rounded-md px-3 py-1 text-xs text-neutral-500 hover:text-neutral-800">取消</button>
            </div>
          </div>
        ) : (
          <button onClick={() => { setEditing(p.placeId); setNoteDraft(p.note); }} className="mt-2 block text-left text-sm text-neutral-600 hover:text-neutral-900">
            {p.note ? p.note : <span className="text-neutral-400">＋ 加備註</span>}
          </button>
        )}
      </li>
    );
  }

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-neutral-400">載入中…</main>;
  }
  if (!user) return <SignIn />;

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Atlas</h1>
          <p className="mt-1 text-sm text-neutral-500">把地點收進來，之後變成旅行。</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/trip" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors">行程</Link>
          <Link href="/dna" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors">Travel DNA</Link>
          <Link href="/import" className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors">匯入</Link>
          <button onClick={() => void signOutUser()} className="rounded-lg px-2 py-1.5 text-xs text-neutral-400 hover:text-neutral-700">登出</button>
        </div>
      </header>

      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") void doSearch(); }}
          placeholder="搜尋地點，例如「九份老街」"
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
        />
        <button
          onClick={() => void doSearch()}
          disabled={searching || !query.trim()}
          className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-800 disabled:opacity-40"
        >
          {searching ? "搜尋中…" : "搜尋"}
        </button>
      </div>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {results.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">搜尋結果</h2>
          <ul className="space-y-2">
            {results.map((p) => {
              const already = savedIds.has(p.placeId);
              return (
                <li key={p.placeId} className="flex items-start justify-between gap-3 rounded-lg border border-neutral-200 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-neutral-900">{p.name}</p>
                    {p.address && <p className="truncate text-xs text-neutral-500">{p.address}</p>}
                  </div>
                  <button
                    onClick={() => void addToCollection(p)}
                    disabled={already || busyId === p.placeId}
                    className="shrink-0 rounded-md border border-teal-700 px-2.5 py-1 text-xs font-medium text-teal-700 transition-colors hover:bg-teal-50 disabled:border-neutral-200 disabled:text-neutral-400"
                  >
                    {already ? "已收藏" : busyId === p.placeId ? "加入中…" : "加入"}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-900">
            我的收藏{saved.length > 0 && <span className="text-neutral-400">（{saved.length}）</span>}
          </h2>
          {saved.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg border border-neutral-300 p-0.5 text-xs font-medium">
                <button
                  onClick={() => setCollectionView("list")}
                  className={`rounded-md px-2.5 py-0.5 transition-colors ${collectionView === "list" ? "bg-neutral-800 text-white" : "text-neutral-600 hover:bg-neutral-50"}`}
                >
                  清單
                </button>
                <button
                  onClick={() => setCollectionView("map")}
                  className={`rounded-md px-2.5 py-0.5 transition-colors ${collectionView === "map" ? "bg-neutral-800 text-white" : "text-neutral-600 hover:bg-neutral-50"}`}
                >
                  地圖
                </button>
              </div>
              <button
                onClick={() => void runRefreshStatus()}
                disabled={refreshStatus.status === "running"}
                className="rounded-lg border border-neutral-300 px-3 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 transition-colors"
              >
                {refreshStatus.status === "running" ? "檢查中…" : "檢查歇業狀態"}
              </button>
              <button
                onClick={() => void runBatchRetag()}
                disabled={batchRetag.status === "running"}
                className="rounded-lg border border-neutral-300 px-3 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 transition-colors"
              >
                {batchRetag.status === "running" ? "檢查中…" : "一鍵批次重新標籤"}
              </button>
            </div>
          )}
        </div>

        {refreshStatus.status === "done" && (
          <p className="mb-3 rounded-lg bg-teal-50 px-3 py-2 text-xs text-teal-700">
            共檢查 {refreshStatus.scanned} 筆，發現 {refreshStatus.closedFound} 筆已歇業
            {refreshStatus.failed > 0 && `，${refreshStatus.failed} 筆查詢失敗`}
            {refreshStatus.remaining > 0 && `，還有 ${refreshStatus.remaining} 筆待檢查（稍後再按一次）`}
          </p>
        )}
        {refreshStatus.status === "error" && (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{refreshStatus.message}</p>
        )}
        {batchRetag.status === "done" && (
          <p className="mb-3 rounded-lg bg-teal-50 px-3 py-2 text-xs text-teal-700">
            共檢查 {batchRetag.checked} 筆，其中 {batchRetag.emptyFound} 筆是空標籤，已補上 {batchRetag.updated} 筆
            {batchRetag.failed > 0 && `，${batchRetag.failed} 筆失敗`}
          </p>
        )}
        {batchRetag.status === "error" && (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{batchRetag.message}</p>
        )}

        {saved.length === 0 ? (
          <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500">
            還沒有收藏。搜尋一個地點，加進來吧。
          </p>
        ) : collectionView === "map" ? (
          <CollectionMap places={saved} />
        ) : (
          <div className="space-y-6">
            {/* 有群組的分區 */}
            {groups.map(([groupName, groupPlaces]) => (
              <div key={groupName}>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                    <span>📁</span> {groupName}
                    <span className="font-normal text-neutral-400">（{groupPlaces.length}）</span>
                  </h3>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() =>
                        memberEditGroup === groupName
                          ? setMemberEditGroup(null)
                          : startMemberEdit(groupName)
                      }
                      className="text-xs text-neutral-400 hover:text-teal-700 transition-colors"
                    >
                      {memberEditGroup === groupName ? "關閉" : "編輯成員"}
                    </button>
                    <Link
                      href={`/trip?group=${encodeURIComponent(groupName)}`}
                      className="text-xs text-teal-700 hover:text-teal-900 transition-colors"
                    >
                      用這個群組生成行程 →
                    </Link>
                  </div>
                </div>

                {/* 群組成員編輯器 */}
                {memberEditGroup === groupName && (
                  <div className="mb-3 rounded-lg border border-teal-200 bg-teal-50 p-3">
                    <p className="mb-2 text-xs font-medium text-teal-800">
                      勾選要加入「{groupName}」的地點：
                    </p>
                    <div className="max-h-52 overflow-y-auto space-y-0.5">
                      {saved.map((p) => (
                        <label
                          key={p.placeId}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-teal-100"
                        >
                          <input
                            type="checkbox"
                            checked={memberDraft.has(p.placeId)}
                            onChange={() => {
                              setMemberDraft((prev) => {
                                const next = new Set(prev);
                                if (next.has(p.placeId)) next.delete(p.placeId);
                                else next.add(p.placeId);
                                return next;
                              });
                            }}
                            className="accent-teal-700"
                          />
                          <span className="flex-1 text-sm text-neutral-800">{p.name}</span>
                          {p.group && p.group !== groupName && (
                            <span className="text-xs text-neutral-400">📁 {p.group}</span>
                          )}
                        </label>
                      ))}
                    </div>
                    <div className="mt-2.5 flex gap-2">
                      <button
                        onClick={() => void saveMemberEdit(groupName)}
                        disabled={savingMembers}
                        className="rounded-md bg-teal-700 px-3 py-1 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-40"
                      >
                        {savingMembers ? "儲存中…" : "儲存"}
                      </button>
                      <button
                        onClick={() => setMemberEditGroup(null)}
                        disabled={savingMembers}
                        className="rounded-md border border-neutral-300 px-3 py-1 text-xs text-neutral-600 hover:bg-white disabled:opacity-40"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}

                <ul className="space-y-2">
                  {groupPlaces.map((p) => <PlaceCard key={p.placeId} p={p} />)}
                </ul>
              </div>
            ))}

            {/* 未分類 */}
            {ungrouped.length > 0 && (
              <div>
                {groups.length > 0 && (
                  <h3 className="mb-2 text-xs font-semibold text-neutral-400 uppercase tracking-wide">
                    未分類（{ungrouped.length}）
                  </h3>
                )}
                <ul className="space-y-2">
                  {ungrouped.map((p) => <PlaceCard key={p.placeId} p={p} />)}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
