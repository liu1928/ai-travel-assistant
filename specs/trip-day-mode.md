# Spec — Trip Day Mode（旅途模式：行程期間的「今日」視圖）※ 規劃中，未實作

> 狀態：spec 已定稿待實作。實作時照本文件執行；有歧義回來改本文件。
> 前置（硬）：`specs/schedule-anchoring.md`（`startDate` 判斷今天第幾天；座標做導航連結）。
> 前置（軟）：`specs/flight-day-status.md`（航班動態列）、`specs/map-view.md`（今日地圖）——缺席時對應區塊自然不顯示，不阻擋本 spec。
> **建議最後實作**：本 spec 是組裝件，把前面各 spec 的能力在「旅途中」場景收攏。

## 0. 為什麼是這份

app 目前是「行前規劃工具」：行程開始後打開，還是同一頁靜態時間軸。旅途中真正要的是：今天要去哪、下一站怎麼走、天氣如何、航班有沒有延誤。本 spec 讓 `/trips/[id]` 在行程期間自動切換成「今日」視圖。全部用既有資料與免費 deep link，**$0**。

## 1. 契約

### 1.1 觸發判斷（client 端純函式，可單測）

```ts
// 回 null（不在行程期間）或 1-based 今天是第幾天
function currentTripDay(startDate: string | undefined, totalDays: number, today: string): number | null
```

- `startDate` 缺席（舊行程）→ null，頁面行為與現在完全一致。
- 以 client 本地日為準（旅途中人在當地，本地日即行程日）。

### 1.2 今日視圖 — `app/trips/[id]/page.tsx`

在行程期間（`currentTripDay` 非 null）時：

- 頁首顯示「旅途中 · 第 N 天／共 M 天」徽章；預設捲動至第 N 天卡片並高亮（其他天照常可看，**不是隱藏**）。
- 今日卡片強化：
  - **當日天氣**：從 `weather[]` 以日期比對取當日，顯示於卡片頂（既有快照資料，零請求）。
  - **導航按鈕**：有座標（`lat/lng`，地基欄位）的 stop 加「導航」，開
    `https://www.google.com/maps/dir/?api=1&destination={lat},{lng}`（有 `placeId` 時加 `&destination_place_id={placeId}` 提升準確度）。Google Maps URLs 是免費 deep link，不計 API 用量。手機開啟 app、桌面開網頁。
  - **下一站提示**：依現在時刻（HH:mm）與 schedule `time` 找出下一個項目，卡片內標「下一站」。
- **今日航班**（`flights[]` 有 date = 今天者）：航班卡置頂今日卡片上方；`specs/flight-day-status.md` 已落地時直接複用其「查即時動態」能力（本 spec 不重複實作）。
- （軟依賴）`specs/map-view.md` 已落地時：今日卡片的地圖 toggle 預設展開。

### 1.3 不做的事（明確出範圍）

- 不做推播/鬧鐘提醒（無 push 基建）。
- 不做即時定位追蹤（不取 geolocation；導航交給 Google Maps）。
- 不做行程自動打卡（visited 回饋屬 Trip Recap／DNA 閉環，另案）。

## 2. 設計決策

- **增強而非改版**：同一頁、同一資料，只是行程期間多一層「今日」導向；不在行程期間 = 零變化，零迴歸面。
- **client 端判斷「今天」**：旅途中裝置時區跟人走，本地日就是對的；不引入時區換算複雜度。
- **導航用 deep link 而非內嵌路線**：Google Maps app 的導航體驗不可能在 web 重做；deep link 免費且是使用者已熟悉的動線。
- **組裝件哲學**：航班動態、地圖各自在其 spec 落地與驗收；本 spec 只負責在對的時間把它們擺到眼前。

## 3. 影響檔案

| 檔案 | 變更 |
|---|---|
| `app/trips/[id]/page.tsx` | 今日視圖：徽章、捲動高亮、天氣置頂、導航按鈕、下一站、今日航班置頂 |
| `lib/trip-day.ts`（新，或併入既有 date utils） | `currentTripDay` 等純函式 |
| `lib/__tests__/trip-day.test.ts`（新） | 期間內/外、首末日、缺 startDate、跨月 |

## 4. 驗證基準

```bash
pnpm typecheck && pnpm test && pnpm lint
```

實測（可把某行程 `startDate` 手動改成今天附近驗證）：
1. 今天 = 第 2 天 → 開頁自動捲到第 2 天、徽章「第 2 天／共 3 天」、當日天氣顯示。
2. 有座標 stop 的「導航」→ 手機開 Google Maps 導航至該點。
3. 今天有航班 → 航班卡置頂（flight-day-status 落地時含動態按鈕）。
4. 行程期間外 / 舊行程無 startDate → 頁面與現在完全一致。
5. `currentTripDay` 單測涵蓋邊界（首日、末日、期間外、跨月）。

## 5. 故障模式

| 症狀 | 原因 | 解法 |
|---|---|---|
| 「今天」判斷差一天 | 用了 UTC 而非本地日 | 純函式以本地日字串比對，單測擋 |
| 導航點到同名錯位 | 只帶名稱 | 一律帶 `lat,lng`；有 placeId 加 `destination_place_id` |
| 舊行程突然變樣 | 缺 startDate 未 null 短路 | `currentTripDay` 缺席即 null，驗收條目 4 |

## 6. 已知限制

- 「下一站」只按表定時間推算，不感知實際進度（沒有定位/打卡）。
- 跨時區長途行程（例：出發日跨日界線）以裝置本地日為準，極端情況可能差一天——旅途中裝置時區已隨人，實務影響極小。
