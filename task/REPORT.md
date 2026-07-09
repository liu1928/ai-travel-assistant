<!-- 產生日期: 2026-07-09 | 產生模型: claude-opus-4-8 | 引用 REVIEW.md 時間戳: 2026-07-09 23:5x（Asia/Taipei）| 下次審視: 補航班 API 帶航線時刻（第二層）前 -->

# REPORT — 航班號自動帶航空公司（①A）

> 任務來源：peanut 指示（新增航班那邊輸入航班號自動帶資訊）。SPEC：`specs/flight-airline-autofill.md`。分支 `feat/flight-airline-autofill`（off main）。
> 依 CLAUDE.md Executor 流程完成：實作 → 自我驗證 → GLM 審查（`task/REVIEW.md`）→ 仲裁 → 本報告。
> **未宣告 Done——等 peanut 驗收。**

## 1. 改了哪些檔案（3 檔 + spec）

| 檔案 | 改動 |
|---|---|
| `lib/airlines.ts`（新） | `IATA_AIRLINES` 代碼表（~40 家、台灣/亞洲為主）+ 純函式 `airlineFromFlightNo`（離線查表）+ `nextAirline`（改/清航班號時的 autofill 語意） |
| `components/bookings.tsx` | 航班號 `onChange` 改用 `setFlightNo` → 依 `nextAirline` 自動帶/更新航空公司 |
| `lib/__tests__/airlines.test.ts`（新） | `airlineFromFlightNo` + `nextAirline` 共 11 case |
| `specs/flight-airline-autofill.md`（新） | 本功能 SPEC |

**行為**：航班號欄打 `BR198` → 航空公司欄自動帶「長榮航空」。**只在空白或先前 autofill 的欄位作用**——手填的航空公司永不被蓋；改成別家代碼會更新、改成未知代碼會清掉殘留值。**零 API、零 key、零成本、離線**。

## 2. 測試結果
```
pnpm typecheck  → ✓
pnpm test       → ✓ 66 passed（新增 airlines 11 case）
pnpm lint       → ✓
```

## 3. GLM finding 統計（詳見 `task/REVIEW.md`）
- 🐛 0（reviewer 確認邏輯乾淨、無 race）
- ⚠️ 3：**1 真已修**（autofill 後改航班號 airline 殘留錯值 → 抽 `nextAirline` 純函式，改代碼會更新/清、手填永不動）、1 不修（regex 未驗證「至少一英文字母」——查表已把關、全數字代碼不存在，冗餘）、1 非問題（數字開頭代碼是真代碼）
- 💡 2：1 隨重構處理、1 不採納
- ❓ 1：已釐清並修（反向更新/清除）

## 4. Known issues / 待實測
- 實測：打 `BR198`→帶長榮；先手填 airline 再打航班號→不被蓋；打 `ZZ999`→不亂填；autofill 後把代碼改成 `CI`→變中華航空。
- **只帶航空公司名稱**，不帶航線/起降時刻/日期——那是第二層（需付費航班 API + 日期，`specs/flight-airline-autofill.md §7` 已列，另開 spec）。
- 代碼表是 curated 子集，罕見航空查不到（回 undefined、使用者手填）。

## 5. 部署
合併進 main → App Hosting 自動 build/deploy。純前端便利功能，不影響既有航班/租車/生成流程。

---
**狀態：實作完成、驗收未過。等 peanut 確認後才可宣告 Done。**
