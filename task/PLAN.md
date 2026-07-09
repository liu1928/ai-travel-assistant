# PLAN — 逐筆計費（每日匯入筆數上限）

> 任務來源：升級藍圖收尾（peanut：「把剩下的藍圖都補完」）。Foundation A/B 的後續。
> 上一輪 PLAN（E）已 commit 於 `feat/foundation-e`（0db84e44），git 歷史保留，本檔覆寫。
> 分支：`feat/import-count-cap`（stacked on E）。

## 設計判斷（偏離「naive per-item × $」的原因）

原「後續」構想是把匯入成本改成 `單價 × 筆數` 折進 `$` 護欄。**實作時發現這是錯的**：以真實 Places 單價（~$0.02）計，一次合法的 300 筆 Takeout 匯入 = ~$6，遠超使用者每日 `$2` → **會擋掉正當的一次性大匯入**。

正解：**另開一個「每日匯入筆數」維度**（與 `$` 護欄不同軸）——
- `$` 護欄：管 AI 生成 / 搜尋 / sharelink 預覽等**每請求**付費操作（維持現狀）。
- 筆數上限：管**批次解析**（takeout / extension / 未來 inspiration）的累積筆數。
- 預設每日 800 筆：放行一兩次大匯入，擋住「反覆大量匯入」把 Places 呼叫放大。

## 步驟

### 1. `lib/quotas.ts`
- 加 `USER_DAILY_IMPORT_LIMIT = numEnv("QUOTA_USER_DAILY_IMPORTS", 800)`。

### 2. `lib/rate-limit.ts`
- 加 `checkAndConsumeImports(uid, count)`：同一 `usage/{uid}__{date}` doc 的 `importCount` 欄位原子累加，對照 `USER_DAILY_IMPORT_LIMIT`。**複用純函式 `decide`**（global 維度以 `Infinity` 關閉，只看 user 的 importCount vs limit）。fail-open。`count<=0` 直接放行。

### 3. `lib/import-core.ts`
- `ImportSummary` 加 `rateLimited: boolean`（初始化 false）。
- 算完 capped `valid` 後、跑付費 resolve 迴圈**前**：`checkAndConsumeImports(uid, valid.length)`；被擋 → `summary.rateLimited = true` 直接 return（未做任何付費解析）。

### 4. `app/api/import/takeout/route.ts` / `extension/route.ts`
- **移除** route 層的 flat `checkAndConsume(uid, "import_resolve")`（改由 import-core 按筆數計）；auth 保留。extension 的 CORS 錯誤回應不受影響。
- `sharelink` route **維持** flat `$` charge（它走預覽、非批次 importCandidates 路徑，1 個連結）。

### 5. `app/import/page.tsx`
- `ImportSummary` type 加 `rateLimited`；takeout 完成訊息 `rateLimited` 時顯示「今日匯入已達上限，請明天再匯入」。

### 6. 測試
- `lib/__tests__/rate-limit.test.ts`：加 `decide` 在 `globalBudget=Infinity`（匯入維度複用）下只看 user 額度的 case。

## 設計決策
- 複用 `decide` 純函式（已測），不重寫比較邏輯。
- 匯入筆數與 `$` 共用同一 usage doc、不同欄位（`importCount` vs `estCostUsd`），台北日界同步重置。
- fail-open 一致（Firestore 抖動不擋匯入）。

## 驗收
```bash
pnpm typecheck && pnpm test && pnpm lint
```
實測：把 `QUOTA_USER_DAILY_IMPORTS` 設極小 → 匯入超過即 `summary.rateLimited=true`、前端提示；還原後正常大匯入放行；`$` 生成護欄不受影響。
完成後：git diff → GLM review → REVIEW.md 仲裁 → REPORT.md → commit → push → PR。

## 不在本輪
- 反向策展（下一支分支）。
