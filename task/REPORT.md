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

---

# REPORT 2026-07-21（四）：Flight Day Status（`specs/flight-day-status.md`）

引用審查：task/REVIEW.md **2026-07-21（四）（Flight Day Status）**。

## 背景

行程裡已存航班班表時刻，但出發當天使用者真正想知道的是延誤了嗎、幾號登機門。AeroDataBox 同一端點在臨近日期本就會帶即時追蹤欄位，之前只解析班表欄位沒用到。本輪讓「今天有航班」時提供一鍵查即時動態，**零額外 API 成本**（同一次呼叫多解析幾個欄位，不是新打一次 API）。

## 做了什麼

1. **`lib/aerodatabox.ts`**：用真實 API 呼叫（BR198 today）核對即時追蹤欄位名稱（`status`/`departure.revisedTime`/`.terminal`/`.gate`），非憑文件猜測；`pickFlight` 從同一個已挑選的 row 多抽這幾個欄位帶入 `FlightLookupResult`（未來日期自然缺席）。新增 export `todayTaipeiDate()`、`daysDiff(a,b)`。
2. **`app/api/flight/lookup/route.ts`**：body 加 `mode?:"schedule"|"status"`（預設 `"schedule"`，零迴歸）；`mode==="status"` 時驗證 `date` 是否為「今天」（±1 天容忍時區落差），否則 400。
3. **`components/bookings.tsx`**：`BookingCards` 航班卡在 `flight.date === 今天（client 本地日）` 時顯示「查即時動態」按鈕；查詢結果含狀態、修正時刻（與原時刻不同才標紅並顯示「原→新」）、航廈/登機門；`sessionStorage` 快取（key=航班號+日期），提供手動「重新整理」。

## 改動檔案

| 檔案 | 變更 |
|---|---|
| `lib/aerodatabox.ts` | 即時欄位解析（status/revisedTime/terminal/gate）+ `todayTaipeiDate`/`daysDiff` |
| `app/api/flight/lookup/route.ts` | `mode` 參數 + 當天限定驗證 |
| `components/bookings.tsx` | `FlightStatusRow`（按鈕/查詢/session 快取/標紅修正時刻） |
| `lib/__tests__/aerodatabox.test.ts` | 新增 5 條：即時欄位解析 2 條 + `daysDiff` 邊界 3 條 |

## 測試結果

- `pnpm typecheck`：過
- `pnpm test`：**16 files / 217 tests 全過**（本輪新增 5）
- `pnpm lint`：過
- `pnpm build`：過

## GLM review 統計（詳 task/REVIEW.md 2026-07-21（四））

⚠️ **本輪 GLM 又失敗**：3 次呼叫（完整 diff、聚焦片段、最小化片段）全部失敗——2 次壓縮不可讀、1 次 504。已切自我驗證，針對送審時列出的 4 個風險點：
1. **`daysDiff` 的 UTC 午夜比較是否有時區/DST 問題**：兩端固定轉 UTC，數學上不受時區影響；獨立腳本驗證跨月/跨年/閏年邊界皆正確。
2. **`sessionStorage` 快取 key 無 uid、同分頁換帳號的資料混淆風險**：真實存在但評估可接受不修——快取內容是公開航班資訊非個人隱私，且有手動重新整理按鈕；為此加 uid 進 cache key 不成比例。
3. **`mode` 參數預設相容性**：程式邏輯保證非 `"status"` 字面值一律落回 `"schedule"`；217/217 測試全過佐證既有呼叫無迴歸。
4. **SSR/hydration mismatch 風險**：讀程式碼確認 `BookingCards` 在兩個使用頁面都被「資料非同步載入後才渲染」的閘門包住，`FlightStatusRow` 從未出現在伺服器渲染 HTML 裡，`typeof window` 防禦分支是無害的死路徑，非真實風險。

## Known issues / 已知取捨（不阻擋）

1. **`sessionStorage` 快取 key 不含 uid**：見上方自我審查第 2 點，評估風險可忽略不修。
2. **status 欄位顯示原文（Expected/EnRoute/Delayed/…），未翻譯成中文**：spec 未要求翻譯，且未收集到完整枚舉值清單，避免翻譯錯誤誤導使用者，維持原文顯示。
3. **不支援自動輪詢**：spec 明確排除，手動按鈕 + session 快取。
4. **GLM review 工具本輪再次失敗**：連續第三輪出現問題（схedule-anchoring 全滅、opening-hours 全滅、這輪又全滅，只有 place-freshness 一輪成功），已記錄在 [[glm-review-tool-issues]]，建議 peanut 持續觀察是否需要換審查後端。

