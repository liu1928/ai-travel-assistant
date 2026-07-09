# PLAN — 反向策展（貼靈感，AI 用你的 DNA 過濾）※ 旗艦

> 任務來源：`specs/reverse-curation.md`（升級藍圖旗艦，peanut：「把剩下的藍圖都補完」）。
> 上一輪 PLAN（逐筆計費）已 commit 於 `feat/import-count-cap`（140f85a7），git 歷史保留，本檔覆寫。
> 分支：`feat/reverse-curation`（stacked on import-count-cap）。前置 A（用量護欄）+ B（匯入上限）+ 匯入筆數維度皆已就緒。

## 功能
貼一段別人的遊記/IG/清單 → Claude 抽出地點 → 用你的 Travel DNA 給契合度評分 + 一句理由 → 勾選高契合一鍵批次收藏。**預覽階段不寫 DB，人工勾選才收藏。**

## 步驟

### 1. `lib/import-core.ts`
- 把私有 `resolve` 匯出為 `resolveCandidate`（供 inspiration 複用同一套名稱→place_id 解析）；`importCandidates` 內部呼叫同步改名。不改既有行為。

### 2. `lib/inspiration.ts`（新，伺服器端）
- `extractSchema = { places: [{ name, context? }] }`（zodOutputFormat，Haiku 抽取）。
- **純函式 `scoreFit(tags, ratios): FitResult`**（可單測）：`{ fitScore 0-100, fitStars 1-5, isGapFiller, reason }`。契合度 = 候選 tag 與 DNA ratio 的加權重疊（`0.7*maxRatio + 0.3*min(1,sumRatio)`，×SCALE 常數，可調）；`isGapFiller` = 命中你低/零收藏 tag 且 fit 不高 → reason 改「補盲區」。理由**確定性模板**（不再多打一次 AI，省成本）。
- `extractAndScore(uid, text): Result<{items: ScoredCandidate[], truncated}, InspirationError>`：抽取 → cap `EXTRACT_CAP`(20) → `checkAndConsumeImports(uid, n)`（超過回 rate_limited）→ `resolveCandidate` 併發解析（mapLimit 5，null 濾除）→ `tagPlaces` 標籤 → `computeTravelDna` 算 ratios → 逐筆 `scoreFit` → `lowConfidence` = 解析名與抽取名不相符（名稱 Text Search 無 bias，提醒人工確認）。

### 3. `app/api/import/inspiration/route.ts`（預覽，不寫 DB）
- auth → `checkAndConsume(uid, "tagging_batch")`（AI 抽取的 $ 費）→ body `{ text }`（trim 空→400、>8000 字→400）→ `extractAndScore` → 200 `{ items, truncated }`；rate_limited → 429；抽取/解析失敗 → 502。

### 4. `app/api/import/inspiration/confirm/route.ts`（寫入勾選）
- auth → body `{ places: PlaceSearchResult[], tags: Record<placeId, PlaceTag[]> }`（zod 驗證擋偽造）→ 對照既有收藏去重（skipped）→ `addPlace` 冪等寫入 → 200 `{ summary: {success, skipped, failed} }`。**不重打 Places/標籤**（預覽已解析）→ 不扣 importCount。

### 5. `app/import/page.tsx`
- 新增「✨ 貼靈感」section：textarea + 分析 → 顯示評分清單（名/地址/tags/⭐/理由 + 補盲區徽章 + 低信心提示）+ 勾選（預設勾 ≥4★）+ 批次收藏 → summary；處理 truncated / rateLimited。

### 6. 測試 `lib/__tests__/inspiration.test.ts`
- `scoreFit`：高契合（強 tag）高分高星、零匹配低分、gapFiller 判定與理由、空 tags、星等分桶邊界。

## 設計決策（與 spec 一致）
- 預覽不寫 DB，人工勾選才收藏（自由文字抽地點必有誤抽/同名綁錯，守門必要）。
- confirm 不重打 Places/標籤（省最貴 SKU）；zod 驗證擋前端竄改的非法值。
- 契合度守門升級為「策展缺口」引擎（命中 DNA 空白 tag → 主動點出補盲區）。
- 硬前置用量護欄：抽取 $ 費 + 解析 importCount 雙保險（EXTRACT_CAP 再收斂）。
- 只吃純文字、不爬網（沿用 sharelink 瘦身 + SSRF 教訓）；理由用確定性模板不再打 AI。
- 名稱解析非精確 place_id（既有限制）→ lowConfidence 徽章 + 顯示地址緩解。

## 驗收
```bash
pnpm typecheck && pnpm test && pnpm lint
```
實測：貼含 5-8 個地點的遊記 → 預覽評分與 DNA 一致、不寫 DB；勾選收藏 → 收藏頁出現；已收藏的 skipped；命中零收藏 tag → 補盲區徽章；超長 → truncated；confirm 送非法 tag → 400。
完成後：git diff → GLM review → **多視角 verify workflow**（SSRF/injection、成本/濫用、正確性、UX 四鏡）→ REVIEW.md 仲裁 → REPORT.md → commit → push → PR。

## 不在本輪
- AI 生成的自然理由（本輪用確定性模板）、embedding 語意契合、圖片多模態入口。
