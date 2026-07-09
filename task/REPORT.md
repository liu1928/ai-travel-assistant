<!-- 產生日期: 2026-07-09 | 產生模型: claude-opus-4-8 | 引用 REVIEW.md 時間戳: 2026-07-09 18:4x（Asia/Taipei）| 下次審視: 反向策展 或調 quota 前 -->

# REPORT — 逐筆計費（每日匯入筆數上限）

> 任務來源：升級藍圖收尾（peanut：「把剩下的藍圖都補完」）。Foundation A/B 後續。計畫見 `task/PLAN.md`。分支 `feat/import-count-cap`（stacked on E）。
> 依 CLAUDE.md Executor 流程完成：實作 → 自我驗證 → GLM 審查（`task/REVIEW.md`）→ 仲裁 → 本報告。
> **未宣告 Done——等 peanut 驗收。**

## 1. 設計判斷（偏離「naive per-item × $」）

原構想是把匯入成本改成 `單價 × 筆數` 折進 `$` 護欄。**實作時判定這是錯的**：真實 Places 單價下，一次合法 300 筆 Takeout ≈ $6 > 使用者每日 $2 → 會擋掉正當大匯入。

改用**獨立的「每日匯入筆數」維度**（與 $ 護欄不同軸）：
- **$ 護欄**（維持現狀）：AI 生成 / 搜尋 / sharelink 預覽等每請求付費操作。
- **筆數上限**（新）：批次匯入解析的累積筆數，預設 **800/日**——放行一兩次大匯入、擋反覆大量匯入把 Places 呼叫放大。

## 2. 改了哪些檔案（7 檔）

| 檔案 | 改動 |
|---|---|
| `lib/quotas.ts` | 加 `USER_DAILY_IMPORT_LIMIT`（預設 800，env 覆寫） |
| `lib/rate-limit.ts` | 加 `checkAndConsumeImports(uid, count)`——同一 `usage/{uid}__{date}` doc 的 `importCount` 欄位原子累加，**複用純函式 `decide`**（global 維度以 `Infinity` 關閉）；fail-open |
| `lib/import-core.ts` | `ImportSummary` 加 `rateLimited`；付費 resolve **前**按 `valid.length` 扣額度，超過即整批不解析 |
| `app/api/import/takeout/route.ts` | 移除 route 層 flat `$` 費（改由 import-core 按筆數計） |
| `app/api/import/extension/route.ts` | 同上（CORS 保留） |
| `app/import/page.tsx` | `rateLimited` 時顯示「今日匯入已達上限，請明天再匯入」 |
| `lib/__tests__/rate-limit.test.ts` | 加 `decide` 在 `global=Infinity`（匯入維度）下只看 user 額度的 case |

**行為**：takeout / extension 匯入按實際筆數扣每日額度（≤300/次因 MAX_IMPORT，≤800/日）；超過整批不解析並前端提示。sharelink 走預覽路徑、維持 flat `$` 費、不碰 importCount。$ 生成護欄不受影響。

## 3. 測試結果

```
pnpm typecheck  → ✓
pnpm test       → ✓ 50 passed（+1 匯入維度 decide case）
pnpm lint       → ✓
```

## 4. GLM finding 統計（詳見 `task/REVIEW.md`）

- 🐛 2：**1 FALSE POSITIVE**（「上限變 801」——實測累積精確封頂在 800，reviewer 把「達 800、下一筆被擋」誤讀成「801 放行」）、**1 不修**（「額度蒸發」——per-attempt 計費對 call-volume cap 是正確的：每個 candidate 都打一次付費 Places，無論成敗；且 `MAX_IMPORT=300` 已限單次消耗，非 reviewer 假設的 800）
- ⚠️ 2：均不修——fail-open 與 peanut 既定決策一致且可利用性極低；`mapLimit(5)` 併發是既有行為非本次引入
- 💡 2：均不採納——失敗退補違反 volume-cap 語意；`LIMIT` 對「筆數上限」比 `BUDGET`（暗示 $）更清楚
- ❓ 1：已釐清——sharelink 不走 importCandidates、不碰 importCount，$ 費對應不同付費操作，**無雙重計費**

**無程式碼修正**：所有 finding 經逐步驗證為 FALSE POSITIVE / 對 volume-cap 語意的誤解 / 既有行為 / 命名偏好，均附實證。

## 5. Known issues / 待實測

- 實測：`QUOTA_USER_DAILY_IMPORTS` 設極小 → 匯入超過即 `summary.rateLimited=true`、前端提示；還原後大匯入放行；`$` 生成護欄與 sharelink 不受影響。
- **fail-open 取捨**（一致沿用）：Firestore 交易本身故障時匯入放行（不計數）。maxInstances:2 下 timeout 幾乎不發生，且 Firestore 掛時 app already 壞，非可持續攻擊面。
- 匯入日額 800 是暫定，可用 `QUOTA_USER_DAILY_IMPORTS` env 調整（apphosting.yaml 改了要重部署）。

## 6. 後續
- **反向策展**（`specs/reverse-curation.md`，旗艦，下一支分支）——前置 A（用量護欄）+ B（匯入上限）+ 本輪（匯入筆數維度）已全部就緒。

---
**狀態：實作完成、驗收未過。等 peanut 確認後才可宣告 Done。**
