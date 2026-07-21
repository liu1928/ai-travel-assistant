# PLAN — 三項修正：生成天數完整性 / 編輯本地重排 / 航班換資料源

> 任務來源：peanut 2026-07-11 拍板——「問題一做 a+b、問題二做替代案（durationMin 本地重排）、問題三做 a+b 的替代案（換資料源）」。
> 根因調查：三問題各經獨立調查 + 反方驗證，核心主張全數 confirmed（證據 file:line 見本檔各節）。
> 分支：`feat/three-fixes`（off main 73427e5d）。>3 檔改動 → 本計畫先經 peanut 確認再動工。

---

## 修正一：一句話生成只出「特殊需求那一天」（a+b）

根因：SYSTEM_PROMPT 無天數覆蓋規則且範例只示範一天（lib/anthropic.ts:74-78, 144-171）；
days 端到端 optional 無預設（app/trip/page.tsx:149、route.ts:118）；schema 只要求 ≥1 天、
無連續性檢查，生成後也無完整性驗證（schema/trip.ts:21,39、lib/anthropic.ts:387-395）。

1. **`lib/anthropic.ts` — prompt 硬規則（a）**
   - SYSTEM_PROMPT 輸出約束區加：「days 必須從 day 1 開始連續編號、涵蓋整趟旅行每一天；
     使用者提到『第 N 天』時總天數至少 N，其他天也要完整排程，不可只輸出提到的那一天」。
   - 輸出格式範例 days 改為兩個元素（day 1、day 2），消除單日偏置。
   - `buildUserMessage`：有 `input.days` 時改為硬指令「必須輸出恰好 N 天（day 1 到 day N，每天都有完整 schedule）」。
   - ⚠️ 牴觸 task/SPEC.md §4「SYSTEM_PROMPT 原文一字不改」→ 需 peanut 授權，改完同步修訂 SPEC §4。
2. **`lib/anthropic.ts` — 天數推斷 + 完整性檢查（b）**
   - 新純函式 `inferMinDays(prompt)`：正則抽「第 N 天」「N 天 M 夜」（含中文數字一~十）取最大值；
     `body.days` 未填時作為 expectedDays 下限（比照 route.ts:103 假日查詢 `body.days ?? 2` 的思路，但不硬給預設——推斷不到就維持 AI 自由判斷）。
   - `generateTrip` 拿到 parsed_output 後驗證：days 從 1 開始連續，且（有 expectedDays 時）覆蓋 1..N；
     不符 → 帶「缺第 X 天」的修正訊息自動重試 1 次，再不符 → err（沿用 refusal 類錯誤，前端顯示現有文案）。
3. **`schema/trip.ts`**：tripSchema 加 `superRefine` 驗證 day 從 1 開始連續遞增（靜態可驗部分）。
   ⚠️ 影響 PATCH /api/trips 路徑：舊 Firestore 文件若存過「day 不連續」的行程，編輯儲存會被擋——
   風險低（正常生成都連續），但列為已知影響。
4. **測試**：`inferMinDays` 單測（第三天/五天四夜/三天兩夜/中文數字/無訊號）、完整性檢查單測（缺天重試/連續性）、schema superRefine 單測。

## 修正二：編輯行程後時間不重排（durationMin 本地重排，免 LLM）

根因：編輯只有刪除/排序且不碰 time（app/trips/[id]/page.tsx:156-173）；PATCH 純覆蓋無重算
（app/api/trips/[id]/route.ts:23-44）；schema 無時長概念（schema/trip.ts:9-17）；
Routes insights 只在生成時寫入、編輯後殘留（generate/route.ts:173-184）。

1. **`schema/trip.ts`**：`scheduleItemSchema` 加 `durationMin: z.number().int().positive().optional()`（舊資料相容，免遷移）。
2. **`lib/anthropic.ts`**：SYSTEM_PROMPT 輸出範例與規則加 durationMin（每項停留/移動時長，分鐘）。
3. **`app/trips/[id]/page.tsx`**：新純函式 `recomputeTimes(day)`（抽到 `lib/` 供單測）：
   - 錨點 = 當天第一項的 time；後續每項 time = 前項 time + 前項時長。
   - 時長來源優先序：`durationMin` →（舊資料 fallback）進編輯模式當下由原始相鄰 time 差推出的「有效時長」→ 預設 60 分鐘（僅末項無後繼可差分時）。
     → 舊行程不用等重新生成也能重排（刪掉中午行程，下午自動提前該項原佔時長）。
   - `removeItem` / `moveItem` 後即時重算，編輯模式所見即所得；跨過 23:59 時 clamp 並提示。
