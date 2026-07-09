<!-- 產生日期: 2026-07-09 | 產生模型: claude-opus-4-8 | 引用 REVIEW.md 時間戳: 2026-07-09 18:1x（Asia/Taipei）| 下次審視: 做 Foundation E / 逐筆計費 / 反向策展前 -->

# REPORT — Foundation Hardening B / C / D

> 任務來源：`specs/foundation-hardening.md` 項目 B/C/D（peanut：「直接下一步 改b/c/d」）。計畫見 `task/PLAN.md`。分支 `feat/foundation-bcd`（stacked on persona）。
> 依 CLAUDE.md Executor 流程完成：實作 → 自我驗證 → GLM 審查（`task/REVIEW.md`）→ 仲裁 → 本報告。
> **未宣告 Done——等 peanut 驗收。**

## 1. 改了哪些檔案（8 檔）

| 檔案 | 項目 | 改動 |
|---|---|---|
| `lib/concurrency.ts` | B/D | 新增 `chunk<T>()`（size<=0 視為 1） |
| `lib/tagging.ts` | D | 批次 schema 改 indexed `{items:[{index,tags}]}`；抽純函式 `alignBatchTags`（依 index 對位、缺編號/重複編號 → err 不靜默補 []）；`TAG_BATCH_SIZE=30`；`max_tokens` 2048→4096 |
| `lib/import-core.ts` | B/D | `MAX_IMPORT`（預設 300，env 覆寫、NaN 防呆）+ `truncated`；標籤改 chunk(30) 逐批、每批獨立成敗 + 失敗 `console.warn` |
| `lib/retag.ts` | D | 同樣 chunk 逐批 + 失敗 `console.warn` |
| `app/api/trip/generate/route.ts` | C | 車程迴圈：任一 stop 定位失敗即整天跳過估計並註明「未估」，不壓縮 coords（修系統性低估 bug） |
| `app/import/page.tsx` | B | `ImportSummary` 加 `truncated`；`>0` 時提示分批 |
| `lib/__tests__/concurrency.test.ts` | B | `chunk` 5 case |
| `lib/__tests__/tagging.test.ts` | D | `alignBatchTags` 7 case（對位/缺編號/重複/超界/count0） |

**修的三件事**：
- **B**：一次匯入上千筆 Takeout → 上千次付費 Places 呼叫的破口，用 `MAX_IMPORT` 上限 + `truncated` 回報堵住；標籤分批 30 讓單批遠低於 token 上限。
- **C（正確性 bug）**：resolve 失敗的 stop 被跳過 → coords 壓縮 → `A→(失敗B)→C` 被當 `A→C` 算 → 移動時間**系統性低估**。改為整天跳過 + 明確「未估」。
- **D（資料品質）**：批次標籤靠陣列位置對齊，`max_tokens` 截斷時尾段地點**靜默拿空標籤**。改 indexed 自我對位 + 完整性檢查，截斷變**整批 err（可觀測 + 可重試）**而非無聲腐蝕。

## 2. 測試結果

```
pnpm typecheck  → ✓
pnpm test       → ✓ 6 files / 49 passed（新增 chunk 5 + alignBatchTags 7）
pnpm lint       → ✓
```

## 3. GLM finding 統計（詳見 `task/REVIEW.md`）

- 🐛 2：**2 真已修**——批次標籤失敗原本靜默吞掉（與 D 初衷矛盾）→ import-core / retag 皆加 `console.warn` 讓降級可觀測；保留「整批 []、由 retag-empty 冪等重試」語意（附理由）
- ⚠️ 3：**1 FALSE POSITIVE**（chunk 記憶體——MAX_IMPORT 上游已壓 ≤300）、2 不修（MAX_IMPORT IIFE 與既有 MODEL/quotas 慣例一致；C 整天跳過是 spec §4.2 明載「寧可少報不報錯」的刻意取捨）
- 💡 2：**1 採納**（`alignBatchTags` 重複 index → err + 測試）、1 不採納（`readonly T[]` cosmetic）
- ❓ 2：**均採納/釐清**——`max_tokens` 2048→4096（防 30 筆批次截斷）；整批降級是刻意（嚴格偵測 + 可觀測 + 可重試）

## 4. Known issues / 待實測

- **匯入上限**：>300 筆 Takeout → `truncated>0`、前端提示、已匯入 =300（可設 `MAX_IMPORT_PER_REQUEST` 調整）。
- **C 降級的取捨**：一天內有冷僻無法定位的 AI 生成點 → 整天不估車程（顯示「未估」）。收藏點必有精確座標、不受影響；只在 AI 亂編冷僻地名時發生。
- **標籤截斷**：`max_tokens` 提到 4096 後 30 筆批次幾乎不會截斷；真截斷時整批以空標籤存 + `console.warn`，「一鍵批次重新標籤」可補。
- **retag 退避窗**未做（需 schema 加 `lastRetagAt`）——本輪只做 chunk 安全化，永遠標不出的點仍會被重試（但不再靜默錯位）。

## 5. 後續（不在本輪）

- **E**：記帳頁入口（`/trips/[id]/expenses` 目前無 UI 連結）。
- **逐筆計費**：把 A 的 `import_resolve` 固定成本改成 × 筆數（B 已把筆數壓在 MAX_IMPORT 內、可安全接）。
- **反向策展**（`specs/reverse-curation.md`，旗艦；前置 A+B 已就緒）。

---
**狀態：實作完成、驗收未過。等 peanut 確認後才可宣告 Done。**
