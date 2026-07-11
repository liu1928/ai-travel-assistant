# Spec — Flight Lookup（帶航線+時刻）

> 狀態：已上線。**2026-07-11 起資料源換為 AeroDataBox（見 §8），§0–§7 的 AviationStack 內容保留為歷史記錄**。
> 實作時照本文件執行；有歧義回來改本文件，不要口頭發散。
> 這是航班 autofill 的**第二層**（第一層＝`specs/flight-airline-autofill.md`，離線帶航空公司名，已上線）。
> 本層用 **AviationStack** 帶出**航線 + 起降時刻**。真實 API 資料（非 AI），符合 `specs/flights-rentals.md §3` 防 AI 編造原則。

## 0. 關鍵事實與取捨（先講清楚）

- **端點**：`GET {BASE}/flights?access_key=<KEY>&flight_iata=<航班號>`；回 `data[]`，每筆含 `departure/arrival`（airport, iata, timezone, scheduled…）+ `airline`（name, iata）+ `flight`（iata, number）。
- **免費方案**：100 次/月、**只支援 http**（付費才 https）。→ `AVIATIONSTACK_BASE_URL` 走 env（預設 `https://api.aviationstack.com/v1`；免費方案設成 `http://…`）。⚠️ http 會讓 key 明文傳輸，付費升 https 較好。
- **日期**：flights 端點回「當前+近期」班次，**不保證是使用者的未來出發日**。同航班號每天飛、航線穩定、時刻約略一致，故帶出的是「典型航線+排定時刻」——**只 autofill 航線與時刻、不 autofill 日期**（日期留使用者填）。這是已知限制、非 bug。
- **觸發＝按鈕**（非打字即查）：每筆航班一顆「查航班」鈕，使用者按了才打 API → **控制成本**（免費僅 100 次/月，且走用量護欄）。

## 1. 總覽

`/trip` 與 `/trips/[id]` 共用的航班編輯器（`components/bookings.tsx` 的 `BookingsFields`）中，每筆航班的「航班號」旁加「🔍 查航班」鈕：

```
使用者打航班號 BR198（第一層已離線帶出「長榮航空」）→ 按「🔍 查航班」
   │
   ▼
POST /api/flight/lookup { flightNo: "BR198" }   ← requireUid + checkAndConsume(flight_lookup)
   │
   ▼
lookupFlight("BR198")                            ← lib/aviationstack.ts
   │   GET {BASE}/flights?access_key&flight_iata=BR198 → data[0]
   │   解析：from = `${dep.airport} ${dep.iata}`、to = `${arr.airport} ${arr.iata}`、
   │         departTime/arriveTime = dep/arr.scheduled 取當地 HH:mm、
   │         airline = 離線中文名(第一層) ?? api airline.name
   ▼
回 { airline?, from, to, departTime, arriveTime }（無日期）
   ▼
前端把這筆航班 draft 的 from/to/departTime/arriveTime 填上（airline 空才填）；顯示「已帶入」/「查無此航班」
```

## 2. 契約

### 2.1 `lib/aviationstack.ts`（新，伺服器端）

```ts
export type FlightLookupResult = {
  airline?: string;
  from: string;       // "台北 TPE" 風格（airport + iata）
  to: string;
  departTime: string; // HH:mm（當地）
  arriveTime: string; // HH:mm（當地，跨日不另計，見 §7）
};
export type FlightLookupError =
  | { kind: "missing_key" }
  | { kind: "not_found" }           // API 回空 data
  | { kind: "api_error"; message: string };

export async function lookupFlight(flightNo: string): Promise<Result<FlightLookupResult, FlightLookupError>>;
```

- `BASE = envOr("AVIATIONSTACK_BASE_URL", "https://api.aviationstack.com/v1")`；`KEY = process.env.AVIATIONSTACK_API_KEY`（缺 → `missing_key`）。
- `flight_iata` 用正規化的航班號（trim、大寫、去空白）。`data` 空/無 dep/arr → `not_found`。
- **HH:mm 取「機場當地」時刻**：⚠️ 實測 AviationStack 的 `scheduled` 是 **UTC**（`2026-07-09T09:00:00+00:00`），另有 `timezone` 欄（如 `Asia/Taipei`）。**必須把 UTC instant 轉成機場當地時區**（09:00 UTC = 17:00 台北），不能直接切字串。用 `Intl.DateTimeFormat("en-GB", { timeZone, hour:"2-digit", minute:"2-digit", hour12:false })` 格式化（Node 24 內建 full ICU 支援 IANA tz）。抽純函式 `localHhmm(scheduledIso, timezone)` 便於單測；`timezone` 缺 → fallback 取 ISO `T` 後 5 碼。
- `airline`：先用第一層 `airlineFromFlightNo`（中文名），沒有再用 API 的 `airline.name`。
- 只取 `data[0]`（最相關/最近一筆）。best-effort：任何解析缺欄位 → `not_found`，不丟例外。

