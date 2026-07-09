# GLM Review — Flight Lookup（AviationStack 帶航線+時刻）

- **時間戳**：round 1 = 2026-07-10 02:19（+0800）；round 2 = 2026-07-10 02:25:12 +0800
- **審查者**：GLM-5.2（MCP glm-reviewer.review_code）
- **審查範圍**：lib/aviationstack.ts、app/api/flight/lookup/route.ts、lib/quotas.ts、components/bookings.tsx、lib/__tests__/aviationstack.test.ts、.env.example（diff 見 task/diff.patch）
- **focus**：security, type-safety, 時區換算, 前端非同步 state（closure/race）, 用量護欄

---

## Round 1 — GLM 原始回傳（原封不動）

這份程式碼整體架構紮實，Result pattern 與型別定義都做得不錯，但在我特別關注的幾個領域仍存在一些盲點。以下是審查意見：

### 🐛 問題點

**1. 前端非同步 State 導致 Race Condition 與資料錯置**
`bookings.tsx` 中使用陣列索引 `i` 作為 `lookup` state 的 key，並在 `onFlightsChange` 中也用 `idx === i` 來更新對應的航班。如果使用者在按下「查航班」後、API 回傳前，新增或刪除了前面的航班欄位，導致 `flights` 陣列長度或順序改變，當 API 回傳時 `i` 就會指向錯誤的航班列，將查詢結果覆寫到錯誤的行程上。這是一個典型的 closure 捕獲過期 index 的邏輯瑕疵。

**2. Regex 驗證與正規化邏輯不一致**
`route.ts` 中的 Regex `/^[0-9A-Za-z]{2}\s?\d{1,4}[A-Za-z]?$/` 允許中間帶空白（如 `BR 198`）。但在 `lib/aviationstack.ts` 中，`iata` 經過 `.replace(/\s+/g, "")` 去除了空白。雖然不會導致崩潰，但 Regex 的設計與實際發送給 API 的行為不一致，應在進入 API 層前統一正規化，或讓 Regex 反映實際行為。

### ⚠️ 風險

**1. 時區換算的隱性風險**
`hhmmFromScheduled` 依賴 `Intl.DateTimeFormat` 處理時區，這部分邏輯正確。但 `scheduled` 字串若未帶有絕對時區資訊（例如 AviationStack 偶爾回傳 `2023-10-25T09:00:00` 而非 `+00:00`），JavaScript 的 `new Date()` 會將其視為「本地時間」解析，這會導致起降時間計算完全錯誤。建議在 `new Date(scheduledIso)` 之前，檢查字串是否包含時區標記，若無則強制補上 `Z` 或 `+00:00` 以確保以 UTC 解析。

**2. API Key 透過 Query String 傳遞的資安疑慮**
`url = ${base}/flights?access_key=${encodeURIComponent(key)}` 將 API Key 放在 URL 中。雖然這是 AviationStack 的要求，但 Query String 可能會被某些中間件、日誌記錄器或 Next.js 的底層 fetch 實作記錄下來。在正式環境中需確保伺服器日誌不會完整記錄 request URL。

**3. 用量護欄的 Fail-open 策略**
背景提到 `checkAndConsume` 採用 fail-open。對於付費且額度有限的 API，如果 quota 服務短暫故障導致 fail-open，使用者可以無限制呼叫，可能會瞬間耗損 100 次/月的免費額度。對於這種剛性額度限制的第三方 API，是否該考慮 fail-close 或至少在伺服器端加上本地記憶體的粗略次數限制？

**4. 前端 `onFlightsChange` 的更新策略**
`airline: f.airline.trim() === "" && data.airline ? data.airline : f.airline` 這個邏輯表示只有當原本航空公司為空時才帶入。但 `from`, `to`, `departTime`, `arriveTime` 卻是無條件覆寫（`data.from ?? f.from`）。如果使用者手動修改了出發地，查詢後會被覆蓋掉，這個 UX 風險需要評估。

### 💡 建議

**1. 統一航班號正規化**
建議在 `route.ts` 收到 `flightNo` 後，立刻 `flightNo = flightNo.trim().toUpperCase().replace(/\s+/g, "")`，然後再拿去驗證與傳遞。這樣 Regex 可以簡化為 `/^[0-9A-Z]{2}\d{1,4}[A-Z]?$/`，且不需要在 `aviationstack.ts` 裡再做一次 `replace`。

**2. 時區 fallback 的防禦性**
在 `hhmmFromScheduled` 中，如果 `timezone` 為空且走到 Regex fallback，取出的時間是 UTC 時間。但 UI 上顯示的沒有時區標記，使用者會誤以為是當地時間。建議在無 timezone 資訊時，至少不要回傳未轉換的 UTC 時間，或明確標示。

### ❓ 待釐清問題

1. **AviationStack 回傳的 `scheduled` 欄位格式是否絕對包含時區（如 `+00:00` 或 `Z`）？** 如果不保證，目前的時區轉換在邊界情況下會出錯。
2. **`checkAndConsume` 的 fail-open 是基於什麼考量？** 對於這種「對外付費/有限額」的 API，通常會傾向 fail-close 以保護額度，想了解這裡選擇 fail-open 的原因。
3. **`bookings.tsx` 的 Race Condition**：既有 `flights` 清單以 index 作為 React key 已經是個壞味道，如果清單支援刪除/排序，不僅查詢狀態會錯亂，React 的 reconciliation 也可能出錯。是否有計畫改用 stable unique ID？