## 部署

改動在本機工作樹，**未 commit / 未部署**。依鐵律停止於此，等 peanut 驗收後再決定 commit + push。人工實測基準（待部署後跑，需真實今天出發的航班）：①今天航班卡出現「查即時動態」按鈕，查詢顯示狀態；②非今天航班不出現按鈕；③既有不帶 mode 的呼叫行為不變；④同 session 重進頁不重打 API。

---

# REPORT 2026-07-21（五）：Map View（`specs/map-view.md`）

引用審查：task/REVIEW.md **2026-07-21（五）（Map View）**。

## 背景

旅遊 app 沒有地圖，收藏地點與行程路線只有文字。收藏的座標本來就齊全，行程座標由 schedule-anchoring 補上，畫出來零 API 成本（Leaflet + OSM，不碰 Google Maps JS）。

## 做了什麼

1. **套件**：`pnpm add leaflet react-leaflet`、`pnpm add -D @types/leaflet`（peer 警告確認是既有 eslint 版本落差，與本次安裝無關）。
2. **`components/collection-map.tsx`（新）**：收藏散點圖，`CircleMarker` 顏色依第一個 tag 對應 `TAG_COLOR`（色系對齊既有 `TAG_STYLE`），popup 顯示名稱/tags/地址/備註，`fitBounds`/單點 `setView`。
3. **`components/day-route-map.tsx`（新）**：單日路線圖，`divIcon` 序號 marker + `Polyline` 相連，popup 顯示時間/標題。
4. **`lib/day-map.ts`（新，spec 檔案表外的技術必要）**：`resolveDayMapItems` 純函式，座標優先序（持久化 lat/lng → 名稱對映收藏座標 → 排除），transport/rest 不計入缺座標分母。
5. **`app/page.tsx`**：dynamic import（`ssr:false`）+「清單/地圖」切換。
6. **`app/trips/[id]/page.tsx`**：dynamic import + 每天標題列「地圖」toggle；收藏座標懶載入（全頁共用一次，第一次展開任一天地圖才打 `/api/collection`）；編輯模式不顯示地圖 toggle。
7. **`lib/__tests__/day-map.test.ts`（新）**：`resolveDayMapItems` 7 條。

## 改動檔案

| 檔案 | 變更 |
|---|---|
| `package.json`/`pnpm-lock.yaml` | 加 leaflet/react-leaflet/@types/leaflet |
| `components/collection-map.tsx`（新） | 收藏散點圖 |
| `components/day-route-map.tsx`（新） | 單日路線圖 |
| `lib/day-map.ts`（新） | `resolveDayMapItems` |
| `app/page.tsx` | 清單/地圖切換 |
| `app/trips/[id]/page.tsx` | 每天地圖 toggle + 座標懶載入 |
| `lib/__tests__/day-map.test.ts`（新） | 7 條測試 |

## 測試結果

- `pnpm typecheck`：過
- `pnpm test`：**17 files / 224 tests 全過**（本輪新增 7）
- `pnpm lint`：過
- `pnpm build`：過（**spec 特別要求**：確認無 `window is not defined`，dynamic import + `ssr:false` 生效）

## GLM review 統計（詳 task/REVIEW.md 2026-07-21（五））

⚠️ **本輪 GLM 又全滅**（3 次呼叫，完整/聚焦/最小片段皆被壓縮），已切自我驗證，針對送審時列出的 4 點：
1. **`resolveDayMapItems`/`loadCollectionCoords` 用名稱對映，同名地點選錯座標**：真實存在但非本 spec 引入——跟 schedule-anchoring 那輪既有的 `placeByName` 名稱對映是同一種手法，task/SPEC.md §9 已記錄為既有已知限制，記錄不修。
2. **`FitBounds` 的 `useEffect` 依賴陣列——自我審查抓到真實 bug**：`points`/`bounds` 是父層每次 render 都重算的新陣列參照，導致無關的頁面重render 都會重跑 `fitBounds`、蓋掉使用者手動平移過的視野。**已修**：改成只在掛載時執行一次（呼應 spec「初始視野」用詞），兩個地圖元件都修（`collection-map.tsx` 雖然目前呼叫端穩定不觸發，同步防禦性修正）。
3. **`numberedIcon` 的 divIcon HTML 插值 XSS**：插入值是內部陣列索引整數，非使用者輸入；popup 走 JSX 文字節點自動跳脫。確認無風險。

