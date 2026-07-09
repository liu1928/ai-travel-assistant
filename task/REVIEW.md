# task/REVIEW.md — GLM-5.2 異質審查（Foundation B/C/D）

- 時間戳：2026-07-09 18:1x（Asia/Taipei）
- 審查範圍：B（匯入上限+分批）/ C（車程 coords 壓縮 bug）/ D（批次標籤靜默空標籤）本次 diff
  - `lib/concurrency.ts`（chunk）、`lib/tagging.ts`（indexed schema + alignBatchTags）、`lib/import-core.ts`（MAX_IMPORT+truncated+chunk）、`lib/retag.ts`（chunk）、`app/api/trip/generate/route.ts`（C）、`app/import/page.tsx`、`lib/__tests__/{concurrency,tagging}.test.ts`
- Reviewer：MCP `glm-reviewer` `review_code`，focus=`correctness`
- ⚠️ Reviewer 意見僅為「懷疑」，先原封記錄，再逐條仲裁。

---

## 一、GLM 原始回覆（原封不動）

### 🐛 問題點

**1. `tagsList` 與 `toSave` 索引錯位（import-core.ts）**
```ts
const tagsList: PlaceTag[][] = [];
for (const batch of chunk(toSave, TAG_BATCH_SIZE)) {
  const r = await tagPlaces(batch);
  tagsList.push(...(r.ok ? r.value : batch.map(() => [])));
}
await mapLimit(toSave, 5, async (p, i) => {
  const saved = await addPlace(uid, p, tagsList[i] ?? []);
});
```
`tagPlaces` 內部呼叫 `alignBatchTags`，而 `alignBatchTags` 要求模型回傳的 `index` 必須從 1 開始且涵蓋所有編號。如果模型在 `max_tokens` 內只回傳了前 20 筆（第 21~30 筆被截斷），`alignBatchTags` 會回傳 `err`。
在 `import-core.ts` 的迴圈中，一旦 `r.ok` 為 `false`，你的降級邏輯是 `batch.map(() => [])`，這會讓整個批次 30 筆資料**全部失去標籤**。
這與 D 修正的初衷（不靜默補 `[]`）完全矛盾。你在 `tagPlaces` 內部嚴格把關，卻在呼叫端把錯誤吞掉並全部補上空陣列。如果呼叫端打算容錯，應該只對缺失的部分補空，而不是整批報銷；如果呼叫端不允許缺失，就應該把錯誤往上拋並中斷匯入。

**2. `retag.ts` 的錯誤處理邏輯缺失**
背景說明提到「`retag` 同樣 chunk empty 逐批 `tagPlaces`」，但你沒有提供 `retag.ts` 的 diff。如果 `retag.ts` 也遇到相同的截斷問題，它是否也默默把錯誤吞掉？這部分無法審查，但極有可能是同一個問題的翻版。

### ⚠️ 風險

**1. `MAX_IMPORT` 的 IIFE 在模組載入時直接讀取環境變數**
這會在模組第一次被 `import` 時凍結數值。如果在測試環境或 Serverless 環境中，環境變數是在程式啟動後才被動態注入或修改的，這個 IIFE 拿到的會是舊值或預設值。雖然 Next.js 通常在 build 時就注入，但這種寫法限制了測試時的彈性。

**2. `chunk` 對超大陣列的記憶體風險**
`chunk` 函式沒有上限保護。雖然 `MAX_IMPORT` 已經限制在 300 筆左右，但如果未來有人把 `MAX_IMPORT` 透過環境變數調到 10000，`chunk(toSave, 30)` 會產生大量陣列切片，可能造成記憶體壓力。

**3. C 修正的降級策略過於激進**
只要有一個地點定位失敗，整天都不估算移動時間。這確實解決了 coords 壓縮的 bug，但對使用者體驗來說是個退步。原本只是「移動時間系統性低估」，現在變成「整天沒有移動時間估計」。如果是一個 10 個地點的行程，第 9 個地點臨時 Google Maps 查不到，前面 8 段的移動時間全被犧牲。這是一個設計決策，但可能會引發使用者抱怨。

### 💡 建議

**1. `chunk` 函式的型別定義可以更嚴格**
`export function chunk<T>(arr: readonly T[], size: number): T[][]` 輸入用 `readonly T[]`。

**2. `alignBatchTags` 的 `byIndex` Map 建立時缺少重複 index 的檢查**
如果模型幻覺回傳了兩個 `index: 1` 的物件，後者會覆蓋前者，且不會報錯。可以考慮在 `set` 之前檢查 `byIndex.has(it.index)`，若重複則回傳 `err`。

### ❓ 待釐清問題

1. **`tagPlaces` 內部 `max_tokens` 維持 2048 是否足夠？** 30 個地點、每個最多 4 標籤 + JSON/index overhead，中文 string literal，2048 是否夠？不足會讓 `alignBatchTags` 頻繁報錯 → import-core 頻繁全批降級。需實測。
2. **`import-core.ts` 中 `tagPlaces` 失敗時的降級策略是否經過討論？** 把整批 30 筆設為 `[]` 是刻意還是疏忽？

---

