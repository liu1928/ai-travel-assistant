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

---

# REPORT 2026-07-21：Schedule Anchoring（地基，`specs/schedule-anchoring.md`）

引用審查：task/REVIEW.md **2026-07-21（Schedule Anchoring）**。

## 背景

`/api/trip/generate` 的 Routes 估車程迴圈本已逐 stop 解析出座標（收藏對映 or `resolveCoordinates`），但解析結果用完即丟；`body.startDate` 也只用於天氣/假日查詢，沒存進 trip。這是 2026-07-21 定案的 8 份延伸功能 spec 裡的共用地基——`opening-hours`、`map-view`、`day-regenerate`、`export-offline`、`trip-day-mode` 五份下游功能都需要行程項目帶 `placeId`/`lat`/`lng` 才能運作，本輪把「已經算出但沒存」的資料存下來，零額外 API 成本。

## 做了什麼

1. **`schema/trip.ts`**：把 `tripSchema.days` 原本內嵌的「day 編號從 1 開始連續」`superRefine` 抽成共用泛型 helper `consecutiveDaysArray`，避免 `tripWithBookingsSchema` 用 `.extend()` 覆寫 `days` 時遺失這個檢查。新增 `savedScheduleItemSchema`（`scheduleItemSchema` 的 server 附掛超集，加 `placeId`/`lat`/`lng`/`openingWarning`，全 optional）與 `savedTripDaySchema`；`tripWithBookingsSchema` 改用 `consecutiveDaysArray(savedTripDaySchema)` 並新增 `startDate`（optional，YYYY-MM-DD）。⚠️ 這些欄位刻意不進 `scheduleItemSchema`/`tripSchema`（AI structured output），否則模型會編造 placeId/座標/出發日。
2. **`app/api/trip/generate/route.ts`**：Routes 迴圈原本「任一 stop 定位失敗就整天放棄」的邏輯拿掉 `break`，改成逐 stop 都嘗試寫回 `placeId`（收藏對映命中）或 `lat`/`lng`（`resolveCoordinates` 命中）；是否跳過車程估計仍看 `allResolved`，但寫回動作與此解耦——已解析成功的 stop 不因同一天其他 stop 失敗而被漏記。回傳 payload 加 `startDate: body.startDate`。
3. **前端 type 複本同步**：`app/trips/[id]/page.tsx`、`app/trip/page.tsx` 的本地 `ScheduleItem`/`SavedTrip`/`Trip` type 補上新欄位（維持既有「各自手刻」慣例，未改抽共用型別——範圍外）。確認編輯儲存路徑（`attachDurations`/`saveEdit` 的 `{...item}` 展開、`saveBookings` 的 `{...gen.trip}` 整包回存）都會原樣帶過新欄位，不需額外改動。

## 改動檔案

| 檔案 | 變更 |
|---|---|
| `schema/trip.ts` | 抽 `consecutiveDaysArray` helper；新增 `savedScheduleItemSchema`/`savedTripDaySchema`；`tripWithBookingsSchema` 覆寫 days + 加 `startDate` |
| `app/api/trip/generate/route.ts` | Routes 迴圈寫回 placeId/lat/lng（與整天跳過估計解耦）；payload 加 `startDate` |
| `app/trip/page.tsx` | `ScheduleItem`/`Trip` 本地 type 加新欄位 |
| `app/trips/[id]/page.tsx` | `ScheduleItem`/`SavedTrip` 本地 type 加新欄位 |
| `schema/__tests__/trip.test.ts` | 新增 8 條：savedScheduleItemSchema 驗證（合法/超界座標/舊資料相容）、startDate 驗證、AI 輸出 schema 鐵律測試 |

## 測試結果

- `pnpm typecheck`：過
- `pnpm test`：**14 files / 177 tests 全過**（本輪新增 8；另確認既有 `lib/__tests__/trip-schema.test.ts` 的「tripWithBookingsSchema 繼承 day 連續性約束」6 條在 helper 抽出後依然全過，未迴歸）
- `pnpm lint`：過
- `pnpm build`：過

## GLM review 統計（詳 task/REVIEW.md 2026-07-21）

⚠️ **本輪 GLM 全數不可用**：4 次呼叫（含 1 次完整 diff、3 次縮小 payload）全部失敗——2 次 504、2 次回傳被 harness 壓縮成無法展開的內容參考（最小已縮到 1.5KB 仍一樣），沒有任何一則取得可讀全文。比 2026-07-20 那輪（至少 1 則可讀）更嚴重。已改用「聚焦小批＋主線獨立驗證」流程處理最高風險的 3 個設計點：

