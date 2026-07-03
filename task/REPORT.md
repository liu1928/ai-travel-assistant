# REPORT — 航班與租車資訊

> ⚠️ 這份報告是**事後補寫**：實作/commit/deploy 都在 CLAUDE.md 的 Executor 流程正式套用前
> 就做完了，這次是照 peanut 要求「補跑」步驟 4（Gemini review）並依 CLAUDE.md 補齊
> PLAN/REVIEW/REPORT/MEMORY 這一整套文件。

## 改了哪些檔案

Commit `2d6d0071`（已 push 到 GitHub、已用 `firebase deploy --only apphosting:my-web-app`
部署到正式站，revision `my-web-app-build-2026-07-03-004`）：

```
 app/api/trip/generate/route.ts |  31 +++-
 app/api/trips/[id]/route.ts    |   4 +-
 app/api/trips/route.ts         |   4 +-
 app/trip/page.tsx              |  30 ++++
 app/trips/[id]/page.tsx        | 100 +++++++++++++
 components/bookings.tsx        | 314 +++++++++++++++++++++++++++++++++++++++++ (新增)
 lib/anthropic.ts               |  33 ++++-
 lib/trips.ts                   |  13 +-
 schema/__tests__/trip.test.ts  |  84 ++++++++++-
 schema/trip.ts                 |  37 +++++
 specs/flights-rentals.md       | 208 +++++++++++++++++++++++++++ (新增)
 11 files changed, 845 insertions(+), 13 deletions(-)
```

摘要：
- `schema/trip.ts`：新增 `flightSchema`／`carRentalSchema`／`tripWithBookingsSchema`；
  `tripSchema`（AI 結構化輸出用）完全不動。
- `lib/anthropic.ts`：`GenerateTripInput` 加 `flights`/`carRentals`；`buildUserMessage`
  加兩段硬約束文字（落地 buffer、起飛 buffer、取還車排時間軸）。
- `lib/trips.ts` + 兩個 `app/api/trips*` route：驗證改用 `tripWithBookingsSchema`，
  舊 Firestore 文件靠 `.default([])` 補空陣列，無需遷移。
- `app/api/trip/generate/route.ts`：航班/租車先過 zod，格式錯回 400（不 best-effort 吞掉）；
  回傳時把使用者輸入的訂位資料附掛到 trip 物件上。
- `components/bookings.tsx`（新增）：顯示卡 + 動態清單編輯器 + 草稿驗證，`/trip`
  與 `/trips/[id]` 共用。
- `app/trip/page.tsx`、`app/trips/[id]/page.tsx`：接上表單/顯示/獨立編輯（PATCH，
  不重新生成）。
- `specs/flights-rentals.md`（新增）：本功能的完整 spec。

## 測試結果

```
pnpm typecheck   → 通過（tsc --noEmit 無輸出）
pnpm test        → 16 個測試全過（原本 5 個 + 本次新增 11 個，含 tripSchema 不含
                    flights/carRentals 的守護測試）
pnpm lint        → 通過（eslint 無輸出）
pnpm build       → 通過（next build 成功，17 條路由全部產出）
```

以上四項在 commit 當下跑過一次，這次補跑流程時又重跑一次確認仍然全綠（見對話紀錄
2026-07-03 17:37 那次重跑）。

**spec §5 的 7 條手動測試案例尚未由 peanut 實際操作驗證過**（例如「填航班 10:00 起飛 →
第一天從 ~14:00 開始排」這條）——這是自動化驗證覆蓋不到的部分，需要 peanut 自己在
正式站或本機 `pnpm dev` 跑一次確認。

## Gemini review 狀態：**已完成**（第 5 次嘗試，改走 REST API）

