<!-- 產生日期: 2026-07-09 | 產生模型: claude-opus-4-8 | 引用 REVIEW.md 時間戳: 2026-07-09 17:5x（Asia/Taipei）| 下次審視: 做 V3 autoPick / Travel DNA v2 或調 prompt 前 -->

# REPORT — Persona Mode（分身模式：Travel DNA 注入生成）

> 任務來源：`specs/persona-mode.md`（升級藍圖第二步）。計畫見 `task/PLAN.md`。分支 `feat/persona-mode`（stacked on rate-limit）。
> 依 CLAUDE.md Executor 流程完成：實作 → 自我驗證 → GLM 審查（`task/REVIEW.md`）→ 仲裁 → 本報告。
> **未宣告 Done——等 peanut 驗收。**

## 1. 改了哪些檔案（3 檔）

| 檔案 | 改動 |
|---|---|
| `lib/anthropic.ts` | `GenerateTripInput` 加 `dna?: TravelDna`（type-only import，無循環依賴）；`export const DNA_MIN_PLACES = 5`；`buildUserMessage` 改 export + 插入「使用者長期旅行偏好畫像」段（top4 tag% + summary + 個人化指令）；`SYSTEM_PROMPT` 的 V3「模擬」dead prompt 改寫成「畫像驅動 + 為你而選 + 反 DNA 驚喜位」；`max_tokens` 4096→8192 |
| `app/api/trip/generate/route.ts` | best-effort `computeTravelDna(auth.value)` 傳入 `generateTrip`；失敗 `console.warn` 降級不阻擋 |
| `lib/__tests__/anthropic.test.ts`（新） | `buildUserMessage` DNA 注入 5 case（門檻 >=/< 邊界、無 dna、空 tagCounts） |

**核心**：Travel DNA 從此真正進入生成 prompt（先前從沒進過，個人化名不符實）。DNA 是**輸入訊號、不進 tripSchema**（沿用航班/租車防編造分層）。冷啟動（收藏 <5）不注入避免對雜訊過擬合。best-effort 降級。這也是 ROADMAP 說的「V3 主動推薦第一步」的落地。

## 2. 測試結果

```
pnpm typecheck  → ✓
pnpm test       → ✓ 4 files / 37 passed（新增 anthropic DNA 注入 5 case）
pnpm lint       → ✓
```

## 3. GLM finding 統計（詳見 `task/REVIEW.md`）

- 🐛 0
- ⚠️ 3：**2 真已修**（① `Math.round` 可印「0%」→ `Math.max(1, …)`；② 分身增加輸出量、長天數行程恐被 4096 截斷 → `max_tokens` 提到 8192）、1 不採納（冷啟動門檻刻意留在純函式 `buildUserMessage`，correct-by-construction、直接單測，附理由）
- 💡 2：均不採納（引號 label 助清晰、成本個位數 token；附理由）
- ❓ 2：**1 真已修**（DNA 失敗加 `console.warn` 觀測）、**1 FALSE POSITIVE**（追 `travel-dna.ts` 的 `buildSummary` 證實 summary/tags 全來自固定 `placeTag` enum、零使用者自由文字，無 prompt injection 向量；使用者可控的 note/group 根本不進 DNA）

## 4. Known issues / 待實測

- **個人化品質需人工實測**：收藏 ≥5 且偏好明顯 → 生成的 description 應出現引用收藏 pattern 的「為你而選」理由 + 每天一個明說「破框」的探索點；收藏 <5 → 行為同現在；`computeTravelDna` 失敗 → 生成仍成功（dev server 會看到 `[trip/generate] DNA 降級`）。品質仍壓在 prompt 上、**尚無 eval 基準**（屬 Foundation 後續的 eval harness）。
- **max_tokens 上調的成本**：8192 只是「上限」，實際計費按真實輸出；一般短行程不會用滿。長行程更不易被截斷。
- **偏好過擬合**：靠「反 DNA 驚喜位」緩解，非根治，需人工觀感調校。

## 5. 後續（不在本輪）

- **V3 autoPick**：模糊 prompt / 不勾地點時，自動從收藏依 DNA 選 top-k 餵生成（另開 spec）。
- **Travel DNA v2**：embedding 語意群聚 / 地理聚類 / 近期vs歷史時間窗（`specs/reverse-curation.md` 與 survey 已鋪路）。
- **行程 eval harness**：讓「個人化前後」有量化回歸（Foundation 後續）。
- 藍圖其餘：Foundation B/C/D/E、反向策展。

---
**狀態：實作完成、驗收未過。等 peanut 確認後才可宣告 Done。**
