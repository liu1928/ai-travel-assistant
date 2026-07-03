# Spec — Flights & Car Rentals（航班與租車資訊）※ 規劃中，未實作

> 狀態：spec 已定稿待實作。實作時照本文件執行；有歧義回來改本文件，不要口頭發散。

## 1. 總覽

使用者手動輸入已訂好的航班與租車資訊 → 生成行程時餵給 AI 當硬約束（落地後才開始排、起飛前要留機場 buffer、取還車排入時間軸）→ 資訊隨行程一起儲存 → 行程頁顯示 → 儲存後也能補填/編輯（不重新生成）。

```
/trip 表單「航班資訊」「租車資訊」（皆可選、可多筆）
   │
   ▼
POST /api/trip/generate { ..., flights: [...], carRentals: [...] }
   │
   ├─ zod 驗證（使用者主動輸入的資料，格式錯 → 400，不做 best-effort 吞掉）
   │
   ▼
generateTrip({ ..., flights, carRentals })
   │   user message 附上航班/租車清單 + 排程指令：
   │   「第一天從落地+入境 buffer 後開始；最後一天在起飛前 buffer 結束並安排前往機場；
   │     取車/還車排入時間軸（type: transport）；租車期間以開車移動為主」
   │
   ▼
AI 生成行程 JSON（tripSchema，不含航班/租車——AI 絕不生成訂位資料）
   │
   ├─ route 把「使用者輸入的」flights/carRentals 附掛到回傳的 trip 物件上
   │
   ▼
前端顯示 ✈️ 航班卡 + 🚗 租車卡 + 時間軸
   │（儲存）
   ▼
POST /api/trips → Firestore（含 flights/carRentals）
   │
   ▼
/trips/[id] 顯示 + 可另行編輯航班/租車（PATCH 整筆 trip，不重新生成）
```

## 2. 契約

### 2.1 Schema（schema/trip.ts 新增）

```ts
// 沿用既有 timePattern（HH:mm）
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const flightSchema = z.object({
  flightNo: z.string().min(1),          // 航班號，如 "BR198"
  airline: z.string().optional(),       // 航空公司，可選
  from: z.string().min(1),              // 出發機場/城市，如 "台北 TPE"
  to: z.string().min(1),                // 抵達機場/城市，如 "沖繩 OKA"
  date: z.string().regex(datePattern).optional(),  // YYYY-MM-DD，可選
  departTime: z.string().regex(timePattern),       // HH:mm
  arriveTime: z.string().regex(timePattern),       // HH:mm（跨日不另計，見已知限制）
  note: z.string().optional(),
});
export type Flight = z.infer<typeof flightSchema>;

export const carRentalSchema = z.object({
  company: z.string().optional(),              // 租車公司，可選
  pickupLocation: z.string().min(1),           // 取車地點
  pickupDate: z.string().regex(datePattern).optional(),
  pickupTime: z.string().regex(timePattern),
  dropoffLocation: z.string().min(1),          // 還車地點
  dropoffDate: z.string().regex(datePattern).optional(),
  dropoffTime: z.string().regex(timePattern),
  note: z.string().optional(),
});
export type CarRental = z.infer<typeof carRentalSchema>;

// ⚠️ 關鍵設計：tripSchema（AI 輸出用）完全不動。
// 航班/租車是使用者輸入的訂位資料，絕不能出現在 zodOutputFormat 的 schema 裡，
// 否則 structured outputs 會讓模型編造航班號/時間。
export const tripWithBookingsSchema = tripSchema.extend({
  flights: z.array(flightSchema).default([]),
  carRentals: z.array(carRentalSchema).default([]),
});
export type TripWithBookings = z.infer<typeof tripWithBookingsSchema>;
```

`.default([])`：Firestore 既有舊行程文件沒有這兩個欄位，parse 時自動補空陣列，**不需要資料遷移**。

### 2.2 POST `/api/trip/generate`（body 新增欄位）

```ts
{
  // ...既有欄位不變（prompt/placeIds/days/style/budget/travelMode/startDate）
  flights?: Flight[];      // 可選
  carRentals?: CarRental[];// 可選
}
```