---

## Round 1 — 仲裁（逐條，經實際驗證）

### 🐛-1 前端非同步 race / stale index — **真（P2），已修**
真。我新增的 async 回填用 render 期閉包的 `flights` 陣列重建，若查詢期間使用者改動列，會覆寫並行編輯或寫錯列。**已修**：`onFlightsChange` 型別放寬為 `Dispatch<SetStateAction<FlightDraft[]>>`（兩呼叫端都直傳 `setFlightDrafts`），回填改 **functional update（讀最新 state）+ 身分守衛 `idx===i && f.flightNo.trim()===flightNo`**——列被增刪/改號時放棄回填，不覆寫。

### 🐛-2 regex 與正規化不一致 — **真（小），已修**
真（`BR 198` 帶空白通過 regex 但送 API 前被去空白）。**已修**：route 收到後先 `trim().toUpperCase().replace(/\s+/g,"")` 再驗證，regex 簡化為 `/^[0-9A-Z]{2}\d{1,4}[A-Z]?$/`，與實際送 API 字串一致。

### ⚠️-1 scheduled 缺時區標記 → new Date 當本地 — **真（邊界），已修**
真。SPEC 實測 scheduled 帶 `+00:00`，但缺 offset 時 `new Date` 會當伺服器本地時間。**已修**：`hhmmFromScheduled` 先測 `/(?:Z|[+-]\d{2}:?\d{2})$/`，缺標記則補 `Z` 強制 UTC 解析；新增單測 `("2026-07-09T09:00:00","Asia/Taipei")→"17:00"`。

### ⚠️-2 API key 在 query string — **真但已符合，不改**
真（AviationStack 強制 key 進 query）。但本程式**不記錄也不回傳完整 URL**：`api_error` 訊息只含 `res.status` + body 片段（非 URL），且被 route 對映成通用訊息（不回給前端）、route 未 `console.log` 該錯誤。key 不進日誌/回應。無需改碼；正式站僅需確保平台不整段記 request URL（維運層，記 known issue）。

### ⚠️-3 fail-open 對硬額度 API — **真但屬 peanut 全域政策，不改（記 known issue）**
真。fail-open 是 peanut 全域決策（2026-07-09：限流基礎設施抖動不該擋掉所有付費入口）。此入口 requireUid + 按鈕觸發，Firestore 故障期間的曝險有限但確存在。是否對「硬月額度」API 改 fail-close / 加本地粗略計數＝政策取捨，交 peanut，記 known issue。

### ⚠️-4 from/to/time 無條件覆寫 vs airline 只補空 — **真但 BY DESIGN（SPEC §2.4/§3）**
這是 SPEC 明定行為：使用者**明確按了查航班**要帶航線+時刻，故一律帶入；airline 因第一層/手填優先而只補空（SPEC §3「airline 不蓋」）。非缺陷。

### 💡-1 統一正規化 — **已採納**（見 🐛-2 修正）。
### 💡-2 fallback 回未標記 UTC — **不修**：real data 一律帶 timezone、幾乎不走 fallback；且全 app 的 HH:mm 本就無時區標記（既有慣例），fallback 為 best-effort。記 known issue。

### ❓-1 scheduled 是否必帶時區 — 已由 ⚠️-1 補 Z 防禦（不保證亦不會算錯）。
### ❓-2 fail-open 理由 — peanut 全域政策（見 ⚠️-3）。
### ❓-3 index 當 key / stable ID — 全 app 既有慣例；本輪的 functional update + 身分守衛已擋掉 async 資料錯置；改 stable ID 是跨 bookings 系統重構，超出本 SPEC，記 known issue。

---

## Round 2 — GLM 原始回傳（審三處修正，原封不動）

## 🐛 問題點
無。

## ⚠️ 風險

1. **修正 A — `flights[i]?.flightNo` 仍讀自 stale closure（渲染期快照）**
   雖然 `onFlightsChange` 已正確改用 functional update 來寫入，但函式開頭讀取航班號的 `const flightNo = flights[i]?.flightNo.trim() ?? "";` 這行的 `flights` 依然是當前渲染閉包裡的快照。如果在非同步請求發起前，使用者快速修改了該欄位，`flightNo` 拿到的會是舊值，並將舊值發送給 API。
   這不會導致崩潰，且因為身分守衛 `f.flightNo.trim() === flightNo` 的保護，最終不會把錯誤資料寫回 state（因為最新 state 的欄位已經改變，守衛會失敗而放棄回填）。但這會發送一個無效的 API 請求，浪費資源且可能讓使用者困惑（查了舊航班號）。

2. **修正 B — Regex 限制過於嚴格，可能擋住合法航班號**
   Regex `^[0-9A-Z]{2}\d{1,4}[A-Z]?$` 強制開頭必須是「兩個字元」。這對於 IATA 標準是正確的。但對於 ICAO 標準（3 碼航空代碼 + 數字，如 EVA198）將會被直接拒絕。若未來系統需要接軌 ICAO 航班號，此 regex 會成為阻礙。

