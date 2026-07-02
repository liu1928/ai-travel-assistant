# Atlas AI — Roadmap

> Personal Travel Intelligence。讓使用者自己長出收藏資料，再由 AI 整理成旅行。

## 已鎖定決策

- 標籤：固定分類（string literal union）
- 收藏：Firestore（Admin SDK，server-only），**per-user**（`users/{uid}/places`）
- LLM：標籤用 Haiku（已支援批次），行程生成用 Sonnet
- Auth：Firebase Auth（Google 登入）
- 部署：**Firebase App Hosting**（非 Vercel）— ADC 在 Google 環境自動生效，繞過組織政策禁止建立 service account key 的限制

---

## Phase 0 — 地基 ✅
`lib/result.ts` / `schema/trip.ts` / `lib/anthropic.ts` / `schema/__tests__/trip.test.ts`

## Phase 1 — 自己的收藏系統 ✅
Places API Text Search + AI 標籤 + Firestore CRUD + UI

### 固定標籤：`海景 | 河岸 | 山林 | 咖啡 | 美食 | 夜景 | 城市 | 文化 | 親子 | 住宿`

## Phase 2 — 匯入 ✅

### 2-A Google Takeout ✅
上傳「已儲存的地點.json」→ `location.name` + 座標 bias Text Search → 批次標籤 → Firestore

### 2-B 分享連結 ✅（瘦身後）
僅支援單一地點連結（直接取 place_id）。清單連結改用 Takeout 或 Chrome 擴充。

### 2-C Chrome Extension ✅ 端到端驗證完成
`atlas-extension/` 獨立資料夾。讀 Google Maps DOM → popup 確認 → POST `/api/import/extension`。
**Wave 2 更新**：Extension 帶 Bearer token（使用者從「匯入地點」頁複製，效期約 1 小時，貼到 Extension 設定頁）。

**實測驗證**：沖繩收藏清單（38 個地點）匯入成功 38、失敗 0。

**DOM 結構筆記（Google Maps 收藏清單頁，2026-07）**：
- 地點名稱在 `[class*="fontHeadlineSmall"]`，外層卡片是 `button` / `[jsaction]`
- **沒有** `<a href="/maps/place/...">`，也沒有 `role="article"`（這兩個是地點詳情頁才有的結構，清單頁不適用）
- 清單是**虛擬捲動**（virtualized），畫面一次只渲染約 20 個項目；`content.js` 已加自動捲動邏輯，捲到連續 3 輪都沒有新地點才停止
- 若未來 Google 改版導致抓不到地點，先用瀏覽器 DevTools Console 檢查 `document.title` / `document.querySelectorAll('[class*="fontHeadlineSmall"]').length` 等，找出新的 class name 再更新 `content.js` 的 selector

**編碼教訓**：Extension 檔案（尤其含中文的 `.html`/`.js`）務必確保寫入時是正確 UTF-8，否則會出現「標題亂碼」「按鈕沒反應卻無錯誤訊息」等難以排查的問題。另外 Manifest V3 的擴充功能頁面有 CSP 限制，**inline `<script>` 會被靜默封鎖**（不顯示任何錯誤），JS 邏輯一律要拆成獨立 `.js` 檔用 `<script src="...">` 載入。

### 2-D Extension 匯入 API ✅
`POST /api/import/extension`（需登入）→ `importCandidates` 共用核心 → 批次標籤 → Firestore

---

## Wave 1（Auth + 部署憑證 + 資料正確性）✅ 完成

- **A1 Auth**：Firebase Auth（Google 登入），`lib/auth.ts`（server 驗證 ID token）、`lib/use-auth.ts`（client hook + `authedFetch`）。所有 API route 都需要登入。
  - 已知坑：部分瀏覽器環境（防毒/企業安全軟體）會封鎖 IndexedDB，導致 Firebase Auth 初始化卡死不丟錯誤。解法：`initializeAuth` 搭配多層 persistence fallback + 5 秒保險逾時。
