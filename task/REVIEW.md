# task/REVIEW.md — 反向策展（貼靈感）異質審查

- 時間戳：2026-07-09 19:1x（Asia/Taipei）
- 審查範圍：`lib/inspiration.ts`、`app/api/import/inspiration/{route,confirm/route}.ts`、`lib/import-core.ts`（匯出 resolveCandidate）、`app/import/page.tsx`、`lib/__tests__/inspiration.test.ts`
- 兩個獨立審查來源：
  1. **GLM-5.2**（MCP `glm-reviewer`，focus=security）— 異質模型
  2. **4-視角對抗驗證 workflow**（4 個 subagent 各讀真實檔案：security / cost-abuse / correctness / ux-integrity，共 14 findings）
- ⚠️ 意見僅為「懷疑」，先記錄，再逐條仲裁（實際驗證後才算數）。

---

## 一、GLM-5.2 原始回覆（原封不動）

### 🐛 問題點
1. **confirm 端 IDOR**：直接接收前端 `placeSearchResultSchema` 寫入，zod 只驗格式非來源，可偽造 placeId。
2. **confirm 端 zod 擋不住竄改**：可傳預覽沒出現過的資料或竄改欄位。
3. **被限流時仍先扣費**：route 的 `checkAndConsume("tagging_batch")` 先扣，之後 `checkAndConsumeImports` rate_limited，$ 已扣但沒拿到東西。

### ⚠️ 風險
1. Prompt Injection 導致 DB 污染。
2. `mapLimit` 失敗導致索引錯位（取決於是否保證回傳長度相同）。
3. `tagPlaces` fallback 成空標籤掩蓋錯誤。
4. `computeTravelDna` 失敗時靜默降級（空 ratios → 全低分）。

### 💡 建議
1. confirm 應在預覽階段把 items 存 server-side session/Firestore，confirm 只收 placeId 從快取取。
2. 修計費順序：先 checkAndConsumeImports 再扣 $。
3. `normalizeName` 對日/韓/全形處理不足。

### ❓ 待釐清
1. `addPlace` 是否會把 fitScore/reason 寫入 DB？
2. `placeSearchResultSchema` 是否含 uid/owner？addPlace 如何確保歸屬？
3. `checkAndConsume` 扣費是否可回滾？

---

## 二、4-視角 workflow findings（14 條，逐條摘錄，見 transcript wyvd0oyjv）

**security（2 low）**：① confirm 信任前端（spec §7 刻意，只影響自己收藏、zod 驗格式）② prompt injection（structured output + 固定 googleapis sink + reason 不打 AI + tags enum 約束 → 無實質危害）。

**cost-abuse**：**① [HIGH] Places 解析成本未進 $ 全域熔斷**（只被 importCount 筆數維度擋；800÷20=40 次/日 ≈ $16 真實花費，$10 global 永不觸發）② [MED] 抽取 Haiku 在 import gate 前，rate_limited 時已付一次 Haiku（可接受小額）③ [low] confirm 全量 listPlaces 去重 ④ [low] 迴圈/截斷安全，唯 $ 維度失效同 ①。

**correctness**：**① [MED] computeTravelDna 失敗靜默當空 DNA → 整批 1 星/補盲區誤導** ② [low] gapTags[0] 未按 ratio 排序，理由未必指向最空白 ③ [low] 預覽 $ 只扣一次但打兩次 Haiku（抽取 + tagPlaces）。

**ux-integrity**：**① [MED] truncated 提示藏在 else，全失敗時不顯示且已扣額度** **② [MED] truncated 文案誤導、resolve 失敗筆數靜默消失** **③ [MED] confirm 出錯丟掉整份預覽 + 勾選，逼重跑昂貴分析** ④ [low] done 後無收藏頁 CTA ⑤ [low] 補盲區恆低星、預設不被勾，賣點被淹沒。

---

## 三、仲裁 + 修正

### 已修（7 項）