## Known issues / 已知取捨（不阻擋）

1. **名稱對映同名地點風險**：見上方第 1 點，既有限制延伸，非本輪新增。
2. **路線是直線 polyline，非實際道路路徑**：spec 已明訂（Routes API 真實路徑另案，會增成本）。
3. **AI 自創地點在舊行程對映不到座標**：隨新行程（地基落地後）自然消失，spec 已知限制。
4. **GLM review 工具**：4 輪中 3 輪失敗（僅 place-freshness 成功），已持續記錄在 [[glm-review-tool-issues]]。

## 部署

改動在本機工作樹，**未 commit / 未部署**。依鐵律停止於此，等 peanut 驗收後再決定 commit + push。人工實測基準：①收藏頁切地圖，散點顏色/popup/視野涵蓋正確；②新生成行程開單日地圖，序號與時間軸一致；③舊行程能靠名稱對映上圖，其餘顯示排除筆數；④不開地圖時無 leaflet chunk/tile 請求；⑤地圖角落有 OSM attribution。

---

# REPORT 2026-07-21（六）：Day Regenerate（`specs/day-regenerate.md`）

引用審查：task/REVIEW.md **2026-07-21（六）（Day Regenerate）**。

## 背景

使用者常只是「第 3 天不喜歡」，原本只能整包重生成：貴（全趟 token）、慢、其他天好結果會被洗掉。單日重生只帶該日 context 重排一天，約 $0.03/次，整趟重生的 1/3 以下。

## 做了什麼

1. **`schema/trip.ts`**：新增 `daySchedulePayloadSchema`（AI 側，只有 schedule 不含 day 編號/錨定欄位）。
2. **`lib/trip-days.ts`**：新增 `dateForDay(startDate, day)`，UTC 午夜運算換算 day N 的實際日期。
3. **`lib/day-anchor.ts`（新）**：`anchorDaySchedule` 從既有 Routes 迴圈抽出純錨定邏輯（不含車程估計），供單日重生複用；**刻意不回頭重構主生成路徑**（風險/效益考量，見 PLAN.md 說明）。
4. **`lib/anthropic.ts`**：新增 `regenerateDay`——只回傳 schedule，context 含 trip 摘要/其他天已排地點（防重複排點）/該日現有排程/回饋/日期星期幾/天氣/當日航班住宿；`max_tokens=4096`。
5. **`lib/quotas.ts`**：登記 `day_regenerate: 0.03`。
6. **`app/api/trips/[id]/regenerate-day/route.ts`（新）**：讀 trip → day 範圍驗證 → 配額 → AI 重生 → 失敗不動 Firestore → 錨定新排程 → 替換該日整份覆寫 → 回傳更新後 trip。
7. **`app/trips/[id]/page.tsx`**：每天標題列「🔄 重排這一天」按鈕，展開回饋輸入（≤200字，可空）；loading/錯誤狀態；成功以回傳完整 trip 更新畫面。

## 改動檔案

| 檔案 | 變更 |
|---|---|
| `schema/trip.ts` | 加 `daySchedulePayloadSchema` |
| `lib/trip-days.ts` | 新增 `dateForDay` |
| `lib/day-anchor.ts`（新） | `anchorDaySchedule` |
| `lib/anthropic.ts` | 新增 `regenerateDay` + message 組裝 |
| `lib/quotas.ts` | 登記 `day_regenerate: 0.03` |
| `app/api/trips/[id]/regenerate-day/route.ts`（新） | 端點 |
| `app/trips/[id]/page.tsx` | 重排按鈕+回饋輸入+loading/錯誤 |
| `lib/__tests__/day-anchor.test.ts`（新） | 7 條 |
| `lib/__tests__/trip-days.test.ts` | 新增 `dateForDay` 5 條 |

## 測試結果

- `pnpm typecheck`：過
- `pnpm test`：**18 files / 236 tests 全過**（本輪新增 12）
- `pnpm lint`：過
- `pnpm build`：過（`/api/trips/[id]/regenerate-day` 正確註冊）

## GLM review 統計（詳 task/REVIEW.md 2026-07-21（六））

