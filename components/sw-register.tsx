"use client";

import { useEffect } from "react";

// 只在 production 註冊，dev 不受快取干擾（specs/export-offline.md §c 故障模式）。
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((e) => {
      // 註冊失敗不影響一般使用（只是沒有離線能力），但要記錄下來否則排查離線功能失效無從查起（GLM REVIEW）。
      console.error("[sw-register] 註冊失敗", e);
    });
  }, []);
  return null;
}
