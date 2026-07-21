# Spec — Opening Hours（公休驗證：營業時間感知行程）※ 規劃中，未實作

> 狀態：spec 已定稿待實作。實作時照本文件執行；有歧義回來改本文件。
> 前置：`specs/schedule-anchoring.md`（`openingWarning` 欄位與 placeId 錨定）。建議 `specs/place-freshness.md` 先落地（本 spec 的 Details 呼叫會免費順帶更新 businessStatus）。

## 0. 為什麼是這份

AI 排行程最常見的翻車：把餐廳排在公休日、把景點排在打烊後。目前生成完全不看營業時間。本 spec 做雙保險：

1. **生成前**：把勾選收藏的每週營業時間 + 各天星期幾餵進 prompt，讓模型排程時就避開。
2. **生成後**：對可錨定 placeId 的項目做程式驗證，UI 標「⚠️ 當日公休」。

成本：`regularOpeningHours` 屬 Place Details **Enterprise SKU（$20/1K，每月免費 1,000 次）**。cap 20 筆/次 + TTL 7 天快取後，個人用量（月 10 次生成）約 100–150 次呼叫，實際 $0；帳面上限 $0.40/次生成。

## 1. 契約

### 1.1 `schema/place.ts` — 快取欄位（全 optional）

```ts
// 壓縮後的每週營業時間，per weekday（0=週日…6=週六）；null = 當天公休。
// 儲存壓縮字串（例 "09:00-17:00" / "09:00-14:00,17:00-21:00" / "24h" / null）省空間好讀。
openingHours: z.record(z.string(), z.string().nullable()).optional(),
openingHoursCheckedAt: z.number().optional(), // epoch ms
```

來源：Details 回應 `regularOpeningHours.periods[].open/close{day,hour,minute}`，實作時壓縮成上述格式；跨午夜時段歸屬 open 那天。

### 1.2 新 `lib/opening-hours.ts`

- `fetchOpeningHours(placeId)`：GET `places/{placeId}?languageCode=zh-TW`，`X-Goog-FieldMask: id,regularOpeningHours,businessStatus`（businessStatus 是 Pro 欄位，搭 Enterprise 呼叫**免費順帶**，一併更新 `specs/place-freshness.md` 的欄位）。
- `ensureOpeningHours(uid, places)`：TTL 內（`OPENING_HOURS_TTL_DAYS`，預設 7）直接用快取；過期者抓新，上限 `OPENING_HOURS_MAX_PLACES`（預設 20）筆；配額 `checkAndConsume(uid, "opening_hours", n)`（`SERVICE_COST_USD` 登記 `opening_hours: 0.02`）；抓完寫回 place doc。
- `checkScheduleAgainstHours(item, weekday)`：純函式，比對排定 `time`（+`durationMin`）vs 該 weekday 營業時段，回 warning 字串或 null。可單測。
- **best-effort**：抓失敗不阻擋生成（比照 holidays/DNA/Routes 降級哲學）。

### 1.3 生成前注入 — `lib/anthropic.ts` + `app/api/trip/generate/route.ts`

- route：撈收藏後 `ensureOpeningHours`，結果掛進 `GenerateTripInput.places` 的每筆地點。
- `buildUserMessage`：有營業時間的地點，行尾附壓縮摘要（例「（週一公休；二–日 11:00-21:00）」）；並附「本行程各天日期與星期幾」（由 `startDate` 推算）+ 指令「排程必須避開各地點公休/非營業時段」。
- 段落精簡控 input token（20 地點約 +1K tokens ≈ $0.003/次，可忽略）。

### 1.4 生成後驗證 + UI

- route：生成完成、錨定 placeId 後（schedule-anchoring 邏輯），對每個有 placeId 且有快取營業時間的 item 跑 `checkScheduleAgainstHours`，結果寫入 `openingWarning`（儲存側欄位，見 schedule-anchoring）。
- 無 placeId / 無營業資料的項目：降級不驗，不標記。
- UI：`app/trips/[id]/page.tsx` 與 `app/trip/page.tsx` 預覽，`openingWarning` 存在時該卡片顯示「⚠️」徽章 + warning 文字（例「當日（週一）公休」）。

## 2. 設計決策

- **雙保險而非只靠 prompt**：模型可能忽略指令；程式驗證兜底，且驗證結果持久化（`openingWarning`），舊行程重看仍在。
- **驗證不阻擋、不自動改排程**：只標警示，改不改由使用者決定（或用 `specs/day-regenerate.md` 重排該天）。
- **營業時間存 place doc 而非 trip**：跨行程共用快取，TTL 統一管理。
- **cap 20 筆**：一次生成通常勾 10–20 點；超過的地點不抓（照舊無驗證），不硬擋生成。
- **`startDate` 缺席**（使用者沒填出發日）：星期幾推算不出來 → 整個功能靜默降級（不注入不驗證），行為與現在一致。

## 3. 影響檔案

| 檔案 | 變更 |
|---|---|
| `schema/place.ts` | 加 `openingHours?`、`openingHoursCheckedAt?` |
| `lib/opening-hours.ts`（新） | fetch/ensure/check 三函式 |
| `lib/quotas.ts` | 登記 `opening_hours: 0.02` |
| `lib/anthropic.ts` | `buildUserMessage` 附營業時間與星期幾段落 + 避開公休指令 |
| `app/api/trip/generate/route.ts` | 生成前 ensure、生成後驗證寫 `openingWarning` |
| `app/trips/[id]/page.tsx`、`app/trip/page.tsx` | 公休徽章 |
| `lib/__tests__/opening-hours.test.ts`（新） | 壓縮格式、跨午夜、24h、公休日、TTL、`checkScheduleAgainstHours` 邊界 |

## 4. 驗證基準

```bash
pnpm typecheck && pnpm test && pnpm lint
```

實測：
1. 勾一家已知週一公休的店 + startDate 讓某天落在週一 → 生成結果該店不排在週一；或若仍排入，卡片出現「⚠️ 當日公休」。
2. 同地點 7 天內第二次生成 → Enterprise 呼叫數 0（快取命中，配額 usage 不增）。
3. 不填 startDate → 行為與現在完全一致（不注入不驗證）。
4. 單測涵蓋跨午夜（如 17:00–01:00）、24h 營業、全日公休。

## 5. 故障模式

| 症狀 | 原因 | 解法 |
|---|---|---|
| Enterprise 用量暴增 | TTL/快取沒生效或 cap 失效 | 檢查 `openingHoursCheckedAt` 寫回與 `OPENING_HOURS_MAX_PLACES` |
| 明明有開卻標公休 | 跨午夜時段解析錯 / timezone 誤解 | `regularOpeningHours` 是當地時間，比對不做時區轉換；補單測重現 |
| 模型仍排公休日 | prompt 指令被忽略 | 程式驗證已兜底標警示；必要時強化措辭 |
| 生成變慢 | ensure 串行抓 20 筆 | `mapLimit` 併發（比照 import-core 慣例） |

## 6. 已知限制

- 臨時公休/特殊假日營業（`currentOpeningHours` 的例外日）不在本 spec——只用 `regularOpeningHours` 常規時間，成本與複雜度考量。
- AI 自創（非收藏）的地點無 placeId，不驗證。