⚠️ **本輪 GLM 又全滅**（3 次呼叫皆被壓縮），已切自我驗證，針對送審時列出的 4 點：
1. **併發競態（同時重生不同天，後完成的覆蓋先完成的）**：**確認是 spec 本身已明文接受的設計**（`grep` 核對 spec §2 原文「last-write-wins 可接受，不做樂觀鎖」），非本輪需要處理的新問題。
2. **`otherDaysPlaces` 去重 key 不一致的漏防風險**：真實存在但影響輕微——只會讓清單多列一行同地點的不同寫法，不影響防重複排點的實際效果，記錄不修。
3. **`anchorDaySchedule` 對缺座標項目的降級**：跟 map-view/opening-hours 既有降級路徑完全一致，非新增風險。
4. **`checkAndConsume` 預設 cost 對應正確性**：TS 預設參數機制確認正確對應 `SERVICE_COST_USD.day_regenerate`。

## Known issues / 已知取捨（不阻擋）

1. **併發 last-write-wins**：spec 明確接受的設計，單人使用情境。
2. **`otherDaysPlaces` 同地點多種寫法未去重**：影響輕微，記錄不修。
3. **主生成路徑未重構共用 `anchorDaySchedule`**：刻意決策，避免動到已上線核心功能，兩處有小段邏輯重複。
4. **重生品質仍壓在 prompt**：無 eval harness，同整趟生成既有限制。
5. **GLM review 工具**：本輪起累計 5 輪中 4 輪失敗（僅 place-freshness 成功），持續記錄在 [[glm-review-tool-issues]]。

## 部署

改動在本機工作樹，**未 commit / 未部署**。依鐵律停止於此，等 peanut 驗收後再決定 commit + push。人工實測基準（待部署後跑）：①對 3 天行程重排第 2 天（回饋「太趕」）→ 只有該天變，其他天/title/summary/flights/weather 不動；②新第 2 天不含第 1/3 天已排地點；③連打超過 rate limit → 429；④AI 回傳不合 schema（模擬）→ Firestore 不動、前端顯示錯誤。

---

# REPORT 2026-07-21（七）：Export & Offline（`specs/export-offline.md`，a+b+c）

引用審查：task/REVIEW.md **2026-07-21（七）（Export & Offline）**（兩批，皆完整可讀）。

## 背景

行程做完只能在 app 裡看：進不了行事曆、分享不了給旅伴、出國斷網就看不到。三件事全部零外部 API、零重依賴：ICS 匯出、列印/存 PDF、PWA 離線瀏覽已開過的行程。

## 做了什麼

### a. ICS 行事曆匯出
`lib/ics.ts`（新，零依賴）純字串生成 VCALENDAR：`escapeText`/`foldLine`（依 UTF-8 位元組摺 75 bytes，不切多位元組字元）/`toIcsLocal`（floating local time，跨午夜正確進位）。flights/lodgings 各一 VEVENT；`days[].schedule[]` 只在有 `startDate` 時產生，否則附 `X-COMMENT` 說明。新 `app/api/trips/[id]/ics/route.ts` 下載端點；`app/trips/[id]/page.tsx` 加「匯出行事曆 (.ics)」按鈕（blob + object URL 觸發下載，因 GET 需帶 auth header）。

### b. 列印 / 存 PDF
`app/trips/[id]/page.tsx` 加「列印/存 PDF」按鈕（`window.print()`）；`print:hidden`（Tailwind v4 內建）套在所有互動元素（導覽、編輯/匯出/列印/刪除按鈕、地圖與重排 toggle 及展開區、導航連結、住宿建議搜尋區）；每天卡片加 `print:break-inside-avoid` 防跨頁腰斬。

### c. PWA 離線
`public/manifest.webmanifest`+`public/icon.svg`（新，見下方偏差說明）、`public/sw.js`（新，手寫最小 SW：導覽請求+靜態 assets cache-first；`/api/trips` 系列 GET network-first+cache fallback；其餘不攔截）、`components/sw-register.tsx`（新，僅 production 註冊）、`app/layout.tsx` 掛 manifest（`themeColor` 走獨立 `viewport` export，Context7 查證 Next.js 14+ 用法）。`app/trips/[id]/page.tsx` 補離線橫幅（讀取成功但 `!navigator.onLine` → 提示「可能非最新」）與離線錯誤訊息客製化。

## 改動檔案

