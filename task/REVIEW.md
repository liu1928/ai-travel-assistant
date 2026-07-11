# REVIEW — GLM-5.2 異質審查（JX302 查無航班 / 行程對不上週幾與時段）

> 時間戳：2026-07-11 18:15–18:33（Asia/Taipei）；兩批 diff 各審一輪
> 審查範圍：修正 JX302 查無航班（lib/aerodatabox.ts 等）/ 修正生成行程對不上使用者提到的週幾與時段
> （lib/trip-days.ts、lib/anthropic.ts、app/trip/page.tsx 等）；diff 見 task/diff-jx302.patch、task/diff-weekday.patch
> 審查者：GLM-5.2（MCP `glm-reviewer.review_code`）。以下回傳內容**原封不動**，仲裁標註接在各批之後。

---

## 批 1（JX302：lib/aerodatabox.ts、app/api/flight/lookup/route.ts + 測試）

### 🐛 問題點
無。邏輯修正與 fallback 機制正確，紅眼班防護與 `predictedTime` fallback 邏輯一致。

### ⚠️ 風險

1. **`predictedTime` 的延遲資料可能導致查詢未來日期航班失敗**：
   `predictedTime` 通常用於「即時追蹤」的航班（例如今天或快起飛的航班），它會反映「延遲」或「提早」的狀態。如果使用者查詢一個未來日期（例如下個月），且該航班不知為何進入了即時追蹤並帶有 `predictedTime`，`endpointDateTime` 會優先採用 `predictedTime`。這會導致取到的 `dataDate` 變成延遲後的日期，進而在 `picked.dataDate !== date` 的驗證中被剔除，最終回傳 `not_found`。這在 `Departure` 查詢路徑（沒有日期驗證）尤其危險，可能撈錯日期的航班。

2. **API 呼叫次數倍增**：
   對於所有在 `Departure` 查無資料的請求，現在都會無條件 retry `Arrival`。如果資料源對於「過去日期」或「不存在的航班」常態性回傳 204，這會讓 API 請求量翻倍，可能觸發 Rate Limit 或增加延遲。

### 💡 建議

1. **加入註解或防呆機制處理 `predictedTime` 延遲問題**：
   在 `endpointDateTime` 中，如果 `scheduledTime` 存在但 `predictedTime` 也有值，目前的程式碼會優先採用 `scheduledTime`（因為 `??` 的特性），這在 `pickFlight` 內部是正確的。但若要避免上述風險 1，建議在 `pickFlight` 或 `lookupFlight` 中明確定義：只要 `scheduledTime` 存在，就忽略 `predictedTime` 的時間偏移，或者確保 `dataDate` 的計算永遠基於 `scheduledTime`。

2. **錯誤訊息格式化**：
   `route.ts` 中的錯誤訊息「查無此航班（該日期可能沒有班次，或資料源尚未收錄此航線排班——可改用下方欄位手動輸入）」有點冗長。可以考慮將「可改用下方欄位手動輸入」這種 UI 提示留給前端處理，API 純粹回傳原因即可。

### ❓ 待釐清問題

1. 為什麼在 `Departure` 查詢路徑（`primary.kind === "rows"`）中，拿到 `picked` 後沒有進行 `picked.dataDate !== date` 的驗證？雖然 `Departure` 角色理論上 API 已經幫忙過濾了日期，但既然你對 `Arrival` fallback 的結果不信任（需要驗證 `dataDate`），為什麼對 `Departure` 的結果完全信任？是否有信心保證 `Departure` 角色回傳的航班，其 `scheduledTime` 或 `predictedTime` 的日期一定等於請求的 `date`？

### ✅ 批 1 仲裁

| # | 判定 | 處置 |
|---|---|---|
| ⚠️-1 / ❓-1 predictedTime 延遲、Departure 路徑無驗證 | **真，已修** | 對稱補上：Departure 路徑拿到 `picked` 後也驗證 `picked.dataDate === date`，跟 Arrival fallback 路徑一致。GLM 這條的具體機制描述（scheduledTime 存在時 predictedTime 被忽略）本身沒錯，但點出「兩條路徑標準不一致」是真問題——已用同一個 `??` fallback 語意驗證，兩邊現在都保證回傳的日期精確等於請求日期。 |
| ⚠️-2 API 呼叫次數倍增 | 真但可接受，不修（P2） | 單次使用者點擊最多 2 次循序呼叫，遠低於 BASIC 方案 1 req/s 限速；個人專案月用量遠低於 300 次額度。 |
| 建議-2 錯誤訊息拆到前端 | 風格偏好，不修 | 現有訊息一次講清楚原因與下一步，前端目前是原樣顯示 API 訊息，拆分不會改變使用者看到的內容，只是搬動程式碼位置。 |

