# PLAN — 安全與清理三改（peanut 口頭指派）

> 本輪任務來源：peanut 直接指示「動手做這三件」，非 task/SPEC.md（SPEC.md 是行程生成規格）。
> 依 CLAUDE.md 流程精神執行：實作 → 自我驗證(test/typecheck/lint) → 異質 review → 報告後停。
> （前一輪 PLAN 內容為航班/租車，已 commit `2d6d0071`；git 歷史保留，本檔覆寫為本輪。）

## 原始三項
1. 修 sharelink SSRF（驗證順序反了）
2. `git rm` 掉 c1.txt/c2.txt + 補 .gitignore
3. 行程生成開 prompt caching + 調高 Cloud Run timeout

## 執行前查證的結論（改變了第 3 項）
- **Prompt caching：不做（驗證為 no-op）。** SYSTEM_PROMPT 實測約 1621 字元 ≈ 900 tokens。
  Sonnet 4.6 的 prompt caching 最小可快取前綴是 **2048 tokens**（見 claude-api skill）。
  低於門檻時加 `cache_control` 不會報錯、但也不會快取（`cache_creation_input_tokens: 0`），
  等於零效果。不為零效果去動 SPEC 範圍內的 lib/anthropic.ts 再跑一輪 review。
- **Cloud Run timeout：不能在 apphosting.yaml 設。** 查 Firebase 官方文件，runConfig 只支援
  `cpu / memoryMiB / maxInstances / minInstances / concurrency / vpcAccess`，**沒有 timeoutSeconds**。
  request timeout 是 Cloud Run 服務層設定，需用 `gcloud run services update` 或 Console。
  → 產出 gcloud 指令交給 peanut 執行，不在 repo 亂加會被平台忽略/拒絕的欄位。

## 實際會動的檔案
| 檔案 | 改動 | 需 review？ |
|---|---|---|
| lib/sharelink.ts | fetch 前加 https + Google Maps 網域白名單；fetch 加 5s AbortSignal timeout | 是（程式碼） |
| lib/__tests__/sharelink.test.ts | 新增 isAllowedInputUrl 單元測試 | 是（程式碼） |
| c1.txt, c2.txt | git rm --cached（build 產物，含 client key） | 否（檔案移除） |
| .gitignore | 補 `c*.txt`、`.env` | 否（≤3 行設定微調豁免） |

## 驗收
- pnpm test / typecheck / lint 全過
- git diff → task/diff.patch → node scripts/gemini-review.mjs → task/REVIEW.md
- 仲裁 REVIEW.md，處理真 P0/P1，寫 task/REPORT.md