| 檔案 | 變更 |
|---|---|
| `lib/ics.ts`（新） | ICS 生成 |
| `app/api/trips/[id]/ics/route.ts`（新） | 下載端點 |
| `public/manifest.webmanifest`（新） | PWA manifest |
| `public/icon.svg`（新） | PWA icon（SVG，見偏差說明） |
| `public/sw.js`（新） | 手寫最小 service worker |
| `components/sw-register.tsx`（新） | SW 註冊（僅 production） |
| `app/layout.tsx` | manifest metadata + viewport + 掛載 SW 註冊元件 |
| `app/trips/[id]/page.tsx` | 匯出/列印按鈕、print CSS、離線橫幅、地圖/重排/導覽等 print:hidden |
| `lib/__tests__/ics.test.ts`（新） | 10 條 |

## ⚠️ 與 spec 字面的偏差

**PWA icon 用 SVG 而非 PNG**：本環境沒有影像生成工具，手刻 PNG 二進位編碼器風險高（任一步 filter byte/CRC32 算錯就是壞圖，沒有圖檢視工具能立即發現）；改用單一可縮放 `public/icon.svg`，manifest 宣告兩個 `sizes` 條目（192x192/512x512）指向同一檔。現代瀏覽器的 PWA 安裝檢查普遍接受 SVG icon。peanut 之後可換成真正的品牌 PNG，manifest 結構不用改。

## 測試結果

- `pnpm typecheck`：過
- `pnpm test`：**19 files / 246 tests 全過**（本輪新增 10）
- `pnpm lint`：過
- `pnpm build`：過（`/api/trips/[id]/ics` 正確註冊）

## GLM review 統計（詳 task/REVIEW.md 2026-07-21（七））

✅ **本輪 GLM 工具難得兩批都完整成功**（連續前 4 輪多半失敗後的正向資料點）。批 1（`lib/ics.ts`+`public/sw.js`）：🐛3/⚠️4/💡2/❓2，真已修 3（`Date.UTC` 改顯式 `setUTCDate`、兩處 cache.put 加 catch、app shell fetch 加 catch）、假 2（`escapeText` undefined 防呆——呼叫點已guard；`isTripsApiGet` query string——`node -e` 實測 `.pathname` 本不含 query）、真但不修 1（旗幟 emoji 摺行視覺拆開，機率低不影響資料完整性）、已答 2。批 2（route/元件/page.tsx）：🐛2/⚠️2/❓2，真已修 2（`revokeObjectURL` 延遲撤銷、`<a>` 掛 DOM 再 click）、真已修 1（SW 註冊失敗加 log）、既有限制記錄不修 1（`navigator.onLine` 誤判）、已答 2（`requireUid` 型別窄化是既有全域模式；ICS 檔名寫死是照 spec 原文非疏漏）。

## Known issues / 已知取捨（不阻擋）

1. **PWA icon 是 SVG 非 PNG**：見上方偏差說明，peanut 可換真實品牌圖檔。
2. **`navigator.onLine` 離線判斷不精確**：瀏覽器 API 固有限制，測介面連線非實際可達性；精確判斷需額外健康檢查端點，跟「手寫最小」精神不成比例。
3. **離線且從未快取過的頁面無自訂 fallback**：交還瀏覽器原生離線錯誤頁，spec 範圍明確限縮成「已開過的行程可離線看」，自訂離線頁屬額外複雜度。
4. **旗幟 emoji 可能被摺行拆開視覺完整性**：不影響 ICS 資料正確性（unfold 後還原），機率極低不修。
5. **ICS 檔名固定 "trip.ics"**：精確照 spec 原文，動態檔名（含行程標題）屬未來優化。

## 部署

改動在本機工作樹，**未 commit / 未部署**。依鐵律停止於此，等 peanut 驗收後再決定 commit + push。人工實測基準（待部署後跑，PWA/SW 需 production 環境）：①匯入 Google/Apple 行事曆核對事件時間；②Chrome 列印預覽單欄精簡版、天卡片不腰斬；③開過某行程後飛航模式仍可完整瀏覽；④恢復連線拿到最新資料；⑤手機加入主畫面 standalone 開啟；⑥SW 只在 production 註冊。

---

# REPORT 2026-07-21（八）：Trip Day Mode（`specs/trip-day-mode.md`，組裝件，「都做」批次最後一份）

