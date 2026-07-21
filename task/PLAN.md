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

---

## 2026-07-21（二）：Place Freshness（`specs/place-freshness.md`）

> 任務來源：8 份延伸功能 spec 的第二份（schedule-anchoring 已落地並 commit `cc38a9e`）。spec 前置：無硬依賴，建議在 opening-hours 之前做（用便宜 SKU 先驗證 Details GET + TTL 快取 + 配額模式）。9 檔改動 → 先列計畫確認。
> ⚠️ 與 spec 原文兩處落地細節偏差（技術必要，非設計變更）：
> 1. spec §1.3 寫 `checkAndConsume(uid, "places_status", n)`——但 `checkAndConsume` 的第三參數是「美金成本」不是「筆數」，實作改傳 `n * SERVICE_COST_USD.places_status`（語意等價，n=50 時仍是 $0.85）。
> 2. spec §3 影響檔案表只列 `app/api/trip/generate/route.ts` 負責「CLOSED_TEMPORARILY 暫停營業註記」，但該註記實際要寫進 AI prompt 的地點清單行——這段組字邏輯在 `lib/anthropic.ts` 的 `buildUserMessage`，不在 route.ts。改動會多這一個檔案，行為不變（`buildUserMessage` 讀 `p.businessStatus` 加註記）。另外落地需要 `lib/collection.ts` 加一個 Firestore 寫回 helper（既有 `updateNote`/`setGroup`/`updateTags` 同款式），spec 沒單獨列但屬既有慣例的自然延伸。

1. **`schema/place.ts`**：`savedPlaceSchema` 加 `businessStatus: z.enum([...]).optional()`、`statusCheckedAt: z.number().optional()`（全 optional，舊資料免遷移）。
2. **`lib/place-status.ts`（新）**：`fetchBusinessStatus(placeId)` → `Result<BusinessStatus, PlaceStatusError>`。GET Places Details（`X-Goog-FieldMask: id,businessStatus`，比照 `lib/sharelink.ts` 的 `fetchPlaceById` 呼叫風格）；`res.status===404` → `ok("NOT_FOUND")`；缺欄位/`BUSINESS_STATUS_UNSPECIFIED` → `ok("OPERATIONAL")`；其他非 2xx/例外 → `err`。
3. **`lib/collection.ts`**：新增 `updatePlaceStatus(uid, placeId, status, checkedAt)`，`doc.update({businessStatus, statusCheckedAt, updatedAt})`（同 `updateTags` 寫法）。
4. **`app/api/collection/refresh-status/route.ts`（新）**：`requireUid` → `listPlaces` 篩 `statusCheckedAt` 缺席或早於 `now - STATUS_TTL_DAYS(預設7,envOr)` → 最舊優先排序取前 `REFRESH_STATUS_CAP`(預設50,envOr) 筆 → `n===0` 直接回（不呼叫 checkAndConsume）→ 否則 `checkAndConsume(uid,"places_status", n*SERVICE_COST_USD.places_status)` → `mapLimit(batch,4,...)` 併發 `fetchBusinessStatus`+`updatePlaceStatus` → 回 `{scanned,updated,closedFound,failed,remaining}`。
5. **`lib/quotas.ts`**：`SERVICE_COST_USD` 加 `places_status: 0.017`。
6. **`app/page.tsx`**：收藏區標題列加「檢查歇業狀態」按鈕（沿用 `batchRetag` 狀態機款式，新開一個 state）；`PlaceCard` 加徽章：`CLOSED_PERMANENTLY`/`NOT_FOUND` 紅「已歇業」、`CLOSED_TEMPORARILY` 黃「暫停營業」。
7. **`app/api/trip/generate/route.ts`**：`places` 過濾掉 `businessStatus` 為 `CLOSED_PERMANENTLY`/`NOT_FOUND` 的項目；有剔除時 `trip.insights` push「已自動排除歇業地點：X、Y」。
8. **`lib/anthropic.ts`**（spec 檔案表外，技術必要）：`buildUserMessage` 組地點行時，`CLOSED_TEMPORARILY` 的地點行尾加「（暫停營業中，避免排入或提醒使用者確認）」。
9. **`lib/__tests__/place-status.test.ts`（新）**：404→NOT_FOUND、UNSPECIFIED/缺欄位→OPERATIONAL、CLOSED_TEMPORARILY/PERMANENTLY 正常回傳、非 2xx 非 404→err、fetch 例外→err。

