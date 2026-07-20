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

## 批 3（Hotfix：上線後實測發現的限速回歸，lib/aerodatabox.ts queryByRole 429 重試）

> 批 1 上線後 peanut 實測回報 JX302「航班查詢服務暫時無法使用」——不是批 1 修的查無資料問題，
> 是新引入的迴歸：Departure→Arrival fallback 兩次請求背靠背發生，撞上 RapidAPI BASIC 方案
> 1 req/s 限速，第二次被 429 擋下判成 api_error。用正式站金鑰實測重現後修正，見下。

### 🐛 問題點
無。邏輯正確，控制流在迴圈內必有 `return`，最後的 unreachable return 僅為滿足 TypeScript 完備性檢查，行為符合預期。

### ⚠️ 風險

1. **未讀取 429 回應的 Body**：當收到 429 時，程式碼直接 `sleep` 後 `continue`，沒有消耗掉該 `Response` 的 body。雖然在 Node.js/Next.js 環境中通常會被 GC 清理，不會造成致命的 memory leak，但這違反了 Web API 的最佳實踐。

2. **Hotfix 的適用範圍過窄（只解了表面問題）**：這個 hotfix 只在單次 `queryByRole` 內部處理 429，使用者需等待約 1.4 秒以上才能拿到資料。真正的 root cause 是「頻率超過 1 req/s」，更穩健的做法應該是在 `lookupFlight` 或更高層級控管請求的發送間隔，而不是在底層函式內遇到錯誤才睡覺。

3. **硬編碼的延遲時間**：`sleep(1100)` 是基於「BASIC 方案限速 1 req/s」硬編碼的。如果 RapidAPI 未來調整限速規則，這裡的 sleep 時間將變得不合理。且未讀取 429 回應 header 中的 `Retry-After` 欄位（如果有提供），喪失了與伺服器節流機制同步的機會。

### 💡 建議

1. **消耗 429 的 Response Body**：在 `continue` 之前把 body 讀掉，避免潛在的資源未釋放問題。
2. **註解中的日期顯得多餘**：「2026-07-11 部署後才發現...」這類註解帶有強烈的「git commit message」風格，放在程式碼行內會干擾閱讀，這些資訊應該留在 PR 描述或 commit message 中。

### ❓ 待釐清問題

1. 為什麼選擇在 `queryByRole` 內部處理 429，而不是在 `lookupFlight` 層級處理？如果在 `lookupFlight` 層級主動 `sleep(1000)` 後才發第二次請求，就可以完全避免 429 的發生，不需要重試邏輯。

### ✅ 批 3 仲裁

| # | 判定 | 處置 |
|---|---|---|
| ⚠️-1 未消耗 429 body | **真，已修** | `continue` 前加 `await res.text().catch(() => "")`。 |
| ⚠️-2 應在 lookupFlight 層級控管、不該塞進底層函式 | 設計選擇，說明後維持現狀 | 見 ❓-1 回覆：queryByRole 內部反應式重試，比呼叫端固定 pre-sleep 更省——多數情況兩次查詢根本不會撞窗口（實測時而 429、時而不會，取決於毫秒級時序），固定 pre-sleep 會讓「不會撞」的情況也白等 1 秒。 |
| ⚠️-3 硬編碼延遲、沒看 Retry-After | 部分真，已查證 | 實際打過 429 回應的完整 header 清單，**確認沒有 `Retry-After` 欄位**（RapidAPI 這層代理不帶），所以「看 header 決定等多久」這個更精確的做法在現實中不可行，固定 1100ms（略高於 1 秒視窗）是唯一可行選項。 |
| 建議-2 註解像 commit message | **真，已修** | 拿掉「2026-07-11 部署後才發現」這類事件敘事，改寫成純粹說明 WHY（限速窗口＋反應式 vs 固定延遲的取捨），符合專案一貫的註解慣例（不寫「用於哪次修復」，這類敘事會隨時間腐朽）。 |
| ❓-1 為何不在 lookupFlight 層級 pre-sleep | 已答（同 ⚠️-2 處置） | — |

---

## 統計

- 批 1（JX302）：⚠️ 2、💡 2、❓ 1；判真已修 1（Departure 路徑補驗證）、可接受不修 1、風格不修 1。
- 批 2（週幾/時段）：⚠️ 4（含重複描述同一問題）、💡 2、❓ 3；判真已修 1（「下週三」誤算，本輪最重要的修正）、可接受不修 2、已回答/不適用 3、已知範圍外限制 1。
- 批 3（Hotfix：429 限速回歸）：⚠️ 3、💡 2、❓ 1；判真已修 2（消耗 body、註解改寫）、查證後維持設計 1、已回答 1。
- 修正後驗證：`pnpm typecheck && pnpm test && pnpm lint && pnpm build` 全綠（14 files / 155 tests，含本輪新增 22 條）。

