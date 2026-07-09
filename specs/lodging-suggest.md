# Spec — Lodging Suggest（住宿建議 + 可變現訂房連結）※ 規劃中，未實作

> 狀態：spec 已定稿待實作。實作時照本文件執行；有歧義回來改本文件，不要口頭發散。
> 前置：`specs/foundation-hardening.md`（用量護欄）已上線——Places 查詢走既有 `checkAndConsume`。

## 0. 定位（連結不綁死任何聯盟商）

- 「適合的住宿地點」用**我們已有的 Google Places（旅宿）**查，錨定**行程實際地理重心**、可**依價位篩選**。
- 訂房連結**不接 Booking Demand API**（要 affiliate 審核、且 Booking 已在 2025 前後終止部分聯盟合作，Travelpayouts 未必能產 Booking link）。改成**可插拔的變現層**：
  - 預設產**純 Booking 搜尋連結**（一定能用、無佣金）。
  - env 有設聯盟商 ID → 包成該商的連結（帶佣金）。**推薦 Stay22**（聚合 Booking/Expedia/Agoda… 多家 OTA、承接 Booking 合作變動、全球可用、AID 制）；也支援 Booking 原生 `aid`、或 Travelpayouts marker。填哪個就用哪個，**不填就純連結**，程式零改動。

## 1. 總覽

已存行程頁 `/trips/[id]` 加「🏨 住宿建議」：以**行程地理重心**（由 schedule 地點對照收藏座標算出，非只用 location 字串）查附近旅宿 → 依評分排序、可依**價位**篩 → 清單（名稱/評分/價位/地址）+ 每筆「訂房 →」連結（可變現）。

```
/trips/[id]「🏨 住宿建議」→ 選價位（不限/$/$$/$$$）→ 按「找住宿」
   │
   ▼
POST /api/lodging/suggest { tripId, maxPriceLevel? }   ← requireUid + checkAndConsume(places_search)
   │
   ├─ 載入 trip（users/{uid}/trips/{tripId}）+ 收藏（listPlaces）
   ├─ 行程地理重心：schedule 的 place/food stop 名稱 → 對照收藏取座標 → 質心 centroid
   │     （對照不到任一 → 退回用 trip.location 字串查）
   │
   ▼
suggestLodging({ center?, location, maxPriceLevel })    ← lib/lodging.ts
   │   Places searchText：textQuery=`${location} 飯店`；有 center → 加 locationBias(circle)
   │   FIELD_MASK 多取 priceLevel；依 rating 排序、依 maxPriceLevel 濾
   │
   ▼
每筆組訂房連結 buildLodgingLink({ query, ... })         ← lib/booking-link.ts（可插拔變現）
   ▼
前端：名稱・⭐評分・價位・地址・「訂房 →」（新分頁、rel noopener）+ 「看這區所有住宿 →」整區連結
```

## 2. 契約

### 2.1 `lib/booking-link.ts`（新；純函式，可 client/server 共用）

```ts
export type LodgingLinkInput = {
  query: string;        // 目的地或旅宿名（"沖繩" / "ANA Crowne Plaza Okinawa"）
  checkIn?: string;     // YYYY-MM-DD 可選
  checkOut?: string;    // YYYY-MM-DD 可選
  adults?: number;      // 預設 2
};
// 依 env 決定變現商（優先序）：
//   NEXT_PUBLIC_STAY22_AID       → Stay22 連結（推薦；多 OTA 聚合）
//   NEXT_PUBLIC_BOOKING_AID      → booking.com/searchresults?...&aid=<id>（Booking 原生 affiliate）
//   NEXT_PUBLIC_TRAVELPAYOUTS_MARKER → Travelpayouts 包裝
//   （都沒有）                    → 純 booking.com 搜尋連結（可用、無佣金）
export function buildLodgingLink(input: LodgingLinkInput): string;
```