範圍外（本輪不做，spec 已註記）：不把 businessStatus 加進匯入 Text Search field mask；歇業不自動刪收藏；cron 自動背景更新（App Hosting 無 cron 基建，維持手動按鈕）。

驗證：`pnpm typecheck && pnpm test && pnpm lint && pnpm build` 全綠 → diff → GLM review → REVIEW/REPORT。人工實測（需 peanut 提供一個已知歇業的真實 placeId 才能完整驗證，否則只能驗證「未歇業」路徑）：①按鈕按下→ place doc 出現 businessStatus/statusCheckedAt；②立刻再按一次→ scanned:0 不扣配額；③收藏含歇業店生成行程→ 該店不出現、insights 有說明；④未登入打 API → 401。

---

## 2026-07-21（三）：Opening Hours（`specs/opening-hours.md`）

> 任務來源：8 份延伸功能 spec 第三份（schedule-anchoring `cc38a9e`、place-freshness `cc6391a` 已 commit）。spec 前置：schedule-anchoring 的 `openingWarning` 欄位與 placeId 錨定（已具備）；建議 place-freshness 先做以便 businessStatus 免費順帶（已具備）。10 檔改動 → 先列計畫確認。
> ⚠️ spec 沒完全講死的實作細節（技術判斷，非設計變更，列出來確認）：
> 1. **businessStatus 免費順帶的分類邏輯直接重用 `lib/place-status.ts` 的 `classifyStatus`**（不重寫一份），減少重複程式碼。
> 2. **`ensureOpeningHours` 呼叫本身也 gate 在 `body.startDate` 存在時才做**（不只是「注入/驗證」gate 在 startDate，見 spec §2 設計決策「startDate 缺席→整個功能靜默降級」）——沒有 startDate 就算抓到營業時間也用不上（算不出對應第幾天是星期幾），比照 weather/holidays 現有的 startDate gate 慣例，省下不會被使用的 Enterprise SKU 呼叫。
> 3. **prompt 注入的「各天對應星期幾」表**：AI 決定的最終天數在生成前無法得知，用 `input.days ?? inferMinDays(prompt) ?? 1` 當表格天數來源（跟現有天數推斷同一套邏輯），並 cap 30 天防禦极端輸入。
> 4. **跨午夜營業時段的驗證只認開始那天**（spec 已知限制明講「跨午夜時段歸屬 open 那天」），不處理「前一天跨午夜營業時段延伸到次日凌晨」這種反向情形——沿用 spec 用詞原樣記為已知限制，不多做。

1. **`schema/place.ts`**：`savedPlaceSchema` 加 `openingHours: z.record(z.string(), z.string().nullable()).optional()`、`openingHoursCheckedAt: z.number().optional()`。
2. **`lib/opening-hours.ts`（新）**：
   - `compressOpeningHours(periods)`（純函式）：Google `regularOpeningHours.periods[]` → `Record<"0"~"6", string|null>`；全週 24h 特例（單一 period、day=0/hour=0/minute=0、無 close）→ 全部填 `"24h"`；一般 period 按 `open.day` 分組、`close` 缺席防禦性視為當天 24h；無 period → 全部 `null`。
   - `formatOpeningHoursSummary(hours)`（純函式）：壓縮映射 → 人類可讀摘要（週一–週日順序分組合併相鄰同值），供 prompt 注入。
   - `fetchOpeningHours(placeId)`：GET Details `id,regularOpeningHours,businessStatus`；businessStatus 分類重用 `classifyStatus`（來自 `lib/place-status.ts`）；`regularOpeningHours` 欄位整個缺席 → `openingHours: undefined`（不當成「全公休」，避免誤標）。
   - `ensureOpeningHours(uid, places)`：TTL（`OPENING_HOURS_TTL_DAYS` 預設 7）+ cap（`OPENING_HOURS_MAX_PLACES` 預設 20）篩選、`checkAndConsume("opening_hours", n*0.02)`（0 筆跳過不扣配額，比照 place-freshness）、`mapLimit(4)` 抓取、寫回 Firestore（含 businessStatus 免費順帶）、回傳合併後的 `SavedPlace[]`（best-effort：任何步驟失敗回傳原陣列，不阻擋生成）。
   - `checkScheduleAgainstHours(item, weekday, hours)`（純函式）：`hours` 缺席或該天缺席 → 不驗（undefined）；`null` → 「當日（週X）公休」；`"24h"` → 通過；一般範圍比對 `item.time`+`durationMin`（預設 60，跟既有 `lib/trip-edit.ts` 慣例一致），跨午夜 range 用 `close<=open ? close+1440 : close` 展開比對。
