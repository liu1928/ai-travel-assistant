# task/REVIEW.md — 住宿建議 + 訂房連結（GLM-5.2 異質審查）

- 時間戳：2026-07-10 00:0x（Asia/Taipei）
- 審查範圍：`lib/booking-link.ts`、`lib/lodging.ts`、`app/api/lodging/suggest/route.ts`、`app/trips/[id]/page.tsx`（住宿建議區塊）、`lib/__tests__/booking-link.test.ts`
- Reviewer：MCP `glm-reviewer` `review_code`，focus=`security`
- ⚠️ 送審用的是**節略版**程式碼（部分實作以註解代替），數條 finding 是節略造成的誤判；以下對照**實際程式碼**仲裁。

---

## 一、GLM 原始回覆（原封不動）

### 🐛 問題點
1. **`buildLodgingLink` 的 stay22 分支沒有 return**：`if (stay22) { /* ... */ }` 只是註解沒實作沒 return。
2. **`bookingSearchUrl` 的 input 缺型別 → any**：`function bookingSearchUrl(input, aid?)` 嚴格模式報錯。
3. **`reqBody` 屬性修改違反常數宣告**：`const reqBody` 後 `reqBody.locationBias = ...`，若有 ESLint 不可變規則會被擋。

### ⚠️ 風險
1. **開放重導向 / URL 注入**：`query`（place.name / trip.location）放進 URL；雖 URLSearchParams encode、前綴固定 https 大幅降低風險，仍建議前端確認 href 以 https 開頭。
2. `place.name` 作查詢字串可能過長/特殊字元影響 Booking 結果（功能非安全）。
3. **tripId 越權依賴 getTrip**：需確認 getTrip 內部強制 uid 過濾。
4. `checkIn/checkOut` 格式未驗證（目前 route 沒傳，未來擴充要驗）。
5. `listPlaces` 失敗靜默降級無 log。
6. **地理重心跨換日線算術平均錯**（台灣國內非問題）。

### 💡 建議
1. `PRICE_LEVEL_NUM` 用 `as const`。
2. `input.center` 解構寫清楚 `latitude/longitude`。
3. 前端 `rel="noopener noreferrer"`。

### ❓ 待釐清
1. stay22 分支是否未實作佔位符？
2. checkIn/checkOut 從哪來？
3. name 完全比對是否可靠（空白/全半形差異會漏）？
4. trip.location 格式？

---

## 二、仲裁（對照實際程式碼）

### 🐛-1 stay22 沒 return → **FALSE POSITIVE（節略造成）**
- 實際 `lib/booking-link.ts` 的 stay22 分支**有完整實作 + return** `https://www.stay22.com/embed/gm?...`；`booking-link.test.ts` 的「有 STAY22_AID → 走 Stay22」也**通過**。送審摘要把它縮成註解才看起來沒 return。

### 🐛-2 bookingSearchUrl 缺型別 → **FALSE POSITIVE（節略造成）**
- 實際簽名是 `function bookingSearchUrl(input: LodgingLinkInput, aid?: string): string`；`pnpm typecheck` 全綠、無 implicit any。

### 🐛-3 reqBody 屬性修改 → **不修（合法、lint 通過）**
- `const` 只擋重新賦值、不擋屬性修改；`reqBody` 型別是 `Record<string, unknown>`（非 any）；`pnpm lint` 通過、無相關規則擋。非 bug。

### ⚠️-1 開放重導向/注入 → **FALSE POSITIVE（scheme+host 是硬編字面量）**
- 連結一律 `https://www.booking.com`／`stay22.com`／`tp.media` **固定 host 字面量開頭**，`query` 只進 query string 且經 URLSearchParams encode，**無法注入 `javascript:` 或改 host**；React 也會擋 `javascript:` href。無 open-redirect/XSS。

### ⚠️-3 tripId 越權 → **已驗證安全**
- `getTrip(uid, id)` 讀 `users/{uid}/trips/{id}`（uid 由 `requireUid` 決定、非前端指定），與其他 trips CRUD 一致的 uid-scoped 路徑。無法讀他人 trip、無 IDOR。

### ⚠️-5 listPlaces 失敗無 log → **真（已修）**
- 加 `console.warn("[lodging] 讀收藏失敗，改用 location 字串查", ...)`；降級語意不變（退回 location 字串查），但可觀測。

### 💡-1 / priceLevel 未知 enum → **採納（型別安全）**
- 改 `raw.priceLevel && raw.priceLevel in PRICE_LEVEL_NUM ? PRICE_LEVEL_NUM[raw.priceLevel] : undefined`：未知 enum 值 → undefined（不會變成「typed number 但 runtime undefined」）。

### ⚠️-4 checkIn/checkOut 未驗證 → **非問題（目前不傳；且進 URLSearchParams 也安全）**
- route 目前不傳日期（optional/後續）；就算傳，也只進 encode 過的 query string，無注入。未來若加日期選擇再驗格式。

### ⚠️-6 換日線質心 → **不修（台灣/亞洲行程非問題，已記為已知限制）**
- 算術平均在跨 ±180 經度會錯；本 app 使用者行程都在同半球（lng ~120–150），不觸發。列 spec 已知限制，不為極罕見情境過度設計。

### 💡-2 / 💡-3 / ❓-1 center 解構、rel、stay22 → **FALSE POSITIVE（節略造成）**
- 實際碼 `input.center.lat/lng` 寫清楚、`rel="noopener noreferrer"` 已用、stay22 已實作。

### ❓-3 name 完全比對可靠性 → **不修（與既有 trip/generate 一致、有 fallback，spec 已記）**
- 用 `placeByName` 完全比對是**沿用既有 `trip/generate` route 的作法**；對不上該點就不計入重心，全對不上則退回 `trip.location` 字串查。saved trip 不存 place_id 故無法用 id 對；屬 spec §7 已載限制。

### ❓-4 trip.location 格式 → **已釐清**：自由文字（行程主要地區，如「沖繩」），作 Places 查詢與整區連結 query 皆合適。

---

## 三、本輪修正動作
1. `lib/lodging.ts`：priceLevel 用 `in` 守未知 enum（💡-1）。
2. `app/api/lodging/suggest/route.ts`：listPlaces 失敗加 `console.warn`（⚠️-5）。
3. 其餘：🐛-1/🐛-2/💡-2/💡-3/❓-1 為節略造成的 FALSE POSITIVE（實際碼正確）；⚠️-1 host 硬編無注入；⚠️-3 越權已驗證安全；⚠️-6/❓-3 為 spec 已載限制。

驗證：`pnpm typecheck / test(61) / lint` 全綠。

## 統計
- 🐛 3：2 FALSE POSITIVE（節略）、1 不修（合法、lint 過）
- ⚠️ 6：1 真已修（listPlaces warn）、1 FALSE POSITIVE（host 硬編）、1 已驗證安全（越權）、3 非問題/已知限制
- 💡 3：1 採納（priceLevel）、2 FALSE POSITIVE（節略）
- ❓ 4：均已釐清