### 2.2 `lib/quotas.ts`

- `SERVICE_COST_USD` 加 `flight_lookup: 0.02`（AviationStack 免費 100/月；$ 值只為相對護欄，實際限制在月額度與 per-uid/global 每日護欄）。

### 2.3 `POST /api/flight/lookup`（新）

- `requireUid` → `checkAndConsume(uid, "flight_lookup")`（付費 API，走 $ 護欄；擋回 429/503）。
- Body：`{ flightNo: string }`；trim 空、或不像航班號（無法解析出 2 碼代碼+數字）→ 400。
- `lookupFlight` → 成功 `200` 回 `FlightLookupResult`；`not_found` → 404「查無此航班（或今日無班次）」；`missing_key` → 500；`api_error` → 502。

### 2.4 前端 `components/bookings.tsx`

- `BookingsFields` 每筆航班的「航班號」欄旁加「🔍 查航班」鈕（disabled 當 flightNo 空或查詢中）。
- 按下 → `authedFetch("/api/flight/lookup", { flightNo })`：
  - 成功 → 更新該筆 draft：`from/to/departTime/arriveTime` 一律帶入（使用者明確要求查），`airline` **僅當空才帶**（不蓋第一層或手填的）。
  - 失敗 → 顯示該筆的錯誤訊息（「查無此航班」等）。
- 需要在 `BookingsFields` 內用 `authedFetch`（`@/lib/use-auth`）+ per-row 的 loading/error state。lookup 不影響既有 `draftsToBookings` 驗證。

### 2.5 設定
- `.env.example` 加 `AVIATIONSTACK_API_KEY=` 與 `AVIATIONSTACK_BASE_URL=`（註明免費方案設 `http://api.aviationstack.com/v1`）。
- 正式站：`AVIATIONSTACK_API_KEY` 進 **Cloud Secret Manager** + `apphosting.yaml` 綁 secret（比照 ANTHROPIC/GOOGLE_MAPS）；`AVIATIONSTACK_BASE_URL` 視方案放 apphosting.yaml env（免費填 http）。**動 secret/apphosting.yaml 前先與 peanut 確認**（禁動清單）。

## 3. 設計決策

- **真實 API、非 AI**：航線/時刻來自 AviationStack，沿用「航班不讓 AI 生成」原則。
- **按鈕觸發、非打字即查**：免費僅 100 次/月，按鈕讓每次查詢是使用者明確意圖；再疊 `checkAndConsume` 每日護欄雙保險。
- **只帶航線+時刻、不帶日期**：real-time 端點不保證使用者未來日期；帶「典型排定」值，日期留使用者。
- **HH:mm 取當地、不換時區**：比照既有 flights（只存 HH:mm、不引時區庫）。
- **BASE 走 env**：免費 http / 付費 https 都能用，不寫死。
- **airline 不蓋**：第一層/手填的航空公司優先，lookup 只補空的。
- **第一層仍在**：打字即帶航空公司名（離線、零成本）；本層是「按鈕加值」帶航線時刻。

## 4. 影響檔案

| 檔案 | 變更 |
|---|---|
| `lib/aviationstack.ts` | 新增：`lookupFlight` + 純函式 `hhmmFromScheduled` |
| `lib/quotas.ts` | `SERVICE_COST_USD` 加 `flight_lookup` |
| `app/api/flight/lookup/route.ts` | 新增：auth + 限流 + lookupFlight |
| `components/bookings.tsx` | 每筆航班加「🔍 查航班」鈕 + per-row loading/error + authedFetch |
| `lib/__tests__/aviationstack.test.ts` | 新增：`hhmmFromScheduled`（含 offset ISO、跨日、格式異常） |
| `.env.example` | 加 `AVIATIONSTACK_API_KEY` / `AVIATIONSTACK_BASE_URL` |
| `apphosting.yaml`（peanut 確認後） | 綁 `AVIATIONSTACK_API_KEY` secret + 視方案設 BASE_URL |

## 5. 驗證基準
```bash
pnpm typecheck && pnpm test && pnpm lint
```
實測（需先設 `AVIATIONSTACK_API_KEY`）：
1. 打 `BR198`（已帶長榮）→ 按「查航班」→ from/to/起降時刻自動填入（TPE→? 與排定時刻）。
2. 打不存在的 `ZZ9999` → 按查航班 → 顯示「查無此航班」，不亂填。
3. 未設 key → route 回 500 明確訊息（不靜默）。
4. 狂按查航班超過 $ 護欄 → 429。
5. `hhmmFromScheduled` 單測：`2026-09-25T10:00:00+08:00`→`10:00`、跨日 `…T23:50…`→`23:50`、異常字串→空或明確處理。