3. **`lib/trip-days.ts`**：新增 `weekdayForDay(startDate, day)`（純函式，`(週幾(startDate) + (day-1)) % 7`），供 route.ts 生成後驗證换算每天星期幾。
4. **`lib/collection.ts`**：新增 `updateOpeningHours(uid, placeId, {openingHours?, checkedAt, businessStatus?})`，一次 Firestore `update()` 寫 `openingHoursCheckedAt` +（有值才寫）`openingHours`/`businessStatus`+`statusCheckedAt`。
5. **`lib/quotas.ts`**：`SERVICE_COST_USD` 加 `opening_hours: 0.02`。
6. **`lib/anthropic.ts`**：`buildUserMessage`——① 地點行尾加營業時間摘要（`p.openingHours` 存在時，格式如「（週一 公休；週二–週日 11:00-21:00）」）；② `startDate` 存在時，在既有出發日期段落追加「各天對應星期幾」表 + 「排程必須避開各地點標示的公休日與非營業時段」硬指令。兩者都只在 `input.startDate` 有效時注入（無 startDate 沒有意義，見上方偏差說明②）。
7. **`app/api/trip/generate/route.ts`**：`body.startDate` 存在時，在呼叫 `generateTrip` 前 `places = await ensureOpeningHours(auth.value, places)`；既有 Routes 迴圈內（已有 `known`/`stop` 錨定寫回邏輯）新增：算出該天 `weekday = weekdayForDay(body.startDate, day.day)`，`known` 命中時額外呼叫 `checkScheduleAgainstHours(stop, weekday, known.openingHours)`，有警示則寫入 `stop.openingWarning`（schedule-anchoring 既有欄位）。
8. **`app/trips/[id]/page.tsx`、`app/trip/page.tsx`**：schedule item 卡片裡 `TYPE_LABEL` 旁，`item.openingWarning` 存在時加「⚠️ {openingWarning}」黃色警示文字。
9. **`lib/__tests__/opening-hours.test.ts`（新）**：`compressOpeningHours`（24h 全週、單日多時段、跨午夜、全公休、缺 close 防禦）、`formatOpeningHoursSummary`（合併相鄰同值/全 24h/全公休）、`checkScheduleAgainstHours`（公休擋下、24h 通過、時段內通過、時段外擋下、跨午夜範圍、無資料不驗）。
10. **`lib/__tests__/trip-days.test.ts`**：新增 `weekdayForDay` 幾條（含跨週日 index 0 邊界、非法 startDate）。

範圍外（本輪不做，spec 已註記）：`currentOpeningHours` 例外日/特殊假日營業時間；AI 自創（非收藏）地點的驗證；跨天的跨午夜營業時段延伸判斷。

驗證：`pnpm typecheck && pnpm test && pnpm lint && pnpm build` 全綠 → diff → GLM review → REVIEW/REPORT。人工實測（需真實已知週間公休店 + 該天落在公休日的 startDate 才能完整驗證）：①勾一家已知公休店讓某天落在公休日 → 該店不排該天或卡片出現「⚠️ 當日公休」；②同地點 7 天內第二次生成 → Enterprise 呼叫數 0；③不填 startDate → 行為與現在完全一致。

---

## 2026-07-21（四）：Flight Day Status（`specs/flight-day-status.md`）

> 任務來源：peanut 核准剩餘 5 份 spec 全部照序做完（「都做」）。本份無依賴，4 檔改動。
> 關鍵技術決策：**AeroDataBox 同一端點同一次呼叫已經回傳即時追蹤欄位**（status/revisedTime/terminal/gate），
> 不需為 `mode:"status"` 另打一次 API——`pickFlight` 直接多解析幾個欄位即可，`mode` 只在 route 層控制
> 「date 必須是今天（±1 天）」的驗證閘門。欄位名**用真實 API 呼叫核對**（BR198 today，非憑文件猜測）：
> `status`（頂層字串）、`departure/arrival.revisedTime.{utc,local}`、`.terminal`、`.gate`。