- 驗證：有傳就用 `z.array(flightSchema)` / `z.array(carRentalSchema)` safeParse。
  **失敗 → 400 `航班或租車資料格式不正確`**。這是使用者主動填的主要資料，
  跟假日（衍生資料，best-effort）不同——填錯要明講，不能靜默丟掉。
- 成功回應的 `trip` 物件附掛使用者輸入的 `flights`/`carRentals`（原封不動回傳，AI 生成內容不含它們）。

### 2.3 POST/PATCH `/api/trips`（儲存/編輯）

- 驗證 schema 從 `tripSchema` 換成 `tripWithBookingsSchema`。
- `lib/trips.ts` 的 `savedTripSchema` 同步改用 `tripWithBookingsSchema.shape` 展開。
- PATCH 維持「整筆覆蓋」語意不變——前端編輯航班/租車後把完整 trip PATCH 回來。

### 2.4 generateTrip 輸入（lib/anthropic.ts）

```ts
export type GenerateTripInput = {
  // ...既有欄位
  flights?: Flight[];
  carRentals?: CarRental[];
};
```

`buildUserMessage` 新增兩段（比照 holidays 的作法，有資料才附）：

```
航班資訊（已訂，硬約束）：
- BR198 台北 TPE → 沖繩 OKA，2026-09-25 10:00 起飛，12:30 抵達
- BR196 沖繩 OKA → 台北 TPE，2026-09-28 18:00 起飛，19:30 抵達

請據此安排：
- 抵達當天的行程從落地後約 1.5 小時開始（入境+提領行李）
- 起飛當天的行程在起飛前 2.5 小時結束，並在時間軸排入「前往機場」（type: transport）
- 不要建議任何其他航班——航班已訂死，只能圍繞它排行程

租車資訊（已訂）：
- OTS 租車：2026-09-25 13:30 那霸機場取車 → 2026-09-28 15:00 那霸機場還車

請據此安排：
- 取車與還車各排入時間軸一項（type: transport）
- 租車期間的移動以開車為主
```

### 2.5 前端

**`/trip`（生成表單）**：
- 新增兩個可收合區塊「✈️ 航班資訊（可選）」「🚗 租車資訊（可選）」，預設收合。
- 每個區塊是動態清單：「＋ 新增航班」/「＋ 新增租車」加一筆，每筆可刪除。
- 航班欄位：航班號*、出發地*、目的地*、日期、起飛時間*、抵達時間*、航空公司、備註（* 必填）。
- 租車欄位：取車地點*、取車日期、取車時間*、還車地點*、還車日期、還車時間*、公司、備註。
- 生成結果區：時間軸上方顯示航班卡與租車卡（唯讀）。

**`/trips/[id]`（已存行程頁）**：
- 標題卡下方顯示「✈️ 航班」「🚗 租車」卡片（沒有資料就不渲染，舊行程零視覺差異）。
- 卡片旁「編輯」按鈕 → 展開跟 `/trip` 表單相同的動態清單編輯器 → 「儲存」PATCH 整筆 trip。
- **這個編輯不重新生成行程**——常見情境是先生成行程、之後才訂到機票，補填進來只是記錄+顯示。
  想讓新航班影響時間軸 → 回 `/trip` 重新生成（已知限制，見 §7）。

## 3. 設計決策

- **AI 輸出 schema（tripSchema）完全不動**：航班/租車走「使用者輸入 → route 附掛」路徑，
  結構化輸出裡不存在這些欄位，從機制上杜絕 AI 編造航班號/時刻。這是本 spec 最重要的一條。
- **驗證失敗回 400，不做 best-effort**：假日/車程是衍生的加值資料，壞了可以少一行 insights；
  航班/租車是使用者親手填的主要資料，靜默丟掉會讓人以為存進去了。兩種哲學并存，界線是「誰產生的資料」。
- **時間欄位沿用 HH:mm + 可選 YYYY-MM-DD**：復用既有 `timePattern`，跟 schedule.time 一致；
  不引入時區、不引入 datetime 库。
- **buffer 數字（入境 1.5h、起飛前 2.5h）寫死在 user message 指令裡**：這是給 AI 的排程參考預設，
  不是使用者可調參數。真有需求再開欄位，先不過度設計。
