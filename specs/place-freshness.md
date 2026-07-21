# Spec — Place Freshness（收藏保鮮：歇業偵測與生成排除）※ 規劃中，未實作

> 狀態：spec 已定稿待實作。實作時照本文件執行；有歧義回來改本文件。
> 前置：無硬依賴（`lib/quotas.ts` 護欄已落地，直接登記新成本項即可）。建議在 `specs/opening-hours.md` 之前做——先用便宜 SKU 驗證「Place Details GET + TTL 快取 + 配額」模式。

## 0. 為什麼是這份

Google Maps 收藏放兩年，一堆店早就倒了，Google 不會提醒你；AI 生成行程更不知道，會把歇業店排進去。用 Place Details 的 `businessStatus` 欄位（**Pro SKU，$17/1K，每月免費 5,000 次**）掃收藏、標記歇業、生成時自動排除。個人用量（300 收藏每月全掃一輪 = 300 次）完全在免費額度內。

## 1. 契約

### 1.1 `schema/place.ts` — 新欄位（全 optional，舊資料免遷移）

```ts
businessStatus: z.enum(["OPERATIONAL", "CLOSED_TEMPORARILY", "CLOSED_PERMANENTLY", "NOT_FOUND"]).optional(),
statusCheckedAt: z.number().optional(), // epoch ms
```

`NOT_FOUND` = Details 回 HTTP 404（place 已從 Google 下架）。**不偽造 Google 沒說的話**：404 不寫成 CLOSED_PERMANENTLY，但 UI 同等級警示。

### 1.2 新 `lib/place-status.ts`

- `fetchBusinessStatus(placeId): Promise<Result<BusinessStatus, PlaceStatusError>>`
- GET `https://places.googleapis.com/v1/places/{placeId}`，`X-Goog-FieldMask: id,businessStatus`（呼叫模式比照 `lib/sharelink.ts` 的 `fetchPlaceById`）。
- 回應缺 `businessStatus` 或值為 `BUSINESS_STATUS_UNSPECIFIED` → 視同 `OPERATIONAL`（不標警示）。

### 1.3 新 `app/api/collection/refresh-status/route.ts`（POST，無 body）

流程：
1. `requireUid`。
2. `listPlaces(uid)` 篩選：`statusCheckedAt` 缺席或早於 `now - STATUS_TTL_DAYS`（預設 7 天，env 可調）。
3. 最舊優先排序，取前 `REFRESH_STATUS_CAP`（預設 50，env 可調）筆。
4. `n = 0` → 直接回（**不扣配額**）；否則 `checkAndConsume(uid, "places_status", n)`（`SERVICE_COST_USD` 登記 `places_status: 0.017`）。
5. `mapLimit(4)` 併發抓，逐筆 merge 寫回 place doc（`businessStatus` + `statusCheckedAt`；單筆失敗不中斷批次）。
6. 回 `{ scanned, updated, closedFound, failed, remaining }`——`remaining > 0` 時前端提示「還有 N 筆待掃，稍後再按」。

**掃描時機採手動按鈕**：App Hosting 無 cron 基建；TTL 本身就是節流（重複點擊、無過期筆 → 0 呼叫 0 扣款），不需額外 cooldown。

### 1.4 UI — `app/page.tsx`

- 收藏區標題列加「檢查歇業狀態」按鈕，狀態機/回饋呈現沿用既有「批次重新標籤」慣例。
- PlaceCard 徽章：`CLOSED_PERMANENTLY` / `NOT_FOUND` → 紅「已歇業」；`CLOSED_TEMPORARILY` → 黃「暫停營業」。

### 1.5 生成排除 — `app/api/trip/generate/route.ts`

- 撈收藏後過濾：`CLOSED_PERMANENTLY` / `NOT_FOUND` 直接剔除，且有剔除時 `insights` 附「已自動排除歇業地點：X、Y」（沿用 post-hoc insights 模式）。
- `CLOSED_TEMPORARILY`：不剔除，prompt 中該地點行尾註「（暫停營業中，避免排入或提醒使用者確認）」。

## 2. 設計決策

- **不把 `businessStatus` 加進匯入 Text Search 的 field mask**：會把整個 Search 呼叫抬到 Pro SKU，加價不加值。狀態只從 Details 補。
- **歇業不自動刪收藏**：使用者可能想留念或手動處理；只標記 + 生成排除。
- **`specs/opening-hours.md` 落地後有免費順帶**：Enterprise Details 呼叫的 field mask 含 `businessStatus`，同一請求順帶更新本欄位，變相幫收藏保鮮省 Pro 呼叫。
- **成本**：單次 50 筆帳面 $0.85、全庫 300 筆 $5.10——但 Pro SKU 免費 5K/月 下實際 $0；護欄照登記，防未來量變。

## 3. 影響檔案

| 檔案 | 變更 |
|---|---|
| `schema/place.ts` | 加 `businessStatus?`、`statusCheckedAt?` |
| `lib/place-status.ts`（新） | `fetchBusinessStatus` |
| `app/api/collection/refresh-status/route.ts`（新） | 批次掃描端點 |
| `lib/quotas.ts` | `SERVICE_COST_USD` 登記 `places_status: 0.017` |
| `app/page.tsx` | 按鈕 + 徽章 |
| `app/api/trip/generate/route.ts` | 生成排除 + insights 註記 |
| `lib/__tests__/place-status.test.ts`（新） | 404→NOT_FOUND、UNSPECIFIED→OPERATIONAL、TTL 篩選邏輯 |

## 4. 驗證基準

```bash
pnpm typecheck && pnpm test && pnpm lint
```

實測：
1. 按「檢查歇業狀態」→ place doc 出現 `businessStatus`/`statusCheckedAt`；已知歇業店（手動找一家）標紅徽章。
2. 立刻再按一次 → 回 `scanned: 0`，配額 usage 不增加（TTL 生效）。
3. 收藏含歇業店時生成行程 → 該店不出現在行程，insights 有排除說明。
4. 收藏 > cap 時 → 回 `remaining > 0`，前端提示分批。
5. 未登入打 API → 401；連打超過 rate limit → 429。

## 5. 故障模式

| 症狀 | 原因 | 解法 |
|---|---|---|
| 全部標 NOT_FOUND | field mask 或 API key 權限錯 | 檢查 `X-Goog-FieldMask` 與 key 的 Places API (New) 啟用狀態 |
| 配額瞬間吃光 | cap/TTL 沒生效 | 確認 n=0 早退與 TTL 篩選；`REFRESH_STATUS_CAP` 環境變數 |
| 匯入變貴 | businessStatus 誤加進 Text Search mask | 本 spec 明令禁止，檢查 import 路徑的 field mask 未動 |

## 6. 已知限制

- `CLOSED_TEMPORARILY` 的資訊時效性依 Google 資料品質，可能過時——所以只提醒不剔除。
- 手動觸發：不會自動背景更新；日後若有 cron 基建（Cloud Scheduler）可另開 spec。