1. `filter()` 結果與原陣列共用物件參照（write-back 設計的前提）——**寫獨立重現腳本實測**（非猜測），確認 mutate 有效反映回 `day.schedule`。
2. `as SavedScheduleItem[]` 型別放寬安全性——確認 `ScheduleItem` 結構性滿足 `SavedScheduleItem` 超集（缺的都是 optional），`pnpm typecheck` 全綠佐證。
3. `tripWithBookingsSchema` 抽 helper 後是否仍保有 day 連續性檢查——既有回歸測試（非本輪新寫）驗證通過，非新增測試自證。

真 P0/P1：0（自驗，非 GLM 確認）。無 GLM 提出的 finding 可仲裁。

## Known issues / 已知取捨（不阻擋）

1. **GLM review 工具本輪完全失效**：連續第二輪出現同類問題（2026-07-20 尚有 1 則可讀，本輪 0 則），建議 peanut 找時間檢查 `glm-reviewer-mcp` 後端狀態或額度，長期若持續失效需要考慮備援審查路徑。
2. **`resolveCoordinates` 模糊比對準確度**：既有限制，本 spec 刻意不解（同名地點可能綁錯座標），已在 spec 記錄。
3. **`openingWarning` 欄位目前只留位置未寫入**：寫入邏輯屬 `specs/opening-hours.md` 範圍，本輪不做。
4. **下游 UI 呈現未做**：`placeId`/`lat`/`lng`/`startDate` 目前只落地不顯示，地圖/公休警示等 UI 由各自下游 spec（`map-view`/`opening-hours`/`day-regenerate`/`export-offline`/`trip-day-mode`）負責。

## 部署

改動在本機工作樹，**未 commit / 未部署**。依鐵律停止於此，等 peanut 驗收後再決定 commit + push（Firebase App Hosting 自動部署）。人工實測基準（待部署後跑）：①生成一筆勾選收藏地點的新行程 → Firestore doc 的 schedule item 帶 `placeId`/`lat`/`lng`、trip 帶 `startDate`；②讀取一筆舊行程（無新欄位）→ 頁面正常渲染不炸驗證。

---

# REPORT 2026-07-21（二）：Place Freshness（`specs/place-freshness.md`）

引用審查：task/REVIEW.md **2026-07-21（二）（Place Freshness）**。

## 背景

Google Maps 收藏放久了會有店家歇業，AI 生成行程不知道會把歇業店排進去。本輪用 Places Details 的 `businessStatus`（Pro SKU，$17/1K，免費 5,000 次/月）掃描收藏、標記歇業，生成時自動排除。這是 8 份延伸功能 spec 的第二份，選在 `opening-hours` 之前做，用便宜情境先驗證「Details GET + TTL 快取 + 配額」這套模式。

## 做了什麼

1. **`schema/place.ts`**：`savedPlaceSchema` 加 `businessStatus`（`OPERATIONAL`/`CLOSED_TEMPORARILY`/`CLOSED_PERMANENTLY`/`NOT_FOUND`，全 optional）與 `statusCheckedAt`（epoch ms，optional）。
2. **`lib/place-status.ts`（新）**：`fetchBusinessStatus(placeId)` 呼叫 Places Details（`X-Goog-FieldMask: id,businessStatus`），抽出純函式 `classifyStatus(httpStatus, body)` 負責分類邏輯（供單測）；404 或 body 缺欄位/`UNSPECIFIED` 都有明確對應。
3. **`lib/collection.ts`**：新增 `updatePlaceStatus`，比照既有 `updateTags` 寫回 Firestore。
4. **`app/api/collection/refresh-status/route.ts`（新）**：篩選 `statusCheckedAt` 缺席或超過 TTL（預設 7 天，`STATUS_TTL_DAYS` 可調）的地點，最舊優先，取前 `REFRESH_STATUS_CAP`（預設 50）筆；0 筆時直接回不扣配額；否則 `checkAndConsume` 預扣 `批次筆數 × $0.017`，`mapLimit(4)` 併發抓取並寫回。
5. **`lib/quotas.ts`**：登記 `places_status: 0.017`。
6. **`app/page.tsx`**：收藏區標題列加「檢查歇業狀態」按鈕（沿用既有批次重新標籤的狀態機款式）；地點名稱旁加紅（已歇業）/黃（暫停營業）徽章。
7. **`app/api/trip/generate/route.ts`**：勾選的收藏地點在送進生成前過濾掉 `CLOSED_PERMANENTLY`/`NOT_FOUND`，有剔除時 `insights` 附加「已自動排除歇業地點：X、Y」。
8. **`lib/anthropic.ts`**（spec 檔案表外，技術必要，PLAN 已先說明）：`buildUserMessage` 组地點清單時，`CLOSED_TEMPORARILY` 的地點行尾加「（暫停營業中，避免排入或提醒使用者確認）」。