## 二、仲裁（逐條實際驗證）

### 🐛-1 全批降級與 D 初衷矛盾 → **部分真（採納：加 warn 讓降級非靜默；保留整批可重試語意）**
- 關鍵區分：D 要根治的是「**單次呼叫內、尾段地點靜默拿 []、且無任何訊號**」的**部分且無聲**腐蝕。現在 indexed schema 讓截斷變成**整批 err（有明確訊號）**，import-core 把該批降級成 [] 但**這些地點可被 `retag-empty` 再標**（placeId 當 doc id，重標只是 update tags）。
- 為何不「只補缺失部分」：截斷回應本身不可信（連已回的 head 都可能來自壞掉的生成），逐筆搶救會**重新引入 D 想消滅的「部分對、部分空、難分辨」**。整批重試較乾淨。
- 真正該修的是「**靜默**」：原本 import-core 完全吞掉 err。**已加 `console.warn`**（import-core 與 retag 都加），降級可觀測、不再無聲。
- 另配合 ❓-1 把 tagPlaces `max_tokens` 提到 4096，讓 30 筆批次幾乎不會觸發截斷 → 降級極少發生。

### 🐛-2 retag.ts 同問題（reviewer 沒看到 diff）→ **真（已同步修：加 warn）**
- retag.ts 確實同 pattern。已加相同 `console.warn`。

### ⚠️-1 MAX_IMPORT IIFE 模組載入讀 env → **不修（與專案既有慣例一致，非 bug）**
- `lib/anthropic.ts`（MODEL）、`lib/tagging.ts`（MODEL）、`lib/quotas.ts` 皆在模組載入時 `envOr` 讀設定。App Hosting 用 apphosting.yaml env、build/啟動前就注入；MAX_IMPORT 非匯出、測試不直接測它。維持一致寫法。

### ⚠️-2 chunk 超大陣列記憶體 → **FALSE POSITIVE**
- `MAX_IMPORT` 上游已把 `toSave` 壓在 ≤300；300/30 = 10 段切片，記憶體可忽略。就算有人把 MAX_IMPORT 設 10000，那是刻意調高的自負決策，且 slice 也只是淺拷貝參考。非本次風險。

### ⚠️-3 C 降級過於激進（整天跳過）→ **不修（spec 明載的刻意取捨）**
- `specs/foundation-hardening.md §4.2` 明訂「**寧可少報一天車程，不報錯的低估數字**」。resolveCoordinates 只在「AI 生成、收藏查無、且 Text Search 也解不出」的冷僻點才失敗（收藏點永遠有精確座標、必定 resolve），實務上整天被跳過不常見。partial 前綴估計本身會漏掉中間未解點、同樣誤導。維持「整天跳過 + 明確 insight」的誠實選擇。（已在 insight 明說「未估」，非靜默。）

### 💡-1 chunk 用 `readonly T[]` → **不採納（cosmetic，與 codebase 風格不一致）**
- 專案他處參數未用 readonly；為單一函式引入不一致的型別風格得不償失。

### 💡-2 alignBatchTags 重複 index 檢查 → **真（採納，順手且更嚴格）**
- 兩個 index:1 + 一個 index:2 會讓 place 1 靜默取到後者的 tags。**已加重複檢查 → err**，並補測試。

### ❓-1 max_tokens 2048 是否夠 30 筆 → **真（採納，提到 4096）**
- 30 筆 `{index, tags(中文)}` JSON 確實逼近 2048、有截斷風險。**已把 tagPlaces `max_tokens` 提到 4096**（只計實際輸出，成本影響小），大幅降低 alignBatchTags 報錯與整批降級的機率。

### ❓-2 全批降級是刻意還是疏忽 → **刻意（已釐清 + 加 warn）**
- 刻意：errored 批次整批 [] 存入、由 retag-empty 再試（冪等）。tagPlaces 內部嚴格是為了**偵測**截斷（取代 D 之前的無聲），呼叫端選擇「整批重試」的容錯策略；兩者不矛盾——嚴格偵測 + 可觀測降級 + 可重試。

---

## 三、本輪修正動作
1. `lib/tagging.ts`：`max_tokens` 2048→4096（❓-1）；`alignBatchTags` 重複 index → err（💡-2）。
2. `lib/import-core.ts`、`lib/retag.ts`：批次標籤失敗加 `console.warn`，降級非靜默（🐛-1/🐛-2/❓-2）。
3. `lib/__tests__/tagging.test.ts`：加重複 index 回歸測試。
4. 不修：⚠️-1（慣例一致）、⚠️-3（spec 刻意取捨）、💡-1（cosmetic）；⚠️-2 為 FALSE POSITIVE。

驗證：`pnpm typecheck / test(49 passed) / lint` 全綠。

## 統計
- 🐛 2：2 真（加 warn 讓降級非靜默；retag 同步）
- ⚠️ 3：1 FALSE POSITIVE、2 不修（慣例一致 / spec 刻意取捨）
- 💡 2：1 採納（重複 index err）、1 不採納（cosmetic）
- ❓ 2：均採納/釐清（max_tokens→4096；降級刻意 + 加 warn）