3. **修正 C — 無時區的 fallback 正規表達式不夠精確**
   `scheduledIso.match(/T(\d{2}:\d{2})/)` 這個 fallback 會貪婪匹配字串中任何 `T` 後面跟著時間格式的部分。雖然在標準 ISO 格式下不會出錯，但如果傳入的時間字串格式非預期（例如 `2026-07-09T09:00:00T10:00:00`），可能會匹配到錯誤的位置。建議加上行首或更嚴格的日期限制。

## 💡 建議

1. **修正 A — 考慮將 `flightNo` 作為參數傳遞**：直接將當前的 `flightNo` 作為參數傳入，避免 stale closure 的尷尬期。
2. **修正 B — Regex 可讀性**：`[0-9A-Z]{2}` 允許數字開頭（例如 `12345`）。若要嚴格限制應改為 `^[A-Z]{2}\d{1,4}[A-Z]?$`，並加註解說明為何允許數字開頭。

## ❓ 待釐清問題

1. **修正 A — `flights` 的來源**：是 props 還是 useSelector？`lookupFlightRow` 有沒有被 useCallback 包住、dependency array 有沒有正確包含 `flights`？
2. **修正 B — `lookupFlight` 內部的重複正規化**：既然 route 已保證正規化，是否應把正規化統一收在 route 層？
3. **修正 C — `timezone` 的來源與格式**：是使用者輸入還是資料庫？若傳入 `UTC+8` 這種非 IANA 格式，Intl 會拋錯並 fallback，是否符合預期？

---

## Round 2 — 仲裁

### ⚠️-1 flightNo 讀自 stale closure — **[FALSE POSITIVE]**
`const flightNo = flights[i]?.flightNo.trim()` 在 `lookupFlightRow` **開頭同步執行**（任何 await 之前）。onClick 綁的是**最新一次 render 的閉包**（每次 keystroke 都重渲染），故點擊當下讀到的即當前值——**不存在「發起請求前的 stale 窗口」**。加上身分守衛保護寫入。GLM 假設的「非同步請求發起前修改」與同步捕獲時序矛盾。無需改。

### ⚠️-2 / 💡-2 regex 拒 ICAO / 應改 `[A-Z]{2}` — **[FALSE POSITIVE，且採納會造成 regression]**
AviationStack `flight_iata` 參數用的是 **IATA（2 碼）**，本功能全線以 IATA 為基礎（`airlineFromFlightNo` 亦解 2 碼）；ICAO 3 碼不被該 endpoint 參數支援，拒絕是正確。且 `IATA_AIRLINES` 表含 **數字開頭代碼 `7C`（濟州）、`5J`（宿霧）、`3K`、`B7`**——若照 💡-2 改成 `[A-Z]{2}` 會**擋掉這些合法航空**（regression）。維持 `[0-9A-Z]{2}`（已加註）。

### ⚠️-3 fallback regex 貪婪匹配 — **真但可忽略，不修**
`.match`（無 /g）回**第一個** `T(\d{2}:\d{2})` → 正常 ISO 取到正確 HH:mm。GLM 舉的 `...T09:00:00T10:00:00` 非合法 ISO、非 AviationStack 真實資料。best-effort fallback、第一匹配即正確。記 known issue（可選加嚴）。

### ❓-1 lookupFlightRow 是否 useCallback — 已釐清：**非** useCallback，定義在 component body、**每次 render 產生新閉包**含當前 `flights`（來自同組件 props/state），無 stale-first-render 問題。
### ❓-2 lookupFlight 重複正規化 — 已釐清：**刻意防禦**。`lookupFlight` 是 lib 函式，可能被 route 以外（測試/未來呼叫端）直接呼叫，不假設呼叫端已正規化；route + lib 各自正規化為 defense-in-depth，冪等無害。
### ❓-3 timezone 來源/格式 — 已釐清：來自 **AviationStack 回應**（`dep.timezone`/`arr.timezone`，IANA 字串如 `Asia/Taipei`），非使用者輸入；非 IANA 值由 try-catch 落 fallback，符合預期。

---

## 結論
- Round 1：🐛×2 **皆真，已修**（race → functional update + 身分守衛；regex 不一致 → route 先正規化）。⚠️×4 中 1 真已修（補 Z）、1 真已符合（key 不入日誌）、2 真但屬 peanut 政策/SPEC 設計；💡×2 一採納一記錄。
- Round 2：🐛×0。⚠️/💡/❓ 皆 **FALSE POSITIVE 或已釐清**；GLM 的 💡-2（改 `[A-Z]{2}`）**若採納會擋掉 7C/5J/3K/B7 等合法航空**，正確地未採納。
- **現無 P0/P1 未修缺陷**；達 2 輪上限、無殘留真缺陷，收斂。
- Known issues（交 peanut）：fail-open vs 硬月額度、正式站日誌勿記完整 URL、fallback 未標記時區/可加嚴、bookings 全面改 stable ID。
