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

---

# REPORT 2026-07-16：單一地點分享連結解析修復

引用審查：task/REVIEW.md **2026-07-16（sharelink 座標 optional）**。

## 症狀與根因

使用者貼單一地點短連結 `maps.app.goo.gl/X3zDsKifeHWBQC9s7` 被誤報「僅支援單一地點連結」。實測展開後為 2026-07 新版格式：`/maps/place/<名稱+完整地址>/data=!4m2!3m1!1s0x<hex>:0x<hex>`——**無 !3d!4d、無 @lat,lng**。原 `extractNameAndCoords` 硬性要求座標 → null → 落入 fallback 錯誤（錯誤訊息誤導成「不支援」）。

## 改動（2 檔）

| 檔案 | 內容 |
|---|---|
| `lib/sharelink.ts` | `extractNameAndCoords` 座標改 optional（`coords: {lat,lng} | null`）並 export；`searchByNameAndCoords` 簽名改 coords 物件、`locationBias` 條件化（無座標時純文字查詢，名稱段含完整地址足以命中） |
| `lib/__tests__/sharelink.test.ts` | 新增 4 測試：精確座標、@fallback、**無座標新格式（真實案例 URL 釘住）**、無 place 段回 null |

## 測試結果

- vitest：**159/159 通過**（新增 4）
- `tsc --noEmit`：通過
- eslint：通過
- **真實 API 端對端**：案例名稱段以 searchText（無 bias）精準命中 `ChIJcep34MxZ5DQR5VjNV0a8HWg`（古宇利蝦蝦飯，沖繩）✅

## GLM finding 統計

真 P0/P1：0。P2 記錄不修：1（(0,0) fallback 與既有 fetchPlaceById 慣例一致、fieldmask 保證 location 存在）。假：1（null 防禦——完整程式碼已有 `if (nameCoords)`）。範圍外記錄:2（200m 半徑、regex 對未來格式的脆弱性）。

## 待 peanut 決定

- 改動已在本機 main 工作樹，**未 commit / 未部署**。驗收後：commit + push main → Firebase App Hosting 自動部署。
- 有座標的既有路徑行為完全未變，回歸風險低。

---

# REPORT 2026-07-16（二）：防 Google 改格式三機制

引用審查：task/REVIEW.md 2026-07-16（二）。

1. **失敗 log**：所有解析層都失敗時 `console.error` 完整 finalUrl → Cloud Logging，下次格式變化五分鐘定位。
2. **第四層保底**：從展開頁 HTML 內嵌 `["0x<CID>","名稱+地址"]` pair 抓名稱（與 URL 結構獨立來源；URL 有 CID 精確配對、配不到寧可失敗不亂抓）。og:title 方案已實測否決（server-side 只拿得到通用 "Google Maps"）。
3. **Canary**：`GET /api/canary/sharelink`——24h 快取節流，失敗回 503；由 oioi8-kernel probe（seed `atlas-canary`）連 2 次失敗 → LINE 告警。

驗證：vitest 164/164、tsc、eslint、GLM（2 修 2 假 1 P2）。kernel 側 seed 見 oioi8-kernel repo。

---

# REPORT 2026-07-20：天氣/匯率延伸功能（補完已抓卻未落地的資料）

引用審查：task/REVIEW.md **2026-07-20（天氣/匯率延伸功能）**。

## 背景

天氣（Open-Meteo，`lib/weather.ts`）與匯率（Frankfurter，`lib/currency.ts`）本已在 `/api/trip/generate` 抓好並注入 AI prompt（`lib/anthropic.ts`），但抓來的**結構化資料餵完 AI 就丟掉**：沒進 schema、沒存 Firestore、前端零顯示（此兩檔在工作樹屬未提交的進行中工作）。本輪把它補成完整、看得到、存得住、能算的功能，涵蓋使用者選定的四個方向：①行程頁顯示天氣 ②記帳頁匯率換算 ③天氣智慧 ④匯率預算智慧。

## 做了什麼

