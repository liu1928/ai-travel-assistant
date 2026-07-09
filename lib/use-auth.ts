"use client";
import { useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  type User,
} from "firebase/auth";
import { auth, googleProvider } from "./firebase-client";

export { auth };

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 消化 redirect fallback 回來的結果：成功由下方 onAuthStateChanged 接手；
    // 失敗記 log 不吞（避免 unhandled rejection、也留下線索）。
    getRedirectResult(auth).catch((e) => {
      console.warn("[auth] redirect result error", e instanceof Error ? e.message : String(e));
    });

    // 保險逾時：萬一 Auth 初始化異常卡住（例如環境封鎖 IndexedDB），
    // 5 秒後強制視為「未登入」，避免整頁永遠卡在「載入中」。
    const timeout = setTimeout(() => setLoading(false), 5000);
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      clearTimeout(timeout);
      setUser(u);
      setLoading(false);
    });
    return () => {
      clearTimeout(timeout);
      unsubscribe();
    };
  }, []);

  return { user, loading };
}

// popup 環境問題（被封鎖 / 環境不支援，含部分 COOP 情境）→ 改用整頁 redirect
const POPUP_FALLBACK_CODES = new Set([
  "auth/popup-blocked",
  "auth/operation-not-supported-in-this-environment",
  "auth/web-storage-unsupported",
]);
// 使用者自己關掉 popup / 重複點擊 → 當作取消，不視為錯誤
const POPUP_CANCELLED_CODES = new Set([
  "auth/popup-closed-by-user",
  "auth/cancelled-popup-request",
  "auth/user-cancelled",
]);

function authErrorCode(e: unknown): string {
  return e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
}
function authErrorMessage(code: string): string {
  switch (code) {
    case "auth/unauthorized-domain":
      return "這個網域尚未被授權登入，請聯絡管理者把網域加入 Firebase Auth 白名單。";
    case "auth/network-request-failed":
      return "網路連線失敗，請檢查連線後再試一次。";
    case "auth/operation-not-allowed":
      return "Google 登入尚未在後台啟用。";
    default:
      return `登入失敗（${code || "unknown"}），請再試一次。`;
  }
}

/**
 * Google 登入：優先用 popup；popup 被封鎖/環境不支援時自動 fallback 到整頁 redirect；
 * 使用者取消不算錯；其餘錯誤丟出可讀訊息讓 UI 顯示（不再被 void 吞掉）。
 * 回傳 "redirecting" 時代表正在整頁導頁——呼叫端應保持 busy、不要重置按鈕（避免閃爍/重複點）。
 */
export async function signInWithGoogle(): Promise<"done" | "redirecting"> {
  try {
    await signInWithPopup(auth, googleProvider);
    return "done";
  } catch (e) {
    const code = authErrorCode(e);
    if (POPUP_FALLBACK_CODES.has(code)) {
      await signInWithRedirect(auth, googleProvider); // 導頁離開（多數瀏覽器不會 resolve）
      return "redirecting";
    }
    if (POPUP_CANCELLED_CODES.has(code)) return "done";
    throw new Error(authErrorMessage(code));
  }
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
}

export async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = await auth.currentUser?.getIdToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
