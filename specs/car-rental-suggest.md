# Spec — Car Rental Suggest（租車建議 + 可變現租車連結）

> 狀態：已實作（2026-07-21）。本文件記錄設計決策，架構完全比照 `specs/lodging-suggest.md`。
> 前置：`specs/lodging-suggest.md`（`lib/booking-link.ts`/`lib/lodging.ts`/`app/api/lodging/suggest/route.ts` 的模式）。

## 0. 為什麼是這份

`schema/trip.ts` 的 `carRentalSchema` 與 `components/bookings.tsx` 的租車編輯器只有「使用者手動輸入」——沒有搜尋、沒有訂位連結，跟住宿在做 `lodging-suggest` 之前的狀態一樣。研究過租車即時報價/預訂 API（Kayak Cars API、Amadeus Car Rental、Booking.com Demand API Cars、Expedia Rapid Car API）全部需要業務申請或簽約審核，跟先前被否決的 Amadeus 航班 API 同樣的門檻，故不採用。改用兩個零新增成本的方案，完全比照住宿的兩支既有程式碼複製：

- `lib/booking-link.ts`（`buildLodgingLink`）→ `lib/car-rental-link.ts`（`buildCarRentalLink`）
- `lib/lodging.ts` + `app/api/lodging/suggest/route.ts` → `lib/car-rentals.ts` + `app/api/car-rental/suggest/route.ts`

## 1. 契約

### 1.1 `lib/car-rental-link.ts`（新；純函式，零網路呼叫）

```ts
export type CarRentalLinkInput = {
  pickupLocation: string;
  dropoffLocation: string;
  pickupDate?: string; // YYYY-MM-DD
  pickupTime?: string; // HH:mm
  dropoffDate?: string; // YYYY-MM-DD
  dropoffTime?: string; // HH:mm
};
export function buildCarRentalLink(input: CarRentalLinkInput): string;
```

- `NEXT_PUBLIC_RENTALCARS_AID` 有設 → URL 帶 `aid=<id>`（Rentalcars Connect，Booking.com 的 B2B 租車聯盟計畫，確認免費自助加入無審核）；沒設 → 同一個 URL 不帶 `aid`（可用、無佣金）。
- URL 格式 `https://www.rentalcars.com/search-results?intent=direct&locationName=...&dropLocationName=...&driversAge=30&puDay=..&puMonth=..&puYear=..&puHour=..&puMinute=..&doDay=..&doMonth=..&doYear=..&doHour=..&doMinute=..&ftsType=C&dropFtsType=C[&aid=..]`——**經實際瀏覽器操作 rentalcars.com 跑一次搜尋核對**（非憑文件猜測）；`aid` 參數名稱對齊 Booking.com 旗下 `cars.booking.com` 的既有慣例（跟 `lib/booking-link.ts` 的 `aid` 用法一致）。
- 沒填日期/時間時的降級預設：取車 30 天後、還車 33 天後、時間 10:00——確保任何情況都能組出可用連結，不是死連結。

### 1.2 `lib/car-rentals.ts`（新，伺服器端）

```ts
export type CarRentalSuggestion = {
  place: PlaceSearchResult;
  priceLevel?: number; // best-effort 帶出，租車行少填，不做篩選
  bookingUrl: string;
};
export type CarRentalSearchError = { kind: "missing_key" } | { kind: "api_error"; message: string };

export async function suggestCarRentals(input: {
  location: string;
  center?: { lat: number; lng: number };
}): Promise<Result<CarRentalSuggestion[], CarRentalSearchError>>;
```

- Places `searchText`：`textQuery=${location} 租車` + **`includedType: "car_rental"`**（真實 Places 類型，比住宿現有的純關鍵字查詢精準，避免混進洗車行/修車廠）；`center` 有值時加 `locationBias(circle, radius 4000)`。FIELD_MASK 同 `lib/lodging.ts`。
- **不接 `maxPriceLevel` 篩選**：租車行極少填 Google Places 的 `priceLevel`，篩選幾乎必為 no-op，容易誤導使用者。`priceLevel` 欄位保留在回傳型別供未來用。
- 依 `rating` 排序，每筆 `buildCarRentalLink({ pickupLocation: place.name, dropoffLocation: place.name })`（同地點取還車，常見情境）。

### 1.3 `POST /api/car-rental/suggest`（新）

- `requireUid` → `checkAndConsume(uid, "places_search")`——**沿用既有護欄桶**，跟住宿建議同一個成本類別，`lib/quotas.ts` 不用改。
- Body：`{ tripId: string }`；`tripId` 缺 → 400。
- 流程：載入 trip（查無 → 404）→ `listPlaces` + `computeTripCentroid`（見 1.4）算行程地理重心 → `suggestCarRentals({ location: trip.location, center })` → `200 { items }`；失敗 → 502。

### 1.4 `lib/trip-geo.ts`（新，抽出自住宿建議路由）

```ts
export function computeTripCentroid(
  days: SavedTripDay[],
  placesByName: Map<string, { lat: number; lng: number }>,
): { lat: number; lng: number } | undefined;
```

- 從 `app/api/lodging/suggest/route.ts` 原本內聯的重心計算（schedule 的 place/food stop 對照收藏座標取平均）抽出的純函式，住宿與租車兩條路由共用。抽取後對住宿路由是行為不變的純替換。

