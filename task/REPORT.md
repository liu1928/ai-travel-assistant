<!-- 產生日期: 2026-07-09 | 產生模型: claude-opus-4-8 | 引用 REVIEW.md 時間戳: 2026-07-09 19:1x（Asia/Taipei）| 下次審視: 調 fit 公式 / 加 AI 理由 / embedding 契合 前 -->

# REPORT — 反向策展（貼靈感，AI 用你的 DNA 過濾）※ 旗艦

> 任務來源：`specs/reverse-curation.md`（升級藍圖旗艦）。計畫見 `task/PLAN.md`。分支 `feat/reverse-curation`（stacked on import-count-cap）。
> 依 CLAUDE.md Executor 流程完成：實作 → 自我驗證 → **GLM 異質審查 + 4 視角對抗驗證 workflow** → 仲裁 → 本報告。
> **未宣告 Done——等 peanut 驗收。**

## 1. 功能
貼一段別人的遊記/IG/清單 → Claude(Haiku) 抽出地點 → 用你的 Travel DNA 給契合度評分（⭐ + 一句理由）→ 預覽勾選 → 確認才收藏。**預覽階段不寫 DB**（人工守門）；命中你零收藏的 tag 標「補盲區」（策展缺口引擎）。

## 2. 改了哪些檔案（8 檔）

| 檔案 | 改動 |
|---|---|
| `lib/inspiration.ts`（新） | 抽地點 `extractAndScore` + 純函式 `scoreFit`（契合度/星等/補盲區/確定性理由）+ `lowConfidence` 名稱比對；DNA fail-fast、`resolveFailed` 回報 |
| `app/api/import/inspiration/route.ts`（新） | 預覽：auth + AI 抽取 $ 費 + 文字長度上限 + error 對映（含 dna_error） |
| `app/api/import/inspiration/confirm/route.ts`（新） | 確認寫入：zod 驗證 + 去重 + 冪等 `addPlace`，不重打 Places/不扣額度 |
| `lib/import-core.ts` | 匯出 `resolveCandidate`（inspiration 複用同套名稱→place_id 解析） |
| `lib/rate-limit.ts` | `checkAndConsumeImports` 加**全域匯入筆數熔斷**（GLM/verify HIGH 修正） |
| `lib/quotas.ts` | `GLOBAL_DAILY_IMPORT_LIMIT`（4000，env 覆寫） |
| `app/import/page.tsx` | 「✨ 貼靈感」section：textarea → 評分清單（⭐/理由/補盲區/請確認徽章）→ 勾選 → 批次收藏 |
| `lib/__tests__/inspiration.test.ts`（新） | `scoreFit` 6 case |

**設計要點**：預覽不寫 DB（守門）；confirm 不重打 Places（省最貴 SKU）；理由用確定性模板不打 AI；只吃純文字不爬網；名稱解析非精確 place_id → lowConfidence 徽章緩解。復用三個現成資產：`computeTravelDna`、`tagPlaces`、`resolveCandidate`。

## 3. 測試結果
```
pnpm typecheck  → ✓
pnpm test       → ✓ 7 files / 56 passed（新增 scoreFit 6 + 匯入雙軸 decide）
pnpm lint       → ✓
```

## 4. 雙重審查與修正（詳見 `task/REVIEW.md`）

跑了**兩個獨立審查**：GLM-5.2（異質模型）+ 4 視角對抗驗證 workflow（security/cost-abuse/correctness/ux-integrity，各讀真實碼，共 14 findings）。

**採納並修正 7 項**：
1. **[HIGH 成本]** Places 解析成本不進 $ 全域熔斷 → 新增**全域匯入筆數熔斷**（不折回 $ 維度以免擋正當大匯入；改用全域筆數軸，與 per-uid 對稱）。
2. **[MED 正確性]** DNA 讀取失敗靜默降級成全 1 星/補盲區 → DNA **移到最前 fail-fast**（`dna_error`），空收藏仍合法。
3. **[MED UX]** 截斷/定位失敗筆數靜默消失 → 回傳 `resolveFailed`、提示移出 else、文案誠實交代去向。
4. **[MED UX]** confirm 出錯丟掉昂貴預覽 → 失敗**保留預覽+勾選**可直接重試。
5. **[low]** gapTags 依 ratio 排序 → 補盲區理由指向最空白方向。
6. **[low]** 補盲區恆低星、預設不勾 → 預設勾選加 `isGapFiller`，賣點被看到。
7. **[low]** done 加「回收藏頁查看 →」CTA。

**不修（附實證）**：confirm 信任前端（spec §7 刻意、**無 uid/owner 欄位→無 IDOR**、只影響自己收藏）、prompt injection（structured output + 固定 sink + reason 不打 AI → 無實質危害，FALSE POSITIVE 級）、mapLimit 索引錯位（`results[i]=await fn(items[i])` 保證對齊，FALSE POSITIVE）、被限流仍扣 $（對應真跑過的抽取、Places 排在 gate 後）、confirm 全量 listPlaces（冪等、讀便宜）、預覽 $ 低估 2 次 Haiku（個位數 token）、normalizeName 全形（lowConfidence 只是柔性提醒）。

## 5. Known issues / 待實測

- 實測：貼含 5–8 地點的遊記 → 預覽評分與 DNA 一致、不寫 DB；勾選收藏 → 收藏頁出現；已收藏 skipped；命中零收藏 tag → 補盲區徽章 + 預設勾選；超長 → 略過提示；定位失敗 → 交代筆數；confirm 送非法 tag → 400；confirm 網路錯 → 預覽保留可重試。
- **契合度公式是啟發式**（`0.7*max+0.3*breadth ×2.2`），需真實資料校準；理由用確定性模板（AI 自然理由、embedding 語意契合屬後續）。
- **名稱解析非精確 place_id**（既有限制）→ lowConfidence 徽章緩解，非根治。
- **全域匯入熔斷 4000/日** 是暫定，可用 `QUOTA_GLOBAL_DAILY_IMPORTS` env 調。

## 6. 升級藍圖至此全數補完
Foundation A/B/C/D/E · 分身模式 · 逐筆計費（匯入筆數雙軸）· **反向策展**。三份 spec 全部落地。

---
**狀態：實作完成、驗收未過。等 peanut 確認後才可宣告 Done。**
