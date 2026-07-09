# Spec — Foundation Hardening（地基止血）※ 規劃中，未實作

> 狀態：spec 已定稿待實作。實作時照本文件執行；有歧義回來改本文件，不要口頭發散。
> 這是「分身模式」(`specs/persona-mode.md`)、「反向策展」(`specs/reverse-curation.md`) 的前置：
> 那兩個功能會放大付費 API 呼叫量，沒有本 spec 的護欄先落地，等於在漏水的地基上蓋房子。

## 0. 為什麼是這份先做

正式站、綁真信用卡、燒 Places / Routes / Anthropic 付費 API，但程式層**零成本護欄**：
- `grep ratelimit/cache` 全碼庫零命中；唯一天花板是 `apphosting.yaml` 的 `maxInstances: 2`（限併發、不限累積花費）。
- 一個已登入帳號（或外洩的 Bearer token）可迴圈打 `/api/trip/generate`，每次燒一次 Sonnet + 多次 Places `resolveCoordinates` + Routes，帳單無上限。
- `app/api/import/extension/route.ts` 還開 `Access-Control-Allow-Origin: *`，配合無限流是放大器。

本 spec 一次收斂 5 個可獨立出 PR 的止血項，並排出建議實作順序。

---

## 1. 五個工作項（各自可獨立驗收）

| # | 項目 | 檔案數 | 嚴重度 | 類型 |
|---|---|---|---|---|
| A | per-uid + 全域 每日用量護欄（Firestore token bucket） | 多 | 高 | 成本/安全 |
| B | 匯入筆數上限 + 標籤分批 | 3 | 高 | 成本 |
| C | 生成後車程 `coords` 壓縮 bug（車程被系統性低估） | 1 | 中（正確性） | bug |
| D | 批次標籤靜默空標籤（截斷時尾段地點靜默變無標籤） | 2 | 高 | 資料品質 |
| E | 記帳頁孤兒入口（`/trips/[id]/expenses` 全站無 UI 連結） | 2 | 高 | UX |

**建議實作順序**：A → B → D → C → E。A/B/D 是成本與資料品質止血（互相獨立），C 是純修 bug，E 是純 UI，最後補。
> 超過 3 檔的改動（A、B、D）依根 `CLAUDE.md` 需先寫 `task/PLAN.md` 條列步驟再動手。

---

## 2. 項目 A — 每日用量護欄

### 2.1 設計核心

用**專案既有的 `firebase-admin` Firestore 當 token bucket 後端，零新依賴**（不引入 Redis/Upstash），完全貼合 App Hosting + ADC 現況。`maxInstances: 2` 併發極低，Firestore transaction 競爭可忽略。

雙層：
1. **per-uid 每日預算**：每個付費入口在 `requireUid` 成功後、呼叫付費 API 前，對 `usage/{uid}__{YYYY-MM-DD}` 原子累加預估成本；超過使用者每日上限 → `429`。
2. **全域每日熔斷**：`usage/__global__{YYYY-MM-DD}` 累計全服務；超過總閾值 → 所有付費入口回 `503`，防單日總支出失控。

### 2.2 契約

**新增 `lib/quotas.ts`**（設定值，對照 `COSTS.md` 費率；一律 `envOr` 讀覆寫）：

```ts
// 每次呼叫的「預估成本」美金（粗估，只為相對比較與熔斷，非精算帳單）
export const SERVICE_COST_USD = {
  places_search: 0.02,   // Places Text Search 一次
  trip_generate: 0.06,   // Sonnet 一次 + 數次 Places/Routes 的粗估上界
  tagging_batch: 0.01,   // Haiku 批次一次
  import_resolve: 0.02,  // 每筆 candidate 一次 Text Search（乘以筆數）
} as const;
export type PaidService = keyof typeof SERVICE_COST_USD;

export const USER_DAILY_BUDGET_USD = Number(envOr("QUOTA_USER_DAILY_USD", "2"));
export const GLOBAL_DAILY_BUDGET_USD = Number(envOr("QUOTA_GLOBAL_DAILY_USD", "20"));
```

**新增 `lib/rate-limit.ts`**：

```ts
export type RateLimitError =
  | { kind: "rate_limited"; scope: "user"; retryAfterSec: number }
  | { kind: "circuit_open"; scope: "global"; retryAfterSec: number };

// 在 requireUid 成功後呼叫；cost 預設取 SERVICE_COST_USD[service]，
// import 類可傳 cost = 單價 × 筆數。
export async function checkAndConsume(
  uid: string,
  service: PaidService,
  cost?: number,
): Promise<Result<null, RateLimitError>>;
```

