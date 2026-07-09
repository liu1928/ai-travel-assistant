# task/REVIEW.md — 航班航空公司 autofill（GLM-5.2 異質審查）

- 時間戳：2026-07-09 23:5x（Asia/Taipei）
- 審查範圍：`lib/airlines.ts`（IATA 表 + `airlineFromFlightNo` + `nextAirline`）、`components/bookings.tsx`（航班號 onChange autofill）
- Reviewer：MCP `glm-reviewer` `review_code`
- ⚠️ 意見僅為「懷疑」，先記錄，再逐條仲裁。

---

## 一、GLM 原始回覆（原封不動）

### 🐛 問題點
無。邏輯正確，有檢查 `airline` 是否為空才帶入，沒有蓋掉使用者手填值的問題。`onFlightsChange` 一次更新兩欄，也沒有 race condition。

### ⚠️ 風險
1. **Regex 會誤判非 IATA 前綴的航班號**：`^([0-9A-Z]{2})\s?\d` 只要求前兩碼英數 + 第三碼數字，`1A2345`/`AB1234` 都會 match 去查表。查不到回 undefined 不出錯，但 regex 沒驗證「前兩碼是否合法 IATA 格式（至少含一英文字母）」。
2. **數字開頭航班號被當 IATA 代碼查表**：`7C/5J/3K` 確實存在故允許數字開頭合理，但 `12A345` 會拿 `12` 查表（查不到、無害）。
3. **`airlineFromFlightNo` 對空字串**：回 undefined 沒問題；但 `setFlightNo` 在 flightNo 被清空時不會反向清除已帶入的 airline，可能資料不一致。

### 💡 建議
1. Regex 更精確：要求至少一碼為英文字母（`if (m && /[A-Z]/.test(m[1]))`）。防禦性改進。
2. `setFlightNo` 提早 return，可讀性稍好。

### ❓ 待釐清
1. **使用者清空/改航班號時，是否該同步更新/清掉 autofill 帶入的 airline？** 目前「airline 為空才帶入」沒有反向清除；打 `BR123`→帶長榮→改成 `CI456`，airline 不更新（仍長榮）。刻意設計嗎？

---

## 二、仲裁 + 修正

### 🐛 無 → 確認乾淨（空值檢查、單次更新兩欄、無 race）

### ⚠️-3 / ❓-1 改/清航班號後 airline 殘留錯值 → **真（已修）**
- 屬實且是真的 UX 問題：autofill 帶了長榮，改成 CI 航班號後仍顯示長榮＝**錯的航空公司**（會出現在行程卡上）。
- 修法：抽純函式 **`nextAirline(oldFlightNo, oldAirline, newFlightNo)`**（可單測）——用「舊 airline 是否 == 舊航班號 autofill 出的值」判斷**是否為 autofill 帶的**：
  - **使用者手填**（非 autofill）→ 一律不動。
  - **空 / 先前 autofill** → 依新航班號更新；新代碼未知時**清掉殘留 autofill 值**。
- `setFlightNo` 改用它一次更新 flightNo + airline。補 5 個 `nextAirline` 回歸測試（更新/清除/不動手填/同航空改班次）。

### ⚠️-1 / 💡-1 regex 未驗證「至少一英文字母」→ **不修（查表已把關）**
- IATA 航空代碼**必含至少一英文字母**、不存在全數字代碼，故 `IATA_AIRLINES` 不會有全數字 key；`12`/`1A2345` 這類前綴查表 miss → undefined → 不會誤填。加 `/[A-Z]/` 檢查與查表把關**功能上等價、冗餘**。維持精簡。

### ⚠️-2 數字開頭查表 → **非問題（正確行為）**
- `7C/5J/3K` 是真代碼，允許數字開頭是對的；reviewer 也認可。

### 💡-2 提早 return 可讀性 → **已隨重構處理**（改用 `nextAirline` 後 `setFlightNo` 已是單行 map）

---

## 三、本輪修正動作
1. `lib/airlines.ts`：新增純函式 `nextAirline`（處理改/清航班號時的 autofill 語意）。
2. `components/bookings.tsx`：`setFlightNo` 改用 `nextAirline` 一次更新兩欄。
3. `lib/__tests__/airlines.test.ts`：加 `nextAirline` 5 case。
4. regex 精確化不採納（查表已把關，附理由）。

驗證：`pnpm typecheck / test(66) / lint` 全綠。

## 統計
- 🐛 0
- ⚠️ 3：1 真已修（airline 殘留）、1 不修（regex 冗餘）、1 非問題（數字代碼）
- 💡 2：1 隨重構處理、1 不採納（regex）
- ❓ 1：已釐清並修（反向更新/清除）
