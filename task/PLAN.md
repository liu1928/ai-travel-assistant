# PLAN — Foundation Hardening B / C / D

> 任務來源：`specs/foundation-hardening.md` 項目 B / C / D（peanut 指定「直接下一步 改b/c/d」）。
> 上一輪 PLAN（分身模式）已 commit 於 `feat/persona-mode`（b58c6cf1），git 歷史保留，本檔覆寫。
> 分支：`feat/foundation-bcd`（stacked on persona）。E（記帳頁入口）不在本輪。
> 依 CLAUDE.md Executor 流程：實作 → 自我驗證 → GLM 審查 → REPORT 後停，等 peanut 驗收。

## 三個修正

| # | 項目 | 類型 | 核心 |
|---|---|---|---|
| B | 匯入筆數上限 + 標籤分批 | 成本 | `MAX_IMPORT` 上限、`truncated` 回報、標籤 chunk 30 |
| C | 車程 `coords` 壓縮 bug | 正確性 | resolve 失敗不壓縮，整天跳過並註明「未估」 |
| D | 批次標籤靜默空標籤 | 資料品質 | indexed schema 自我對位 + 完整性檢查 → err 不靜默補 `[]` |

B 與 D 共用 `tagging.ts` / `import-core.ts`，一起做；C 獨立在 route。

## 設計決策

- **chunk 助手放 `lib/concurrency.ts`**（與既有 `mapLimit` 同層）；`TAG_BATCH_SIZE=30` 由 `tagging.ts` export，import-core / retag 共用（DRY）。
- **標籤對位邏輯抽純函式 `alignBatchTags(items, count)`**（像 rate-limit 的 `decide()`）——不碰 API、可單測；`tagPlaces` 薄殼包它。
- **每批獨立成敗**：import-core / retag 逐批呼叫 `tagPlaces`，某批 err → 該批 `[]`（可被 retag-empty 再試），不因一批壞掉全丟。配合 chunk 30 讓單批遠低於 `max_tokens 2048`，正常不觸發截斷。
- **C 寧可少報不報錯**：當天任一 `place/food` stop 定位失敗 → 跳過該天車程估計 + insight「有地點無法定位，未估移動時間」，不用壓縮後的相鄰點算出偏低數字。
- **上限預設 300**（`MAX_IMPORT_PER_REQUEST` 可覆寫）；`truncated>0` 前端提示。

## 步驟

### D-1 `lib/concurrency.ts`
- 新增 `export function chunk<T>(arr, size): T[][]`。

### D-2 `lib/tagging.ts`
- `export const TAG_BATCH_SIZE = 30;`
- `batchSchema` 改 `{ items: { index:int, tags: placeTag[].max(4) }[] }`；system prompt 要求「對每個地點回傳 {index, tags}，index 從 1 起，務必涵蓋每一個編號」。
- 抽純函式 `export function alignBatchTags(items, count): Result<PlaceTag[][], TaggingError>`：依 index 組回，缺任一 index → `err(api_error 疑似截斷)`。
- `tagPlaces` parse 後呼叫 `alignBatchTags`（`tagPlace` 單筆不動）。

### B-1 `lib/import-core.ts`
- `import { chunk, mapLimit } from "./concurrency"`、`import { tagPlaces, TAG_BATCH_SIZE } from "./tagging"`、`import { envOr } from "./env"`、加 `type PlaceTag`。
- `const MAX_IMPORT = ...(envOr("MAX_IMPORT_PER_REQUEST","300"), NaN 防呆)`。
- `ImportSummary` 加 `truncated: number`（初始化 0）。
- `valid` 超過 `MAX_IMPORT` → 只取前 N，`summary.truncated = validAll.length - N`。
- 標籤改 `for (const batch of chunk(toSave, TAG_BATCH_SIZE)) { const r = await tagPlaces(batch); tagsList.push(...(r.ok ? r.value : batch.map(()=>[]))); }`。

### B-2 `lib/retag.ts`
- 同樣 chunk `empty`：逐批 `tagPlaces`，每批獨立成敗，concat 成 `tagsList`。

### B-3 `app/import/page.tsx`
- 前端 `ImportSummary` type 加 `truncated`；takeout 完成訊息 `truncated>0` 時多一行「超過單次上限，已匯入前 N 筆，其餘請分批」。

### C-1 `app/api/trip/generate/route.ts`
- Routes best-effort 迴圈：改為逐 stop 產 coord；**任一 stop 定位失敗即整天跳過估計**並 push insight「第 N 天有地點無法定位，未估移動時間」；只有全數定位且 `coords.length>=2` 才 `estimateLegs`。

### 測試
- `lib/__tests__/concurrency.test.ts`（新）：`chunk` 邊界（空、剛好整除、有餘、size>len）。
- `lib/__tests__/tagging.test.ts`（新）：`alignBatchTags` 完整→ok 對齊、缺尾→err、亂序 index→正確對齊、count=0→ok []。

## 驗收
```bash
pnpm typecheck && pnpm test && pnpm lint   # 全綠
```
實測：① 匯入 >300 筆 Takeout → `truncated>0`、前端提示、已匯入 =300；② 造一個含冷僻無法定位 stop 的行程 → 該天 insight「未估移動時間」、不再出現偏低分鐘數；③ 模擬 tagPlaces 輸出缺尾 index → 回 api_error、不靜默補 []；正常小批次照常標到。
完成後：git diff → GLM review_code → REVIEW.md 仲裁 → REPORT.md → commit → 停等 peanut。

## 不在本輪
- E 記帳頁入口
- 逐筆計費（把 A 的 `import_resolve` 固定改成 × 筆數）——B 已備好筆數，之後接
- retag 退避窗（需 schema 加 lastRetagAt；本輪只做 chunk 安全化，不加退避）
