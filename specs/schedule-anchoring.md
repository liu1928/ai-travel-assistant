# Spec — Schedule Anchoring（行程項目座標/placeId/startDate 持久化：共用地基）※ 規劃中，未實作

> 狀態：spec 已定稿待實作。實作時照本文件執行；有歧義回來改本文件。
> 前置：無。本 spec 是 `opening-hours`、`map-view`、`day-regenerate`、`export-offline`、`trip-day-mode` 五份 spec 的共用地基，**必須最先落地**。

## 0. 為什麼是這份

`app/api/trip/generate/route.ts` 的 Routes 估車程迴圈（約 199–236 行）**已經**逐 stop 解析座標：收藏對映拿 `known.location`、對不到的用 `resolveCoordinates(stop.location ?? stop.title)` 補查——但解析結果用完即丟。同時 `body.startDate` 只用於天氣/假日查詢，沒存進 trip。結果是：

- 行程項目無法錨定回收藏（公休驗證沒有 placeId 可查）；
- 地圖畫不出路線（沒座標）；
- 「今天是行程第幾天」算不出來（沒 startDate）。

本 spec 把「已經算出來的東西存下來」，零額外 API 成本。

## 1. 契約

### 1.1 `schema/trip.ts` — 儲存側 schema 擴充

```ts
// 儲存側 schedule item：AI 輸出的 scheduleItemSchema + server 附掛的錨定欄位。
// ⚠️ 這些欄位絕不能進 scheduleItemSchema / tripSchema（AI structured output），
// 否則模型會編造 placeId/座標。沿用 flights/weather 的分層鐵律（本檔 61-63 行註解）。
export const savedScheduleItemSchema = scheduleItemSchema.extend({
  placeId: z.string().optional(),           // 收藏對映成功才有（Google Place ID）
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  openingWarning: z.string().optional(),    // specs/opening-hours.md 寫入，本 spec 只留欄位
});

export const savedTripDaySchema = tripDaySchema.extend({
  schedule: z.array(savedScheduleItemSchema).min(1),
});

export const tripWithBookingsSchema = tripSchema.extend({
  days: consecutiveDaysArray(savedTripDaySchema), // 見 1.2
  startDate: z.string().regex(datePattern).optional(), // 出發日；舊資料缺席
  // ...既有 flights/carRentals/lodgings/weather/exchangeRate 不變
});
```

注意：**用平鋪 `lat`/`lng`，不用 nested `location`**——`scheduleItemSchema.location` 已是字串（地點描述），欄位名衝突。

### 1.2 superRefine 抽共用 helper

`tripSchema.days` 的「day 編號從 1 開始連續」`superRefine`（現 44–55 行）在 `.extend()` 覆寫 `days` 後會遺失。抽成：

```ts
const consecutiveDaysArray = <T extends z.ZodTypeAny>(daySchema: T) =>
  z.array(daySchema).min(1, "days 不可為空").superRefine(/* 既有連續編號檢查 */);
```

`tripSchema` 與 `tripWithBookingsSchema` 兩處都套用，並各有單測覆蓋。

### 1.3 `app/api/trip/generate/route.ts` — 寫回錨定資料

- Routes 迴圈內：收藏對映成功 → 該 stop 寫 `placeId` + `lat/lng`；`resolveCoordinates` 成功 → 寫 `lat/lng`（無 placeId）。
- **寫回不受「整天跳過估計」影響**：現行邏輯任一 stop 定位失敗會跳過該天車程估計，但已解析成功的個別 stop 仍要寫回（解析與估車程解耦）。
- 回傳/儲存的 trip payload 加 `startDate: body.startDate`。

### 1.4 前端 type 複本同步

`app/trips/[id]/page.tsx`（約 23–51 行的本地 `ScheduleItem`/`SavedTrip`）與 `app/trip/page.tsx` 的複本補上新 optional 欄位（或改為直接 import schema 推導的 type，實作時擇一並在 PLAN.md 記錄）。

## 2. 設計決策

- **AI 輸出 schema 一個字不動**：錨定欄位全由 server 附掛，模型看不到也不輸出。
- **全部 optional**：舊 Firestore 行程免遷移，讀取直接過驗證。
- **本 spec 不做 UI**：純資料層，UI 由下游 spec 消費。
- **`resolveCoordinates` 仍是名稱模糊比對**：綁錯同名地點的既有限制不在本 spec 解（見 task/MEMORY.md 預警）；只錨定「收藏對映」來源的 placeId，模糊解析只存座標不存 placeId，降低錯綁面。

## 3. 影響檔案

| 檔案 | 變更 |
|---|---|
| `schema/trip.ts` | 加 `savedScheduleItemSchema`/`savedTripDaySchema`；`consecutiveDaysArray` helper；`tripWithBookingsSchema` 覆寫 days + 加 `startDate?` |
| `app/api/trip/generate/route.ts` | Routes 迴圈寫回 placeId/lat/lng；payload 加 startDate |
| `app/trips/[id]/page.tsx`、`app/trip/page.tsx` | 本地 type 複本同步 |
| `schema/__tests__/trip.test.ts` | 連續編號 refine 兩 schema 都測；savedScheduleItem 新欄位驗證；舊資料（無新欄位）通過 |

## 4. 驗證基準

```bash
pnpm typecheck && pnpm test && pnpm lint
```

實測：
1. 生成一筆新行程（勾選收藏地點）→ Firestore doc 的 schedule item 帶 `placeId/lat/lng`、trip 帶 `startDate`。
2. 讀取一筆舊行程（無新欄位）→ 頁面正常渲染，不炸驗證。
3. 兩個 schema 的 day 編號不連續輸入都被擋（helper 抽出後不迴歸）。

## 5. 故障模式

| 症狀 | 原因 | 解法 |
|---|---|---|
| 舊行程讀取炸 zod | 新欄位沒設 optional | 檢查 `.extend()` 欄位全 optional |
| day 編號檢查失效 | extend 覆寫 days 後 superRefine 遺失 | 確認兩 schema 都套 `consecutiveDaysArray`，單測擋住 |
| AI 開始輸出 placeId | 欄位誤加進 `scheduleItemSchema` | 錨定欄位只能在 `savedScheduleItemSchema` |