---

## 批 4（2026-07-12 JX302 未來日期查不到：lookupFlight fallback 邏輯修正）

> 時間戳：2026-07-12 20:27（Asia/Taipei）  
> 審查範圍：`lib/aerodatabox.ts` lookupFlight 4 行改動  
> Bug：Departure 返回 rows 但 pickFlight 取不到時刻時，舊程式直接回 not_found 不試 Arrival

### 🐛 問題點
無。修改邏輯正確，成功消除了提早 `return not_found` 導致無法觸發 Arrival fallback 的缺陷。

### ⚠️ 風險

1. **API 呼叫次數增加**：當 `primary.kind === "rows"` 但 `pickFlight` 失敗時，現在必定會多打一次 Arrival API，可能觸發 Rate Limit 或增加延遲。

2. **Arrival fallback 的 `dataDate` 保護**：防紅眼班的 `dataDate === date` 驗證高度依賴 `pickFlight` 正確提取 `dataDate`。若缺出發時間可能誤判。

### ❓ 待釐清問題

1. `pickFlight` 對「只有機場名、無時刻」的 rows 回傳 `undefined` 還是 `dataDate` 不符的物件？
2. Arrival fallback 下方（diff 未展示）是否有 `dataDate !== date` 的防護？

### ✅ 批 4 仲裁

| # | 判定 | 處置 |
|---|---|---|
| ⚠️-1 API 呼叫次數增加 | 可接受，不修 | 「只有機場名無時刻」僅在 JX302 類特定航班＋遠期日期才發生；一般航班 Departure 有 scheduledTime 直接回傳，不多一次 call。429 retry 已在 queryByRole 內處理。 |
| ⚠️-2 dataDate 保護 | [FALSE POSITIVE] | Arrival fallback 的 `dataDate` 保護早已存在（`lib/aerodatabox.ts:196-197`）：`if (!picked \|\| picked.dataDate !== date) return err({ kind: "not_found" })`。 |
| ❓-1 pickFlight 回傳什麼 | [ANSWERED] | 回傳 `undefined`——有單測驗證（`lib/__tests__/aerodatabox.test.ts:121-126`）。`if (picked && picked.dataDate === date)` 判斷精準。 |
| ❓-2 Arrival fallback 有無 dataDate 保護 | [ANSWERED] | 有，見 ⚠️-2 仲裁。 |

- 本批統計：0 條真實 finding，1 條 [FALSE POSITIVE]，2 條 [ANSWERED]，不修 1。
- 驗證：`pnpm typecheck` 通過，`pnpm test` 155 tests 全通過。

---

# GLM 審查 2026-07-16：單一地點分享連結解析修復（sharelink 座標 optional）

審查範圍：`lib/sharelink.ts`（extractNameAndCoords 座標改 optional、searchByNameAndCoords 條件化 locationBias）+ `lib/__tests__/sharelink.test.ts`（新增 4 測試）。focus：correctness、回歸風險。

## GLM 發現與仲裁

- 🐛1「無座標時 location fallback (0,0) 是資料污染」——**P2 記錄不修**。SEARCH_FIELD_MASK 明確要求 `places.location`，API 正常回應必帶座標（本日真實 API 呼叫證實）；且 `(0,0)` fallback 與既有 `fetchPlaceById` 的 `?? 0` 慣例一致，非本次引入。若未來要收緊，應同時改兩處與 PlaceSearchResult 型別，不在本 hotfix 範圍。
- 🐛2「parseShareLink 對 null 缺防禦會 TypeError」——**[FALSE POSITIVE]**。完整程式碼是 `const nameCoords = extractNameAndCoords(finalUrl); if (nameCoords) { ... }`，null 已被擋；GLM 只看 diff 節錄。
- ⚠️1「無座標純文字查詢可能命中遠處同名店」——**已以真實 API 端對端驗證**：實際案例 URL 的名稱段（含完整地址＋郵遞區號＋國名）`textQuery` 無 bias 精準命中正確地點（ChIJcep34MxZ5DQR5VjNV0a8HWg，沖繩古宇利島）。此路徑僅在連結本身無座標時走，而該類連結名稱段必含地址；有座標路徑完全未變（回歸安全）。接受。
- ⚠️2「200m 硬編碼半徑」——既有邏輯，非本次範圍，記錄備查。
- ⚠️3「regex 對未來 URL 格式脆弱」——既有結構性限制；本次已為 2026-07 新格式補測試釘住行為，未來格式再變時測試會先失敗。
- ❓2「是否真機驗證」——**已做**：真實 Places API searchText 呼叫成功命中（見 ⚠️1）。

## 驗證