- 純 Booking 搜尋 URL：`https://www.booking.com/searchresults.html?ss={query}&checkin={in}&checkout={out}&group_adults={n}`（欄位 encode）。
- Stay22 / Travelpayouts 的實際包裝格式**實作時照各官方文件對一次**；本 spec 只定「優先序 + 有 ID 才包、無則純連結」的行為契約與 env 名稱。

### 2.2 `lib/lodging.ts`（新，伺服器端）

```ts
export type LodgingSuggestion = {
  place: PlaceSearchResult;   // 複用既有型別
  priceLevel?: number;        // Places priceLevel 0–4
  bookingUrl: string;         // buildLodgingLink 產出
};
export type LodgingError = { kind: "missing_key" } | { kind: "api_error"; message: string };

export async function suggestLodging(input: {
  location: string;                    // 顯示/查詢用字串（trip.location）
  center?: { lat: number; lng: number }; // 行程地理重心；有則 locationBias
  maxPriceLevel?: number;              // 0–4，濾掉更貴的
  checkIn?: string; checkOut?: string;
}): Promise<Result<LodgingSuggestion[], LodgingError>>;
```

- Places `searchText`：`textQuery=${location} 飯店`、`languageCode zh-TW`、`regionCode TW`、`maxResultCount 10`；**FIELD_MASK 多加 `places.priceLevel`**；`center` 有值時帶 `locationBias:{circle:{center, radius: 4000}}`。
- 依 `rating` 由高到低排序；`maxPriceLevel` 有給則濾掉 `priceLevel > maxPriceLevel`（無 priceLevel 的保留）。每筆 `buildLodgingLink`。

### 2.3 `POST /api/lodging/suggest`（新）

- `requireUid` → `checkAndConsume(uid, "places_search")`（Places 計費，走 $ 護欄；擋回 429/503）。
- Body：`{ tripId: string, maxPriceLevel?: number }`；`tripId` 缺 → 400。
- 流程：載入該 uid 的 trip（查無 → 404）→ `listPlaces(uid)` → 用 `placeByName`（比照 `trip/generate` route 的作法）把 schedule 的 `place/food` stop（`stop.location ?? stop.title`）對照收藏取座標 → 有 ≥1 命中則算 centroid 當 `center`；否則 `center` 省略、退回 `trip.location` 字串查。
- `suggestLodging({ location: trip.location, center, maxPriceLevel })` → 成功 `200 { items }`；失敗 → 502。

### 2.4 前端 `app/trips/[id]/page.tsx`

- 標題卡下方加「🏨 住宿建議」：一個**價位下拉**（不限 / $ 平價 / $$ 中等 / $$$ 高級 → 對應 maxPriceLevel `undefined/1/2/3`）+「找住宿」按鈕 → `authedFetch("/api/lodging/suggest", { tripId, maxPriceLevel })`。
- 結果清單：名稱・⭐評分・價位符號（`$`×priceLevel）・地址・`<a href={bookingUrl} target="_blank" rel="noopener noreferrer">訂房 →</a>`。
- 另加「在 Booking 看這區所有住宿 →」= 前端直接 `buildLodgingLink({ query: trip.location })`（不查 Places）。
- discriminated union 狀態機（idle/loading/ready/error/empty），沿用頁面既有風格。

### 2.5 設定（`.env.example`）
```
# 住宿訂房連結變現（擇一填；不填則產純 Booking 連結、無佣金）
NEXT_PUBLIC_STAY22_AID=
NEXT_PUBLIC_BOOKING_AID=
NEXT_PUBLIC_TRAVELPAYOUTS_MARKER=
```
`NEXT_PUBLIC_` build 時內嵌，改了要重部署（App Hosting 自動）。

## 3. 設計決策

