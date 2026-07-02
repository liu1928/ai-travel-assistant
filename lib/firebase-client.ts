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

const app = getApps().length ? getApp() : initializeApp(config);

// 部分瀏覽器（防毒/企業安全軟體）會封鎖 IndexedDB，導致預設的
// indexedDBLocalPersistence 卡住、不丟錯誤、永遠不 resolve。
// 這裡明確指定多層 fallback persistence，避免初始化卡死。
let auth: ReturnType<typeof getAuth>;
try {
  auth = initializeAuth(app, {
    persistence: [
      indexedDBLocalPersistence,
      browserLocalPersistence,
      browserSessionPersistence,
      inMemoryPersistence,
    ],
  });
} catch {
  // initializeAuth 只能呼叫一次（HMR 重複載入時會丟錯），退回 getAuth 取得既有 instance
  auth = getAuth(app);
}

export { auth };
export const googleProvider = new GoogleAuthProvider();