- **A2 部署憑證**：`apphosting.yaml` + `lib/firebase.ts` 改用 `applicationDefault()`（本機 `gcloud auth application-default login`、App Hosting 環境皆自動生效）
- **資料模型**：`users/{uid}/places`（per-user，淘汰全域 `places`）
- **B4 匯入品質**：Extension/Takeout 都改用真實 Places API 解析（不再寫死 `{0,0}` 座標或隨機 ID）
- **B5 並行化**：`lib/concurrency.ts`（`mapLimit`），匯入不再是 N+1 序列呼叫
- **B6 批次標籤**：`tagPlaces`（多筆地點一次 Claude 呼叫），呼叫數與成本砍一個量級
- **C9 重新標籤**：收藏列表「↻ 重新標籤」按鈕 + `/api/collection/retag`
- **C10 清理**：移除 `.eslintrc.json.bak`、`tailwind.config.js`（v4 不需要）、殘留 `mnt/`

## Wave 2（品質 + Travel DNA）✅ 完成

- **C7 ESLint 救回**：`eslint-plugin-react-hooks@5`（`rules-of-hooks` + `exhaustive-deps`）。
  注意：v7 內建一批給 React Compiler 用的嚴格規則（如 `set-state-in-effect`），會把標準 data-fetching pattern 也判定為問題，故鎖定 v5 穩定版。
- **C8 分享連結瘦身**：移除清單爬蟲（不穩定、Google 登入牆擋住），只留單一地點解析
- **Travel DNA**：`lib/travel-dna.ts` 聚合 `tags` 為偏好統計 → `/api/dna` → `/dna` 頁面（長條圖呈現分布 + 一句話摘要）
- **Extension auth**：方案採「貼上 Token」（從網站複製 ID token，效期 1 小時，貼到 Extension 設定頁）。

### 待辦 / 已知取捨
- Extension 驗證**未來可選**升級為 `chrome.identity` OAuth（免手動複製 token，但需另設 GCP OAuth Client，較複雜）。目前方案 1（貼 Token）已足夠日常使用，OAuth 留待真有痛點再做。

---

## Phase 3 — AI 推薦行程

### Wave 1 ✅ 實作完成（待實測驗證）

- **V1+V2 共用同一套 API**：`generateTrip()` 接受 `{ prompt?, places?, days?, style?, budgetMin?, budgetMax? }`，有 `prompt` 走 V1、有勾選的收藏地點走 V2，兩者可並存
- **System Prompt** 原文直接存入 `lib/anthropic.ts`，一字不改（使用者提供的 V1/V2/V3 規格）
- **`schema/trip.ts`** 整個換掉 Phase 0 的骨架版，改用正式規格（title/location/style/summary/days[].schedule[]/insights/budget）
- **Google Routes API 真實車程**：`lib/routes.ts` 只算「相鄰兩點」的實際車程（n-1 段，不是 n×n 矩陣），超過 20 段自動跳過並在 insights 註明。交通方式（DRIVE/WALK/TRANSIT）使用者自己選，預設開車
- 路線增值是 **best-effort**：Routes API 失敗不會讓整個行程生成失敗，只是少一行提示
- **儲存/檢視**：`lib/trips.ts`（`users/{uid}/trips` Firestore CRUD）+ `/api/trips`（列表/儲存）+ `/api/trips/[id]`（檢視/刪除）
- **頁面**：`/trip`（生成：一句話輸入框 + 從收藏勾選地點 + 天數/風格/預算/交通方式 + 時間軸呈現）、`/trips`（已存行程列表）、`/trips/[id]`（檢視單一行程）

**待確認**：以上都是碼層驗證（typecheck/test/lint 全綠），**實際生成品質、Routes API 計算正確性、完整 UI 流程還需使用者實際操作驗證**。

### 後續（未開始）

- 行程生成需要一組固定 eval（品質目前完全壓在 prompt 上，沒有驗證基準）
- V3（AI 主動推薦）尚未實作，目前 System Prompt 只是要求 AI 模擬這種能力
- 地點座標解析（`resolveCoordinates`）用名稱比對收藏列表，非精確匹配，未來可改用 place_id 直接對應

---

## 已知風險

- Extension DOM selector 可能因 Google Maps 改版失效（壞了更新 selector）
- Places API / Routes API 付費，需綁卡
- 之前對話中暴露過的 Anthropic / Google Maps API Key 建議重新產生