- 實作：`db().runTransaction`，同一交易內讀 `usage/{uid}__{date}` 與 `usage/__global__{date}`，比對上限：先檢查全域（回 `circuit_open`），再檢查 per-uid（回 `rate_limited`），都過才 `increment(cost)` 兩個 doc。
- `date` 用**當地時區**（`Asia/Taipei`）的 `YYYY-MM-DD`；`retryAfterSec` = 距下一個當地午夜的秒數。
- doc 欄位：`{ estCostUsd: number, count: number, updatedAt: number }`。舊 doc 不存在 → transaction 內視為 0。

### 2.3 插入點（`requireUid` 成功後、付費呼叫前各插一行）

| Route | service | 備註 |
|---|---|---|
| `app/api/places/route.ts` | `places_search` | |
| `app/api/trip/generate/route.ts` | `trip_generate` | |
| `app/api/import/takeout/route.ts` | `import_resolve` | cost = 單價 × 候選筆數（見項目 B 的上限） |
| `app/api/import/sharelink/route.ts` | `import_resolve` | |
| `app/api/import/extension/route.ts` | `import_resolve` | |
| `app/api/import/inspiration/route.ts` | `import_resolve` | 反向策展 spec 新增，一併納入 |
| `app/api/collection/route.ts`（POST） | `tagging_batch` | 加一筆收藏會打 `tagPlace` |
| `app/api/collection/retag/route.ts` | `tagging_batch` | |
| `app/api/collection/retag-empty/route.ts` | `tagging_batch` | |

- 命中 `rate_limited` → `429`，帶 `Retry-After` header + `{ error: "今日用量已達上限，請明天再試" }`。
- 命中 `circuit_open` → `503` + `Retry-After` + `{ error: "系統今日已達總量上限，請稍後再試" }`。
- **不對** `/api/dna`、`GET /api/collection`、`GET/列表 /api/trips` 等純 Firestore 讀取限流（不燒付費 API）。
- CORS route（extension）回錯時要沿用 `CORS_HEADERS`。

---

## 3. 項目 B — 匯入筆數上限 + 標籤分批

### 3.1 問題

`lib/import-core.ts` 的 `importCandidates` 對所有 valid 候選全量跑 Text Search（每筆一次付費 API），無上限；Takeout 檔可含上千筆。且 `tagPlaces` 一次把整批塞給 Haiku（`max_tokens: 2048`），大批次會截斷 → 見項目 D。

### 3.2 契約

`lib/import-core.ts`：

```ts
const MAX_IMPORT = Number(envOr("MAX_IMPORT_PER_REQUEST", "300")); // 單次匯入上限
const TAG_BATCH_SIZE = 30; // 每批送 tagPlaces 的筆數，避免 max_tokens 截斷

export type ImportSummary = {
  success: number; skipped: number; failed: number; invalid: number;
  truncated: number; // 因超過 MAX_IMPORT 被丟棄的筆數（>0 時前端要提示）
};
```

- `valid` 超過 `MAX_IMPORT` → 只取前 `MAX_IMPORT` 筆，其餘計入 `summary.truncated`。
- 標籤改成 `chunk(toSave, TAG_BATCH_SIZE)` 逐批呼叫 `tagPlaces`，每批獨立成敗；串回 `tagsList`。
- `app/api/import/extension/route.ts`：`body.places.length > MAX_IMPORT` 時同樣截斷並在回應帶 `truncated`。
- 前端 `app/import/page.tsx` 的完成訊息在 `truncated > 0` 時加一行「超過單次上限，已匯入前 N 筆，其餘請分批」。

---

## 4. 項目 C — 車程 `coords` 壓縮 bug（正確性）

### 4.1 問題

`app/api/trip/generate/route.ts`（約 117–140 行）對每天 `schedule` 過濾 `place/food` 的 stop 逐點取座標：命中收藏用已知座標，未命中才 `resolveCoordinates`。**但迴圈只在解析成功時 `push`，失敗的 stop 被跳過**，`coords` 長度 < stops 長度。`estimateLegs` 對壓縮後相鄰點算段，等於把 `A →（解析失敗的 B）→ C` 當成 `A → C` 直算 → 移動時間被系統性**低估**，且對應不到真實行程。