引用審查：task/REVIEW.md **2026-07-21（八）（Trip Day Mode）**。

## 背景

app 目前是「行前規劃工具」，行程開始後打開還是同一頁靜態時間軸。旅途中真正要的是：今天要去哪、下一站怎麼走、天氣如何、航班有沒有延誤。本 spec 是組裝件，把 schedule-anchoring（硬依賴）、flight-day-status/map-view（軟依賴，皆已落地）的能力在「旅途中」場景收攏，全部用既有資料與免費 deep link，$0 成本。這是「都做」批次的第八份、也是最後一份。

## 做了什麼

1. **`lib/trip-day.ts`（新）**：`currentTripDay`（今天是第幾天，UTC 午夜運算同既有 `dateForDay`/`daysDiff` 慣例）、`findNextStopIndex`（複用 `timeToMin`）、`todayLocalDateStr`（client 本地日）。
2. **`components/bookings.tsx`**：`FlightStatusRow` 加 `export`，供本頁複用 flight-day-status 的查即時動態能力（spec 明講不重複實作）。
3. **`app/trips/[id]/page.tsx`**：
   - `navUrl()` 升級為「有座標走精確 dir deep link、沒有退回文字搜尋」，對所有天都是純粹品質提升（見 PLAN.md 說明為何是全域而非只在今日卡片）。
   - 頁首「🧭 旅途中 · 第 N 天／共 M 天」徽章；進頁自動捲動並高亮到今天的卡片。
   - 今日卡片：「今天」徽章、「下一站」標籤（依現在時刻）、地圖 toggle 預設展開（軟依賴 map-view）。
   - 今日航班卡置頂今日卡片上方，內含複用的 `FlightStatusRow`。
4. **`lib/__tests__/trip-day.test.ts`（新）**：15 條。

## 改動檔案

| 檔案 | 變更 |
|---|---|
| `lib/trip-day.ts`（新） | `currentTripDay`/`findNextStopIndex`/`todayLocalDateStr` |
| `components/bookings.tsx` | `FlightStatusRow` 加 export |
| `app/trips/[id]/page.tsx` | 旅途模式整合（徽章/捲動高亮/今日航班/下一站/導航升級/地圖預設展開） |
| `lib/__tests__/trip-day.test.ts`（新） | 15 條 |

## 測試結果

- `pnpm typecheck`：過
- `pnpm test`：**20 files / 261 tests 全過**（本輪新增 15）
- `pnpm lint`：過
- `pnpm build`：過

## GLM review 統計（詳 task/REVIEW.md 2026-07-21（八））

⚠️ **本輪 GLM 又全滅**（3 次呼叫：完整 diff/兩個 useEffect 片段/Fragment JSX 片段，1 次壓縮 2 次 504），已切自我驗證：
1. **`currentTripDay` 的 UTC 解析是否有時區偏差**：`node -e` 實測跨年/跨月邊界皆正確，原理同既有 `dateForDay`/`daysDiff` 慣例。
2. **兩個新 `useEffect` 只用 `[tripDay]` 當 deps，切換不同行程但 tripDay 數值巧合相同時會漏觸發**：**自我審查抓到真的問題**——用 Context7 查證 Next.js App Router 只有 `template.tsx` 才會在動態 segment 變化時強制 remount，本專案這個路由只有 `page.tsx`（`find` 指令確認），代表 state 會跨行程切換留存。**已修**：兩個 effect 的 deps 都加 `params.id`。
3. **`setMapOpenDays` 判斷邏輯**：讀程式碼確認正確，問題只在上一點的觸發時機。
4. **Fragment+相鄰 div 的 JSX 結構正確性**：`pnpm typecheck`/`pnpm build` 已完整驗證，非本輪自行猜測。

## Known issues / 已知取捨（不阻擋）

1. **人工瀏覽器實測缺口**：需要一筆 `startDate` 落在今天附近的真實行程才能看到旅途模式視覺效果，本輪只驗證邏輯正確與無執行期錯誤（build/typecheck/單測），視覺驗收（徽章/捲動/下一站/今日航班卡的實際呈現）留給 peanut 部署後測（spec 本身也建議「可把某行程 startDate 手動改成今天附近驗證」）。
2. **導航 deep link 升級是全域的**：所有天的導航按鈕都受益於座標優先的精確連結，非僅今日卡片，見 PLAN.md 說明。
3. **今日天氣沿用既有 index 對齊邏輯**：不另開日期比對路徑，見 PLAN.md 說明（同一份資料的另一種查法，無實益）。
4. **GLM review 工具本輪再度全滅**：8 輪累計 2 成功 6 全滅，持續記錄在 [[glm-review-tool-issues]]。