- **地理重心而非只用 location 字串**：schedule 地點對照**收藏既有座標**算 centroid（零額外 Places 成本、精準錨定這趟實際去的區域）；對照不到才退回 location 字串。復用 `trip/generate` 既有的 `placeByName` 模式。
- **價位篩選**：用 Places `priceLevel`（0–4）server 端濾 + 前端下拉；無 priceLevel 的旅宿保留（不因缺資料被誤刪）。
- **連結不綁死聯盟商**：預設純 Booking 連結（一定能用），變現層 env 可插拔（Stay22 優先，因 Booking 已終止部分聯盟合作）；沒 ID 也能用。
- **deep-link 而非 Demand API**：零審核依賴即可上線導購；即時房價待 Demand API 另做。
- **錨定 trip（`tripId`）**：後端一次載 trip + 收藏算重心，前端不必自帶座標；trip 無日曆日期時連結不帶日期（Booking 上選）。
- 導購連結一律新分頁 + `rel="noopener noreferrer"`。

## 4. 影響檔案

| 檔案 | 變更 |
|---|---|
| `lib/booking-link.ts` | 新增：`buildLodgingLink`（env 可插拔變現：Stay22/Booking aid/Travelpayouts/純連結） |
| `lib/lodging.ts` | 新增：`suggestLodging`（Places 旅宿查詢 + center bias + priceLevel 濾 + 每筆連結） |
| `app/api/lodging/suggest/route.ts` | 新增：auth + 限流 + 載 trip/收藏算重心 + suggestLodging |
| `app/trips/[id]/page.tsx` | 加「🏨 住宿建議」區塊（價位下拉 + 清單 + 整區連結） |
| `lib/trips.ts` | （若需要）匯出「依 id 取單筆 trip」給 route 用（沿用既有 CRUD） |
| `lib/__tests__/booking-link.test.ts` | 新增：四種 env 分支、query/中文 encode、日期帶入 |
| `.env.example` | 加三個變現 env |
| （可選）`lib/places.ts` | 抽出可帶 `locationBias`/`priceLevel` 的查詢；否則 lodging.ts 自打 |

## 5. 驗證基準
```bash
pnpm typecheck && pnpm test && pnpm lint
```
實測：
1. 開「沖繩」行程且該行程 schedule 地點多在你收藏裡 → 「找住宿」出現**沖繩該區**旅宿（重心錨定，不是隨便一個沖繩點）。
2. 價位選「$ 平價」→ 清單只剩 priceLevel ≤1 的。
3. `.env` 無變現 ID → 連結是純 `booking.com/searchresults?ss=...`；設 `NEXT_PUBLIC_STAY22_AID` → 變 Stay22 連結。
4. 狂按「找住宿」超過 $ 護欄 → 429。
5. `buildLodgingLink` 單測：四種 env 分支、中文/空白 encode、有/無日期。

## 6. 故障模式

| 症狀 | 原因 | 解法 |
|---|---|---|
| 住宿清單空 | Places 查無 / key 失效 / 價位濾太嚴 | 放寬價位；查 `GOOGLE_MAPS_API_KEY` |
| 建議的區域不準 | schedule 地點對照不到收藏 → 退回 location 字串 | 正常降級；行程地點多在收藏裡時最準 |
| 連結沒佣金 | 三個變現 env 都沒設，或未重部署 | 填一個（建議 Stay22 AID）後重部署 |
| 找住宿回 429 | 觸發 $ 護欄 | 明天再試或調 quota |

## 7. 已知限制（非 bug）
- **無即時房價/空房**（deep-link）——要即時價需 Booking Demand API（affiliate 審核）另開 spec。
- **地理重心靠「schedule 地點名對照收藏」**：AI 生成的新地點若不在收藏、名稱又對不上，該點不計入重心（多數行程有足夠收藏點可算）。
- **住宿只做「建議 + 導購」，不進生成 prompt**（不像 flights/carRentals 當硬約束）；要「把訂好的旅宿當行程錨點餵生成」是另一延伸（比照 flights 加 lodgingSchema），本 spec 不含。
- 各聯盟商連結格式以其官方文件為準；Booking 對台灣的直接 affiliate 仍有地區限制，故推薦 Stay22。