vitest **159/159**（含新增 4 測試）✅、`tsc --noEmit` ✅、eslint ✅、真實 API 端對端 ✅。

統計：真 P0/P1 0 條、P2 記錄 1 條、假 1 條、既有範圍外 2 條。

---

# GLM 審查 2026-07-16（二）：防 Google 改格式三機制

範圍：`lib/sharelink.ts`（失敗 log finalUrl、第四層 HTML CID-pair 保底、resolveUrl 回 html）+ `app/api/canary/sharelink/route.ts`（新）。focus：correctness、security、記憶體。

## 仲裁

- 🐛1「resolveUrl 未驗 res.ok，錯誤頁 HTML 會進第四層」——**已修**：非 2xx 時 html 取空字串（URL 各層照走）。
- 🐛2「名稱含 HTML 實體/unicode escape 會截斷」——**P2 記錄不修**。Google 內嵌資料用 `&` 形態 escape，此類 pair 整個 match 不到 → 安全側失效（抓不到，不會抓錯）；第四層是保底層，接受覆蓋率取捨，不引入 JSON parse 複雜度。
- 🐛3「URL 與 HTML 的 CID 格式可能不一致」——**推測性**：實測兩處完全一致（同 hex pair），測試已釘住。記錄。
- ⚠️1「canary 無 auth 消耗 quota」——**接受**：24h 快取＋inflight 去重把成本壓到每實例生命週期最多 1 次真呼叫；高頻打只會拿快取。加 token 會讓 secret 進 kernel seed（git），不划算。
- ⚠️2「inflight race」——**[FALSE POSITIVE]**：Node 單執行緒，`if (!inflight) inflight = ...` 到 await 前是同步的，無交錯窗口（GLM 自己也判可接受）。
- ⚠️3「slice 切斷 UTF-8 產生無效序列」——**[FALSE POSITIVE]**：`res.text()` 已解碼為 JS 字串，slice 是字元截斷非位元組截斷。變數已改名 HTML_MAX_CHARS 消歧義。
- 💡2「detail 洩漏內部錯誤」——**已修**：公開回應只給粗粒度原因，詳情進 server log。
- ❓1「有 CID 配不到為何不退 first」——**刻意設計**（寧可失敗不亂抓頁面上別的地點），已加註解，測試釘住。
- ❓2「24h 快取延遲發現」——**預期設計**：目標是隔天內發現（Google 改格式是月/年級事件），不值得每 5 分鐘燒 288 次 Places 呼叫。

## 驗證

vitest **164/164**（新增 5 個 extractNameFromHtml 測試）✅、tsc ✅、eslint ✅。
統計：真且已修 2、P2 記錄 1、假 2、刻意設計/預期 3。

---

# REVIEW — GLM-5.2 異質審查（天氣/匯率延伸功能）

> 時間戳：2026-07-20（Asia/Taipei）
> 審查範圍：把已抓卻未落地的天氣（Open-Meteo）/匯率（Frankfurter）補成完整功能——
> schema/trip.ts（tripWithBookingsSchema 加 weather/exchangeRate）、app/api/trip/generate/route.ts（回傳附掛）、
> app/trips/[id]/page.tsx（逐日天氣 chip＋打包清單＋預算匯率卡）、app/trips/[id]/expenses/page.tsx（折合 TWD＋超支預警）、
> app/api/rates/route.ts、app/api/weather/best-days/route.ts、lib/currency.ts（fetchExchangeRates）、lib/weather.ts（scoreDayWeather）。
> diff 見 task/diff.patch。審查者：GLM-5.2（MCP glm-reviewer.review_code）。
>
> ⚠️ 工具限制：本輪 review_code 多次回傳被 harness 壓縮成無法展開的內容參考（`<<ccr:…>>`），
> 僅第一則「換算正確性」審查取得可讀全文，原封收錄於下。其餘面向改以聚焦小批重審＋主線獨立驗證處理，
> 仲裁與依據一併記錄。

## 可讀全文（換算方向 / schema 安全，原封收錄）

### 🐛 問題點
- **`byCurrency[c] <= 0` 會漏算金額為 0 的幣別**：若該幣別金額為 0，`continue` 跳過後並不會引發錯誤，但邏輯上應該是「有記錄但金額為 0」也要能正常累加（0 / rate = 0）。這裡勉強算對，但若未來改為處理「負數（退費）」，`<= 0` 會直接忽略退費紀錄，導致總額計算錯誤。
- **`total` 初始值未做防呆**：若 `byCurrency.TWD` 為 `undefined`（例如使用者完全沒有台幣消費），`total` 會變成 `NaN`，後續所有累加與最終回傳值皆會變成 `NaN`，前端顯示會出錯。

