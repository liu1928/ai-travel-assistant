# task/REVIEW.md — GLM-5.2 異質審查（Persona Mode）

- 時間戳：2026-07-09 17:5x（Asia/Taipei）
- 審查範圍：分身模式（Travel DNA 注入生成）本次 diff
  - `lib/anthropic.ts`（GenerateTripInput 加 dna、buildUserMessage 畫像段、SYSTEM_PROMPT V3 改寫、export buildUserMessage）
  - `app/api/trip/generate/route.ts`（best-effort computeTravelDna 傳入）
  - `lib/__tests__/anthropic.test.ts`（新）
- Reviewer：MCP `glm-reviewer` `review_code`，focus=（全面）
- ⚠️ Reviewer 意見僅為「懷疑」，先原封記錄，再逐條仲裁。

---

## 一、GLM 原始回覆（原封不動）

### 🐛 問題點
無。

### ⚠️ 風險

1. **`Math.round` 導致 0% 偏好標籤出現的邊界錯誤**
   `tagCounts` 雖然已過濾掉 `count === 0`，但若使用者收藏的總地點數極大，某個標籤的 `ratio` 可能極小（例如 `0.004`）。`Math.round(0.004 * 100)` 會得到 `0`，導致 prompt 印出「溫泉 0%」，這在語意上極度荒謬且會干擾模型理解。應改為 `Math.max(1, Math.round(...))` 確保最小百分比為 1，或在 ratio 過低時直接捨棄該標籤。

2. **「每天 1 個反 DNA 驚喜位」可能導致 token 成本與輸出截斷**
   專案目前 `max_tokens` 設為 4096。現在要求每個景點都要寫「為你而選」的理由，且每天還要額外生成一個「反 DNA 探索點」並附帶破框說明。這大幅增加了模型在 `description` 欄位的輸出量。若使用者請求產生 7~10 天的行程，結構化輸出（JSON）的 token 量極可能逼近或超過 4096，導致 JSON 被截斷、`zodOutputFormat` parse 失敗，最終引發系統錯誤。建議重新評估 `max_tokens` 是否需提升，或限制驚喜位的生成頻率。

3. **冷啟動門檻判斷條件重複且分散**
   `input.dna && input.dna.totalPlaces >= DNA_MIN_PLACES && input.dna.tagCounts.length > 0` 這段判斷寫在 `buildUserMessage` 內。雖然 `route.ts` 透過 best-effort 拿到 `dna` 後直接傳入，但 `TravelDna` 的型別允許 `totalPlaces` 或 `tagCounts` 為 0。若未來有其他呼叫端傳入剛好 4 個收藏的 `dna`，這裡的防護是有效的。但這導致「是否要注入 DNA」的業務邏輯耦合在純粹的字串組裝函式中，未來維護時可能會忽略這層隱性門檻。

### 💡 建議

1. **集中冷啟動判斷邏輯**
   與其在 `buildUserMessage` 裡寫 `if (input.dna && input.dna.totalPlaces >= DNA_MIN_PLACES && ...)`，不如在 `route.ts` 取得 `dna` 後，直接判斷並傳入 `undefined`：
   ```ts
   const dnaResult = await computeTravelDna(auth.value);
   const rawDna = dnaResult.ok ? dnaResult.value : undefined;
   const dna = rawDna && rawDna.totalPlaces >= DNA_MIN_PLACES ? rawDna : undefined;
   ```
   讓 `buildUserMessage` 只需單純檢查 `if (input.dna)`，維持其作為「純函式」的職責單一性，將「冷啟動門檻」的商業邏輯收攏至 route 層。

2. **避免在 prompt 字串中過度使用「」等標點**
   `「為你而選」`、`「略微跳出既有偏好」` 這些引號在 prompt 中並非必要，模型理解自然語言不需要這些強調符號，這只會增加無意義的 token 消耗。直接寫「每個景點的 description 至少有一句為你而選的理由...」即可。

### ❓ 待釐清問題

1. **`computeTravelDna` 的失敗是否真的完全無聲？**
   `route.ts` 寫了 `const dna = dnaResult.ok ? dnaResult.value : undefined;`，這代表 `computeTravelDna` 失敗時（例如 Firestore 查詢超時），系統會默默降級。這是否符合預期？還是應該至少記錄 log（例如 console.warn 或 telemetry），以便觀察 DNA 聚合功能的可用性？背景說明提到「比照 holidays/Routes 降級」，但 holidays 降級可能只是少放國定假日，DNA 降級則是讓「個人化」直接失效，這兩者的衝擊程度是否對等？