## 改動檔案

| 檔案 | 變更 |
|---|---|
| `schema/place.ts` | 加 `businessStatus`/`statusCheckedAt`（全 optional） |
| `lib/place-status.ts`（新） | `fetchBusinessStatus` + 純函式 `classifyStatus` |
| `lib/collection.ts` | 新增 `updatePlaceStatus` |
| `app/api/collection/refresh-status/route.ts`（新） | 批次掃描端點（TTL+cap+配額+併發） |
| `lib/quotas.ts` | 登記 `places_status: 0.017` |
| `app/page.tsx` | 「檢查歇業狀態」按鈕 + PlaceCard 紅/黃徽章 |
| `app/api/trip/generate/route.ts` | 生成前過濾歇業地點 + insights 註記 |
| `lib/anthropic.ts` | `buildUserMessage` 暫停營業提示語 |
| `lib/__tests__/place-status.test.ts`（新） | `classifyStatus` 9 條：404/缺欄位/UNSPECIFIED/OPERATIONAL/CLOSED_*/非2xx |

## 測試結果

- `pnpm typecheck`：過
- `pnpm test`：**15 files / 185 tests 全過**（本輪新增 8）
- `pnpm lint`：過
- `pnpm build`：過（`/api/collection/refresh-status` 正確註冊）

## GLM review 統計（詳 task/REVIEW.md 2026-07-21（二））

本輪工具恢復正常，取得完整可讀審查（對比上一輪 schedule-anchoring 全滅）。🐛 2、⚠️ 3、💡 2、❓ 3。仲裁：
- **假 2**：「`trip.insights.push` 沒效果」——GLM 未見完整上下文的誤判，實測 grep 驗證 `trip` 是一般可變物件且既有 Routes insights push 是完全相同模式；「失敗呼叫沒退款」——專案所有付費服務皆「呼叫前預扣、不論成敗」的既定護欄哲學，非本次引入。
- **真但不修 2**：浮點精度誤差（現況全域行為，量級對美元預算無感知）；404 以外錯誤碼可能誤判成 `failed` 而非 `NOT_FOUND`（spec 只定義 404，照 spec 實作，降級到下次 TTL 重試，非資料錯誤）。
- **假（Result pattern 保證）1**：mapLimit 計數器 race——`fetchBusinessStatus`/`updatePlaceStatus` 皆整體包 try/catch、不 rethrow，符合專案 Result pattern 慣例，GLM 假設的漏算情境不會發生。
- **採納已修 1**：統一 `classifyStatus` 判斷來源，拿掉 `fetchBusinessStatus` 內的 404 特判分支，改一律讀 body 交給 `classifyStatus` 統一判斷；typecheck/test（185/185）重跑確認無迴歸。
- **不修 1**：雙重 filter 合併——資料量級可忽略，現況更易讀。

## Known issues / 已知取捨（不阻擋）

1. **`classifyStatus` 只精確處理 404**：Google 若對無效 place ID 回其他 4xx（400/403），會落在 `failed` 而非 `NOT_FOUND`，下次 TTL 到期會再重試；spec §1.2 本就只定義 404 這一種特例。
2. **成本護欄呼叫前預扣、失敗不退款**：跟專案其他所有付費服務（`trip_generate`/`flight_lookup`/`tagging_batch`）一致的既有哲學，非本次引入的新問題。
3. **人工實測缺口**：沒有真實已知歇業的 place ID 可測，只驗證了「正常營業」與單元測試覆蓋的分類邏輯；`CLOSED_PERMANENTLY`/`NOT_FOUND` 的端對端排除路徑（含生成排除、UI 紅色徽章）需要 peanut 部署後提供一個真實案例驗證。
4. **`fetchBusinessStatus`/route.ts 批次流程沒有自動化整合測試**：跟 aerodatabox 429 重試路徑同類已知缺口（本專案無 fetch mock 慣例），只靠 `classifyStatus` 純函式單測 + 型別系統把關。

## 部署