---

## 批 2（週幾/時段：lib/trip-days.ts、lib/anthropic.ts、app/trip/page.tsx + 測試）

> 註：GLM 這次回傳內容重複三次（同一份意見的模型輸出異常，非我方問題），以下取其中一份完整版本，內容與另外兩份一致。

### 🐛 問題點

無。沒有會導致立即執行失敗的語法或型別錯誤。

### ⚠️ 風險

1. **`expectedDayForWeekday` 在跨週行程時會算出錯誤的天數**：
   假設出發日是週一，使用者說「下週三去 A」。`extractWeekdaySignal` 抓到「週三」，`expectedDayForWeekday` 算出 `diff = 2`，回傳 `day 3`。但使用者要的是 `day 10`。系統會驗證 `day 3` 有沒有該行程，如果 AI 剛好在 `day 3` 排了行程，驗證就 pass 了。使用者拿到一個完全錯在週期的行程，且系統背書過。註解寫「不處理這週/下週的相對修飾詞（範圍外）」，但這不是「不處理」，而是「錯誤處理」。如果無法處理相對修飾詞，`extractWeekdaySignal` 應該在偵測到「下週」時直接回傳 `undefined`，而不是抓出「週三」然後算錯天數。

2. **`extractTimeOfDaySignal` 的 `includes` 匹配過於寬鬆**：
   `text.includes(kw)` 會導致誤判。例如「我不要在早上的時候去」，會被判定為包含「早上」。這會讓 `checkWeekdayTimeSignal` 去驗證一個使用者根本沒強制要求的時段，增加無謂的 retry 機率，甚至可能導致 AI 為了符合錯誤的驗證而把行程挪到早上。

3. **`WEEKDAY_RE` 正則表達式未處理「這週」、「下週」等修飾詞**：（與風險 1 同一問題的另一角度描述，見上）

4. **前端擋下機制的 UX 缺陷**：
   如果使用者輸入「我不要週末去」，雖然「週末」不會命中，但「不要週六」會命中並被擋下。使用者明明是「排除」條件，卻被系統強迫填日期才能生成，這在產品邏輯上不太合理。

### 💡 建議

1. **`extractTimeOfDaySignal` 應使用正則表達式加上邊界**：避免子字串誤判，例如 `/(凌晨|早上|上午|中午|下午|晚上|深夜)/`。雖然這仍無法解決「不要早上」的語意問題，但至少能避免「早上的時候」這種無意義命中。

2. **`checkWeekdayTimeSignal` 的錯誤訊息可以更具體**：如果 `days` 根本不是連續編號（例如 `[1, 2, 4, 5]`），`days.length` 會是 4，訊息會說「只有 4 天」，但實際上是缺少第 3 天。建議訊息直接點名缺少的 day 編號。

### ❓ 待釐清問題

1. **`timeToMin` 的實作細節為何？** 它如何處理 `HH:MM` 格式以外的字串？如果 AI 回傳 `09:00 AM` 或 `0900`，它會回傳 `undefined` 還是拋錯？這直接影響 `checkWeekdayTimeSignal` 的可靠性。

2. **為什麼 `extractWeekdaySignal` 只抓第一個命中？** 註解寫「多個不同星期幾同時出現是罕見輸入，不特別處理」。但在多日行程規劃中，「週三去 A，週五去 B」非常常見。目前的設計等於完全放棄了對第二個星期幾的驗證，這與「修正行程對不上使用者提到的週幾」的目標似乎背道而馳。是否有計畫在後續補上？

3. **「下週三」這種相對日期的處理，真的可以當作範圍外嗎？** 如果系統會把「下週三」算成「這週三」並通過驗證，這不是一個 silent failure 嗎？

