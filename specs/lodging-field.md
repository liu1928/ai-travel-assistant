# Spec — Lodging Field（住宿欄位：記錄 + 當生成錨點）※ 規劃中，未實作

> 狀態：spec 已定稿待實作。實作時照本文件執行；有歧義回來改本文件，不要口頭發散。
> 這是把「住宿」做成**第三種訂位資料**（比照 `specs/flights-rentals.md` 的 flights/carRentals）：
> 使用者手填已訂的住宿 → 隨行程儲存/顯示/編輯 → 生成時當**硬約束**餵 AI（行程圍繞住宿排）。
> 與 `specs/lodging-suggest.md`（找住宿建議 + Booking 連結）是**兩個互補功能**：那個是「找」，這個是「記錄+錨定」。

## 0. 定位

- **完全比照 flights/carRentals 的既有機制**：draft 字串表單 → zod schema → `tripWithBookingsSchema` → 儲存/顯示/編輯 → 生成 prompt 硬約束。**AI 輸出 schema（tripSchema）不動**（住宿是使用者輸入，不讓 AI 生成，沿用防編造分層）。
- 舊行程沒有 `lodgings` 欄位 → `.default([])`，**零資料遷移**（同 flights/carRentals 手法）。

## 1. 契約

### 1.1 `schema/trip.ts`（新增，沿用既有 `datePattern`/`timePattern`）

```ts
export const lodgingSchema = z.object({
  name: z.string().min(1),                               // 住宿名稱（旅館/民宿）
  address: z.string().optional(),
  checkInDate: z.string().regex(datePattern).optional(), // YYYY-MM-DD
  checkInTime: z.string().regex(timePattern).optional(), // HH:mm（預設可留空，飯店多 15:00）
  checkOutDate: z.string().regex(datePattern).optional(),
  checkOutTime: z.string().regex(timePattern).optional(),
  note: z.string().optional(),
});
export type Lodging = z.infer<typeof lodgingSchema>;

// tripWithBookingsSchema 追加（tripSchema 不動）
export const tripWithBookingsSchema = tripSchema.extend({
  flights: z.array(flightSchema).default([]),
  carRentals: z.array(carRentalSchema).default([]),
  lodgings: z.array(lodgingSchema).default([]),   // 新增
});
```

### 1.2 `components/bookings.tsx`

- `LodgingDraft`（全字串）+ `emptyLodging()` + `lodgingToDraft(l)` + `isLodgingEmpty(d)`。
- `draftsToBookings` 擴充：新增第三參數 `lodgingDrafts`，回傳型別加 `lodgings: Lodging[]`；非空但缺必填（`name`）→ 回 `{ ok:false, message }`（同 flights 的「不靜默丟」哲學）。
  - ⚠️ 契約變動：`draftsToBookings(flightDrafts, rentalDrafts, lodgingDrafts)` + `BookingsResult` 加 `lodgings`；同步改所有呼叫端（`app/trip`、`app/trips/[id]`）。
- `BookingsFields` 加第三個可收合區塊「🏨 住宿資訊（可選）」：動態清單，每筆欄位 名稱*、地址、入住日期、入住時間、退房日期、退房時間、備註；＋新增/刪除。props 加 `lodgings` + `onLodgingsChange`。
- `BookingCards` 加「🏨 住宿」卡片（沒資料不渲染，舊行程零視覺差異）。

### 1.3 `lib/anthropic.ts`

- `GenerateTripInput` 加 `lodgings?: Lodging[]`。
- `buildUserMessage` 加一段（有資料才附，比照 flights）：
  ```
  住宿資訊（已訂，硬約束）：
  - {name}（{address}）：{checkInDate} {checkInTime} 入住 → {checkOutDate} {checkOutTime} 退房

  請據此安排：
  - 入住/退房排入對應那天的時間軸（type: place 或 rest）
  - 每天行程盡量在住宿可及範圍、晚上收在住宿附近
  - 有多筆住宿（換點）時，依日期把行程分段錨定到當晚的住宿
  ```
- **tripSchema 不動**（住宿走「使用者輸入 → route 附掛」路徑，AI 輸出不含）。

### 1.4 Routes

- `app/api/trip/generate/route.ts`：body 加 `lodgings?: unknown` → `z.array(lodgingSchema).safeParse`（失敗 → 400「住宿資料格式不正確」，比照 flights 主要資料不 best-effort）；傳入 `generateTrip`；回傳 `trip` 附掛 `lodgings`。
- `app/api/trips/route.ts`（POST）/`[id]/route.ts`（PATCH）：驗證已是 `tripWithBookingsSchema`（`lib/trips.ts` 的 `savedTripSchema` 基於它）→ 加了 `lodgings` 後**自動涵蓋**，確認 `.default([])` 生效即可（舊文件無欄位不炸）。