改動在本機工作樹，**未 commit / 未部署**。依鐵律停止於此，等 peanut 驗收後再決定 commit + push。人工實測基準（待部署後跑，需真實歇業 place）：①按「檢查歇業狀態」→ place doc 出現 `businessStatus`/`statusCheckedAt`，已知歇業店標紅徽章；②立刻再按一次 → `scanned:0`，配額不增加（TTL 生效）；③收藏含歇業店生成行程 → 該店不出現，insights 有排除說明；④未登入打 API → 401。

---

# REPORT 2026-07-21（三）：Opening Hours（`specs/opening-hours.md`）

引用審查：task/REVIEW.md **2026-07-21（三）（Opening Hours）**。

## 背景

AI 排行程完全不看營業時間，最常見翻車就是把餐廳排在公休日、景點排在打烊後。本輪做雙保險：生成前把收藏地點的每週營業時間 + 各天對應星期幾餵進 prompt 讓模型主動避開；生成後對可錨定 placeId 的排程項目做程式驗證，寫入 `openingWarning` 供 UI 標警示。這是 8 份延伸功能 spec 第三份，依賴 schedule-anchoring（`openingWarning` 欄位/placeId 錨定）與 place-freshness（businessStatus 免費順帶），兩者皆已 commit。

## 做了什麼

1. **`schema/place.ts`**：`savedPlaceSchema` 加 `openingHours`（`Record<"0"~"6", string|null>` 壓縮格式）與 `openingHoursCheckedAt`（全 optional）。
2. **`lib/opening-hours.ts`（新）**：
   - `compressOpeningHours`：Google `regularOpeningHours.periods[]` → per-weekday 字串；全週 24h 特例（經 Context7 查證 Google 官方文件的表示法：單一 period、`open={day:0,hour:0,minute:0}`、無 `close`）、跨午夜歸屬 open 那天、缺 close 防禦性視為當天 24h（並修過一個邊界：同一天若先出現缺 close 片段又有正常時段，不會混成髒資料）。
   - `formatOpeningHoursSummary`：壓縮映射轉人類可讀摘要（相鄰同值星期幾合併），供 prompt 注入。
   - `fetchOpeningHours`：GET Details `id,regularOpeningHours,businessStatus`；businessStatus 分類**重用上一輪 `lib/place-status.ts` 的 `classifyStatus`**（不重寫）；`regularOpeningHours` 欄位整個缺席時 `openingHours` 回 `undefined`（不當「全公休」，避免誤標每個排程）。
   - `ensureOpeningHours`：TTL（7 天）+ cap（20 筆）+ `checkAndConsume` 配額 + `mapLimit(4)` 併發，best-effort（任何步驟失敗回傳原陣列，不阻擋生成）。
   - `checkScheduleAgainstHours`：生成後驗證 `time`+`durationMin` 是否落在營業時間內，含跨午夜範圍展開比對。
3. **`lib/trip-days.ts`**：新增 `weekdayForDay(startDate, day)`，換算 day N 對應星期幾。
4. **`lib/collection.ts`**：新增 `updateOpeningHours`，一次 Firestore `update()` 寫回，businessStatus 有值才順帶更新（免費 SKU 搭車）。
5. **`lib/quotas.ts`**：登記 `opening_hours: 0.02`。
6. **`lib/anthropic.ts`**：`buildUserMessage` 地點行加營業時間摘要；`startDate` 有效且有地點附帶營業時間資料時，附加「各天對應星期幾」表 + 避開公休硬指令（皆只在 `startDate` 有效時注入，無錨點整個功能靜默降級）。
7. **`app/api/trip/generate/route.ts`**：`body.startDate` 存在時生成前呼叫 `ensureOpeningHours` 補強；既有 Routes 錨定迴圈內，`known` 命中時額外算出該天星期幾、呼叫 `checkScheduleAgainstHours`，有警示寫入 `stop.openingWarning`。
8. **前端**：`app/trips/[id]/page.tsx`、`app/trip/page.tsx` 的 schedule item 卡片，`openingWarning` 存在時顯示「⚠️ {警示文字}」。

## 改動檔案

