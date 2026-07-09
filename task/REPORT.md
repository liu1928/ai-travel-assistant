<!-- 產生日期: 2026-07-09 | 產生模型: claude-opus-4-8 | 引用 REVIEW.md 時間戳: 2026-07-09 18:2x（Asia/Taipei）| 下次審視: 做逐筆計費 / 反向策展前 -->

# REPORT — Foundation Hardening E：記帳頁入口

> 任務來源：`specs/foundation-hardening.md` 項目 E（peanut：「再收尾E」）。計畫見 `task/PLAN.md`。分支 `feat/foundation-e`（stacked on bcd）。
> 依 CLAUDE.md Executor 流程完成：實作 → 自我驗證 → GLM 審查（`task/REVIEW.md`）→ 仲裁 → 本報告。
> **未宣告 Done——等 peanut 驗收。**

## 1. 改了哪些檔案（2 檔，純前端）

| 檔案 | 改動 |
|---|---|
| `app/trips/[id]/page.tsx` | header 右側改 flex，`ready` 時永遠顯示「💰 記帳」`Link → /trips/[id]/expenses`；「去分帳」維持條件式並列 |
| `app/trips/page.tsx` | 列表每筆動作區加「💰 記帳」`Link`，與「刪除」並列 |

**修的事**：`/trips/[id]/expenses` 記帳功能已上線卻**全站無 UI 入口**（`grep '/expenses'` 零命中），使用者得手動改網址才進得去。補上兩處站內入口，讓孤兒頁被看見。無後端/資料模型/依賴變動。

## 2. 測試結果

```
pnpm typecheck  → ✓
pnpm test       → ✓ 49 passed（純 UI，測試不受影響）
pnpm lint       → ✓
```

## 3. GLM finding 統計（詳見 `task/REVIEW.md`）

- 🐛 0（reviewer 確認無巢狀 anchor、結構乾淨）
- ⚠️ 2：均不修——`id` 由資料模型保證（SavedTrip.id = Firestore doc id，`ready`/列表狀態必存在）；刪除無二次確認屬**既有行為、非本輪引入**，gap-3 觸控間距足夠
- 💡 2：均不採納——`/trips/${id}/expenses` 是 trivial 路徑，抽 `buildExpensesHref` 屬過度抽象；emoji a11y 與 codebase 既有 emoji 連結慣例一致，**全站 a11y 是 survey 已列的另案**，不在此夾帶
- ❓ 2：均已釐清（`ready` 保證 id；記帳不綁 `SPLIT_BILL_URL` 是刻意）

**無程式碼修正**：GLM 未找到真 bug，所有 finding 經驗證為資料模型保證 / 既有 scope / 慣例一致。

## 4. Known issues / 待實測

- 實測：行程詳情頁 header 與行程列表每筆都看得到「💰 記帳」，點入即 `/trips/[id]/expenses`。
- **全站 a11y**（emoji 連結無 aria、錯誤無 `role="alert"`、按鈕無 `aria-label`）是升級藍圖 survey 已記錄的獨立缺口，宜整批處理，非本輪。
- 列表刪除無二次確認是既有 UX，若要補屬另案。

## 5. Foundation Hardening 全數完成

A（用量護欄）· B（匯入上限+分批）· C（車程 coords bug）· D（靜默空標籤）· **E（記帳入口）** 全部落地。

後續（不在本輪）：**逐筆計費**（把 A 的 `import_resolve` 固定成本改 ×筆數，B 已備好上限）、**反向策展**（`specs/reverse-curation.md`，旗艦，前置 A+B 已就緒）。

---
**狀態：實作完成、驗收未過。等 peanut 確認後才可宣告 Done。**