### ✅ 批 2 仲裁

| # | 判定 | 處置 |
|---|---|---|
| ⚠️-1/3/❓-3 「下週三」被誤算成「週三」，驗證會誤判通過 | **真，且是這批裡最嚴重的一條，已修** | 這正是我在 checkWeekdayTimeSignal 註解裡寫的原則（「沒有錨點就不驗，寧可不驗也不要用錯誤的猜測」）被自己違反的案例——之前沒把「下」這個修飾詞納入考量，等於用錯誤錨點驗證，比不驗更糟（給使用者錯誤的信心）。修法：`WEEKDAY_RE` 加吃 `(下下\|下)?` 前綴，`extractWeekdaySignal` 回傳型別改成 `{ weekday, weekOffset }`，`expectedDayForWeekday` 加 `weekOffset` 參數（`* 7` 天），呼叫端同步更新。新增 4 條測試涵蓋「下週三」「下星期三」「下禮拜三」「下下週三」。 |
| ⚠️-2 includes 子字串誤判（「不要早上」被當成要早上） | 真但影響輕微，不修（P2） | 最壞後果是多一次 correction retry（機制本來就有），不會產生「錯誤但背書」的結果（跟上一條性質不同——這條頂多讓 AI 多被要求一次「早上排點東西」，不會讓錯誤答案被判定通過）。真要處理需要否定詞偵測，對個人使用的行程規劃工具不成比例。 |
| ⚠️-4 「不要週六」被誤判成請求週六、擋下要求填日期 | 真但影響輕微，不修（P2） | 使用者只是多填一個日期欄位就能繼續，不是被永久卡住；否定語意偵測同上，不成比例。 |
| 建議-1 extractTimeOfDaySignal 改用 regex | 已是等價實作 | 目前用 `Object.keys().find(text.includes)`，跟建議的 regex `/(凌晨|早上|...)/ ` 效果相同（都是子字串匹配，關鍵字彼此無重疊子字串問題），不影響其指出的「不要早上」誤判（regex 版一樣會誤判），改寫不解決問題，不改。 |
| 建議-2 錯誤訊息應點名缺的 day | 不適用（誤判的前提不成立） | 這條建立在「checkWeekdayTimeSignal 可能收到非連續 days」的假設上，但實際呼叫處（generateTrip）在呼叫 checkWeekdayTimeSignal 之前，已經先跑過 checkDayCoverage 且要求通過才會往下——到這裡的 days 保證是 1..N 連續，此情境不會發生。 |
| ❓-1 timeToMin 對非法格式的處理 | 已回答（無需改動） | `timeToMin`（lib/trip-edit.ts）用 `^(\d{1,2}):(\d{2})$` 錨點正則 + `h>23\|\|min>59` 檢查，"09:00 AM"、"0900"、"25:00" 都會回 undefined，已經是嚴謹實作，GLM 的疑慮沒有實際依據。 |
| ❓-2 只認第一個星期幾命中 | 已知限制，不修（此輪範圍外） | 這是設計時就記錄的刻意邊界（見 lib/trip-days.ts 註解與 task/MEMORY.md）：要可靠驗證「週三去 A、週五去 B」這種多錨點，需要 schema 加結構化標記欄位讓每個 schedule item 對應到 prompt 的哪一句話——這是稍早根因調查（task/PLAN.md 週幾/時段那節）列出的「選項 3：大工程」，未被使用者選用（使用者選的是「前端擋下」這個較輕量方案）。本輪只保證單一星期幾＋時段的準確度，多重星期幾維持 prompt 層軟性引導，不做結構化驗證。 |

---

## 統計

- 批 1（JX302）：⚠️ 2、💡 2、❓ 1；判真已修 1（Departure 路徑補驗證）、可接受不修 1、風格不修 1。
- 批 2（週幾/時段）：⚠️ 4（含重複描述同一問題）、💡 2、❓ 3；判真已修 1（「下週三」誤算，本輪最重要的修正）、可接受不修 2、已回答/不適用 3、已知範圍外限制 1。
- 修正後驗證：`pnpm typecheck && pnpm test && pnpm lint && pnpm build` 全綠（14 files / 155 tests，含本輪新增 22 條）。