- **`.default([])` 取代資料遷移**：Firestore 舊文件缺欄位 → zod 自動補空陣列，零遷移成本。
- **儲存後編輯不觸發重新生成**：PATCH 語意維持「整筆覆蓋、只動資料」。
  重新生成是另一個成本（Anthropic API 費用）跟 UX（覆蓋手動編輯過的時間軸）問題，明確不做。

## 4. 影響檔案

| 檔案 | 變更 |
|---|---|
| `schema/trip.ts` | 新增 `flightSchema`、`carRentalSchema`、`tripWithBookingsSchema`；`tripSchema` 不動 |
| `schema/__tests__/trip.test.ts` | 新增 flights/carRentals 驗證測試（含舊文件缺欄位 → default 空陣列） |
| `lib/anthropic.ts` | `GenerateTripInput` 加 `flights`/`carRentals`；`buildUserMessage` 加兩段組裝 |
| `lib/trips.ts` | `savedTripSchema` 改基於 `tripWithBookingsSchema` |
| `app/api/trip/generate/route.ts` | body 驗證 + 傳入 generateTrip + 回傳時附掛 |
| `app/api/trips/route.ts` | POST 驗證改 `tripWithBookingsSchema` |
| `app/api/trips/[id]/route.ts` | PATCH 驗證改 `tripWithBookingsSchema` |
| `app/trip/page.tsx` | 表單加航班/租車動態清單區塊；結果區顯示卡片 |
| `app/trips/[id]/page.tsx` | 顯示卡片 + 獨立編輯器（PATCH） |

## 5. 驗證基準

```bash
pnpm typecheck && pnpm test && pnpm lint
```

實測：
1. 不填航班/租車 → 生成與儲存行為跟現在完全一樣；舊的已存行程開起來零差異。
2. 填一筆去程航班（如 10:00 起飛 12:30 抵達）→ 生成的第一天時間軸從 ~14:00 開始，
   且 insights 或 schedule 反映了航班約束；回程航班 18:00 → 最後一天有「前往機場」項且行程在 ~15:30 前收尾。
3. 填租車 → 時間軸有取車/還車兩個 transport 項。
4. 生成後儲存 → `/trips/[id]` 看得到航班/租車卡 → 編輯（改時間/加一筆）→ 儲存 → 重新整理資料還在。
5. 航班時間填 `25:00` 之類非法格式 → 前端擋掉或後端 400 明確報錯，不會靜默吞掉。
6. 舊行程（Firestore 裡沒有 flights 欄位）→ 開頁正常、PATCH 正常、不顯示航班卡。

## 6. 故障模式

| 症狀 | 原因 | 解法 |
|---|---|---|
| 生成回 400「航班或租車資料格式不正確」 | 時間不是 HH:mm、日期不是 YYYY-MM-DD、必填欄位空白 | 前端表單先驗證；檢查是不是 12 小時制（"2:30 PM"）誤填 |
| AI 排的行程沒有避開航班時間 | user message 組裝漏了，或模型忽略指令 | dev server 看送出的 user message 是否含航班段；偶發忽略 → 重新生成一次 |
| 舊行程開頁掛掉 | savedTripSchema 改壞、`.default([])` 沒生效 | 檢查 tripWithBookingsSchema 是否用 `.default([])` 而非 `.optional()` 之外的寫法 |
| 時間軸出現 AI 編造的航班號 | tripSchema 被誤加了 flights 欄位（違反 §3 第一條） | 立刻回退：AI 輸出 schema 絕不能含訂位資料 |
| 編輯航班存檔後時間軸沒變 | 正常行為——編輯不重新生成（§2.5、§3） | 需要重排就回 /trip 重新生成 |

## 7. 已知限制（非 bug）

- **跨日航班**（紅眼班機 23:50 起飛、隔天 05:00 抵達）：arriveTime 只存 HH:mm，不做跨日計算；
  date 欄位可各自標註，AI 看得懂文字描述，但系統不做日期運算。
- **不處理時區**：所有時間一律視為當地時間，使用者自己填當地時刻。
- **buffer 不可調**：入境 1.5h / 起飛前 2.5h 是寫死的 AI 指令預設值。
- **儲存後編輯航班不會重排時間軸**（設計決策，見 §3）。
- **沒有航班狀態查詢**：純手動記錄，不接航班動態 API；未來要接（如 AviationStack）另開 spec。
