# Spec — Reverse Curation（反向策展：貼別人的靈感，AI 用你的 DNA 過濾）※ 規劃中，未實作

> 狀態：spec 已定稿待實作。實作時照本文件執行；有歧義回來改本文件，不要口頭發散。
> **前置（硬相依）**：
> - `specs/foundation-hardening.md` 的 A（用量護欄）與 B（匯入筆數上限）**必須先落地**——本功能對任意外部文字抽出的每個地點都跑一次付費 Places Text Search，無上限會爆量。
> - `specs/persona-mode.md` 讓 DNA 成為一等公民；本功能複用同一份 `computeTravelDna` 當「品味過濾器」。建議 persona-mode 先做，但非硬相依。

## 0. 這是什麼（旗艦級獨創點）

現有收藏入口都是「你主動搜 / 匯入」。**反過來**：貼一段別人的遊記、IG 貼文、YouTube 說明、景點清單，Claude 抽出裡面提到的地點，逐一對照**你的 Travel DNA** 給「契合度評分 + 一句理由」，你勾選高契合的一鍵批次收藏。

- 為何獨創：競品全是「搜尋/推薦導向」，沒有把**任意外部文字用你的個人品味當過濾器**這個反向流程。而它精準複用本專案三個現成資產：`computeTravelDna`（tagCounts）、`tagPlaces`、`importCandidates`——別人抄不走。
- 補的是「靈感 → 我的收藏」最痛的手動斷層，直接拉高收藏量（全系統的燃料）。

## 1. 總覽

```
app/import「貼靈感」分頁：貼一段文字
   │
   ▼
POST /api/import/inspiration { text }          ← Firebase Auth + checkAndConsume(import_resolve)
   │
   ├─ 1. 抽地點：Claude(Haiku) 結構化輸出 { places: [{ name, context }] }   ← lib/inspiration.ts
   │       （上限 EXTRACT_CAP，超過截斷並回報）
   │
   ├─ 2. 解析 + 標籤（不寫入 DB）：複用 import-core 的 resolve + tagPlaces
   │       → 每筆得到真 place_id / 座標 / tags（PlaceSearchResult + tags）
   │
   ├─ 3. 契合度：對照 computeTravelDna(uid) 的 tagCounts 算分 + 標「策展缺口」
   │       Claude 生成每筆一句理由（可與步驟 1 合併或獨立輕呼叫）
   │
   ▼
回傳 { items: ScoredCandidate[], truncated }    → 前端顯示評分清單 + 勾選
   │（使用者勾選高契合，按「批次收藏」）
   ▼
POST /api/import/inspiration/confirm { placeIds/candidates }  ← 冪等寫入既有收藏
   │   複用 addPlace（placeId 當 doc id + merge，天然去重）
   ▼
收藏頁自然帶出新地點
```

**關鍵原則：預覽階段不寫入 DB。** 抽取/解析/標籤/評分全在預覽回傳，使用者**人工確認**勾選後才寫入——自由文字抽地點易誤抽（把形容詞當地名）或綁錯同名地點，必須有守門關卡。

## 2. 契約

### 2.1 `lib/inspiration.ts`（新增，伺服器端）

```ts
// 步驟 1：從自由文字抽地點名稱
const extractSchema = z.object({
  places: z.array(z.object({
    name: z.string().min(1),      // 地點名稱
    context: z.string().optional(),// 原文提到它的脈絡（供理由生成與去重）
  })).max(EXTRACT_CAP),
});

export type ScoredCandidate = {
  place: PlaceSearchResult;        // 解析出的真地點（含 place_id）
  tags: PlaceTag[];                // tagPlaces 標的
  fitScore: number;               // 0–100 契合度
  fitStars: 1 | 2 | 3 | 4 | 5;    // UI 星等（fitScore 分桶）
  reason: string;                 // 一句理由（含「策展缺口」提示）
  isGapFiller: boolean;           // 命中你 DNA 的弱項/空白 tag
  lowConfidence: boolean;         // 名稱解析可能綁錯（同名/座標無 bias）
};

export async function extractAndScore(
  uid: string,
  text: string,
): Promise<Result<{ items: ScoredCandidate[]; truncated: number }, InspirationError>>;
```