### 1.5 前端 `app/trips/[id]/page.tsx`

- 仿「🏨 住宿建議」加「🚗 租車建議」區塊：標題 + 快速連結（`buildCarRentalLink({pickupLocation: trip.location, dropoffLocation: trip.location})`）+ 搜尋按鈕（**無價位下拉**，見 1.2）+ 結果清單（名稱/⭐評分/地址 + 「租車 →」連結）。
- `CarRentalSuggestState`/`CarRentalSuggestItem` type 特意加 `Suggest` 字尾，避免跟既有 `CarRental`（schema 型別）與手動租車編輯器的 `rentalDrafts` 狀態撞名。

### 1.6 `components/bookings.tsx`

- `BookingCards` 既有手動輸入的租車卡片旁加「找租車優惠 →」連結，用 `buildCarRentalLink` 帶入使用者填的 pickup/dropoff 地點與日期時間。此元件同時被 `app/trip/page.tsx`（生成預覽頁）共用，兩處都會出現，是預期行為（純前端函式，零成本）。

## 2. 設計決策

- **只做 2 層變現（Rentalcars Connect + 零佣金 fallback）**：目前只確認一個免審核聯盟管道，不為了結構對稱硬湊第二層；程式碼用同一個 `rentalcarsSearchUrl(input, aid?)` 函式處理兩種情況（比照 `lib/booking-link.ts` 的 `bookingSearchUrl(input, aid?)` 寫法），之後要加第二層是同形狀的增量修改。
- **不接受住宿的 3 層 provider 鏈結構**：Stay22/Booking aid/Travelpayouts 的優先序是住宿特有的歷史脈絡（Booking 曾終止部分聯盟合作），租車目前沒有類似的多選需求。
- **重構「行程地理重心」計算為共用函式**：這個計算是純函式、無副作用、跟周邊邏輯無交織，抽取風險低、兩條路由都要用、抽出後才有單測覆蓋（原本完全沒測到）。
- **不建新 zod schema**：`CarRentalSuggestion` 是複合回傳型別（包住已驗證過的 `placeSearchResultSchema`），跟 `LodgingSuggestion` 的做法一致。

## 3. 影響檔案

| 檔案 | 變更 |
|---|---|
| `lib/trip-geo.ts`（新） | `computeTripCentroid`，從住宿建議路由抽出 |
| `lib/car-rental-link.ts`（新） | `buildCarRentalLink`（Rentalcars Connect 可插拔變現） |
| `lib/car-rentals.ts`（新） | `suggestCarRentals`（Places `car_rental` 類型查詢） |
| `app/api/car-rental/suggest/route.ts`（新） | 端點 |
| `app/api/lodging/suggest/route.ts` | 重心計算改呼叫 `computeTripCentroid`（行為不變） |
| `app/trips/[id]/page.tsx` | 加「🚗 租車建議」區塊 |
| `components/bookings.tsx` | 手動租車卡片加「找租車優惠 →」連結 |
| `.env.example` | 加 `NEXT_PUBLIC_RENTALCARS_AID` |
| `lib/__tests__/car-rental-link.test.ts`（新）、`lib/__tests__/trip-geo.test.ts`（新） | 測試 |

## 4. 驗證基準

```bash
pnpm typecheck && pnpm test && pnpm lint && pnpm build
```

實測：
1. 對一筆有收藏地點的行程按「找 XX 的租車」→ 出現該區真實租車據點（地址/評分）。
2. 點「租車 →」連結能正常開啟 rentalcars.com 搜尋結果（無論有沒有設定 `NEXT_PUBLIC_RENTALCARS_AID` 都要能用）。
3. 手動輸入的租車記錄旁的「找租車優惠 →」連結同樣正常開啟。
4. `.env` 無 `NEXT_PUBLIC_RENTALCARS_AID` → 連結不帶 `aid`；設定後 → 帶 `aid=<id>`。

## 5. 已知限制（非 bug）

- **無即時報價/空房**（deep-link，非 API 直查）——要即時報價需 Rentalcars Connect 的更深度整合或付費 API，本 spec 不含。
- **同地點取還車假設**：`suggestCarRentals` 每筆建議連結預設 pickup=dropoff=該租車行地址，是最常見情境；使用者若要跨點還車需自行在 rentalcars.com 上調整。
- **`driversAge` 固定 30**：沒有使用者實際年齡資料，用常見預設值；部分租車行對年輕/年長駕駛有額外費用，連結本身不受影響（rentalcars.com 頁面上仍可調整）。
- **地理重心跟住宿共用同一套「schedule 地點對照收藏」邏輯**：AI 生成的新地點若不在收藏、名稱又對不上，該點不計入重心（同住宿既有限制）。
- **`computeTripCentroid` 用簡單算術平均，跨國際換日線（經度 ±180 附近）會算出錯誤質心**：例如行程橫跨東經 179 度與西經 179 度的地點，平均出來會落在經度 0 度附近（地球另一側），是球面幾何的固有限制；本專案行程範圍目前是東亞/東南亞，機率極低，不在本次修復範圍（GLM 審查自我驗證確認，見 task/REVIEW.md）。