前 4 次用 gemini CLI 全部卡死，root cause 後來證實是 **API key 專案預付額度用完**
（`429 RESOURCE_EXHAUSTED`），CLI 收到 429 靜默無限重試看起來像卡死。peanut 換 key 後
改用直接呼叫 Gemini REST API 一次成功。可重複使用的腳本已存到
`scripts/gemini-review.mjs`（之後步驟 4 用它，別再用 CLI）。完整嘗試紀錄與逐條仲裁
見 `task/REVIEW.md`。

**Finding 統計：8 條（P0×0、P1×4、P2×4）→ 仲裁後 0 真、4 假/降級、4 條 P2 記錄不修**
- P1-3（isFlightEmpty 誤丟資料）：**明確誤讀**，寫了重現腳本實測推翻（`every` 語意）
- P1-1、P1-2（錯誤訊息不夠細）：降級 P2——是 spec 明訂的 API 契約與既有風格，前端已先驗證
- P1-4（淺層合併覆蓋並行編輯）：目前 UI 走過所有路徑無此問題；多分頁情境屬 SPEC §2.4
  「整筆覆蓋」語意的已知取捨
- P2×4：全部記錄不修（controlled input 下 key={i} 資料無虞、unknown+zod 是正確用法、
  風格一致性、主觀 UX）

**無程式碼變更** → 不需回到步驟 3 重跑驗證迴圈（沒有新 diff）。

## Known issues / 需要 peanut 決定的事

1. **CLAUDE.md 步驟 4 的指令建議更新**：原本寫的 `gemini -p "..." < task/diff.patch` 在這個
   環境實測會因 CLI 靜默重試行為而不可靠，這次已改用 `scripts/gemini-review.mjs`（REST 直呼）
   成功跑完。要不要把 CLAUDE.md 步驟 4 的指令改成
   `GEMINI_API_KEY=<key> node scripts/gemini-review.mjs > task/REVIEW.md`，由 peanut 決定
   （CLAUDE.md 是不能擅自改的檔案）。另外 GEMINI_API_KEY 建議放進 `.env.local` 之類的
   gitignored 檔案管理，不要每次貼在對話裡。
2. **`task/SPEC.md` 路徑跟 CLAUDE.md 前置檢查的假設不完全一致**：CLAUDE.md 假設每個任務
   都能在 `task/SPEC.md` 找到 SPEC，但本專案的實際慣例是把功能性 spec 放在
   `specs/*.md`（`holidays.md`、`split-bill.md`、`flights-rentals.md`），`task/SPEC.md`
   專屬於「行程生成」主功能。這次任務用 `specs/flights-rentals.md` 當作 SPEC 來源。
   要不要統一 CLAUDE.md 的措辭（例如改成「確認任務對應的 spec 檔案存在，可能在
   `task/SPEC.md` 或 `specs/*.md`」）由 peanut 決定。
3. **流程順序的偏差**：這次任務原本是在 CLAUDE.md 生效前用一般模式做完並直接
   commit/push/deploy 的，事後才補跑 Gemini review 這一步。正常情況下 CLAUDE.md
   規則 2「超過 3 個檔案的改動 → 先在 task/PLAN.md 條列計畫，請 peanut 確認再動手」
   應該要在動手前就先給 peanut 看計畫——這次是先做完才補寫 PLAN.md，如實記錄，
   往後照 CLAUDE.md 走的任務不會有這個問題。
4. spec §5 的手動測試案例還沒有人實際跑過（見上）。

## 結論

CLAUDE.md 流程的補跑已走完：自動化驗證全綠、Gemini review 完成且逐條仲裁
（0 條真 P0/P1，無需改碼）、PLAN/REVIEW/REPORT/MEMORY 四份文件齊備。
仍待 peanut 的事：(a) spec §5 手動測試案例還沒人實際跑過；(b) 上方 Known issues
1、2 兩個 CLAUDE.md 修訂決定；(c) task/*.md 與 scripts/gemini-review.mjs 要不要
commit（peanut 說稍等）。**照 CLAUDE.md 規則，只有 peanut 可以宣布任務結束——
在此停止並等待驗收。**
