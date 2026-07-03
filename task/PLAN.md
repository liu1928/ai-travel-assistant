# PLAN — 航班與租車資訊（補記）

> ⚠️ 本檔案為**事後補記**：這個任務在 CLAUDE.md 的 Executor 流程正式生效前就已經做完並 commit/deploy
> （commit `2d6d0071`），使用者事後要求「補跑」Gemini review 這一步並嚴格照 CLAUDE.md 走。
> 照規則 2「超過 3 個檔案的改動 → 先在 task/PLAN.md 條列計畫，請 peanut 確認再動手」，
> 這次改了 11 個檔案，但因為是舊流程下做的，**沒有事先請 peanut 確認計畫**——這是一個已知的流程偏差，
> 誠實記在這裡，不是要假裝當初有照走。

## SPEC 來源

本任務的 SPEC 是 `specs/flights-rentals.md`（不是 `task/SPEC.md`——後者是「行程生成」主功能的
單一事實來源，跟本次任務範圍不同）。這是 CLAUDE.md 前置檢查步驟 1「確認 task/SPEC.md 存在」
跟本專案既有的 `specs/*.md` 慣例（holidays.md、split-bill.md）之間的路徑不一致，本次先照實際情況
用 `specs/flights-rentals.md` 當 SPEC，事後在 REPORT.md 裡提醒 peanut 這個落差要不要統一。

## 目的（照 specs/flights-rentals.md §1）

使用者手動輸入已訂好的航班/租車資訊，綁在行程上；生成時當硬約束餵給 AI（落地後才開始排、
起飛前留 buffer、取還車排入時間軸）；資訊隨行程儲存、顯示、可事後編輯（不重新生成）。

## 步驟（實際執行順序）

1. `schema/trip.ts`：新增 `flightSchema`／`carRentalSchema`／`tripWithBookingsSchema`；
   `tripSchema`（AI 結構化輸出用）不動——這是本任務最重要的一條約束（§3）。
2. `schema/__tests__/trip.test.ts`：補測試，含一條守護測試斷言 `tripSchema.shape` 不含
   `flights`/`carRentals`。
3. `lib/anthropic.ts`：`GenerateTripInput` 加欄位；`buildUserMessage` 加航班/租車兩段組裝
   （硬約束文字）。
4. `lib/trips.ts` + `app/api/trips/route.ts` + `app/api/trips/[id]/route.ts`：驗證 schema
   換成 `tripWithBookingsSchema`；舊 Firestore 文件靠 `.default([])` 補空陣列，不做遷移。
5. `app/api/trip/generate/route.ts`：航班/租車進來先過 zod（格式錯 400，不 best-effort 吞掉，
   跟假日/車程那種衍生資料的哲學刻意不同）；生成結果附掛使用者輸入的訂位資料回傳。
6. 新增 `components/bookings.tsx`：顯示卡 + 動態清單編輯器 + 草稿驗證，`/trip` 與
   `/trips/[id]` 共用。
7. `app/trip/page.tsx`：表單加可收合航班/租車區塊；結果區顯示卡片。
8. `app/trips/[id]/page.tsx`：顯示卡片 + 獨立編輯模式（PATCH，不重新生成）。

## 不能碰的清單

- `tripSchema` 本體（AI 輸出 schema）——見上方。
- 已存的 `task/SPEC.md`（行程生成主 spec）——本次任務範圍不含它，沒有動它。

## 驗收條件（照 §5）

`pnpm typecheck && pnpm test && pnpm lint` 全綠 + spec §5 列的 7 條手動測試案例。
