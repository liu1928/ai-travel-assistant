# task/REVIEW.md — GLM-5.2 異質審查（Foundation E）

- 時間戳：2026-07-09 18:2x（Asia/Taipei）
- 審查範圍：記帳頁入口（純前端連結補洞）
  - `app/trips/[id]/page.tsx`（header 加「💰 記帳」）、`app/trips/page.tsx`（列表每筆加「💰 記帳」）
- Reviewer：MCP `glm-reviewer` `review_code`，focus=（全面）
- ⚠️ Reviewer 意見僅為「懷疑」，先原封記錄，再逐條仲裁。

---

## 一、GLM 原始回覆（原封不動）

### 🐛 問題點
無。根據你的結構說明，`<Link>` 與 `<a>` 皆為兄弟節點，確實沒有產生巢狀 `<a>` 的 HTML 違規問題。

### ⚠️ 風險
1. **`id` 為空字串或 `undefined` 的防呆**：程式碼直接使用 `/trips/${view.trip.id}/expenses` 與 `/trips/${t.id}/expenses`。雖然背景說明指出 `SavedTrip` 有 `id` 欄位，但若資料庫或 API 在特定邊界情況下回傳了尚未生成 `id` 的暫存資料，這會導致路由變成 `/trips//expenses` 或 `/trips/undefined/expenses`。建議確認上層元件是否已絕對過濾掉無 `id` 的資料。
2. **列表頁的刪除按鈕與連結並列的誤觸風險**：在列表頁中，記帳連結與刪除按鈕距離拉近了。若使用者在使用手機版（窄螢幕）時，點擊「💰 記帳」可能會因為手指觸擊範圍過大而誤觸「刪除」按鈕，反之亦然。需確認 RWD 在小螢幕下的 `gap-3` 是否足夠，或刪除按鈕是否有二次確認防護。

### 💡 建議
1. **路由路徑抽離為常數或輔助函式**：`/trips/${id}/expenses` 這個字串在兩個檔案中硬編碼。既然有 `buildSplitBillHref` 這類輔助函式的慣例，建議也建立類似 `buildExpensesHref(id)` 的工具函式，不僅符合 DRY 原則，也能集中管理路由變更。
2. **無障礙屬性 (a11y) 補強**：連結文字「💰 記帳」使用了 Emoji，螢幕閱讀器可能會將其朗讀為「金錢符號記帳」或類似語音。建議在連結上加上 `aria-label` 或給 Emoji 加上 `aria-hidden="true"`。

### ❓ 待釐清問題
1. 原本條件 `view.status === "ready" && SPLIT_BILL_URL` 改為 `view.status === "ready"`，即使無 `SPLIT_BILL_URL` 也顯示記帳連結？（看起來正確，記帳是站內功能不依賴外部分帳 URL，但想確認 `ready` 是否保證 `view.trip.id` 存在？）
2. 列表頁刪除按鈕沒有二次確認，這次把連結放得離刪除很近，是否需一併補上刪除的二次確認？

---

## 二、仲裁（逐條實際驗證）

### 🐛 無 → 確認乾淨
- reviewer 確認無巢狀 anchor。實際結構：列表項的標題 `<Link>` 與動作 `<div>`（記帳 Link + 刪除 button）為兄弟；詳情頁記帳 Link 與去分帳 `<a>` 為兄弟。無 HTML 違規。

### ⚠️-1 `id` 空/undefined 防呆 → **不修（資料模型保證存在）**
- `SavedTrip.id` = Firestore 文件 id，**存檔時必生成**；記帳 Link 只在 `view.status==="ready"`（已從 Firestore 讀回）與列表（`/api/trips` 回的 SavedTrip[]）渲染，兩者 id 必存在。`/trips//expenses` 對真實資料不會發生。加防呆屬防禦無效資料，本專案 listPlaces/trips 都經 zod safeParse，不會回無 id 的暫存資料。

### ⚠️-2 記帳連結與刪除誤觸 → **不修（gap-3 足夠；刪除無確認屬既有、非本輪引入）**
- `gap-3`（12px）觸控間距合理；且記帳是 `Link`（誤點只是導去 expenses、可返回，無破壞），刪除是 `button`。刪除無二次確認是**改動前就存在**的行為，非 E 引入，不在本輪 scope 擴大。

### 💡-1 抽 `buildExpensesHref` → **不採納（trivial 路徑，helper 為過度抽象）**
- `buildSplitBillHref` 存在是因為它組**帶 query params + encode + base URL** 的複雜 URL；`/trips/${id}/expenses` 只是一段模板字串，抽 helper 增加間接、無實質收益。路由若變更是 2 處 find-replace，成本極低。

### 💡-2 emoji a11y（aria-label / aria-hidden）→ **不採納（與 codebase 慣例一致；app-wide a11y 屬另案）**
- 連結文字含實義「記帳」，emoji 為裝飾；螢幕閱讀器讀「錢袋 記帳」冗餘但不失義。且全站既有 emoji 連結（`📁 群組`、`🧭 導航`、`← 返回`）皆無 aria，單獨為這兩處加會不一致。**a11y 是升級藍圖 survey 已列的全站缺口**，宜整批處理（含錯誤 `role="alert"`、按鈕 `aria-label`），非在此小補洞夾帶。

### ❓-1 `ready` 是否保證 id → **是（已釐清）**
- `view.status==="ready"` 代表 trip 已從 Firestore 讀回（含 doc id）。改成不依賴 `SPLIT_BILL_URL` 是刻意的——記帳是站內功能，本就不該被外部分帳 URL 的有無綁住。

### ❓-2 刪除二次確認 → **不在本輪（既有行為）**
- 刪除無確認是改動前現況；本輪只補記帳入口，不擴大改刪除互動。若要做屬另一個 UX 議題。

---

## 三、本輪修正動作
- **無程式碼修正**：GLM 未找到真 bug；所有 finding 經驗證為「資料模型已保證」「既有行為非本輪 scope」或「與 codebase 慣例一致、屬 app-wide a11y 另案」。均附理由。

驗證：`pnpm typecheck / test(49 passed) / lint` 全綠。

## 統計
- 🐛 0
- ⚠️ 2：均不修（id 資料模型保證、刪除誤觸屬既有 scope）
- 💡 2：均不採納（trivial 路徑不抽 helper、a11y 屬全站另案）
- ❓ 2：均已釐清