1. **資料落地（Phase 1）**：`schema/trip.ts` 的 `tripWithBookingsSchema` 加 `weather`（`z.array(dailyWeatherSchema).default([])`）與 `exchangeRate`（`exchangeRateSchema.optional()`）；**刻意不加進 `tripSchema`**（AI structured output，加了會讓模型編造）。`/api/trip/generate` 回傳附掛 weather/exchangeRate。儲存往返靠既有 `savedTripSchema = tripWithBookingsSchema.shape + …` 自動流通，舊文件靠 default 免遷移。
2. **行程頁顯示（Phase 1+3）**：`app/trips/[id]/page.tsx` 每日標題掛天氣 chip（emoji＋高低溫＋降雨；降雨 ≥5mm 加「記得帶傘」）、預算列旁匯率雙標卡（TWD↔目的地幣）、整趟打包清單（依高低溫/降雨/溫差衍生）。
3. **記帳頁換算＋超支預警（Phase 2）**：`app/trips/[id]/expenses/page.tsx` 新增「全部折合 TWD ≈ X」與對照行程 `budget.max` 的超支標紅；走新 `GET /api/rates`（`lib/currency.ts` 的 `fetchExchangeRates` 多目標）。
4. **最佳出遊日（Phase 3）**：新 `GET /api/weather/best-days` 掃未來 16 天預報，用 `scoreDayWeather`（降雨/極端溫度扣分）挑體感最好的一天；`/trip` 生成頁加按鈕，可一鍵套用為出發日期。

## 改動檔案

| 檔案 | 變更 |
|---|---|
| `schema/trip.ts` | 加 dailyWeatherSchema/exchangeRateSchema；tripWithBookingsSchema 擴充 weather/exchangeRate |
| `app/api/trip/generate/route.ts` | 回傳附掛 weather/exchangeRate（抓取邏輯本已存在） |
| `app/trips/[id]/page.tsx` | weatherEmoji/buildPackingList；逐日天氣 chip（長度守衛防位移）；預算匯率卡；打包清單 |
| `app/trips/[id]/expenses/page.tsx` | totalInTwd 換算；/api/rates + budget fetch；折合 TWD 卡＋超支預警 |
| `app/api/rates/route.ts` | 新檔：GET（需登入）回 TWD→USD/JPY/EUR 即時匯率 |
| `app/api/weather/best-days/route.ts` | 新檔：GET（需登入）16 天預報挑最佳日 |
| `app/trip/page.tsx` | Trip 型別加 weather/exchangeRate；suggestBestDay + UI |
| `lib/currency.ts` | 新增 fetchExchangeRates（多目標） |
| `lib/weather.ts` | 新增 scoreDayWeather |
| `schema/__tests__/trip.test.ts` | 新增 5 條：weather default、合法快照、負降雨/非正匯率拒絕、tripSchema 排除 |

## 測試結果

- `pnpm typecheck`：過
- `pnpm test`：**14 files / 169 tests 全過**（本輪新增 5）
- `pnpm lint`：過
- `pnpm build`：過（`/api/rates`、`/api/weather/best-days` 正確註冊）

## GLM finding 統計（詳 task/REVIEW.md 2026-07-20）

真且已修 2（`totalInTwd` 加 `|| 0` 防 NaN；行程頁天氣加 `weather.length===days.length` 守衛防編輯刪天後索引位移）、假/現況不成立 2、刻意設計 3、不修 1、已答 2。
⚠️ 工具限制：本輪 review_code 多數回傳被 harness 壓縮成無法展開的內容參考，僅一則取得可讀全文（原封收於 REVIEW.md），其餘改以聚焦小批＋主線獨立驗證處理，換算方向已自驗正確（Frankfurter `from=TWD&to=X` = 1 TWD = N X；外幣→TWD 除、TWD→外幣乘）。

## Known issues / 已知取捨（不阻擋）

1. **匯率快照 vs 即時**：行程頁預算用生成當下的 `exchangeRate` 快照（規劃基準）、記帳頁用即時 `/api/rates`（已標「僅供參考」）。兩者語意不同、可能小幅不一致，屬刻意設計。
2. **多幣別擴充未做**：記帳幣別維持 TWD/USD/JPY/EUR；擴充 `COUNTRY_TO_CURRENCY`／expense `currency` enum 屬「視需要」follow-up，未在本輪範圍。
3. **weather 城市 geocode 為 best-effort**：`/api/trip/generate` 以第一個有座標的收藏地點或 prompt 城市關鍵字定位，冷門地名可能查無 → 天氣為空（不影響行程生成）。
4. **best-days geocode 命中率**：優先用勾選收藏地點名；純一句話輸入可能 geocode 失敗 → 回「查不到」。

## 部署

改動在本機工作樹，**未 commit / 未部署**（本輪含先前未提交的 weather/currency 進行中工作）。依鐵律停止於此，等 peanut 驗收後再決定 commit + push（Firebase App Hosting 自動部署）。
