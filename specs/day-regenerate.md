# Spec — Day Regenerate（單日重生：只重排不滿意的那一天）※ 規劃中，未實作

> 狀態：spec 已定稿待實作。實作時照本文件執行；有歧義回來改本文件。
> 前置：`specs/schedule-anchoring.md`（`startDate` 持久化推算該日日期/星期；重生後座標錨定複用）。

## 0. 為什麼是這份

使用者常只是「第 3 天不喜歡」，目前只能整包重生成：貴（全趟 token）、慢、且其他天的好結果會被洗掉。單日重生只帶該日 context 重排一天，約 **$0.03/次**（Sonnet，輸入 ~3K + 輸出 ~1.5K tokens），是整趟重生的 1/3 以下。

## 1. 契約

### 1.1 `schema/trip.ts` — AI 輸出 schema（單日）

```ts
// 單日重生的 structured output：只有 schedule，不含 day 編號（server 端知道是哪天）。
export const daySchedulePayloadSchema = z.object({
  schedule: z.array(scheduleItemSchema).min(1),
});
```

注意：用 **`scheduleItemSchema`（AI 側）**，不含錨定欄位——重生後由 server 重跑錨定。

### 1.2 `lib/anthropic.ts` — 新函式

```ts
export async function regenerateDay(input: RegenerateDayInput): Promise<Result<ScheduleItem[], GenerateTripError>>
```

`RegenerateDayInput` 與 user message 組成：
- trip 摘要：title / location / style / summary / budget；
- **其他天已排地點清單**——附指令「以下已排在其他天，除非使用者回饋明確要求，不要重複排入」（防重複排點的關鍵）；
- 該日現有 schedule（讓模型知道使用者不滿意的基準）；
- 使用者一句話回饋（≤200 字）；
- 該日日期與星期幾（`startDate` + day 推算；缺 startDate 則略過此段）；
- 該日天氣：從 `weather[]` **以日期比對**取（不用 index 對位，weather 有 date 欄位）；
- 當日相關 flights / lodgings 錨點（有航班的日子要留接送機時間）。

輸出走 structured outputs 綁 `daySchedulePayloadSchema`；`max_tokens` 取整趟生成的 1/3 即足。

### 1.3 新 `app/api/trips/[id]/regenerate-day/route.ts`（POST）

- body：`{ day: number, feedback?: string }`（zod：day 為正整數且 ≤ `days.length`；feedback ≤200 字）。
- 流程：`requireUid` → 讀 trip（不存在/非本人 404）→ rate limit + `checkAndConsume(uid, "day_regenerate", 1)`（`SERVICE_COST_USD` 登記 `day_regenerate: 0.03`）→ `regenerateDay` → 對新 schedule 重跑座標錨定（schedule-anchoring 的錨定邏輯抽成可複用 helper）→ 若 `specs/opening-hours.md` 已落地，順跑公休驗證 → 替換該日、整份覆寫 Firestore → 回傳更新後 trip。
- 失敗（AI 錯誤/驗證不過）→ 不動 Firestore，回錯誤訊息；原行程完好。

### 1.4 UI — `app/trips/[id]/page.tsx`

- 每天卡片標題列加「重排這一天」按鈕 → 展開一行回饋輸入（placeholder：「例：下午太趕，想多留咖啡時間」）+ 送出。
- 送出後該天卡片 loading 狀態；成功後以回傳 trip 更新整頁 state；失敗顯示錯誤、原內容不動。

## 2. 設計決策

- **只回傳 schedule、不讓模型碰 day 編號 / title / summary / insights**：範圍越小越不會把別的東西改壞；trip 層欄位全部保留。
- **其他天地點清單進 context**：實測重複排點是單日重生最大風險，明文列出 + 禁令是最直接的防線。
- **先錨定再落庫**：重生的那天立刻補座標，地圖/公休驗證不因重生而失效。
- **併發**：last-write-wins 可接受（單人使用）；rate limit 防連打即可，不做樂觀鎖。
- **feedback 可空**：空回饋 = 「換一批」，prompt 指令改為「重新編排並提供不同選點」。

## 3. 影響檔案

| 檔案 | 變更 |
|---|---|
| `schema/trip.ts` | 加 `daySchedulePayloadSchema` |
| `lib/anthropic.ts` | 新 `regenerateDay` + user message 組裝（純函式部分可單測） |
| `lib/quotas.ts` | 登記 `day_regenerate: 0.03` |
| `app/api/trips/[id]/regenerate-day/route.ts`（新） | 端點 |
| `app/trips/[id]/page.tsx` | 按鈕 + 回饋輸入 + loading/錯誤處理 |
| `lib/__tests__/`（新增測試） | message 組裝（含他天清單/回饋/缺 startDate 降級）、day 範圍驗證 |

## 4. 驗證基準

```bash
pnpm typecheck && pnpm test && pnpm lint
```

實測：
1. 對 3 天行程重排第 2 天（回饋「太趕」）→ 只有第 2 天變、其他天與 title/summary/flights/weather 不動；新排程反映回饋。
2. 新第 2 天不含第 1/3 天已排的地點（防重複生效）。
3. 連打超過 rate limit → 429 + Retry-After；配額耗盡 → 429/503（沿用既有護欄行為）。
4. AI 回傳不合 schema（模擬）→ Firestore 不動、前端顯示錯誤。
5. 重生後該天開地圖 → 座標錨定正常（若 map-view 已落地）。

## 5. 故障模式

| 症狀 | 原因 | 解法 |
|---|---|---|
| 重生天與他天重複排點 | 他天清單沒進 context 或指令太弱 | 檢查 message 組裝單測；強化禁令措辭 |
| 其他天被改動 | 誤把整包 trip 交給模型重寫 | 本 spec 只允許替換該日 schedule，route 層保證 |
| 重生天丟失座標/公休標記 | 落庫前沒重跑錨定 | 錨定 helper 必經；驗收條目 5 擋住 |
| 成本失控 | 連打 | rate limit + `day_regenerate` 配額雙層 |

## 6. 已知限制

- 重生品質同樣壓在 prompt（無 eval harness，同整趟生成的既有限制）。
- 不支援「同時重排多天」——多天不滿意就整包重生成，別繞過整趟配額。