4. **止血（附帶，需 peanut 勾選）**：`saveEdit` 送出前濾掉符合「第 N 天移動時間約…」「第 N 天有地點無法定位…」pattern 的過期車程 insights。
5. **空天地雷修復（附帶，需 peanut 勾選）**：某天被刪到空時——儲存前自動移除該天並將後續 day 連續重編（配合修正一的 superRefine）；UI 提示「第 X 天已無行程，儲存時將移除該天」。
6. **測試**：`recomputeTimes` 單測（durationMin 齊全/舊資料差分 fallback/混合/末項預設/跨日 clamp）、insights 過濾單測。

範圍外（本輪不做）：編輯後重跑 Routes API 更新車程（原選項 A/B）——durationMin 方案不含此項，車程 insights 只做過期清除。

## 修正三：航班查詢換資料源（建議 AeroDataBox）

根因：現行打 AviationStack 即時 /flights 端點、只帶 flight_iata 不帶日期（lib/aviationstack.ts:81），
表單的出發日期沒送出（app/api/flight/lookup/route.ts:18-27），回的是「今天這班」——換季後的未來班表查不到；
資料日期在解析層被丟棄，前端無警語。

供應商評比（四家、關鍵主張經官方原文複核）：

| | 航班號+日期直查 | 未來班表 | 費用（本案用量） | 整合難度 |
|---|---|---|---|---|
| **AeroDataBox**（推薦） | ✅ `GET /flights/number/{航班號}/{日期}` 原生支援 | 免費層 365 天；換季最慢約 2 週反映 | $0（RapidAPI 免費層 300 次/月，hard limit 不會被扣款，但**訂閱需綁信用卡**） | 低：回應自帶 {utc, local} 雙時區，當地時間直接用 |
| FlightAware AeroAPI | ⚠️ /schedules 需拆航空公司+班號 | 1 年 | 實質 $0（每月 $5 免費額度） | 中：回 UTC 無機場時區，要自己轉 |
| Amadeus Self-Service | ✅ carrierCode+flightNumber+date | 未文件化 | $0（production 免費 2,000 次/月） | 中：OAuth 兩段式；production 要填帳單+簽約+最長 72h 審核；LCC（台虎）覆蓋有風險 |
| AviationStack 升級 Basic | ❌ 仍是機場式查詢+7 天盲區 | 上限未知 | $49.99/月 | 高（兩段式+自組時區） |

實作（以 AeroDataBox 為準，peanut 若選別家再改此節）：

1. **`lib/aerodatabox.ts`（新）**：`lookupFlight(flightNo, dateLocal?)` → 沿用現有 `Result<FlightLookupResult, FlightLookupError>` 介面。
   - `GET https://aerodatabox.p.rapidapi.com/flights/number/{no}/{date}?dateLocalRole=Departure`，
     headers `X-RapidAPI-Key`（Secret）/`X-RapidAPI-Host`；date 未填 → 用今日（維持現行為）。
   - 回應是 FlightContract 陣列（同號一日多班會多筆）：取排定出發時間最早一筆；時間直接取 `scheduledTime.local` 切 HH:mm（不需 Intl 時區換算）。
   - `FlightLookupResult` 加 `dataDate: string`（YYYY-MM-DD，回傳班表所屬日期）。
   - `lib/aviationstack.ts` 保留備查加 deprecated 註記（比照 gemini-review.mjs 慣例），不刪。
2. **`app/api/flight/lookup/route.ts`**：body 加收 `date?`（YYYY-MM-DD，驗格式），改呼叫 aerodatabox；錯誤對應不變；`flight_lookup` 配額沿用。
3. **`components/bookings.tsx`**：查詢時把該列 date 一併送出；成功訊息改「已帶入（YYYY-MM-DD 班表）」；
   該列 date 未填時提示「未填日期，帶入的是今日班表」。