- `EXTRACT_CAP = Number(envOr("INSPIRATION_EXTRACT_CAP", "20"))`（單次抽取上限；超過截斷計入 `truncated`）。
- **抽取模型**用 Haiku（`ANTHROPIC_TAGGING_MODEL`），成本低；理由生成可同批要模型一起回，或用一次 Haiku 針對已評分結果補理由。
- 解析複用 import-core 的邏輯：需把 `resolve(c, apiKey)` 從 `import-core.ts` **匯出**（目前是模組內私有），或抽到共用；回傳 `PlaceSearchResult | null`。解析失敗的地點列入「無法定位」不進 items。
- `lowConfidence`：無 `locationBias`（純文字無座標）時 Text Search 取第一筆，標記提醒使用者確認（沿用既有名稱解析限制，不在本 spec 根治）。

### 2.2 契合度公式（`fitScore`）

- 基準：候選 `tags` 與使用者 `tagCounts` 的**加權重疊**——候選某 tag 在使用者收藏佔比越高 → 加分。
- 正規化到 0–100，分桶成 1–5 星。
- **策展缺口反轉**（sharpening）：若候選 tag 命中使用者**低佔比 / 零收藏**的 tag，不是扣分，而是標 `isGapFiller = true`，理由改為「這正好補上你較少收藏的 ○○ 方向」。
- 公式係數放 `lib/inspiration.ts` 常數、可調；**避免全部給高分**（失去守門意義）——實作後用真實資料校準分布。

### 2.3 API

**POST `/api/import/inspiration`**（預覽，不寫入）
- Auth：`requireUid`；`checkAndConsume(uid, "import_resolve", 單價 × 抽出筆數)`（見 foundation-hardening §2）。
- Body：`{ text: string }`（trim 後為空 → 400）。長度上限（如 8000 字）防濫用。
- 回應 `200`：`{ items: ScoredCandidate[], truncated: number }`。
- 錯誤：`401` / `400 文字為空或過長` / `429|503`（限流）/ `502 抽取或解析失敗`。

**POST `/api/import/inspiration/confirm`**（寫入勾選）
- Auth：`requireUid`。
- Body：`{ places: PlaceSearchResult[], tagsByPlaceId: Record<string, PlaceTag[]> }`（前端把預覽結果原樣送回，避免重打 Places/標籤；伺服器 zod 驗證後 `addPlace` 冪等寫入）。
  - 設計取捨：confirm 不重新解析/標籤（省成本、省一次 Places 呼叫）；但需驗證 `placeId` 格式與 tags 屬合法 `placeTag`，防偽造。
- 回應 `200`：`{ summary: { success, skipped, failed } }`（skipped = 已在收藏，沿用 import 去重語意）。

### 2.4 前端 `app/import/page.tsx`

- 新增一個 section／分頁「✨ 貼靈感」：
  - `textarea`（貼遊記/IG/清單）+「分析」按鈕 → 打預覽 API。
  - 結果清單：每筆顯示 地點名 + 地址 + tags + ⭐ 星等 + 一句理由；`isGapFiller` 加「補盲區」徽章；`lowConfidence` 加「請確認是否正確」提示。
  - 勾選框（預設勾選 ≥ 4 星的），底部「批次收藏（N）」→ 打 confirm API → 顯示 summary。
  - `truncated > 0` 顯示「文字太長，只分析了前 N 個地點」。
- 沿用既有 `authedFetch`、discriminated union 狀態機、紅底錯誤呈現慣例。

## 3. 設計決策

- **預覽/確認兩段式，預覽不寫入**：自由文字抽地點必然有誤抽/漏抽/同名綁錯，人工確認是必要守門；沿用「使用者主動輸入的主要資料要明確、不 best-effort 靜默」的專案哲學。
- **抽取用 Haiku、解析複用 import-core**：不重造輪子，最小新增碼點亮新輸入模態；`resolve` 匯出共用。
- **confirm 不重打 Places/標籤**：預覽已解析好，confirm 只做冪等寫入，省一次最貴的 Text Search SKU；代價是需驗證前端回傳資料合法性。
- **契合度「守門」升級為「策展缺口」引擎**：命中 DNA 空白 tag 時主動點出「補上你品味盲區」，讓它從被動過濾器變成會**擴張你品味邊界**的主動策展夥伴——比單純評分更利、更難被抄。
- **硬相依用量護欄**：每個抽出地點跑一次付費 Text Search，`EXTRACT_CAP` + foundation-hardening 的 `checkAndConsume` 是防爆量的雙保險；缺任一都不該上線。
- **`lowConfidence` 只提示不阻擋**：名稱解析綁錯同名地點是既有限制（`resolveCoordinates`/`resolve` 用名稱 Text Search），本 spec 用「顯示地址 + 低信心徽章 + 人工勾選」緩解，不在此根治（根治屬「place_id 優先解析 + 快取」另案）。