### 1.5 前端頁面

- `app/trip/page.tsx`：加 `lodgingDrafts` state；傳進 `BookingsFields`；`draftsToBookings(...)` 帶第三參數；生成 payload 加 `lodgings`；結果區 `BookingCards` 顯示。
- `app/trips/[id]/page.tsx`：`flightToDraft`/`rentalToDraft` 同層加 `lodgingToDraft`；編輯器存檔 PATCH 帶 `lodgings`；`BookingCards` 顯示。

## 2. 設計決策
- **完全對稱 flights/carRentals**：降低認知成本、複用既有 draft/驗證/儲存/顯示/生成路徑。
- **住宿不進 tripSchema**（AI 輸出）：使用者輸入資料，沿用防 AI 編造分層。
- **當硬約束餵生成**：住宿是行程的地理/時間錨點，餵 prompt 讓 AI「圍繞住宿排、晚上收在住宿附近、多住宿依日期分段」。
- **`.default([])` 零遷移**：舊行程開啟/PATCH 正常、不顯示住宿卡。
- **與 lodging-suggest 分工**：suggest＝找 + Booking 連結；本 field＝記錄 + 錨定生成。之後可串（在住宿建議清單按「設為此趟住宿」→ 填進本欄位），屬後續。

## 3. 影響檔案
| 檔案 | 變更 |
|---|---|
| `schema/trip.ts` | 加 `lodgingSchema`；`tripWithBookingsSchema` 加 `lodgings` |
| `schema/__tests__/trip.test.ts` | 加 lodging 驗證 + 舊文件缺欄位→default 空陣列 |
| `components/bookings.tsx` | LodgingDraft/emptyLodging/lodgingToDraft；`draftsToBookings` 加住宿；`BookingsFields`/`BookingCards` 加住宿區塊 |
| `lib/anthropic.ts` | `GenerateTripInput` 加 lodgings；`buildUserMessage` 加住宿段 |
| `app/api/trip/generate/route.ts` | 驗證 lodgings + 傳入 + 回傳附掛 |
| `app/trip/page.tsx` | lodgingDrafts 串接（表單/生成/顯示） |
| `app/trips/[id]/page.tsx` | lodgingDrafts 串接（編輯/PATCH/顯示） |

> ⚠️ 超過 3 檔：實作前先寫 `task/PLAN.md` 條列步驟。

## 4. 驗證基準
```bash
pnpm typecheck && pnpm test && pnpm lint
```
實測：
1. 不填住宿 → 生成/儲存/舊行程開啟**完全同現在**（零回歸）。
2. 填一筆住宿（如 那霸某飯店，9/25 15:00 入住、9/28 11:00 退房）→ 生成行程時間軸有入住/退房項，且晚上收在住宿附近、insights 反映。
3. 生成後儲存 → `/trips/[id]` 看得到住宿卡 → 編輯（改/加）→ 儲存 → 重整還在。
4. 住宿時間填 `25:00` 非法 → 前端擋或後端 400 明確，不靜默。
5. 舊行程（Firestore 無 lodgings）→ 開頁正常、PATCH 正常、不顯示住宿卡。

## 5. 故障模式
| 症狀 | 原因 | 解法 |
|---|---|---|
| 生成回 400「住宿資料格式不正確」 | 日期非 YYYY-MM-DD、時間非 HH:mm、缺 name | 前端先驗；檢查 12 小時制誤填 |
| 舊行程開頁掛掉 | `.default([])` 沒生效 | 確認 `tripWithBookingsSchema` 用 `.default([])` |
| 存檔後住宿卡沒出現 | PATCH 漏帶 lodgings | 檢查 `[id]` 頁 PATCH payload 含 lodgings |
| 時間軸沒圍繞住宿排 | prompt 段漏組 / 模型忽略 | dev 看送出 user message 是否含住宿段；偶發忽略重生成 |

## 6. 已知限制（非 bug）
- **不接訂房 API**：純手動記錄（找住宿走 `lodging-suggest`）。
- **儲存後編輯住宿不重排時間軸**（同 flights/carRentals，PATCH 只覆蓋資料）；要重排回 `/trip` 重新生成。
- 跨日/時區不處理（沿用既有 flights 慣例，HH:mm + 可選日期，當地時間）。
