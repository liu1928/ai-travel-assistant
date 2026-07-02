"use client";
import { useEffect, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut, type User } from "firebase/auth";
import { auth, googleProvider } from "./firebase-client";

export { auth };

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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

export async function signInWithGoogle(): Promise<void> {
  await signInWithPopup(auth, googleProvider);
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
