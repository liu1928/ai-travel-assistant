<!-- 產生日期: 2026-07-10 | 產生模型: claude-opus-4-8 | 引用 REVIEW.md 時間戳: round1 2026-07-10 02:19 / round2 2026-07-10 02:25:12 +0800 -->

# REPORT — Flight Lookup（AviationStack 帶航線+時刻）

> 依據 GLM 審查：`task/REVIEW.md`（兩輪）。SPEC：`specs/flight-lookup.md`。PLAN：`task/PLAN.md`。分支：`feat/flight-lookup`。

## 做了什麼
航班 autofill **第二層**：使用者打航班號、按「🔍 查航班」→ 打 `POST /api/flight/lookup` → AviationStack 帶出**航線 + 起降時刻**（真實 API 非 AI，符合「航班不讓 AI 生成」原則）。第一層（離線帶航空公司中文名）仍在。按鈕觸發（非打字即查）+ requireUid + 每日 $ 護欄雙重控成本。**只帶航線+時刻、不帶日期**（real-time 端點回典型排定班次，不保證使用者未來日期——已知限制、非 bug）。

## 改動檔案（diff 摘要，見 task/diff.patch）
| 檔案 | 變更 |
|---|---|
| `lib/aviationstack.ts`（新） | `lookupFlight(flightNo)` → `Result<FlightLookupResult, FlightLookupError>`；純函式 `hhmmFromScheduled(iso, tz?)` 把 **UTC → 機場當地 HH:mm**（`Intl` + `hourCycle:h23` 避免午夜 24:00；缺時區標記補 `Z` 強制 UTC；tz 缺/無效 → fallback 取 ISO T 後 5 碼）。airline 第一層中文名優先。只取 `data[0]`。 |
| `app/api/flight/lookup/route.ts`（新） | requireUid → `checkAndConsume("flight_lookup")` → 正規化+驗證 flightNo（不像航班號 400）→ lookupFlight。not_found 404 / missing_key 500 / api_error 502。 |
| `lib/quotas.ts` | `SERVICE_COST_USD.flight_lookup = 0.02`（`PaidService` 型別自動涵蓋）。 |
| `components/bookings.tsx` | 每筆航班加「🔍 查航班」鈕 + per-row loading/error state + `authedFetch`；成功回填 `from/to/departTime/arriveTime`（一律帶）、`airline`（僅空才帶）。回填用 **functional update + 航班號身分守衛**防並行編輯覆寫。`onFlightsChange` 型別放寬為 `Dispatch<SetStateAction<FlightDraft[]>>`。 |
| `lib/__tests__/aviationstack.test.ts`（新） | `hhmmFromScheduled` 8 條單測（UTC→tz、東京、跨日、午夜 00:00、缺 offset 補 Z、缺 tz fallback、無效 tz、異常字串）。 |
| `.env.example` | 加 `AVIATIONSTACK_API_KEY` / `AVIATIONSTACK_BASE_URL`（註明免費方案設 http）。 |

## 自我驗證（全過）
- `pnpm typecheck`：**通過**，0 error。
- `pnpm test`：**10 檔 84 tests 全過**（+8 條 hhmmFromScheduled）。
- `pnpm lint`：**通過**（`LINT_OK`）。
- `pnpm build`：**Compiled successfully**，`ƒ /api/flight/lookup` 已註冊。

## GLM finding 統計（兩輪，逐條仲裁見 REVIEW.md）
**Round 1**：🐛×2 **皆真、已修**（① async closure/race → functional update + 身分守衛；② regex 與正規化不一致 → route 先 trim/upper/去空白再驗證）。⚠️×4：1 真已修（scheduled 缺 offset 補 Z）、1 真已符合不需改（key 不入日誌/回應）、2 真但屬既有政策/SPEC 設計（fail-open、from·to·time 明確覆寫）。💡×2：一採納（正規化）、一記錄。
**Round 2**（審修正）：🐛×**0**。其餘 ⚠️/💡/❓ **皆 FALSE POSITIVE 或已釐清**——尤其 GLM 建議把 regex `[0-9A-Z]{2}` 改成 `[A-Z]{2}`，**若採納會擋掉 `7C`/`5J`/`3K`/`B7` 等數字開頭合法 IATA 航空（regression）**，正確地未採納。
**淨結果**：真 P0/P1 = 0（原有 2 條真缺陷已於 round 1 修掉並通過 round 2）。

## Known issues（交 peanut，非阻斷）
1. **fail-open vs 硬月額度**：`checkAndConsume` 全域 fail-open（peanut 2026-07-09 定）。AviationStack 免費 100 次/月是硬額度，Firestore 故障期間曝險有限但存在；是否對此類 API 改 fail-close / 加本地粗略計數＝政策取捨。
2. **正式站日誌**：key 走 query string（AviationStack 強制）；程式不記/不回傳完整 URL，但平台層需確保不整段記 request URL。
3. **免費方案 http**：BASE 設 `http://` 時 key 明文傳輸；付費可升 https。
4. bookings 全面改 stable ID（取代 index）＝跨系統重構，超出本 SPEC。

## ⚠️ 待 peanut 確認才動（禁動清單）——本輪未做
程式碼已全綠，但正式站要能查航班，需**動 Secret Manager + apphosting.yaml**（禁動清單，須 peanut 授權）：
1. **Cloud Secret Manager** 建 secret `AVIATIONSTACK_API_KEY` = `e273e5fae43bd144437d346fa6651e50`（用 Write 寫入、不帶 BOM；比照 ANTHROPIC/GOOGLE_MAPS 授權 App Hosting SA 讀取）。
2. **apphosting.yaml** 綁該 secret；因**免費方案**，另設 `AVIATIONSTACK_BASE_URL: http://api.aviationstack.com/v1`（env，非 secret）。
→ 我會把確切指令列給你確認再執行；不在本輪自行寫入。

## 現況
- 分支 `feat/flight-lookup`（off main a7d6dbd0），待 commit。未合併、未部署、未動 secret/apphosting。

**停止，等待 peanut 驗收與「動 secret/apphosting」授權。不自行宣布 Done。**
