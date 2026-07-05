<!-- 產生日期: 2026-07-06 | 產生模型: claude-fable-5 | 下次審視: 下次動 sharelink 或部署前 -->

# REPORT — 安全與清理三改

> 對應審查：`task/REVIEW.md`（時間戳 2026-07-06，審查者 GLM-5.2）。
> 任務來源：peanut 口頭指示「動手做這三件」（非 task/SPEC.md）。實作 → test/typecheck/lint 全過
> → GLM 兩輪異質審查 → 本報告後停，等 peanut 驗收。

## 1. 改了哪些檔案

| 檔案 | 改動 |
|---|---|
| `lib/sharelink.ts` | SSRF 修補：`parseShareLink` 在 `fetch` 之前先用 `isAllowedInputUrl` 做 https + Google Maps 網域白名單；`resolveUrl` 的 `fetch` 加 `AbortSignal.timeout(5000)`；`isMapsUrl` 由 `includes` 子字串改為解析 hostname 精確比對。新匯出 `isAllowedInputUrl`、`isMapsUrl` 供測試。 |
| `lib/__tests__/sharelink.test.ts` | 新增：`isAllowedInputUrl`（接受 Google 網域、擋內網/非 https/偽造子網域）與 `isMapsUrl`（擋 query/path 塞字串）共 6 個 case 群。 |
| `.gitignore` | 補 `.env`、`c*.txt`。 |
| `c1.txt`, `c2.txt` | `git rm`（Turbopack build 產物，含 Firebase client key，本不該進版控）。 |
| `task/PLAN.md` `task/REVIEW.md` `task/REPORT.md` | 本輪流程文件（覆寫前一輪；git 歷史保留）。 |

## 2. 測試結果

- `pnpm test` → **2 檔 22 tests 全過**。
- `pnpm typecheck`（`tsc --noEmit`）→ **exit 0**。
- `pnpm lint`（eslint app lib schema）→ **exit 0**。

## 3. GLM finding 統計（兩輪）

- 第一輪：🐛×2、⚠️×3、💡×2、❓×1。
  - **真並修**：1 條（`isMapsUrl` 子字串繞過 → 改 hostname 精確比對）。
  - **False positive**：1 條（regex 子網域繞過 → 誤讀錨點，實測 + 單測證偽）。
  - 其餘風險/建議：接受殘留或非問題（見 REVIEW.md 逐條）。
- 第二輪（改完 isMapsUrl 後）：**🐛 0**，僅重申已接受的殘留風險與 DRY/錯誤訊息建議。
- **結論：無 P0/P1 未處理項。**

## 4. 原「第三件」的查證結論（重要 — 兩半都不照原方案做）

第三件原本是「行程生成開 prompt caching + 調高 Cloud Run timeout」，查證後兩半都不成立：

1. **Prompt caching：不做（會是 no-op）。** `SYSTEM_PROMPT` 實測約 1621 字元 ≈ **900 tokens**；
   Sonnet 4.6 的 prompt caching 最小可快取前綴是 **2048 tokens**。低於門檻時 `cache_control`
   不報錯也不快取（`cache_creation_input_tokens: 0`），零效果。故不動 SPEC 範圍的 `lib/anthropic.ts`。
   → 只有未來 SYSTEM_PROMPT 長到 >2048 tokens，或改用別的快取策略，才值得加。

2. **Cloud Run timeout：不能在 `apphosting.yaml` 設。** 查 Firebase 官方文件，`runConfig` 只有
   `cpu / memoryMiB / maxInstances / minInstances / concurrency / vpcAccess`，**無 `timeoutSeconds`**。
   request timeout 是 Cloud Run 服務層設定。若要調高（診斷認為長 LLM 呼叫可能撞逾時），請自行執行：
   ```bash
   # 先查現值與服務名（App Hosting 的 Cloud Run 服務通常叫 <backendId>）
   gcloud run services list --project ai-travel-assistant-20e55
   # 調高到 180 秒（範圍 1–3600）
   gcloud run services update <SERVICE_NAME> --region <REGION> --timeout=180 \
     --project ai-travel-assistant-20e55
   ```
   註：此為正式站基礎設施變更，需 peanut 用自己的 gcloud 權限跑；我不代為執行。

## 5. Known issues / 待 peanut 決定

1. **審查者衝突（GLM vs Gemini）**：根 `CLAUDE.md` 說「GLM 取代 Gemini，所有專案適用」；但本專案
   `CLAUDE.md` 步驟 4 仍寫 Gemini，且最近一個 commit 才建好 `scripts/gemini-review.mjs`。本輪照
   根目錄的較新指示用了 **GLM**。**請 peanut 定調**這個專案往後用哪個，並把落敗的那份文件更新，
   免得下個弱模型 session 又要重猜。
2. **國別 `com.XX` 網域不被接受**（`google.com.au`/`com.tw`/`com.hk` 等）：`GOOGLE_MAPS_HOST`
   涵蓋 `google.com`、`google.co.xx`、`google.<2-3字母>`，但漏 `com.XX`。**這不是回歸**（原 `includes`
   版本同樣不收），屬既有功能限制。若這些地區的使用者會直接貼完整網址，再開一張功能票處理。
3. **殘留、刻意不修（皆記於 REVIEW.md）**：`redirect:"follow"` 對可信短連結轉址不逐跳驗證、
   DNS rebinding、`resolveUrl` 回傳原始錯誤訊息。皆為低風險/超出本次範圍，權衡後保留。

## 6. 尚未做（等 peanut 指示，不自作主張）

- 未 `git commit`。以上都是工作區改動，peanut 驗收後再決定 commit/部署。
- 未碰上面第 4 節的 apphosting.yaml 或 Cloud Run（原因見上）。