1. **`lib/aerodatabox.ts`**：`AdbMovement` 加 `revisedTime?/terminal?/gate?`，`AdbFlight` 加 `status?`；`FlightLookupResult` 加 `status?/revisedDepartTime?/revisedArriveTime?/departTerminal?/departGate?/arriveTerminal?`；`pickFlight` 從同一個 `best.row` 多抽這幾個欄位（未來日期自然缺席，零成本）。新增 export `todayTaipeiDate()`、`daysDiff(a,b)` 供 route 驗證用。
2. **`app/api/flight/lookup/route.ts`**：body 加 `mode?: "schedule"|"status"`（預設 `"schedule"`，零迴歸）；`mode==="status"` 且有帶 `date` 時，`daysDiff(date, todayTaipeiDate())` 絕對值 >1 → 400。
3. **`components/bookings.tsx`**：`BookingCards` 的航班卡，`f.date === todayLocalDate()` 時顯示 `FlightStatusRow`（按鈕觸發查詢、`sessionStorage` 快取 key=航班號+日期、修正時刻與原時刻不同才標紅、航廈/登機門、「重新整理」手動按鈕）。
4. **`lib/__tests__/aerodatabox.test.ts`**：新增即時欄位解析（有資料/未來日期缺席不影響既有欄位）+ `daysDiff` 邊界測試。

範圍外（spec 已註記）：不自動輪詢、不持久化動態資料、不做推播。

驗證：`pnpm typecheck && pnpm test && pnpm lint && pnpm build` 全綠 → diff → GLM review → REVIEW/REPORT。人工實測（待部署後，需真實今天出發航班）：①今天航班卡出現「查即時動態」按鈕，查詢顯示狀態；②非今天航班不出現按鈕，直打 API 帶未來日期+mode:status → 400；③既有不帶 mode 的呼叫行為不變；④同 session 重進頁不重打 API。

---

## 2026-07-21（五）：Map View（`specs/map-view.md`）

> 任務來源：「都做」批次的第二份，只依賴地基（已完成）。7 檔改動 + 3 個 pnpm 套件。
> ⚠️ spec 檔案表沒列的技術必要新檔：`lib/day-map.ts`（純函式 `resolveDayMapItems`，座標優先序解析，
> 抽出來是為了單測——跟過去幾輪「純邏輯抽 lib/ 供單測」的慣例一致，不放進 page 元件內聯）。
> spec 提到「維持既有篩選狀態」，但 `app/page.tsx` 目前沒有收藏清單的篩選/搜尋功能，此條件不適用
> （地圖一律顯示 `saved` 全部，等同「目前顯示結果」）。

1. **`package.json`**：`pnpm add leaflet react-leaflet`、`pnpm add -D @types/leaflet`（peer 警告經確認是既有 eslint 版本落差，與本次安裝無關）。
2. **`components/collection-map.tsx`（新）**：收藏散點圖，`TAG_COLOR`（對齊 `app/page.tsx` 既有 `TAG_STYLE` 色系的 600 色階 hex）、`CircleMarker`+`Popup`、`fitBounds`/單點 `setView`。
3. **`components/day-route-map.tsx`（新）**：單日路線圖，`divIcon` 序號 marker + `Polyline`，`fitBounds`。
4. **`lib/day-map.ts`（新）**：`resolveDayMapItems`——座標優先序（持久化 lat/lng → 名稱對映收藏座標 → 排除）；transport/rest 不計入分母。
5. **`app/page.tsx`**：dynamic import `CollectionMap`（`ssr:false`）；「清單/地圖」切換 toggle。
6. **`app/trips/[id]/page.tsx`**：dynamic import `DayRouteMap`；每天標題列「地圖」toggle；`collectionCoords` 懶載入（第一次展開任一天地圖才打 `/api/collection`，全頁共用一次）；`editing` 模式不顯示地圖 toggle（比照既有導航連結的 `!editing` 慣例）。
7. **`lib/__tests__/day-map.test.ts`（新）**：`resolveDayMapItems` 7 條（持久化座標/名稱對映/location 優先於 title/都對不到/collectionCoords 未載入/transport-rest 排除在外/混合案例）。

範圍外（spec 已註記）：不做 Routes API 真實路徑（polyline 是直線）；AI 自創地點在舊行程對映不到座標（隨新行程自然消失）。

驗證：`pnpm typecheck && pnpm test && pnpm lint && pnpm build` 全綠（**spec 特別要求 build**：SSR 相容性只在 build/runtime 現形，已確認無 `window is not defined`）→ diff（不含 pnpm-lock.yaml 噪音）→ GLM review → REVIEW/REPORT。人工實測：①收藏頁切地圖，散點顏色對應 tag、popup 正確、視野涵蓋全部點；②新生成行程開單日地圖，序號與時間軸一致；③舊行程（無持久化座標）能靠名稱對映上圖，其餘顯示排除筆數；④不開地圖時 Network 面板無 leaflet chunk/tile 請求；⑤地圖角落有 OSM attribution。

