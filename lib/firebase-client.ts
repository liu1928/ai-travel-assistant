"use client";
import { initializeApp, getApps, getApp } from "firebase/app";
import {
  initializeAuth,
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  indexedDBLocalPersistence,
  GoogleAuthProvider,
  getAuth,
} from "firebase/auth";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// ⚠️ Guard: Firebase client SDK 只能在瀏覽器初始化。
// Next.js build 時會在 server side prerender "use client" 頁面，
// 此時 window 不存在，若直接 initializeApp 會因為缺少 API key 而 throw。
// 用 lazy init + typeof window 防護解決這個問題。

let _auth: ReturnType<typeof getAuth> | null = null;

function initFirebase() {
  if (typeof window === "undefined") return; // server-side guard
  if (_auth) return; // already initialized
  const app = getApps().length ? getApp() : initializeApp(config);
  try {
    _auth = initializeAuth(app, {
      persistence: [
        indexedDBLocalPersistence,
        browserLocalPersistence,
        browserSessionPersistence,
        inMemoryPersistence,
      ],
    });
  } catch {
    // initializeAuth 只能呼叫一次（HMR 重複載入時會丟錯），退回 getAuth 取得既有 instance
    _auth = getAuth(app);
  }
}

// Proxy object that initializes Firebase lazily on first access
export const auth = new Proxy({} as ReturnType<typeof getAuth>, {
  get(_target, prop) {
    initFirebase();
    return (_auth as ReturnType<typeof getAuth>)[prop as keyof ReturnType<typeof getAuth>];
  },
});

export const googleProvider = new GoogleAuthProvider();
