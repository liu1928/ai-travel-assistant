# PLAN — Persona Mode（分身模式：Travel DNA 注入生成）

> 任務來源：`specs/persona-mode.md`（升級藍圖第二步，peanut 指定「commit 再分身模式」）。
> 上一輪 PLAN（Foundation A 用量護欄）已 commit 於 `feat/rate-limit-usage-guard`（37d97f66），git 歷史保留，本檔覆寫為本輪。
> 分支：`feat/persona-mode`（stacked on rate-limit）。
> 依 CLAUDE.md Executor 流程：實作 → 自我驗證 → GLM 審查 → REPORT 後停，等 peanut 驗收。

## 本輪範圍（≤3 檔，直接做但記錄步驟）

把 `computeTravelDna(uid)` 的偏好畫像**真正注入行程生成 prompt**（現在從沒進過 → 個人化名不符實），並把 SYSTEM_PROMPT 那段「模擬 V3」的 dead prompt 改寫成真實的「畫像驅動個人化 + 反 DNA 驚喜位」指令。

## 實作前查證結論

1. `buildUserMessage`（lib/anthropic.ts）目前只 push prompt / places / constraints / holidays / flights / carRentals，**完全沒有整體偏好畫像**。
2. `computeTravelDna(uid)` 已存在，回 `Result<TravelDna, DnaError>`，`TravelDna = { totalPlaces, tagCounts: {tag,count,ratio}[]（已排序、count>0）, topTags, summary }`。
3. `import type { TravelDna }` 進 anthropic.ts **無 runtime 循環依賴**（type-only；且 travel-dna 不 import anthropic）。
4. `buildUserMessage` 目前**未 export** → 為單測需 export（純函式好測）。
5. route 已有 `auth.value`（uid），加一段 best-effort DNA 查詢即可（比照 holidays 降級哲學）。

## 步驟

### P-1 `lib/anthropic.ts`
- `import type { TravelDna } from "./travel-dna";`
- `GenerateTripInput` 加 `dna?: TravelDna;`
- 新增 `export const DNA_MIN_PLACES = 5;`（冷啟動門檻）
- `export function buildUserMessage`（改為 export 供測試）
- 在 constraints push 之後、holidays 之前插入「使用者長期旅行偏好畫像」段：
  條件 `input.dna && input.dna.totalPlaces >= DNA_MIN_PLACES && input.dna.tagCounts.length > 0`
  內容：top 4 tag + ratio%、summary、三條個人化指令（為你而選 evidence-linked / 每天 1 個反 DNA 驚喜位）。
- `SYSTEM_PROMPT` 的 V3 區塊（「## 🔵 V3：AI 主動旅行系統（未來能力）」那段「模擬」指示）改寫成「畫像驅動個人化」真實指令，含「為你而選」與「反 DNA 驚喜位」。V1/V2、輸出格式、禁止行為**不動**。

### P-2 `app/api/trip/generate/route.ts`
- `import { computeTravelDna } from "@/lib/travel-dna";`
- 生成前 best-effort：`const dnaResult = await computeTravelDna(auth.value); const dna = dnaResult.ok ? dnaResult.value : undefined;`（失敗不阻擋，比照 holidays/Routes）
- `generateTrip({ ..., dna })`

### P-3 `lib/__tests__/anthropic.test.ts`（新）
- 測 `buildUserMessage`：
  - dna 且 `totalPlaces>=5` 且有 tagCounts → 輸出含「偏好畫像」段與 top tag %。
  - `totalPlaces<5` → 不含畫像段（冷啟動不注入）。
  - 無 dna → 不含（回歸不破）。

## 設計決策（與 spec 一致）
- DNA 是**輸入訊號、不進 tripSchema**（防模型「生成」偏好數字，沿用航班/租車分層）。
- best-effort 降級不阻擋生成。
- 冷啟動 `<5` 不注入（偏好是雜訊）。
- 「反 DNA 驚喜位」防個人化僵化；「為你而選」要求可驗證證據防公式化空話。

## 驗收
```bash
pnpm typecheck && pnpm test && pnpm lint   # 全綠
```
實測：收藏 ≥5 且偏好明顯 → 生成的 description 出現引用收藏 pattern 的理由 + 每天一個破框探索點；收藏 <5 → 行為同現在；computeTravelDna 故意失敗 → 生成仍成功。
完成後：git diff → GLM review_code → REVIEW.md 仲裁 → REPORT.md → commit → 停等 peanut 驗收。

## 不在本輪
- V3 autoPick（模糊 prompt 時自動依 DNA 選 top-k）
- Travel DNA v2（embedding / 地理聚類 / 時間窗）
- prompt caching（固定 system 前綴；DNA 段動態不可快取）