---

## 2026-07-21（六）：Day Regenerate（`specs/day-regenerate.md`）

> 任務來源：「都做」批次第三份，依賴地基（已完成）。9 檔改動。
> ⚠️ 關鍵範圍限縮決策：spec 說「schedule-anchoring 的錨定邏輯抽成可複用 helper」，實作上**只抽出
> 純錨定部分**（placeId/lat/lng/openingWarning 寫回）到新 `lib/day-anchor.ts`，**不回頭重構**
> `app/api/trip/generate/route.ts` 既有的 Routes 迴圈去呼叫這個新 helper——因為那段程式碼把「錨定」
> 跟「車程估計」交織在一起，硬拆分風險大於好處，會動到已測試、已上線的核心生成路徑。兩處會有小段
> 邏輯重複，換取零迴歸風險（CLAUDE.md「不做不必要的重構」）。

1. **`schema/trip.ts`**：新增 `daySchedulePayloadSchema = z.object({ schedule: z.array(scheduleItemSchema).min(1) })`（AI 側，不含錨定欄位）。
2. **`lib/trip-days.ts`**：新增 `dateForDay(startDate, day)`（純函式，UTC 午夜運算同 `daysDiff` 慣例，避免時區/DST），供比對 weather/flights/lodgings 用日期。
3. **`lib/day-anchor.ts`（新）**：`anchorDaySchedule(schedule, places, weekday)`——收藏對映優先、`resolveCoordinates` 次之、有 weekday 錨點才驗公休。
4. **`lib/anthropic.ts`**：新增 `regenerateDay(input): Result<ScheduleItem[], GenerateTripError>`——`RegenerateDayInput` 含 trip 摘要/其他天已排地點（防重複排點指令）/該日現有排程/使用者回饋/日期星期幾/天氣/當日航班住宿；`daySchedulePayloadSchema` 結構化輸出；`max_tokens=4096`（整趟下限 8192 的一半，spec 建議約 1/3）。
5. **`lib/quotas.ts`**：登記 `day_regenerate: 0.03`。
6. **`app/api/trips/[id]/regenerate-day/route.ts`（新）**：`requireUid` → 讀 trip（404）→ day 範圍驗證 → `checkAndConsume` → `regenerateDay` →（失敗直接回錯誤，不動 Firestore）→ `anchorDaySchedule` → 替換該日、`updateTrip` 整份覆寫 → 回傳更新後 trip。
7. **`app/trips/[id]/page.tsx`**：每天標題列加「🔄 重排這一天」按鈕，展開回饋輸入框（≤200字，可空）+送出；loading/錯誤狀態；成功以回傳的完整 trip 更新 `view` state。
8. **`lib/__tests__/day-anchor.test.ts`（新）**：7 條（收藏對映/location優先/openingWarning驗證/無weekday不驗/對映不到降級/transport-rest跳過/欄位保留）。
9. **`lib/__tests__/trip-days.test.ts`**：新增 `dateForDay` 5 條。

範圍外（spec 已註記）：不支援同時重排多天；重生品質仍壓在 prompt（無 eval harness）。

驗證：`pnpm typecheck && pnpm test && pnpm lint && pnpm build` 全綠 → diff → GLM review → REVIEW/REPORT。人工實測（待部署後）：①對 3 天行程重排第 2 天（回饋「太趕」）→ 只有該天變、其他天/title/summary/flights/weather 不動；②新第 2 天不含第 1/3 天已排地點；③連打超過 rate limit → 429；④AI 回傳不合 schema（模擬）→ Firestore 不動、前端顯示錯誤。

---

## 2026-07-21（七）：Export & Offline（`specs/export-offline.md`，a+b+c 一次做完）

> 任務來源：「都做」批次最後一份延伸功能（trip-day-mode 留最後組裝）。spec 拆 a/b/c 三小件、
> 各自獨立驗收，本輪一次做完、一個 commit（跟其他輪一樣一 spec 一 commit 的慣例，內部仍照 a/b/c
> 分節記錄）。9 檔改動 + 4 新檔。
> ⚠️ 唯一與 spec 字面不符的偏差：**PWA icon 用 SVG 而非 PNG**。spec 寫「icon 產 192/512 兩檔」，
> 但本環境沒有影像生成工具，手刻 PNG 二進位編碼器風險高（filter byte/CRC32 任何一步錯就是壞圖，
> 沒有圖檢視工具能立即發現）；改用單一可縮放 `public/icon.svg`，在 manifest 裡宣告兩個 `sizes`
> 條目（192x192/512x512）指向同一檔——現代瀏覽器的 PWA 安裝檢查普遍接受 SVG icon。peanut 之後可
> 替換成真正的品牌 PNG，manifest 結構不用改。

