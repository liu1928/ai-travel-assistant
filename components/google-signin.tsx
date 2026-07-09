"use client";
import { useState } from "react";
import { signInWithGoogle } from "@/lib/use-auth";

// 共用登入鈕：把 signInWithGoogle 的錯誤 catch 起來顯示（取代各頁 `void signInWithGoogle()`
// 把錯誤吞掉的 pattern）。popup 失敗自動 fallback redirect 的邏輯在 signInWithGoogle 內。
export function GoogleSignInButton() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    setError(null);
    try {
      const outcome = await signInWithGoogle();
      // 正在整頁導頁 → 保持 busy、不重置（避免頁面卸載前按鈕閃回、被重複點）
      if (outcome === "redirecting") return;
    } catch (e) {
      setError(e instanceof Error ? e.message : "登入失敗，請再試一次。");
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col items-center">
      <button
        onClick={() => void handleClick()}
        disabled={busy}
        className="rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-800 disabled:opacity-40"
      >
        {busy ? "登入中…" : "用 Google 登入"}
      </button>
      {error && <p className="mt-3 max-w-xs text-center text-sm text-red-600">{error}</p>}
    </div>
  );
}
