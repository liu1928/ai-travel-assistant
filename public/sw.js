// 手寫最小 service worker（不引入 serwist/workbox）。specs/export-offline.md §c。
// 範圍明確限縮：出國斷網時看得到「已開過」的行程，不做離線編輯、不做背景同步。
// CACHE_VERSION 改變時 activate 會清掉舊版本的 cache（版本更新策略）。
const CACHE_VERSION = "atlas-v1";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const API_CACHE = `${CACHE_VERSION}-api`;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isTripsApiGet(url) {
  return /^\/api\/trips(\/[^/]+)?$/.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // 只處理 GET；POST/PATCH/DELETE 與其他 API（places、generate 等）一律不攔截，直接走原生 fetch。
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin === self.location.origin && isTripsApiGet(url)) {
    // network-first、失敗 fallback cache：看過的行程斷網可讀，連線時永遠拿新資料。
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          // 靜默處理寫入快取失敗（例如無痕模式/quota 已滿），避免 unhandled rejection（GLM REVIEW）。
          caches.open(API_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(request).then((cached) => cached ?? Response.error())),
    );
    return;
  }

  const isAppShell =
    request.mode === "navigate" || (url.origin === self.location.origin && url.pathname.startsWith("/_next/static/"));
  if (isAppShell) {
    // cache-first：app shell（頁面殼 + 靜態 assets）不常變，命中就直接回，未命中才打網路並存入快取
    // （這也讓「已開過的行程頁面」之後離線可以重新進入殼層，實際行程資料另外走上面的 API 分支）。
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request)
          .then((res) => {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
            return res;
          })
          .catch(() => Response.error());
        // 離線且從未快取過的頁面：交還瀏覽器原生離線錯誤頁，不做自訂 fallback 頁面
        // （spec 範圍明確限縮成「已開過的行程可離線看」，自訂離線頁屬額外複雜度，不在本輪範圍）。
      }),
    );
  }
  // 其他請求（places、generate 等 API）不攔截，原生行為。
});
