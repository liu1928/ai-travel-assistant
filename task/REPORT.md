<!-- 產生日期: 2026-07-10 | 產生模型: claude-opus-4-8 | 引用 REVIEW.md 時間戳: 2026-07-10 00:0x（Asia/Taipei）| 下次審視: 接 Booking Demand API（即時房價）或加日期/DNA 預算篩選前 -->

# REPORT — 住宿建議 + 訂房連結（②b）

> 任務來源：peanut 指示（多加住宿功能、串 Booking 給適合住宿；加價位篩選 + 錨定行程地理重心）。SPEC：`specs/lodging-suggest.md`。分支 `feat/lodging-suggest`（off main）。
> 依 CLAUDE.md Executor 流程完成：實作 → 自我驗證 → GLM 審查（`task/REVIEW.md`）→ 仲裁 → 本報告。
> **未宣告 Done——等 peanut 驗收。**

## 1. 改了哪些檔案（7 檔 + spec）

| 檔案 | 改動 |
|---|---|
| `lib/booking-link.ts`（新） | `buildLodgingLink`：**可插拔變現**（Stay22 > Booking aid > Travelpayouts > 純連結），純函式、client/server 共用 |
| `lib/lodging.ts`（新） | `suggestLodging`：Places 旅宿查詢 + **地理重心 locationBias** + **priceLevel 價位篩** + 每筆訂房連結 |
| `app/api/lodging/suggest/route.ts`（新） | auth + `checkAndConsume` 限流 + `getTrip`/`listPlaces` 算**行程地理重心** + suggestLodging |
| `app/trips/[id]/page.tsx` | 「🏨 住宿建議」區塊：價位下拉 + 「找住宿」+ 清單（名稱/⭐/價位/地址/訂房連結）+ 整區連結 |
| `lib/__tests__/booking-link.test.ts`（新） | 四種變現 env 分支 + 中文/空白 encode + 日期，5 case |
| `.env.example` | 加 `NEXT_PUBLIC_STAY22_AID` / `NEXT_PUBLIC_BOOKING_AID` / `NEXT_PUBLIC_TRAVELPAYOUTS_MARKER` |
| `specs/lodging-suggest.md`（新） | 本功能 SPEC |

**做的事**：`/trips/[id]` 按「找住宿」→ 以**行程實際地理重心**（schedule 地點對照收藏座標算質心，零額外 API 成本）查 Places 旅宿、依評分排序、可依**價位篩**→ 每筆「訂房 →」deep-link。連結**不綁死聯盟商**：預設純 Booking（一定能用、無佣金），env 設了才帶佣金（**推薦 Stay22**，因 Booking 已終止部分聯盟合作）。Places 查詢走既有 $ 護欄。

## 2. 測試結果
```
pnpm typecheck  → ✓
pnpm test       → ✓ 61 passed（新增 booking-link 5 case）
pnpm lint       → ✓
```

## 3. GLM finding 統計（詳見 `task/REVIEW.md`）
- 🐛 3：**2 FALSE POSITIVE**（送審用節略版把 stay22 分支/型別縮成註解 → 誤判「沒 return / any」；實際碼正確、typecheck 過）、1 不修（const 屬性修改合法、lint 過）
- ⚠️ 6：**1 真已修**（listPlaces 失敗加 warn）、1 FALSE POSITIVE（open-redirect——連結 scheme+host 是硬編 https 字面量、query 經 encode，無注入）、1 已驗證安全（tripId 越權：getTrip 走 uid-scoped 路徑）、3 非問題/已知限制（換日線質心、日期未傳、name 比對）
- 💡 3：**1 採納**（priceLevel 用 `in` 守未知 enum）、2 FALSE POSITIVE（節略）
- ❓ 4：均已釐清

## 4. Known issues / 待實測（部署後）
- 實測：開「沖繩」且 schedule 地點多在收藏裡的行程 → 「找住宿」出**沖繩該區**旅宿（重心錨定）；價位選「$ 平價」→ 只剩 priceLevel≤1；`.env` 無變現 ID → 純 Booking 連結；狂按超 $ 護欄 → 429。
- **無即時房價/空房**（deep-link，非 Demand API）——要即時價需 Booking Demand API（affiliate 審核）另開 spec。
- **地理重心靠「schedule 名對照收藏」**：AI 生成、不在收藏又名稱對不上的點不計入（有 fallback 到 location 字串）；跨換日線行程質心會偏（台灣/亞洲非問題，spec §7 已載）。
- Stay22/Travelpayouts 連結格式以各官方文件為準；使用者拿到 AID/marker 填進 env 重部署即帶佣金。

## 5. 部署
合併進 main → App Hosting 自動 build/deploy。變現 env 未設也能用（純 Booking 連結）。

---
**狀態：實作完成、驗收未過。等 peanut 確認後才可宣告 Done。**