### ⚠️ 風險
- **缺匯率回傳 `null` 隱藏總額的 UX 爭議**：只要有一個外幣缺匯率，整個 TWD 總額直接回 `null`。較安全的做法是：缺匯率的外幣先跳過或標示 `未計入`，回傳「部分 TWD 總額 + 未換算幣別清單」，而不是全有全無。
- **`tripSchema` 不含 `exchangeRate` 的潛在覆蓋風險**：若儲存使用整份文件覆蓋，可能把 DB 中原本的 `exchangeRate`/`weather` 意外清除。需確保儲存邏輯是「合併更新」或前端回存時帶齊欄位。
- **浮點數精度問題**：`Math.round(budget.min * exchangeRate.rate)` 在極大金額或極小匯率時仍需留意顯示精度。

### 💡 建議
- 將 `let total = byCurrency.TWD;` 改為 `let total = byCurrency.TWD || 0;`，避免 `NaN` 傳播。
- 將 `if (byCurrency[c] <= 0) continue;` 改為 `if (!byCurrency[c]) continue;`，保留未來對負數（退費）的處理空間。

### ❓ 待釐清問題
- `byCurrency` 是否保證一定存在 `TWD` 屬性？
- 行程頁 `exchangeRate` 是單一匯率（生成快照），記帳頁 `rates` 是多幣別即時值——兩者基準/更新頻率不一致是否造成使用者困惑？

## 仲裁（逐條）

| 類別 | Finding | 判定 | 依據 / 處置 |
|---|---|---|---|
| 🐛 | `total = byCurrency.TWD` 可能 NaN | **真（防呆）已修** | `computeSummary` 其實一律初始化 `{TWD:0,USD:0,JPY:0,EUR:0}`，現況不會 undefined；但 `\|\| 0` 是零成本防未來形狀漂移，已採納。 |
| 🐛 | `<=0` 忽略退費（負數） | **假（現況）／記錄** | expense schema `amount` 為 `positive()`，不存在負數；退費是未來功能，屆時再處理。不改。 |
| ⚠️ | 缺匯率回 null 隱藏總額 | **刻意設計** | 各幣別分項卡仍顯示，只隱藏「折合 TWD」一行；避免顯示漏算的誤導性偏低總額。已標「僅供參考」。Frankfurter 免 Key 穩定，缺率屬 API 全掛的罕見情況。不改。 |
| ⚠️ | 整份覆蓋清掉 weather/exchangeRate | **假（已驗證安全）** | 前端 `saveEdit`/`saveBookings` 為 `{...view.trip,…}` 整包回存，view.trip 來自 GET（含 weather/exchangeRate），且本地型別已補欄位；PATCH 走 tripWithBookingsSchema（weather default []、exchangeRate optional）→ 往返不遺失。 |
| ⚠️ | 浮點精度 | **不修** | `Math.round` 已足夠，金額量級無實務風險。 |
| ❓ | byCurrency 一定有 TWD？ | **已答** | 是，`computeSummary` 固定初始化四幣別；已加 `\|\| 0` 再保險。 |
| ❓ | 行程頁快照 vs 記帳頁即時匯率不一致 | **刻意設計／已標示** | 行程頁＝生成當下快照（規劃基準），記帳頁＝即時匯率（實際花費對照，已標「依即時匯率換算，僅供參考」）。語意不同，可接受。 |

## 聚焦重審（回傳壓縮不可讀，改主線獨立驗證）

- **換算方向正確性（自驗）**：Frankfurter `from=TWD&to=JPY` 回 `rates.JPY`=「1 TWD = N JPY」。外幣→TWD 用 `amount / rate`（記帳頁）✓；TWD 預算→目的地幣 用 `budget × rate`（行程頁）✓。方向正確。
- **weather 索引位移（編輯刪天後）**：判定值得防、已修——`dayWeather` 加條件 `weather.length === days.length` 才顯示；刪天致長度不符時整體隱藏逐日天氣，避免對錯日（打包清單走整趟聚合，不受影響）。
- **best-days `forecast[0]` 初始 best**：安全，先 `if (forecast.length === 0) return` 才取 `[0]`。
- **`bestDay.best!` non-null assertion**：外層 `bestDay.best ?` 已判真，與本專案既有 `!` 用法（如 expenses `catMap.get(c.value)!`）一致，可接受。
- **`/api/rates` base 未白名單**：非法 base 時 Frankfurter 回錯 → `fetchExchangeRates` 回 `{}` → 前端不顯示換算；route 需登入。屬穩定性可接受，非安全問題。

## 驗證

tsc ✅、eslint ✅、vitest **169/169**（新增 5：weather/exchangeRate schema）✅、`next build` ✅。
統計：真且已修 2（NaN 防呆、weather 索引位移守衛）、假/現況不成立 2、刻意設計 3、不修 1、已答 2。