### 4.2 修法

保持索引對齊，**寧可少報一天車程，不要報錯的數字**：

- 逐 stop 產出 `coord | null`（解析失敗放 `null`，不壓縮）。
- 若當天存在 `null`（有 stop 定位失敗）→ **跳過該天車程估計**，改 push insight：`第 N 天有地點無法定位，未估移動時間`。
- 只有當天全部 `place/food` stop 都成功定位，才 `estimateLegs`（此時 `coords` 與 stops 一一對應，計算才正確）。
- 其餘 best-effort 語意不變（整段仍包在 try/catch，失敗只少一行 insight）。

---

## 5. 項目 D — 批次標籤靜默空標籤

### 5.1 問題

`lib/tagging.ts` 的 `tagPlaces` 用 `batchSchema = { tags: string[][] }`，靠位置對齊 `out = places.map((_, i) => tags[i] ?? [])`。當地點多到輸出被 `max_tokens: 2048` 截斷，zod 仍 parse 出**短陣列**，後段地點全拿到 `[]`（被當「無標籤」），無任何長度一致性檢查或告警。`SPEC.md` §7① 也記錄過「標籤悄悄變空」。`import-core.ts` 又把 `tagPlaces` 失敗與「真的無標籤」都塞 `[]`，`retag-empty` 之後會反覆重試這些永遠標不出的點。

### 5.2 修法

**用「可自我對位的結構」取代「信任位置」**：

`lib/tagging.ts`：

```ts
// 讓模型回填 index 自證對應，而非靠陣列位置
const batchSchema = z.object({
  items: z.array(z.object({
    index: z.number().int(),          // 對應輸入清單的 1-based 編號
    tags: z.array(placeTag).max(4),
  })),
});
```

- system prompt 改為要求「每筆回填其 `index`」。
- 回傳後做**完整性檢查**：`items` 是否涵蓋 `1..N` 每個 index。
  - 缺 index / 數量不符 → 回 `err({ kind: "api_error", message: "標籤輸出不完整（疑似截斷）" })`，**不靜默補 `[]`**。
- 依 `index` 組回 `PlaceTag[][]`（而非 `tags[i]`）。
- 配合項目 B 的 `TAG_BATCH_SIZE=30` 讓每批遠低於 token 上限，正常情況不會觸發截斷。

`lib/import-core.ts`：`tagPlaces` 回 `api_error` 的批次，該批地點以空標籤存入但**不計入 success 的「已標籤」**（維持現有寫入行為，僅確保錯誤不被當成「無標籤」）；`retag.ts` / retag-empty 對「曾 api_error」與「模型判定 no_tags」加以區分，避免無效重試（可先簡化為：retag-empty 只重試 `tags.length === 0` 且 `updatedAt` 距今超過退避窗的點）。

> 註：`taggingResultSchema`（單筆 `tagPlace` 用）不動，只改批次路徑。

---

## 6. 項目 E — 記帳頁入口

### 6.1 問題

`grep '/expenses'` 在 `app/trips/[id]/page.tsx` 零命中；`/trips/[id]/expenses` 功能已上線卻無任何 UI 入口，使用者得手動改網址才進得去。

### 6.2 修法（純前端，無後端變動）

- `app/trips/[id]/page.tsx`：在標題卡片區（`SavedTrip` 標題/預算附近）加一個 `Link href={/trips/${id}/expenses}`「💰 記帳」。
- `app/trips/page.tsx`：列表每筆行程可加同一入口（次要）。
- 沿用既有 `rel="noopener noreferrer"` 慣例（若外開）；站內導覽用 `next/link`。

---

## 7. 影響檔案

| 檔案 | 項目 | 變更 |
|---|---|---|
| `lib/quotas.ts` | A | 新增：成本表 + 每日預算設定 |
| `lib/rate-limit.ts` | A | 新增：`checkAndConsume` transaction |
| `lib/__tests__/rate-limit.test.ts` | A | 新增：超額回 429、全域回 503、跨日重置 |
| `app/api/**/route.ts`（見 §2.3 表） | A | 各插一行 `checkAndConsume` |
| `lib/import-core.ts` | B, D | `MAX_IMPORT`、`chunk`、`truncated`、依 index 組標籤 |
| `app/api/import/extension/route.ts` | B | 筆數上限 |
| `app/import/page.tsx` | B | `truncated` 提示 |
| `lib/tagging.ts` | D | indexed `batchSchema` + 完整性檢查 |
| `lib/retag.ts` | D | 區分 api_error / no_tags 加退避 |
| `app/api/trip/generate/route.ts` | C | 修 coords 壓縮，改保持索引對齊 |
| `app/trips/[id]/page.tsx` | E | 記帳入口 |
| `app/trips/page.tsx` | E | 記帳入口（次要） |
| `firestore.rules`（新增進 repo） | A | `usage/**` 鎖定只 Admin SDK 寫（見 §10） |

