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
  type Auth,
} from "firebase/auth";

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

function createAuth(): Auth {
  const app = getApps().length ? getApp() : initializeApp(config);
  try {
    return initializeAuth(app, {
      persistence: [
        indexedDBLocalPersistence,
        browserLocalPersistence,
        browserSessionPersistence,
        inMemoryPersistence,
      ],
    });
  } catch {
    // initializeAuth 只能呼叫一次，HMR 重複載入時退回 getAuth
    return getAuth(app);
  }
}

// ⚠️ 只在瀏覽器環境初始化 Firebase。
// Next.js build 時會在 server side 執行 "use client" 模組，
// typeof window 防護讓 server side 不呼叫 initializeApp，
// 避免 NEXT_PUBLIC_* 未設定時 throw auth/invalid-api-key。
// Server side 回傳空物件（型別斷言），實際上永遠不會在 server 呼叫 auth 方法。
export const auth: Auth =
  typeof window !== "undefined" ? createAuth() : ({} as Auth);

export const googleProvider = new GoogleAuthProvider();