| 檔案 | 變更 |
|---|---|
| `schema/place.ts` | 加 `openingHours`/`openingHoursCheckedAt`（全 optional） |
| `lib/opening-hours.ts`（新） | 5 個函式：compressOpeningHours/formatOpeningHoursSummary/fetchOpeningHours/ensureOpeningHours/checkScheduleAgainstHours |
| `lib/trip-days.ts` | 新增 `weekdayForDay` |
| `lib/collection.ts` | 新增 `updateOpeningHours` |
| `lib/quotas.ts` | 登記 `opening_hours: 0.02` |
| `lib/anthropic.ts` | `buildUserMessage` 營業時間摘要 + 星期幾表 + 避開公休指令 |
| `app/api/trip/generate/route.ts` | 生成前補強（gate 在 startDate）+ 生成後驗證寫 `openingWarning` |
| `app/trips/[id]/page.tsx`、`app/trip/page.tsx` | ⚠️ 公休/非營業警示 |
| `lib/__tests__/opening-hours.test.ts`（新） | 27 條：compressOpeningHours（24h/跨午夜/多時段/防禦邊界）、formatOpeningHoursSummary、checkScheduleAgainstHours |
| `lib/__tests__/trip-days.test.ts` | 新增 4 條：weekdayForDay |

## 測試結果

- `pnpm typecheck`：過
- `pnpm test`：**16 files / 212 tests 全過**（本輪新增 30，含自我審查追加的 1 條防禦性測試）
- `pnpm lint`：過
- `pnpm build`：過

## GLM review 統計（詳 task/REVIEW.md 2026-07-21（三））

⚠️ **本輪 GLM 又全滅**：3 次呼叫（完整 diff、聚焦片段、最小化到 20 行）全部回傳被 harness 壓縮成無法展開的內容——這次連 20 行的最小片段都被壓縮，證明「縮小 payload」不是穩定有效的變通法（上一輪 place-freshness 才剛正常過）。已切自我驗證，針對送審時列出的 4 個最高風險點：
1. **跨午夜時間比對正確性**：獨立 node 腳本驗證 6 種案例（正常命中/退化 close===open/超時擋下/開始前擋下/邊界剛好卡到打烊），全部符合預期。
2. **「缺 close 防禦分支」邊界**：自我審查時額外發現一個真實問題——同一天若先出現缺 close 的 period、後面又有正常時段，會混成語意不明的髒資料。**已修**（加一行提前跳過判斷）+ 補測試釘住。雖然此情境依 Google 官方文件不會在真實資料出現（只有全週 24h 特例才缺 close，且已提早 return），仍屬零成本的防禦硬化。
3. **ensureOpeningHours best-effort 降級是否漏資料**：讀原始碼確認不會——配額失敗整批延後（下次 TTL 到期再試）、單一地點抓取失敗不影響其他地點（`mapLimit` 逐項獨立，跟上一輪 `place-status.ts` 驗證過的 Result pattern 保證一致）。
4. **`ensureOpeningHours` 只在 `body.startDate` 存在時呼叫**：這是 task/PLAN.md 已記錄並經 peanut 核准的設計取捨，非本輪臨時決定。

## Known issues / 已知取捨（不阻擋）

1. **GLM review 工具可靠性持續不穩**：同一天內三輪任務出現「全滅→成功→全滅」，且這次確認「縮小 payload」不是穩定解法。已更新跨 session 記憶 `glm-review-tool-issues`，建議 peanut 若這個模式持續發生，中長期評估是否需要換審查後端（目前資料量還不足以下定論）。
2. **跨天的跨午夜營業時段延伸判斷不做**：spec 已知限制——只認「開始那天」的時段，不處理「前一天營業延伸到隔天凌晨」的反向情形。
3. **`currentOpeningHours` 例外日/特殊假日營業時間不做**：只用 `regularOpeningHours` 常規時間，spec 範圍外。
4. **AI 自創（非收藏）地點不驗證**：無 placeId 可錨定，降級不驗。
5. **人工實測缺口**：沒有真實已知公休店家 + 對應公休日的 startDate 可測，只驗證了單元測試覆蓋的邏輯層；端對端「公休店被排入且卡片顯示警示」路徑需 peanut 部署後提供真實案例驗證。
6. **`ensureOpeningHours`/`fetchOpeningHours` 沒有自動化整合測試**：跟 place-status/aerodatabox 429 同類已知缺口（本專案無 fetch mock 慣例），只靠純函式單測 + 型別系統把關。

## 部署

改動在本機工作樹，**未 commit / 未部署**。依鐵律停止於此，等 peanut 驗收後再決定 commit + push。人工實測基準（待部署後跑，需真實已知週間公休店 + 該天落在公休日的 startDate）：①勾一家已知公休店讓某天落在公休日 → 該店不排該天或卡片出現「⚠️ 當日公休」；②同地點 7 天內第二次生成 → Enterprise 呼叫數 0；③不填 startDate → 行為與現在完全一致。
