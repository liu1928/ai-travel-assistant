<!-- 產生日期: 2026-07-10 | 產生模型: claude-opus-4-8 | 引用 REVIEW.md 時間戳: 2026-07-10 02:01:04 +0800 -->

# REPORT — 住宿欄位（Lodging Field）

> 依據 GLM 審查：`task/REVIEW.md`（時間戳 2026-07-10 02:01:04 +0800）。SPEC：`specs/lodging-field.md`。分支：`feat/lodging-field`。

## 做了什麼
把「住宿」做成**第三種訂位資料**，完全比照既有 flights/carRentals：使用者手填已訂住宿 → 隨行程儲存/顯示/編輯 → 生成時當**硬約束**餵 AI（行程圍繞住宿排、晚上收在住宿附近、多住宿依日期分段）。`tripSchema`（AI 輸出）不動——住宿走「使用者輸入 → route 附掛」路徑，沿用防 AI 編造分層。舊 Firestore 文件靠 `.default([])` 零遷移。

## 改動檔案（diff 摘要，見 task/diff.patch）
| 檔案 | 變更 |
|---|---|
| `schema/trip.ts` | 新增 `lodgingSchema`（name 必填，address/checkIn·Out Date·Time/note 可選，沿用 datePattern/timePattern）+ `Lodging` 型別；`tripWithBookingsSchema` 加 `lodgings: z.array(lodgingSchema).default([])` |
| `components/bookings.tsx` | `LodgingDraft` 型別 + `emptyLodging`/`lodgingToDraft`/`isLodgingEmpty`；`draftsToBookings` 加第三參數 `lodgingDrafts` + 住宿驗證迴圈（缺 name 回 `{ok:false}`）；`BookingsResult` 加 `lodgings`；`BookingCards` 加 🏨 住宿唯讀卡；`BookingsFields` 加可收合「🏨 住宿資訊」動態清單（名稱*/地址/入住日·時/退房日·時/備註 + 新增/刪除） |
| `lib/anthropic.ts` | `GenerateTripInput` 加 `lodgings?`；`buildUserMessage` 加住宿硬約束段（有資料才 push） |
| `app/api/trip/generate/route.ts` | body 加 `lodgings?: unknown` → `z.array(lodgingSchema).safeParse`（失敗 400「住宿資料格式不正確」）→ 傳入 `generateTrip` → 回傳 `trip` 附掛 `lodgings` |
| `app/trip/page.tsx` | `lodgingDrafts` state；`BookingsFields`/`draftsToBookings`/生成 payload/`BookingCards` 串接 |
| `app/trips/[id]/page.tsx` | `lodgingDrafts` state；`startBookingsEdit` 用 `lodgingToDraft` 回填；`saveBookings` PATCH 帶 `lodgings`；`BookingCards` 顯示；編輯鈕文案改「航班/租車/住宿」 |
| `schema/__tests__/trip.test.ts` | 新增 lodgingSchema 驗證（合法/缺 name/非法時間/非法日期）+ tripWithBookings 舊文件 default、含住宿完整行程、住宿缺 name 整筆拒絕、tripSchema 不含 lodgings |

## 自我驗證（全過）
- `pnpm typecheck`（tsc --noEmit）：**通過**，0 error。
- `pnpm test`（vitest）：**9 檔 76 tests 全過**（含新增 lodging 測試）。
- `pnpm lint`（eslint app lib schema）：**通過**，0 error。（components 不在 lint scope，由 typecheck 覆蓋。）
- `pnpm build`（next build）：**通過**，exit 0，所有路由正常產出。

## GLM finding 統計
GLM 共提 🐛×2、⚠️×3、💡×2、❓×2（原文 + 逐條仲裁見 REVIEW.md）：
- **假（FALSE POSITIVE）：2 條**
  - 🐛-1 `isLodgingEmpty` 遇 undefined 崩潰 → `LodgingDraft` 全欄位為 `string`、draft 恆由 `emptyLodging`/`lodgingToDraft` 全填字串產生，`.trim()` 安全（與既有 isFlightEmpty/isRentalEmpty 同構）。
  - 🐛-2 迴圈索引錯誤訊息誤導 → 空 draft 仍渲染成卡片，`第 i+1 筆` 與畫面卡片位置一致，不誤導（與 flights/carRentals 對稱）。
- **真但不修（P2 / 屬既有全域特性、本 SPEC 範圍外）：3 條** — 見下方 Known issues。
- **建議/疑問：4 條** — 風格建議不採納（維持與 flights/carRentals 對稱）；2 個疑問皆已釐清且設計正確（lodgingToDraft 安全、AI 不會編造座標——座標由後續 Google 地理編碼從 location 字串解析，非 AI 生成）。
- **真的 P0/P1 缺陷：0 條** → 無新 diff，不需回步驟 3 重跑。

註：GLM 的 `checkInTime:"25:99"` 具體例有誤——`timePattern` 已擋。

## Known issues（交 peanut 決定，皆非本次 regression、非本 SPEC 範圍）
1. **日期曆法/前後順序未驗證**：`datePattern` 接受 `2024-02-31` 這種不存在的日、且不驗 checkIn≤checkOut。與既有 flights/carRentals 同一慣例。若要 `.refine()` 強化，建議三種訂位資料一致地做，開獨立 SPEC。
2. **buildUserMessage 無輸入隔離（prompt injection）**：整份 user message 本就由使用者輸入組成（prompt 欄位、地點名、flights/carRentals 的 note/company/location），lodging 未新增攻擊面；輸出受 tripSchema 約束、僅影響使用者自己的行程。建議開全域 prompt-hardening SPEC 一次處理。
3. **訂位陣列無 `.max()` 上限**：generate route 已 requireUid + 限流，DoS 僅限已登入未超額者；flights/carRentals 亦無上限。建議三者一致加上限，屬對稱性強化。

## 待 peanut 驗收
- 本地四項驗證 + build 全綠；未自行合併、未部署。
- 尚未把此分支合入 main（等 peanut 指示）。合併後 Firebase App Hosting 會自動部署（`tripWithBookingsSchema` 加 `.default([])`，舊行程零遷移、開頁/PATCH 不炸）。
- 下一個排程項目：`specs/flight-lookup.md`（AviationStack 帶航線+時刻），需動 Cloud Secret Manager + apphosting.yaml（禁動清單，動前會先與 peanut 確認）。

**停止，等待 peanut 驗收。不自行宣布 Done。**
