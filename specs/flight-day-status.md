# Spec — Flight Day Status（出發日航班即時動態）※ 規劃中，未實作

> 狀態：spec 已定稿待實作。實作時照本文件執行；有歧義回來改本文件。
> 前置：無（不依賴 schedule-anchoring）。`specs/trip-day-mode.md` 會複用本能力。

## 0. 為什麼是這份

行程裡已存 `flights[]`（班表時刻），但出發當天使用者真正想知道的是：**延誤了嗎？幾號登機門？** AeroDataBox 同一端點在臨近日期會帶即時欄位（實際/預估起降時刻、航廈、登機門、狀態），目前 `lib/aerodatabox.ts` 只取班表欄位。本 spec 在「今天有航班」時提供一鍵查詢即時動態。

成本：$0——用既有 RapidAPI 訂閱（600 units/月、1 req/s），靠觸發條件限縮保護額度。

## 1. 契約

### 1.1 `lib/aerodatabox.ts` — 擴充解析

- 既有查詢函式擴充回傳即時欄位（實作時以實際回應為準核對欄位名，本 spec 只定形狀）：

```ts
export type FlightDayStatus = {
  status?: string;            // 例 Expected / Delayed / Departed / Cancelled…
  revisedDepartTime?: string; // HH:mm，有修正才有
  revisedArriveTime?: string;
  departTerminal?: string;
  departGate?: string;
  arriveTerminal?: string;
};
```

- 注意既有 429 教訓（task/MEMORY.md 2026-07-11）：fallback 背靠背請求要間隔，沿用既修好的節流。

### 1.2 API — 擴充 `app/api/flight/lookup/route.ts`（不另開 route，避免重複驗證/限流碼）

- body 加 `mode?: "schedule" | "status"`（預設 `"schedule"`，行為不變 = 零迴歸）。
- `mode: "status"` 時：**server 端強制驗證 `date` 必須是今天**（以出發地日期為準的模糊容忍 ±1 天，因時區），否則 400——即時動態只在當天有意義，也是額度保護的硬閘門。
- rate limit 沿用既有 flight lookup 桶。

### 1.3 UI — `components/bookings.tsx` 航班卡片

- 顯示條件：`flight.date` === 今天（client 本地日）→ 卡片出現「查即時動態」按鈕。
- 查詢結果顯示在卡片動態列：狀態、修正時刻（與原時刻不同時標紅 + 顯示「原 08:00 → 08:45」）、航廈/登機門。
- **client 端 session 快取**（`sessionStorage`，key = 航班號+日期）：重整/重進頁不重打；提供「重新整理」小按鈕手動更新。

## 2. 設計決策

- **只在當天可查**：600 units/月 是硬額度，未來日期的「即時動態」無意義；server 端驗證是閘門，UI 只是引導。
- **擴充 lookup route 而非新 route**：驗證、限流、航班號 regex、錯誤處理全部複用；`mode` 預設值保證既有呼叫零迴歸。
- **不自動輪詢**：手動按鈕 + session 快取。自動輪詢會把額度燒在背景（一班機刷 10 次 = 10 units）。
- **不持久化動態**：即時資料存 Firestore 沒意義（過期即廢），只留 client 快取。

## 3. 影響檔案

| 檔案 | 變更 |
|---|---|
| `lib/aerodatabox.ts` | 解析即時欄位，回傳型別擴充 |
| `app/api/flight/lookup/route.ts` | `mode` 參數 + 當天限定驗證 |
| `components/bookings.tsx` | 航班卡片動態列 + 按鈕 + session 快取 |
| `lib/__tests__/aerodatabox.test.ts`（或既有測試檔） | 即時欄位解析、mode 預設不迴歸、非當天 400 |

## 4. 驗證基準

```bash
pnpm typecheck && pnpm test && pnpm lint
```

實測：
1. 行程含今天出發的真實航班 → 卡片出現「查即時動態」，查詢顯示狀態/登機門；延誤班機修正時刻標紅。
2. 航班日期非今天 → 按鈕不出現；直接打 API `mode:"status"` + 未來日期 → 400。
3. 既有 lookup（不帶 mode）行為不變（自動填 route/時刻照舊）。
4. 同 session 重進頁 → 不重打 API（Network 面板確認）。

## 5. 故障模式

| 症狀 | 原因 | 解法 |
|---|---|---|
| 429 迴歸 | 動態查詢與 fallback 背靠背 | 沿用既有節流；單日單班快取後重試面極小 |
| 動態欄位全空 | 該航班/機場無即時資料源 | 顯示「暫無即時資料」，不報錯（資料源限制，同班表查詢的既有處理哲學） |
| 時區誤判「今天」 | client 本地日 vs 出發地日 | server 用 ±1 天容忍；UI 以 flight.date 字面比對 client 本地日即可 |

## 6. 已知限制

- 免費資料源對部分機場無登機門/延誤資料——顯示「暫無」即可，不升級付費層。
- 不做推播通知（無 push 基建）；使用者主動打開查看。