## 6. 故障模式
| 症狀 | 原因 | 解法 |
|---|---|---|
| 查航班回 500 | 缺 `AVIATIONSTACK_API_KEY` | 設 key（Secret Manager + apphosting.yaml）並重部署 |
| 一直「查無此航班」 | 該航班號今日無班次 / 免費額度用完 / http-https 不符方案 | 檢查 AviationStack 後台額度；免費方案 BASE 設 `http://` |
| 時刻對不上使用者日期 | real-time 端點回典型排定、非該未來日（§7 已知限制） | 使用者按實際航班微調；日期本就手填 |
| 429 | 觸發 $ 護欄 | 明天再試或調 quota |

## 7. 已知限制（非 bug）
- **不保證使用者未來出發日的精確班次**：帶「典型航線+排定時刻」，日期留使用者填。
- **跨日航班**（紅眼）：arriveTime 只存 HH:mm、不做跨日計算（沿用 flights-rentals §7）。
- **免費方案 http + 100 次/月**：key 明文、額度有限；付費升 https + 更多額度。
- 只取 `data[0]`；同號多航段/共掛班號時可能非使用者要的那筆（罕見，使用者可手改）。

---

## 8. 換源 AeroDataBox（2026-07-11，peanut 核准）

**為什麼換**：§7 第一條限制被使用者實際踩到——航空公司換季做長期班表變更後，AviationStack
即時 `/flights` 端點（不帶日期、只回今天這班）帶出變更前的舊時刻，且資料日期在解析層被丟棄、
前端無警語，使用者無從發現。免費層要查未來班表只有 `flightsFuture`，但那是機場式查詢
（iataCode+type+date，不能航班號直查）、有 +7 天盲區，升 Basic $49.99/月也不解此結構問題。

**選型**（四家評比經官方原文複核，詳 task/PLAN.md 2026-07-11 版）：AeroDataBox 勝出——
`GET /flights/number/{航班號}/{dateLocal}?dateLocalRole=Departure` 原生支援「航班號+日期」直查，
未來班表免費層可查 365 天（換季班表最慢約 2 週反映）、回應自帶 `{utc, local}` 雙時區時間
（**local 已是機場當地**，不需 Intl 換算——與 AviationStack scheduled 是 UTC 的舊坑相反）、
全程 https。RapidAPI BASIC $0/月：600 units（Flight Status 是 Tier 2＝2 units/次 ≈ 300 次/月）、
hard limit 超額擋請求不扣款（但訂閱需綁信用卡）、限速 1 req/s。無 SLA；台灣 schedules 覆蓋 94%。

**實作差異**（對照 §1–§4）：
- `lib/aerodatabox.ts` 取代 `lib/aviationstack.ts`（舊檔保留備查）。`lookupFlight(flightNo, dateLocal?)`
  多收出發日；未填 → 以 UTC 今日近似「今天這班」（維持舊行為）。
- `FlightLookupResult` 加 `dataDate`（該筆班表的出發地當地日期），前端顯示「已帶入（YYYY-MM-DD 班表）」；
  未填日期查詢會提示「先填日期再查可拿到當天班表」——把 §7 第一條限制透明化。
- 回應是 FlightContract **陣列**：缺起降資訊的列剔除，多筆（同號一日多班/多航段）取排定出發最早者。
- `POST /api/flight/lookup` body 加收 `date?`（YYYY-MM-DD，格式錯 400）；quota `flight_lookup` 沿用。
- 認證：header `x-rapidapi-key` + `x-rapidapi-host`（由 `AERODATABOX_BASE_URL` 推導，
  預設 `https://aerodatabox.p.rapidapi.com`）。secret：`AERODATABOX_API_KEY`
  （Secret Manager + apphosting.yaml，動之前照禁動清單與 peanut 確認）。

**新的已知限制**：
- 未填日期時的「今日」以台灣時區（Asia/Taipei）計——本專案使用者主要在台灣；在其他時區查非台灣出發的航班仍可能差一天（前端提示填日期即可避開）。
- 換季班表更新頻率「每 2 週/機場區域」——剛公布的變更最慢 2 週才反映。
- 免費層資料窗 ±365 天；超窗查詢會查無。
- 多航段同號航班取第一段，中停後的最終抵達時間需使用者手改（沿用 §7 舊限制）。
