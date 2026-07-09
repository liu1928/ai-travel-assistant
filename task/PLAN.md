# PLAN — Flight Lookup（AviationStack 帶航線+時刻）

> 任務來源：peanut「合併後接著做 AviationStack 航班查詢」。SPEC：`specs/flight-lookup.md`（已定稿）。
> 這是航班 autofill 第二層（第一層＝離線帶航空公司名，已上線）。按鈕觸發、真實 API、走用量護欄。
> 分支：`feat/flight-lookup`（off main a7d6dbd0）。

## 步驟（>3 檔，先列計畫）

1. **`lib/aviationstack.ts`（新）**：`lookupFlight(flightNo)` → `Result<FlightLookupResult, FlightLookupError>`；
   純函式 `hhmmFromScheduled(scheduledIso, timezone?)` 把 **UTC instant 轉機場當地 HH:mm**
   （`Intl.DateTimeFormat("en-GB", { timeZone, hour:"2-digit", minute:"2-digit", hourCycle:"h23" })`，
   避免 midnight "24:00"）；timezone 缺/無效 → fallback 取 ISO `T` 後 5 碼。
   airline 優先用第一層 `airlineFromFlightNo`（中文），無則 API `airline.name`。只取 `data[0]`。
   缺 key → `missing_key`；空 data／缺 dep·arr → `not_found`；fetch/JSON/API error → `api_error`。
2. **`lib/quotas.ts`**：`SERVICE_COST_USD` 加 `flight_lookup: 0.02`。
3. **`app/api/flight/lookup/route.ts`（新）**：`requireUid` → `checkAndConsume("flight_lookup")` →
   驗 `flightNo`（不像航班號 → 400）→ `lookupFlight`。not_found 404 / missing_key 500 / api_error 502。
4. **`components/bookings.tsx`**：每筆航班加「🔍 查航班」鈕 + per-row loading/error state + `authedFetch`。
   成功：`from/to/departTime/arriveTime` 一律帶入、`airline` 僅空才帶；失敗顯示該筆訊息。
5. **`lib/__tests__/aviationstack.test.ts`（新）**：`hhmmFromScheduled` 單測（UTC→tz、跨日、midnight、
   fallback 無 tz、無效 tz、異常字串）。
6. **`.env.example`**：加 `AVIATIONSTACK_API_KEY` / `AVIATIONSTACK_BASE_URL`（註明免費方案設 http）。

## 驗證
`pnpm typecheck && pnpm test && pnpm lint && pnpm build` → GLM review → REVIEW.md → 仲裁 → REPORT.md。

## ⚠️ 禁動清單（停下與 peanut 確認，不偷做）
- **Cloud Secret Manager**：寫入 `AVIATIONSTACK_API_KEY`（值 `e273e5fae43bd144437d346fa6651e50`）。
- **`apphosting.yaml`**：綁 secret + 視方案設 `AVIATIONSTACK_BASE_URL`（免費 → `http://api.aviationstack.com/v1`）。
- → 程式碼全綠 + 審完後，把這兩步的**確切指令**列給 peanut 確認再執行；不在本輪自行寫入。
