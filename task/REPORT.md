<!-- 產生日期: 2026-07-11 | 產生模型: claude-fable-5 | 引用 REVIEW.md 時間戳: 2026-07-11 18:15–19:10 (Asia/Taipei)，含批 3 hotfix -->

# REPORT — 修正 JX302 查無航班 / 生成行程對不上週幾與時段（含上線後 hotfix）

> 依據 GLM 審查：`task/REVIEW.md`（本輪，共三批）。任務來源：peanut 回報「航班資訊查不到 JX302」「輸入週三早上去美麗海水族館，行程排出來不是在週三也不是在早上」。
> 根因調查：獨立調查 + 反方驗證（含實打 AeroDataBox API），主張全數 confirmed，詳見對話紀錄。
> 週幾無錨點的處理方式已與 peanut 確認：選「前端擋下、要求先填日期」。分支：`main`（已合併 feat/three-fixes 後的延續改動）。
>
> **⚠️ 部署後追加 hotfix**：批 1、2 部署上線後 peanut 實測 JX302 回報「航班查詢服務暫時無法使用」——
> 這不是原本要修的「查無資料」問題，是批 1 本身引入的迴歸（Departure→Arrival fallback 兩次請求
> 背靠背發生，撞上 RapidAPI BASIC 方案 1 req/s 限速）。已用正式站金鑰實測重現、修正、GLM 審查
> （批 3）、重新部署驗證。此份 REPORT 涵蓋全部三批。

## 做了什麼

### 1. JX302 查無航班（兩個疊加的程式 bug + 一個資料源限制）

實測驗證的根因：
- **bug①**：`lib/aerodatabox.ts` 原本把 `dateLocalRole` 寫死成 `Departure`。JX302 這班（今天已進入 AeroDataBox 即時追蹤、但尚無正式排班公告）出發端只回 `predictedTime`（推估值）不回 `scheduledTime`，導致 Departure 角色查詢回 204；換 `Arrival` 角色查同一天同一航班立刻拿到 200（有對照組 BR198 證明 API/金鑰本身正常）。
- **bug②**：就算繞過①拿到 200，`pickFlight`／`AdbMovement` 型別只讀 `scheduledTime`，沒有 fallback 到 `predictedTime`，資料仍會被濾掉判成查無。
- **資料源限制（無法修）**：查很遠的未來日期，AeroDataBox 對這條航線的出發時刻本身就是空的，只有快到日期才會補上——這部分只能改錯誤訊息引導手動輸入。

修法：
- `queryByRole` 抽成共用函式；`lookupFlight` 先查 `Departure`，204/404 時 retry 一次 `Arrival`。
- `pickFlight`／`AdbMovement` 加 `predictedTime` fallback（`endpointDateTime` 輔助函式，scheduledTime 優先、缺了才退 predictedTime）。
- **兩條查詢路徑都驗證 `picked.dataDate === date`** 才採用（GLM 審查抓到我原本只驗 Arrival fallback 沒驗 Departure，標準不一致，已補齊）——防止紅眼班因為日期吻合被誤撈進來。
- `app/api/flight/lookup/route.ts` 的查無此航班訊息加一句「可能是資料源尚未收錄此航線排班，可改用下方欄位手動輸入」。

### 2. 生成行程對不上使用者提到的週幾/時段

根因比預期更根本：不只是 SYSTEM_PROMPT 沒寫規則（這部分也是真的），**更關鍵的是沒填「出發日期」時，系統送給 AI 的訊息完全沒有日期基準，AI 數學上無法算出「週三」對應第幾天**。時段（早上）則不需要錨點，是可以獨立強制的規則缺口。

修法（沿用同一輪稍早「一句話生成只出特殊需求那一天」的機制模式）：
- `lib/trip-days.ts` 新增 `extractWeekdaySignal`（抽「週三/星期三/禮拜三」，含「下週三/下下週三」修飾詞，回傳 `{weekday, weekOffset}`）、`extractTimeOfDaySignal`（抽早上/上午/中午/下午/晚上/凌晨/深夜）、`expectedDayForWeekday`（以 startDate 錨點換算對應第幾天）、`checkWeekdayTimeSignal`（驗證該天存在、且時段吻合）。
- SYSTEM_PROMPT 加硬規則：明確星期幾/時段的要求優先於「④路線優化引擎」的排程美學建議（早→晚敘事節奏等），並定義七種時段的明確時間窗。
- `buildUserMessage` 在有 `startDate` 時加換算指引：「day N 對應出發日 + (N-1) 天」。
- `generateTrip` 生成後用 `checkWeekdayTimeSignal` 驗證，不符帶修正指示重試 1 次（複用既有重試迴圈）。
- **前端 `app/trip/page.tsx`**：沒填出發日期但 prompt 含「週幾」字眼時直接擋下，要求先補日期（peanut 選定方案），不做靜默猜測。

### GLM 審查抓到的關鍵問題（已修）
「下週三」原本會被 `WEEKDAY_RE` 誤判成「週三」，算出錯誤的 day 卻仍回報驗證通過——比不驗證更糟（讓使用者以為系統背書過的答案其實是錯的）。已修：正則加吃「下/下下」前綴，`expectedDayForWeekday` 加 `weekOffset` 參數正確位移 7/14 天。