4. **`lib/__tests__/aerodatabox.test.ts`（新）**：解析單測（多筆挑選、codeshare、local 時間切取、跨日、空 data、error body）。
5. **`.env.example`**：加 `AERODATABOX_API_KEY`（+`AERODATABOX_BASE_URL` 走 envOr，預設 RapidAPI host，供測試替換）。
6. **`specs/flight-lookup.md`**：新增 AeroDataBox 章節記錄換源決策與新限制（不刪 AviationStack 歷史）。

## ⚠️ 禁動清單（停下與 peanut 確認，不偷做）

- **peanut 需自行註冊** RapidAPI 帳號並訂閱 AeroDataBox BASIC（$0，需綁信用卡；hard limit 超額擋請求不扣款），把 `X-RapidAPI-Key` 提供給我。
- **Cloud Secret Manager**：寫入 `AERODATABOX_API_KEY`（先讀現值核對，用 Write 工具產生任何中間檔，絕不盲蓋）。
- **`apphosting.yaml`**：綁新 secret；`AVIATIONSTACK_*` 綁定保留不動（檔案屬禁動清單，列出確切 diff 給 peanut 確認再改）。
- **`task/SPEC.md` §4 修訂**（SYSTEM_PROMPT「一字不改」條款）與 **`specs/flight-lookup.md`** 增章：均先給 peanut 過目。

## 驗證

`pnpm typecheck && pnpm test && pnpm lint && pnpm build` 全綠 → `git diff > task/diff.patch` →
GLM review（分三批：修正一/二/三）→ REVIEW.md 仲裁 → REPORT.md。
人工實測基準：①「第三天要去迪士尼的五天東京行」→ 應生成 5 天完整行程且第 3 天含迪士尼；
②刪掉既有行程中午項目 → 下午項目時間自動提前；③查 BR/CI/JX/IT 各一班 2 週後航班 → 帶入時間與航司官網一致。

---

## 2026-07-16 hotfix：單一地點分享連結解析失敗

**症狀**：使用者貼 `maps.app.goo.gl/X3zDsKifeHWBQC9s7`（單一地點）被誤報「僅支援單一地點連結」。

**根因（已實測）**：該短連結展開後為新版格式
`/maps/place/<名稱+完整地址>/data=!4m2!3m1!1s0x...:0x...`——**無 `!3d!4d` 座標、無 `@lat,lng`**，只有 hex CID。`extractNameAndCoords()` 硬性要求座標 → 回 null → 落入 fallback 錯誤（訊息誤導）。

**修法**：名稱段本身含完整地址，直接 Text Search 即可精準命中。
1. `lib/sharelink.ts`：座標改 optional——抓到名稱但無座標時，`places:searchText` 不帶 `locationBias` 直接查。
2. `lib/__tests__/sharelink.test.ts`：export 解析函式並補測試（含本次實測 URL 形態）。

範圍：2 檔。驗證：pnpm test / typecheck / lint → GLM review → REVIEW/REPORT。

---

## 2026-07-20：天氣/匯率延伸功能（補完已抓卻未落地的資料）

> 任務來源：peanut 於 plan mode 核准（`~/.claude/plans/ai-travel-assistant-api-adaptive-micali.md`），四方向全做。
> 前提：weather/currency 本已在 `/api/trip/generate` 抓好並注入 AI，但結構化資料未進 schema/Firestore/前端（工作樹未提交的進行中工作）。本輪補完。

**Phase 1 — 資料落地 + 行程頁顯示**
1. `schema/trip.ts`：加 dailyWeatherSchema/exchangeRateSchema，`tripWithBookingsSchema` 擴充 `weather`（default []）/`exchangeRate`（optional）。⚠️ 絕不進 `tripSchema`（AI 會編造）。
2. `app/api/trip/generate/route.ts`：回傳 `{...trip, …, weather, exchangeRate}`。
3. `app/trips/[id]/page.tsx`：逐日天氣 chip（索引對齊＋長度守衛）、預算匯率雙標卡。

**Phase 2 — 記帳頁匯率換算 + 超支預警**
1. `lib/currency.ts`：`fetchExchangeRates(from, to[])`。2. 新 `GET /api/rates`（需登入）。3. `expenses/page.tsx`：折合 TWD 總計＋對照 budget 超支標紅。