2. **`summary` 是否有被注入惡意提示詞的風險？**
   `input.dna.summary` 被直接插入 prompt 字串中。這個 `summary` 是由系統生成的，還是可能包含了使用者輸入的自由文字（例如使用者自訂的收藏標籤名稱或備註）？如果是後者，直接插入字串可能會成為 Prompt Injection 的攻擊向量，破壞原本的結構化輸出意圖。

---

## 二、仲裁（逐條實際驗證）

### ⚠️-1 `Math.round` 印成 0% → **真（採納，順手一行）**
- 驗證：`slice(0,4)` 取的是 count 最高的前 4 個 tag，且只有 10 個固定 tag，top-4 ratio 極難低到 0.5% 以下；但確為可能的醜陋邊界，且修法是一行。
- 處置：改 `Math.max(1, Math.round(t.ratio * 100))`。

### ⚠️-2 max_tokens 4096 截斷風險 → **真（採納，我的改動加劇既有風險）**
- 驗證：分身模式讓每個 place/food stop 多「一句為你而選」+ 每天一個探索點，確實增加 `description` 輸出量；長天數行程 JSON 逼近 4096 → 截斷 → parse 失敗 → 假性 refusal。survey 本就列此為既有風險，我的改動加劇它。
- 處置：`max_tokens` 4096 → 8192（Sonnet 4.6 支援遠高於此，保守上調；直接消除本次引入的回歸）。

### ⚠️-3 / 💡-1 冷啟動門檻耦合在純函式 → **不採納（設計取捨，附理由）**
- 反對移到 route：把 guard 留在 `buildUserMessage` 讓它**對任何呼叫端 correct-by-construction**——未來任何 caller（如 eval、批次、之後的 party 生成）傳入低於門檻的 dna 都不會誤注入雜訊畫像；且單測正是直接驗這個門檻。移到 route 反而讓 `buildUserMessage` 在「dna 存在就注入」，把防線外包給每個呼叫端記得先過濾，較脆弱。`buildUserMessage` 仍是純函式（無副作用、輸入決定輸出），職責單一性未破。**維持現狀。**

### 💡-2 移除「」引號省 token → **不採納（可讀性 > 幾個 token）**
- 「為你而選」的引號是**把該片語標成模型該用的固定 label**，有助指令清晰；成本是個位數 token，可忽略。維持。

### ❓-1 DNA 失敗無聲降級 → **真（採納，加 warn）**
- 同意：DNA 降級 = 個人化整層失效，比假日少一行更有感，值得可觀測。
- 處置：route 加 `if (!dnaResult.ok) console.warn("[trip/generate] DNA 降級：", ...)`。仍不阻擋生成（best-effort 語意不變）。

### ❓-2 `summary` prompt injection 風險 → **FALSE POSITIVE（已驗證，無使用者自由文字）**
- 追 `lib/travel-dna.ts` 的 `buildSummary`：summary = `你的收藏偏好 ${topTags.join("、")}，...`，`topTags` 全來自 `placeTag.options`（**固定 10 類 string literal enum**）。注入段的 `top`（tagCounts[].tag）同樣來自該 enum。**全數系統生成、零使用者自由文字**（使用者可控的 `note`/`group` 根本不進 TravelDna，DNA 只聚合 `tags`）。無 prompt injection 向量。**不需處理。**

---

## 三、本輪修正動作
1. `lib/anthropic.ts`：`Math.max(1, Math.round(...))`（⚠️-1）；`max_tokens` 4096→8192（⚠️-2）。
2. `app/api/trip/generate/route.ts`：DNA 失敗加 `console.warn`（❓-1）。
3. 不採納 ⚠️-3/💡-1、💡-2（附理由）；❓-2 經追碼驗證為 FALSE POSITIVE。

修正後重跑 `pnpm typecheck && pnpm test && pnpm lint` 全綠 → REPORT.md → commit。

## 統計
- 🐛 0
- ⚠️ 3：2 真已修（Math.max / max_tokens）、1 不採納（設計取捨）
- 💡 2：均不採納（附理由）
- ❓ 2：1 真已修（warn）、1 FALSE POSITIVE（追碼驗證 summary 無使用者文字）