### 3. Hotfix：上線後 JX302「查詢服務暫時無法使用」（批 1 引入的迴歸）

批 1、2 部署上線後，peanut 實測 JX302 回報 502「航班查詢服務暫時無法使用」——跟原本的 404「查無此航班」不同，代表打 API 本身出狀況。用正式站金鑰直接重現：`Departure` 角色回 204 後，緊接著打 `Arrival` 角色立即回 **429**「You have exceeded the rate limit per second for your plan, BASIC」。Root cause：批 1 新加的 fallback 邏輯讓兩次請求幾乎背靠背發生，撞上 RapidAPI BASIC 方案「1 req/s」的限速——這是我自己這輪引入的迴歸，先前只手動測過刻意加 `sleep` 的版本，沒測過真實無延遲的連續呼叫。

修法：`queryByRole` 內部改成最多 2 次嘗試的迴圈，遇到 429 且是第一次嘗試時消耗掉回應 body、`sleep(1100)` 後重試一次。實測確認 429 回應不帶 `Retry-After` header（查過完整 header 清單），固定延遲是唯一可行做法；選在 `queryByRole` 底層而非 `lookupFlight` 呼叫端做固定 pre-sleep，是因為兩次查詢不一定會撞到限速窗口（實測時而 429、時而不會，取決於毫秒級時序）——反應式重試只在真的撞到時才付出等待成本。

## 改動檔案

| 檔案 | 變更 |
|---|---|
| `lib/aerodatabox.ts` | `queryByRole` 共用函式；Departure→Arrival fallback；`predictedTime` fallback；兩路徑統一驗證 dataDate |
| `app/api/flight/lookup/route.ts` | 查無此航班錯誤訊息補充說明 |
| `lib/__tests__/aerodatabox.test.ts` | 新增 3 條：predictedTime fallback、優先序、都缺時剔除 |
| `lib/trip-days.ts` | 新增 extractWeekdaySignal／extractTimeOfDaySignal／expectedDayForWeekday／checkWeekdayTimeSignal |
| `lib/anthropic.ts` | SYSTEM_PROMPT 週幾/時段硬規則；buildUserMessage 換算指引；generateTrip 生成後驗證+重試 |
| `app/trip/page.tsx` | 沒填日期卻提到週幾 → 前端擋下 |
| `lib/__tests__/trip-days.test.ts` | 新增 22 條：週幾/時段/錨點換算/驗證函式（含下週三修正的 4 條） |

## 測試結果

- `pnpm typecheck`：過
- `pnpm test`：**14 files / 155 tests 全過**（本輪新增 25 條）
- `pnpm lint`：過
- `pnpm build`：過

## GLM finding 統計（詳 task/REVIEW.md）

- 批 1（JX302）：⚠️ 2、💡 2、❓ 1；判真已修 1（Departure 路徑補對稱驗證）、可接受不修 1、風格不修 1。
- 批 2（週幾/時段）：⚠️ 4、💡 2、❓ 3；判真已修 1（**「下週三」誤判為「週三」，本輪最重要的修正**）、可接受不修 2、已回答/不適用 3、已知範圍外限制 1（多個星期幾同時出現時只驗第一個，需要 schema 結構化標記才能做到，屬更大工程，peanut 未選用）。
- 批 3（Hotfix：429 限速回歸）：⚠️ 3、💡 2、❓ 1；判真已修 2（消耗 429 body、註解改寫成純 WHY）、查證後維持設計 1（反應式重試優於 pre-sleep）、已回答 1（確認無 Retry-After header 可用）。

## Known issues / 已知限制（不阻擋，已記錄）

1. **AeroDataBox 對遠期未來日期無出發時刻資料**：屬資料源限制，非程式問題，已用錯誤訊息引導使用者改手動輸入。
2. **`extractTimeOfDaySignal` 是子字串匹配**：「不要早上」這種否定語句會被誤判成有時段要求，最壞後果是多一次重試，不會產生錯誤但顯示為「已驗證通過」的結果。
3. **`extractWeekdaySignal` 只認第一個星期幾**：「週三去 A、週五去 B」這種多重星期幾，只有第一個會被結構化驗證，其餘靠 prompt 軟性引導。
4. 兩個修正都建立在稍早那輪（`feat/three-fixes`）新增的 `lib/trip-days.ts` 機制之上，共用同一個重試迴圈與 correction 機制。

5. **429 重試路徑沒有自動化測試**：專案沒有 fetch mock 慣例（既有慣例只測純函式），這條路徑靠這次上線後的實際故障 + 正式站金鑰手動重現來驗證，沒有回歸測試防護。若日後 `queryByRole` 再改動，建議手動用同樣手法（連續 curl 兩次同一 key）驗證限速路徑沒被破壞。

## 部署

批 1、2 已於 2026-07-11 部署一次；批 3（hotfix）修正後 typecheck/test(155)/lint/build 全綠，準備推送。**依鐵律停止於此，等待 peanut 確認要不要現在部署 hotfix。**