## 部署

改動在本機工作樹，**未 commit / 未部署**。依鐵律停止於此，等 peanut 驗收。這是「都做」批次的最後一份——8 份延伸功能 spec（schedule-anchoring/place-freshness/opening-hours/flight-day-status/map-view/day-regenerate/export-offline/trip-day-mode）全數實作完成，前 7 份已 commit，本份待驗收後 commit。人工實測基準：①把某行程 `startDate` 改成今天附近 → 開頁自動捲到對應天卡片、徽章顯示正確、天氣/下一站/今日航班（若有）正確呈現；②行程期間外或舊行程無 startDate → 頁面與現在完全一致；③有座標 stop 的導航按鈕開 Google Maps 導航（非純文字搜尋）。

---

# REPORT 2026-07-21（九）：租車建議 + 可變現租車連結（`specs/car-rental-suggest.md`）

引用審查：task/REVIEW.md **租車建議 + 可變現租車連結**。

## 背景

peanut 詢問「有沒有免費可用的租車相關 MCP 或資訊可以加入這個專案」。研究確認沒有真正免費、免審核的租車即時報價/預訂 API（Kayak/Amadeus/Booking Demand API/Expedia Rapid Car 皆需業務申請，跟先前被否決的 Amadeus 航班 API 同樣門檻），但找到兩個零新增成本、可套用既有模式的選項：Rentalcars Connect（Booking.com 的 B2B 租車聯盟計畫，免費自助加入無審核）+ Google Places `car_rental` 類型（複用既有的 `places_search` 護欄桶）。peanut 確認兩者都做。架構完全比照住宿建議（`lib/booking-link.ts`/`lib/lodging.ts`/`app/api/lodging/suggest/route.ts`）複製。

## 做了什麼

1. **`lib/trip-geo.ts`（新）**：從 `app/api/lodging/suggest/route.ts` 原本內聯的地理重心計算抽出 `computeTripCentroid`（純函式，住宿/租車兩條路由共用；抽取前完全沒有單測覆蓋）。
2. **`lib/car-rental-link.ts`（新）**：`buildCarRentalLink`——URL 格式**經實際瀏覽器操作 rentalcars.com 跑一次搜尋核對**（非憑文件猜測，用 `firecrawl_interact` 驅動真實瀏覽器完成），`NEXT_PUBLIC_RENTALCARS_AID` 有設 → 帶 `aid`；沒設 → 同一個 URL 不帶 `aid`（可用、無佣金）。沒填日期時間時降級用合理預設值（30 天後取車、10:00），確保永遠不是死連結。
3. **`lib/car-rentals.ts`（新）**：`suggestCarRentals`——Places `searchText` + `includedType: "car_rental"` + `strictTypeFiltering: true`（避免混進洗車行/修車廠，見下方 GLM 自驗修正）；不做價位篩選（租車行極少填 `priceLevel`）。
4. **`app/api/car-rental/suggest/route.ts`（新）**：結構複製 `app/api/lodging/suggest/route.ts`，沿用 `places_search` 護欄桶（`lib/quotas.ts` 不用改）。
5. **`app/api/lodging/suggest/route.ts`**：重心計算改呼叫 `computeTripCentroid`（行為不變的純替換）。
6. **`app/trips/[id]/page.tsx`**：仿「🏨 住宿建議」加「🚗 租車建議」區塊（無價位下拉）。
7. **`components/bookings.tsx`**：手動輸入的租車卡片旁加「找租車優惠 →」連結。
8. **`.env.example`**：加 `NEXT_PUBLIC_RENTALCARS_AID`。
9. **測試**：`lib/__tests__/trip-geo.test.ts`（6 條）、`lib/__tests__/car-rental-link.test.ts`（6 條）。

## 改動檔案