---

## 8. 驗證基準

```bash
pnpm typecheck && pnpm test && pnpm lint
```

實測：
1. **A**：同一帳號短時間連打 `/api/trip/generate` 超過 `QUOTA_USER_DAILY_USD` → 回 `429` 帶 `Retry-After`；`/api/dna` 不受影響。把 `QUOTA_GLOBAL_DAILY_USD` 設極小 → 任一付費入口回 `503`。跨日（改系統日期或等午夜）計數重置。
2. **B**：匯入 > `MAX_IMPORT` 筆的 Takeout → `summary.truncated > 0`，前端顯示截斷提示；已匯入筆數 = `MAX_IMPORT`。
3. **C**：造一個含「AI 生成、收藏中查無、名稱刻意冷僻到 Text Search 解不出」的 stop 的行程 → 該天 insight 顯示「有地點無法定位，未估移動時間」，**不再出現偏低的分鐘數**。
4. **D**：模擬 `tagPlaces` 輸出被截斷（回傳 items 缺尾段 index）→ 回 `api_error`，該批不被當「無標籤」靜默寫入；正常小批次照常標到。
5. **E**：行程詳情頁看得到「記帳」入口，點入即 `/trips/[id]/expenses`。
6. 不填任何新環境變數 → quota 用預設值，既有流程行為不變（只是多了上限）。

---

## 9. 故障模式

| 症狀 | 原因 | 解法 |
|---|---|---|
| 正常使用就被 429 擋 | `QUOTA_USER_DAILY_USD` 設太低 | 調高環境變數；初期建議設寬鬆 + 觀察 `usage` doc 再收緊 |
| 所有人一起被 503 | 全域熔斷觸發（可能被攻擊或有 bug 迴圈） | 查 `usage/__global__{date}` 累積來源；確認沒有前端無限重試 |
| 匯入大檔只進了一部分 | 觸發 `MAX_IMPORT` 截斷（預期行為） | 看 `summary.truncated`，分批再匯入 |
| 某天完全沒有移動時間 | 該天有 stop 定位失敗（項目 C 的預期降級） | 正常；想要車程就把該地點加進收藏（有精確座標） |
| 標籤匯入回「輸出不完整」 | 批次仍被截斷（極端長名稱） | 調小 `TAG_BATCH_SIZE`；這是正確報錯，非靜默吞掉 |

---

## 10. Firestore Rules（附帶版控化）

現況 rules 只存在 `FIREBASE.md` 文字區塊、未進 repo、靠人工貼 console，會 drift。本 spec 順手把 rules 落進 repo `firestore.rules` 並在 `firebase.json` 掛上：
- `usage/**`：`allow read, write: if false;`（只 Admin SDK 寫，client 一律不可碰）。
- `users/{uid}/**`：維持現有 per-user 授權語意（client 不直連，全走 Admin SDK；rules 作為縱深防禦第二道）。
- 這是後續 `persona-mode` / `reverse-curation` / 任何分享功能的授權前置。

> ⚠️ 動 `firestore.rules` / `firebase.json` 屬根 `CLAUDE.md` 禁動清單，改了要 `firebase deploy --only firestore:rules` 才生效；實作前先與 peanut 確認部署時機。

## 11. 已知限制（非 bug）

- 成本估算是**粗估上界**（用於相對熔斷），非精算帳單；真實帳單仍以 GCP/Anthropic 後台為準，budget alert 照設不取代。
- 「成本感知的優雅降級」（超軟配額時 Sonnet→Haiku、跳過 Routes/holidays 回快取 DNA，而非硬 429）是更好的體驗，但**本 spec 不做**，先硬限流止血；列為後續增強。
- Places/Routes 的結果快取（省重複查詢）不在本 spec，屬 `reverse-curation.md` 與後續獨立議題。
- 跨區部署 / 多實例的 transaction 競爭在 `maxInstances: 2` 下可忽略；未來放大實例數需重估。