## 4. 影響檔案

| 檔案 | 變更 |
|---|---|
| `lib/inspiration.ts` | 新增：抽取（Haiku 結構化輸出）+ 解析 + 契合度評分 + 理由 |
| `lib/import-core.ts` | 把 `resolve` 匯出（或抽 `resolveOne` 共用）；不改既有 `importCandidates` 行為 |
| `schema/place.ts` | （可選）新增 `ScoredCandidate` 相關 zod（或就近放 `lib/inspiration.ts`） |
| `app/api/import/inspiration/route.ts` | 新增：預覽（auth + 限流 + `extractAndScore`） |
| `app/api/import/inspiration/confirm/route.ts` | 新增：確認寫入（auth + 驗證 + 冪等 `addPlace`） |
| `app/import/page.tsx` | 新增「貼靈感」分頁 UI + 兩段式流程 |
| `lib/__tests__/inspiration.test.ts` | 新增：契合度公式分桶、`isGapFiller` 判定、`truncated` 截斷、confirm 驗證擋偽造 |

## 5. 驗證基準

```bash
pnpm typecheck && pnpm test && pnpm lint
```

實測（本機 `pnpm dev`）：
1. 貼一段含 5–8 個明確地點的沖繩遊記 → 預覽回傳對應地點，星等與你的 DNA 一致（海景控看到海景點高星）；不寫入任何 DB。
2. 收藏中已有的地點 → confirm 後 `summary.skipped` 計入（不重複）。
3. 貼含「形容詞被誤抽成地名」的文字 → 該筆標 `lowConfidence` 或解析不出被排除；使用者可不勾。
4. 命中你零收藏的 tag（如你沒有夜景）→ 該筆 `isGapFiller`，理由顯示「補盲區」。
5. 貼超長文字（> `EXTRACT_CAP` 個地點）→ `truncated > 0`，前端提示。
6. 未先做 foundation-hardening 的限流時，連續大量貼文 → （提醒）會爆 Places 呼叫；故限流為硬前置。
7. confirm 送入偽造的非法 `placeTag` / 空 `placeId` → 伺服器 zod 擋下回 400。

## 6. 故障模式

| 症狀 | 原因 | 解法 |
|---|---|---|
| 抽出一堆不是地點的詞 | 自由文字抽取誤判 | 預覽人工勾選守門；必要時強化抽取 prompt（要求只抽明確地名） |
| 地點綁到別城市同名店 | 純名稱 Text Search 無 `locationBias`（既有限制） | `lowConfidence` 徽章 + 顯示地址供辨識；根治屬 place_id 優先解析另案 |
| 全部都給 4–5 星 | 契合度公式未校準 | 調係數；用真實資料看分布，拉開高低差 |
| 分析很慢 | 抽出地點多、逐筆 Text Search | `EXTRACT_CAP` 收斂 + 解析用 `mapLimit` 併發（沿用 import-core） |
| 回 429/503 | 觸發 foundation-hardening 限流 | 預期行為；明天再試或調 quota |
| confirm 存了但收藏頁沒更新 | 前端未 reload collection | confirm 成功後觸發收藏重載（沿用既有 `loadCollection`） |

## 7. 已知限制（非 bug）

- **只吃純文字**：IG/YouTube 連結需使用者自己複製文字貼上；不做網頁爬取（SSRF 面 + 不穩定，沿用 `specs`/sharelink 瘦身的教訓）。圖片/截圖輸入屬「多模態入口」另案。
- **名稱解析非精確 place_id**：沿用既有 `resolve` 限制，用低信心提示緩解。
- **契合度是啟發式**：基於 10 類固定 tag 的重疊加權，非語意理解；語意 embedding 版屬 Travel DNA v2 另案。
- **confirm 信任前端回傳的預覽資料**（經 zod 驗證）：取捨是省一次 Places 呼叫；驗證擋非法值但不重新解析，若使用者竄改 name 與 placeId 不符，最壞情況是存到一筆自己竄改的地點（僅影響自己的收藏，無跨使用者風險）。