| 檔案 | 變更 |
|---|---|
| `lib/trip-geo.ts`（新） | `computeTripCentroid` |
| `lib/car-rental-link.ts`（新） | `buildCarRentalLink` |
| `lib/car-rentals.ts`（新） | `suggestCarRentals` |
| `app/api/car-rental/suggest/route.ts`（新） | 端點 |
| `app/api/lodging/suggest/route.ts` | 重心計算改呼叫 `computeTripCentroid` |
| `app/trips/[id]/page.tsx` | 加「🚗 租車建議」區塊 |
| `components/bookings.tsx` | 手動租車卡片加「找租車優惠 →」連結 |
| `.env.example` | 加 `NEXT_PUBLIC_RENTALCARS_AID` |
| `lib/__tests__/trip-geo.test.ts`（新）、`lib/__tests__/car-rental-link.test.ts`（新） | 測試 |
| `specs/car-rental-suggest.md`（新） | 設計決策記錄 |

## 測試結果

- `pnpm typecheck`：過
- `pnpm test`：**22 files / 273 tests 全過**（本輪新增 12）
- `pnpm lint`：過
- `pnpm build`：過（新路由 `/api/car-rental/suggest` 正確產生）

## GLM review 統計（詳 task/REVIEW.md「租車建議 + 可變現租車連結」）

⚠️ **本輪 GLM 4 次呼叫全滅**（3 次 504、1 次同），累計成功率持續低迷（見 [[glm-review-tool-issues]]）。改自我驗證，針對原本要問的 6 個問題逐一查證：
1. **`splitDate` 日期解析邊界**（沒補零/完全不合法/月份 0/空字串/undefined）：`node -e` 實測全數正確，無靜默產生錯誤但看似合法的日期。
2. **`computeTripCentroid` 跨國際換日線平均經度錯誤**：確認是真實的球面幾何限制，但**是從既有已上線程式碼原樣抽出，非本輪新增風險**；本專案行程範圍是東亞/東南亞，機率極低，已記錄進 spec 的已知限制。
3. **`includedType` 是否真的過濾類型**：Context7 查證 Google Places API 官方文件——**確認是真問題並已修**：`includedType` 預設只在「適用時」套用，要保證每次過濾需額外加 `strictTypeFiltering: true`，已補上。
4. **`buildCarRentalLink` 在生成預覽頁是否可能吃到未驗證的空字串**：讀 `app/trip/page.tsx` 確認 `BookingCards` 收到的是已通過 zod schema 驗證的 `gen.trip.carRentals`，非編輯中的草稿字串。確認無問題。
5. **route.ts 錯誤處理是否有遺漏 edge case**：結構複製已上線的住宿建議路由，無新增分支。確認無問題。
6. **lodging route 重構後行為是否不變**：抽出函式逐行比對一致，273/273 測試全過佐證。確認無問題。

## Known issues / 已知取捨（不阻擋）

1. **人工瀏覽器實測缺口**：需要真實 `GOOGLE_MAPS_API_KEY` 環境與一筆有收藏地點的行程才能看到「找 XX 的租車」的真實 Places 查詢結果，本輪只驗證邏輯正確與無執行期錯誤，實際結果與 rentalcars.com 連結能否正常開啟留給 peanut 部署後測。
2. **Rentalcars Connect 的 `aid` 參數名稱是推論而非直接驗證**：對照 Booking.com 旗下 `cars.booking.com` 的既有慣例（該處確認用 `aid`），本專案 `lib/booking-link.ts` 對 Booking 本體也是用 `aid`，一致性高，但 rentalcars.com 這個網域本身的 `aid` 行為需 peanut 實際申請 Rentalcars Connect 帳號後才能 100% 確認。零佣金 fallback（不帶 `aid`）的 URL 格式已用真實瀏覽器操作驗證，這部分無疑慮。
3. **`computeTripCentroid` 跨國際換日線限制**：見上方自驗第 2 點，非本輪新增、非本輪修復範圍。
4. **GLM review 工具本輪再度全滅**：9 輪累計 2 成功 7 全滅，持續記錄在 [[glm-review-tool-issues]]。

## 部署

改動在本機工作樹，**未 commit / 未部署**。依鐵律停止於此，等 peanut 驗收後再決定 commit。人工實測基準：①對一筆有收藏地點的行程按「找 XX 的租車」→ 出現該區真實租車據點；②點「租車 →」連結能正常開啟 rentalcars.com 搜尋結果（無論有沒有設定 `NEXT_PUBLIC_RENTALCARS_AID`）；③手動輸入的租車記錄旁的「找租車優惠 →」連結同樣正常開啟；④設定 `NEXT_PUBLIC_RENTALCARS_AID` 後連結帶 `aid=<id>`。
