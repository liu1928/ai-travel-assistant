# task/REVIEW.md — GLM-5.2 異質審查（每日匯入筆數上限）

- 時間戳：2026-07-09 18:4x（Asia/Taipei）
- 審查範圍：逐筆計費（改為「每日匯入筆數」維度）
  - `lib/quotas.ts`、`lib/rate-limit.ts`（`checkAndConsumeImports`）、`lib/import-core.ts`、`app/api/import/{takeout,extension}/route.ts`、`app/import/page.tsx`、`lib/__tests__/rate-limit.test.ts`
- Reviewer：MCP `glm-reviewer` `review_code`，focus=`correctness`
- ⚠️ Reviewer 意見僅為「懷疑」，先原封記錄，再逐條仲裁。

---

## 一、GLM 原始回覆（原封不動）

這個設計在方向上正確（將 flat 費改成按筆數維度來避免擋掉正當大匯入），但在交易一致性與計費邊界上存在嚴重瑕疵。

### 🐛 問題點
1. **「扣款成功但解析全失敗」導致額度憑空蒸發**
   `checkAndConsumeImports` 在 `mapLimit` 解析前就 `tx.set` 扣除 `valid.length` 筆額度。若後續 `resolve(c, apiKey)` 因為 API key 失效、網路全斷而全部失敗，使用者的每日匯入額度已被扣光，卻沒拿到任何有效資料。這在單次 800 筆匯入時會直接把使用者當日額度歸零，極度不合理。
2. **`decide` 純函式套用語意錯誤，導致上限變 801**
   `importCount + n > 800`，當 `importCount=0`、`n=800`，`0+800>800` 為 false 放行，扣款後 `importCount=800`。隔天再匯入 1 筆，`800+1>800` 為 true 被擋。這使實際每日上限變成 **801 筆**。

### ⚠️ 風險
1. **Fail-open 在此處的取捨可能不當**：`importCandidates` 一次可吃數百筆額度，若 Firestore 交易 timeout 觸發 fail-open，攻擊者可繞過每日上限。對高消耗批次操作，fail-closed 較安全。
2. **`mapLimit` 並發數 5 與 `maxInstances: 2` 的資源競爭**：一次 300 筆匯入並發 5，若兩請求打滿實例，10 個併發外部 API 請求可能被限流拖長、增加交易 timeout 風險。

### 💡 建議
1. **修正扣款時機以保障一致性**：解析後依實際失敗筆數退補（`increment(-failedCount)`）。
2. **統一常數命名**：`USER_DAILY_IMPORT_LIMIT` 在 `decide` 中作為 `userBudget` 傳入，建議改名 `USER_DAILY_IMPORT_BUDGET`。

### ❓ 待釐清問題
1. **`sharelink` 維持 flat $ 費，是否與匯入額度雙重計費？** 預覽後點匯入是否 $ 收一次、`importCount` 又扣一次？

---

## 二、仲裁（逐條實際驗證）

### 🐛-1 額度蒸發 → **不修（per-attempt 計費對 call-volume cap 正確；MAX_IMPORT 已限單次 ≤300）**
- 這個 quota 的**目的是限制「每日 Places 呼叫的筆數量」**。`resolve(c)` 對每個 valid candidate 都打**一次付費 Text Search（無論成功與否）**——所以扣 `valid.length` 是**正確反映實際呼叫量**，不是憑空蒸發。
- reviewer 假設「單次 800 筆歸零」不成立：**`MAX_IMPORT=300` 已把單次上限壓在 300**（`valid = validAll.slice(0, MAX_IMPORT)`），單次最多消耗 300，日額 800 仍剩 500。
- 若 Places 真的全斷，退款重試只會再打 Places 300 次——volume cap **本就該**擋這種重試風暴。故不退補。前端會顯示「成功 0・失敗 300」，使用者看得到。

### 🐛-2 上限變 801 → **FALSE POSITIVE（累積上限精確為 800）**
- 逐步驗證：放行條件 `importCount + n <= 800`；只有放行才 `increment(n)`。故任何一系列放行後，累積 importCount 恆 `<= 800`，**永不超過 800**。
- reviewer 的推演把「importCount 已達 800、下一筆被擋」誤讀成「801 被放行」。實際上第一次匯入 800（累積到 800），之後全擋——**當日總匯入正好 800 = 上限**。無 off-by-one。

### ⚠️-1 fail-open 對批次不當 → **不修（與 peanut 既定 fail-open 一致；可利用性極低）**
- peanut 已拍板全域 fail-open。Firestore timeout 在 `maxInstances:2` 極低併發下幾乎不發生；且 Firestore 若真掛，整個 app（所有資料）already 壞，不是可持續利用的攻擊面。維持一致 fail-open。（已記為 known tradeoff。）

### ⚠️-2 mapLimit 5 × maxInstances 2 資源競爭 → **不修（既有行為、非本次引入）**
- `mapLimit(valid, 5, resolve)` 是**改動前就存在**的併發設定，本次未動。10 個併發 Places 呼叫在 Places 承受範圍內，非本輪 scope。

### 💡-1 失敗退補 → **不採納（見 🐛-1，per-attempt 計費對 volume cap 正確）**

### 💡-2 改名 IMPORT_BUDGET → **不採納（LIMIT 對「筆數上限」比 BUDGET 更清楚）**
- `BUDGET` 一詞在本檔語境暗示「$ 金額」（USER_DAILY_BUDGET_USD 就是 $）；匯入是**筆數**上限，`LIMIT` 更精確、避免與 $ 預算混淆。`decide` 的參數名 `userBudget` 是泛用比較界線，傳入 count-limit 語意成立。

### ❓-1 sharelink 雙重計費 → **無雙重計費（已釐清）**
- `sharelink` **不走 `importCandidates`**：預覽收一次 flat `$`（做 1 個連結的 Places 解析），之後前端把每個地點 POST 到 `/api/collection`（各收一次 `tagging_batch` $，因為每筆要打標籤）。**全程不碰 `importCount`**。$ 費對應的是**不同的實際付費操作**（預覽解析 vs 逐筆標籤），非同一動作重複收費。takeout/extension 才走 importCandidates、只扣 importCount、不收 $ flat。

---

## 三、本輪修正動作
- **無程式碼修正**：GLM 兩個 🐛 一個是 FALSE POSITIVE（上限精確 800）、一個是對 volume cap 的誤解（per-attempt 計費正確且 MAX_IMPORT 已限 300）；⚠️/💡 均為既有行為或與既定取捨/命名一致；❓ 已釐清無雙重計費。均附實證理由。

驗證：`pnpm typecheck / test(50 passed) / lint` 全綠。

## 統計
- 🐛 2：1 FALSE POSITIVE（上限 800 非 801）、1 不修（per-attempt 計費正確 + MAX_IMPORT 限 300）
- ⚠️ 2：均不修（fail-open 一致 / mapLimit 既有）
- 💡 2：均不採納（退補違反 volume cap 語意 / LIMIT 命名更清楚）
- ❓ 1：已釐清（sharelink 不碰 importCount，無雙重計費）
