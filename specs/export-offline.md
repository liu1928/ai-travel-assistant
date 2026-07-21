# Spec — Export & Offline（ICS 匯出 / 列印 PDF / PWA 離線）※ 規劃中，未實作

> 狀態：spec 已定稿待實作。實作時照本文件執行；有歧義回來改本文件。
> 前置：`specs/schedule-anchoring.md`（ICS 的每日行程需要 `startDate` 換算日期；flights/lodgings 自帶日期不受影響）。
> 本 spec 拆 **a → b → c 三小件，各自獨立驗收**，可分三輪任務做。

## 0. 為什麼是這份

行程做完只能在 app 裡看：進不了行事曆、分享不了給旅伴、出國斷網就看不到。三件事全部 **$0**（零外部 API、零重依賴）。

---

## a. ICS 行事曆匯出

### 契約

- 新 `lib/ics.ts`：純字串生成 VCALENDAR（**零依賴**，不裝 ics 套件），輸入 `TripWithBookings`，輸出 ICS 字串。可單測。
  - `flights[]` → 各一個 VEVENT（SUMMARY：`BR198 TPE→NRT`；起訖時刻取 depart/arrive + date）。
  - `lodgings[]` → check-in / check-out 各一個 VEVENT（有日期才產）。
  - `days[].schedule[]` → 有 `startDate` 時，每個 stop 一個 VEVENT（日期 = startDate + day-1；DTSTART = date + time；DTEND = + `durationMin`，缺省 60 分）。無 `startDate` → 只匯出 flights/lodgings，並在檔內加一行 X-comment 說明。
  - 時間一律 **floating local time（無 TZID）**：跨時區旅行時「當地 08:00」直覺正確，也免掉時區資料庫依賴。
  - 逐行摺疊（75 bytes）與跳脫（逗號/分號/換行）照 RFC 5545 基本要求；UID 用 `tripId-day-index@atlas`。
- 新 `app/api/trips/[id]/ics/route.ts`（GET）：`requireUid` → 讀 trip → 回 `text/calendar; charset=utf-8` + `Content-Disposition: attachment; filename="trip.ics"`。
- UI：`app/trips/[id]/page.tsx` 加「匯出行事曆 (.ics)」（`authedFetch` 取 blob 下載，因 GET 需帶 auth header，不能裸連結）。

### 驗收

1. 匯入 Google Calendar / Apple 行事曆 → 航班、住宿、每日行程事件正確（日期、當地時間、標題）。
2. 無 `startDate` 的舊行程 → 仍可匯出 flights/lodgings。
3. `lib/__tests__/ics.test.ts`：跳脫、摺疊、日期換算、缺欄位降級。

---

## b. 列印 / 存 PDF（單頁摘要）

### 契約

- **print stylesheet 路線，零依賴**：不引入 html-to-image / jsPDF 類重依賴（明訂禁止）。
- `app/trips/[id]/page.tsx` 加「列印 / 存 PDF」按鈕 → `window.print()`。
- 新增 print CSS（`@media print`，Tailwind `print:` variant 即可）：隱藏導覽/按鈕/輸入區與地圖，顯示精簡版：標題、日期、每日時間軸（time + title + description 一行化）、航班/住宿摘要、預算。分頁避免天卡片被腰斬（`break-inside: avoid`）。
- 使用者用瀏覽器「另存為 PDF」即得檔案；手機分享到 LINE 走系統列印/分享流程。

### 驗收

1. Chrome 列印預覽：單欄精簡版、無按鈕雜訊、天卡片不跨頁腰斬。
2. 正常瀏覽畫面不受 print CSS 影響。

---

## c. PWA 離線（斷網看行程）

### 契約

- 範圍明確限縮：**「出國斷網時，看得到已開過的行程」**。不做離線編輯、不做背景同步。
- `public/manifest.webmanifest`：name/short_name/icons/start_url/display=standalone/theme_color。icon 產 192/512 兩檔。
- `app/layout.tsx`：metadata 掛 manifest 連結。
- 新 `public/sw.js`（手寫最小 service worker，不引入 serwist/workbox）：
  - app shell（`/`、`/trips`、靜態 assets）：cache-first。
  - `/api/trips` 與 `/api/trips/[id]` 的 GET 回應：**network-first、失敗 fallback cache**（看過的行程斷網可讀，連線時永遠拿新資料）。
  - 不快取任何 POST/PATCH/DELETE 與其他 API（places、generate 等）。
- 新 client 元件註冊 SW（`navigator.serviceWorker.register`，僅 production）。
- 版本更新策略：SW 檔內 CACHE_VERSION 常數，activate 時清舊 cache。

### 驗收

1. 開過某行程後開飛航模式 → `/trips/[id]` 仍可完整瀏覽（含天氣快照）；沒開過的行程顯示離線提示。
2. 恢復連線 → 拿到最新資料（network-first 生效）。
3. 手機「加入主畫面」→ standalone 開啟。
4. `pnpm build` 過；SW 只在 production 註冊（dev 不受快取干擾）。

---

## 設計決策（三件共通）

- **零依賴是硬約束**：ICS 手寫、PDF 走 print、SW 手寫——三者需求都在「基本盤」範圍，引套件是用不到的複雜度與供應鏈面積。
- **auth 邊界不變**：ICS 端點走 `requireUid`；SW 只快取「該瀏覽器已成功取得」的回應，不繞過權限。
- 資安註記：ICS 內容含個人行程，`Content-Disposition: attachment` + 需 auth，不做公開分享連結（Shared Trip 是另一個 ROADMAP 項目）。

## 影響檔案

| 檔案 | 變更 | 屬於 |
|---|---|---|
| `lib/ics.ts`（新）+ 測試 | ICS 生成 | a |
| `app/api/trips/[id]/ics/route.ts`（新） | 下載端點 | a |
| `app/trips/[id]/page.tsx` | 匯出/列印按鈕 + `print:` 樣式 | a、b |
| `public/manifest.webmanifest`、`public/sw.js`、icons（新） | PWA | c |
| `app/layout.tsx` | manifest metadata | c |
| SW 註冊 client 元件（新） | PWA | c |

## 故障模式

| 症狀 | 原因 | 解法 |
|---|---|---|
| 行事曆匯入時間錯 | 誤加 UTC/Z 後綴 | floating local time，DTSTART 不帶 Z |
| ICS 中文亂碼 | 未跳脫/未宣告 charset | UTF-8 + RFC 5545 跳脫，單測擋 |
| dev 環境頁面被快取搞瘋 | SW 在 dev 註冊了 | 僅 production 註冊 |
| 使用者看到過期行程不自知 | fallback cache 無標示 | 離線 fallback 時 UI 顯示「離線資料，可能非最新」橫幅 |