**Phase 3 — 天氣智慧**
打包清單（`buildPackingList`）、雨天帶傘標記（chip 內）、最佳出遊日（`lib/weather.ts` `scoreDayWeather` + 新 `GET /api/weather/best-days` + `/trip` 按鈕）。

**Phase 4 — 匯率快照 / 多幣別**
快照隨 Phase 1 存於行程；多幣別擴充列為「視需要」follow-up（本輪維持 TWD/USD/JPY/EUR）。

範圍：8 檔改 + 2 新檔 + 1 測試。驗證：typecheck/test/lint/build 全綠 → `task/diff.patch` → GLM review → REVIEW/REPORT。

---

## 2026-07-21：Schedule Anchoring（地基，`specs/schedule-anchoring.md`）

> 任務來源：2026-07-21 定案的 8 份延伸功能 spec，本份是 opening-hours / map-view / day-regenerate / export-offline / trip-day-mode 五份的共用地基，需最先落地（見 task/MEMORY.md 依賴順序記錄）。
> 目的：把生成時**已經算出但用完即丟**的座標/placeId/startDate 存下來，零額外 API 成本。5 檔改動 → 先列計畫確認。

1. **`schema/trip.ts`**
   - 抽 `consecutiveDaysArray(daySchema)` helper：把現有 `tripSchema.days` 的 day-連續編號 `superRefine` 邏輯搬進去，`tripSchema` 改呼叫此 helper（行為不變）。
   - 新增 `savedScheduleItemSchema = scheduleItemSchema.extend({ placeId?: string, lat?: number(-90~90), lng?: number(-180~180), openingWarning?: string })`。
   - 新增 `savedTripDaySchema = tripDaySchema.extend({ schedule: z.array(savedScheduleItemSchema).min(1) })`。
   - `tripWithBookingsSchema`：`extend` 覆寫 `days: consecutiveDaysArray(savedTripDaySchema)`（取代繼承自 tripSchema 的陽春版）+ 新增 `startDate: z.string().regex(datePattern).optional()`。
   - ⚠️ 這些欄位絕不能出現在 `scheduleItemSchema`/`tripSchema`（AI structured output 會編造）。

2. **`app/api/trip/generate/route.ts`**（Routes 估車程迴圈，約 199–236 行）
   - 改寫迴圈：不再「任一 stop 定位失敗就中斷收集」，改成**逐 stop 都嘗試寫回** `placeId`（收藏對映命中）或 `lat/lng`（`resolveCoordinates` 命中，無 placeId）；是否整天跳過車程估計仍看 `allResolved`，但寫回動作與車程估計解耦。
   - 回傳 payload 加 `startDate: body.startDate`。

3. **前端 type 複本同步**（維持現有「各自手刻 local type」慣例，不改抽共用型別——範圍外）
   - `app/trips/[id]/page.tsx`：`ScheduleItem` 加 `placeId?/lat?/lng?/openingWarning?`；`SavedTrip` 加 `startDate?`。
   - `app/trip/page.tsx`：`ScheduleItem`、`Trip` 比照同步。

4. **`schema/__tests__/trip.test.ts`**
   - `consecutiveDaysArray` 抽出後兩個 schema（tripSchema / tripWithBookingsSchema）的連續編號檢查都要有測試覆蓋。
   - `savedScheduleItemSchema` 新欄位驗證（合法 placeId/lat/lng、座標超界拒絕、全 optional 舊資料通過）。
   - `tripSchema`（AI 輸出用）不含 placeId/lat/lng/startDate 欄位的鐵律測試（比照既有 flights/weather 模式）。

範圍外（本輪不做）：`openingWarning` 的寫入邏輯（`specs/opening-hours.md` 負責）、前端讀取新欄位後的 UI 呈現（下游 spec 負責）、`resolveCoordinates` 模糊比對準確度（既有限制，spec 已註記不在此解）。

驗證：`pnpm typecheck && pnpm test && pnpm lint && pnpm build` 全綠 → `task/diff.patch`（Bash `git diff >`，非 PowerShell）→ GLM review → REVIEW/REPORT。人工實測：生成一筆勾收藏地點的新行程 → Firestore doc 的 schedule item 帶 placeId/lat/lng、trip 帶 startDate；讀一筆舊行程（無新欄位）→ 正常渲染不炸驗證。