| # | finding | 修正 |
|---|---|---|
| 1 | cost ①[HIGH] Places 不進全域熔斷 | 新增**全域匯入筆數熔斷** `GLOBAL_DAILY_IMPORT_LIMIT`（4000）——`checkAndConsumeImports` 加 global 軸（`usage/__global__.importCount`，複用 decide）。**不折回 $ 維度**（會擋掉正當大匯入，見逐筆計費決策），改用「全域筆數」封住跨使用者累積放大，與 per-uid 同軸對稱。 |
| 2 | correctness ①[MED] DNA 失敗靜默 | `extractAndScore` **DNA 移到最前 fail-fast**：`!dnaResult.ok → err(dna_error)`（route 對 502）；**在昂貴抽取/解析前**就擋，空收藏（新使用者）仍合法走 ok。 |
| 3 | ux ①②[MED] 去向靜默消失 | `extractAndScore` 回傳 `resolveFailed`；前端把 truncated/resolveFailed 提示**移出 else**（空結果也顯示），文案改「略過 N 個 / 地圖找不到 M 個」，不再把截斷數與倖存數混談。 |
| 4 | ux ③[MED] confirm 出錯丟預覽 | confirm 失敗**保留預覽 + 勾選**（`{...preview, error}`），可直接重按批次收藏，不必重跑抽取/重扣額度。 |
| 5 | correctness ②[low] gapTags 未排序 | `scoreFit` 的 gapTags 依 ratio 由低到高排序 → 理由指向最空白方向。 |
| 6 | ux ⑤[low] 補盲區預設不勾 | 預設勾選改 `fitStars>=4 || isGapFiller`，讓策展缺口賣點被看到。 |
| 7 | ux ④[low] done 無 CTA | done 加「回收藏頁查看 →」Link。 |

### 不修（附理由）

- **GLM 🐛1/🐛2 + security ①（confirm 信任前端）→ 不修（spec §7 刻意取捨）**：這是**單一使用者對自己收藏**的寫入，`placeSearchResultSchema` **無 uid/owner 欄位**（uid 由 `addPlace(uid, …)` 從 `requireUid` 決定、doc 寫在 `users/{uid}/places`，前端無法指定他人 uid）→ **無跨使用者風險/無 IDOR**。最壞情況是使用者寫一筆自己竄改的地點到自己收藏，無安全影響。spec §7 明載此取捨（省一次 Places Details 付費）。GLM ❓1（fitScore/reason 是否入 DB）：**否**——confirm 只存 `place`（PlaceSearchResult）+ `tags`，fitScore/reason 不寫入。
- **GLM 🐛3 / cost ②（被限流仍先扣 $）→ 不修（已釐清，非漏洞）**：route 的 `tagging_batch` $ 對應的是**確實跑過的抽取 Haiku**（$ 沒白扣）；最貴的 Places resolve **確實排在 import gate 之後**（未發生「被限流卻已付 Places」）。Haiku 一次是小額；接受。
- **GLM ⚠️1 / security ②（prompt injection）→ 不修（FALSE POSITIVE 等級）**：structured output 強制 schema、`name` 只流向固定 googleapis 端點（無 SSRF）、`context` 現行未被使用、`reason` 走確定性模板不回灌 AI、`tags` 受 enum 約束。無實質危害。
- **GLM ⚠️2（mapLimit 錯位）→ FALSE POSITIVE**：`mapLimit`（concurrency.ts）用 `results[i] = await fn(items[i], i)` **保證回傳長度=輸入長度、索引對齊**；`resolved[i]` 與 `capped[i]` 一一對應，null 濾除用 `filter` 後 pairs 內 place 與 extracted 仍成對。無錯位。
- **GLM ⚠️3 / correctness ③（tagPlaces fallback 空標籤）→ 記錄不修**：tagPlaces 失敗該批空標籤是既有 D 決策（有 warn）；此處空標籤 → scoreFit 回低分，屬合理降級（非靜默腐蝕）。
- **cost ③（confirm 全量 listPlaces）→ 不修**：只影響 skipped 分類統計、addPlace 本身冪等；收藏規模有限、Firestore 讀便宜。
- **correctness ③ / cost 校準（預覽 $ 低估 2 次 Haiku）→ 記錄不修**：Haiku 極便宜（$0.01 級），$ 護欄是粗估上界；不為個位數 token 複雜化。
- **GLM 💡3（normalizeName 全形/日韓）→ 不修**：lowConfidence 只是「提醒人工確認」的柔性訊號，非硬判定；名稱比對不完美時最多多顯示一個「請確認」徽章，無正確性危害。

---

## 四、驗證
`pnpm typecheck / test(56 passed) / lint` 全綠（新增 scoreFit 6 case、匯入雙軸 decide case）。

## 統計
- GLM：🐛3 / ⚠️3 / 💡3 / ❓3 — 逐條仲裁（3 不修-刻意、2 FALSE POSITIVE、其餘釐清）
- workflow：14 findings（2 HIGH-equiv 的 cost①與多個 MED）→ **7 修**、7 不修（spec 刻意/FALSE POSITIVE/低優先，均附理由）