### a. ICS 行事曆匯出
1. **`lib/ics.ts`（新）**：`generateIcs(trip: SavedTrip)` 純字串生成 VCALENDAR，零依賴。`escapeText`（RFC 5545 跳脫）、`foldLine`（依 UTF-8 位元組摺 75 bytes，不切在多位元組字元中間——中文字每字 3 bytes 是真實風險，已寫測試證明反摺後還原正確）、`toIcsLocal`（floating local time，跨午夜 durationMin 正確進位到隔天日期）。flights/lodgings 各自一個 VEVENT；`days[].schedule[]` 只在有 `startDate` 時才產生，否則整段略過並加 `X-COMMENT` 說明。
2. **`app/api/trips/[id]/ics/route.ts`（新）**：`requireUid` → 讀 trip → 回 `text/calendar` + `Content-Disposition: attachment`。
3. **`app/trips/[id]/page.tsx`**：「匯出行事曆 (.ics)」按鈕，`authedFetch` 取 blob → 暫時 object URL 觸發下載（GET 需帶 auth header，不能用裸連結）。
4. **`lib/__tests__/ics.test.ts`（新）**：10 條（基本結構/日期換算/無 startDate 降級/航班缺 date 降級/住宿只有入住無退房/跨午夜進位/跳脫/摺行反摺還原/UID 不重複）。

### b. 列印 / 存 PDF
1. **`app/trips/[id]/page.tsx`**：「列印/存 PDF」按鈕 → `window.print()`；`print:hidden`（Tailwind v4 內建 print variant，免額外設定）套在導覽列、編輯/刪除/匯出/列印按鈕本身、地圖 toggle 與展開區、重排 toggle 與展開區、導航連結、航班租車住宿編輯按鈕與住宿建議搜尋區；每天卡片容器加 `print:break-inside-avoid` 防止跨頁腰斬。

### c. PWA 離線
1. **`public/manifest.webmanifest`（新）**：name/short_name/icons（見上方偏差說明）/start_url=`/trips`/display=standalone/theme_color。
2. **`public/icon.svg`（新）**：見上方偏差說明。
3. **`public/sw.js`（新）**：手寫最小 SW，`CACHE_VERSION` 常數＋activate 清舊快取。導覽請求（`request.mode==="navigate"`）+ `_next/static/`：cache-first（涵蓋任何「已開過」的頁面，不限首頁/列表頁）。`/api/trips`、`/api/trips/[id]` 的 GET：network-first、失敗 fallback cache。其餘一律不攔截。
4. **`components/sw-register.tsx`（新）**：`navigator.serviceWorker.register`，僅 `NODE_ENV==="production"` 執行。
5. **`app/layout.tsx`**：`metadata.manifest` 掛連結；`themeColor` 改走獨立 `viewport` export（**技術修正**：Next.js 14 起 `metadata.themeColor` 已棄用，用 Context7 查證 Next.js 官方文件核對，非憑印象）；掛載 `<ServiceWorkerRegister />`。
6. **`app/trips/[id]/page.tsx`**：離線相關兩處小補強（spec 故障模式表已預期）——讀取成功但 `!navigator.onLine` 時顯示「📴 離線資料，可能非最新」橫幅（判斷離線時能讀到資料代表是 SW cache fallback）；讀取失敗且離線時，錯誤訊息改「目前離線，且尚未瀏覽過此行程，無法離線查看」。

範圍外（spec 已註記）：不做離線編輯/背景同步；三者皆零依賴（不裝 ics/jsPDF/serwist）。

驗證：`pnpm typecheck && pnpm test && pnpm lint && pnpm build` 全綠 → diff → GLM review → REVIEW/REPORT。人工實測（待部署後跑，PWA/SW 需 production 環境）：①匯入 Google/Apple 行事曆核對航班/住宿/每日事件時間；②Chrome 列印預覽單欄精簡版、天卡片不腰斬；③開過某行程後飛航模式仍可完整瀏覽，沒開過的顯示離線提示；④恢復連線拿到最新資料；⑤手機加入主畫面 standalone 開啟；⑥SW 只在 production 註冊。
