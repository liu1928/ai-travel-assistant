<!-- 產生日期: 2026-07-09 | 產生模型: claude-opus-4-8 | 引用 REVIEW.md 時間戳: 2026-07-09 21:1x（Asia/Taipei）| 下次審視: 要顯示 redirect 錯誤 UI 或動 auth 前 -->

# REPORT — 登入錯誤顯示 + popup 失敗 fallback 到 redirect

> 任務來源：peanut 指示（正式站「Google 登入沒反應」根因＝`void signInWithGoogle()` 吞掉錯誤）。計畫見 `task/PLAN.md`。分支 `feat/auth-error-surface`（off main）。
> 依 CLAUDE.md Executor 流程完成：實作 → 自我驗證 → GLM 審查（`task/REVIEW.md`）→ 仲裁 → 本報告。
> **未宣告 Done——等 peanut 驗收。**

## 1. 改了哪些檔案（9 檔）

| 檔案 | 改動 |
|---|---|
| `lib/use-auth.ts` | `signInWithGoogle` 加 **popup→redirect fallback**（popup 被封鎖/環境不支援時自動改整頁 redirect）+ **丟可讀中文錯誤**（`authErrorMessage`），回傳 `"done"\|"redirecting"`；`useAuth` 加 `getRedirectResult` 消化 redirect 回來結果（失敗 console.warn 不吞） |
| `components/google-signin.tsx`（新） | 共用 `<GoogleSignInButton>`：catch 顯示錯誤 + busy 狀態；`"redirecting"` 時保持 busy 不重置 |
| 7 頁（`app/page` `import` `trip` `trips` `trips/[id]` `trips/[id]/expenses` `dna`） | `<button onClick={() => void signInWithGoogle()}>` → `<GoogleSignInButton />`，移除各頁 `signInWithGoogle` import |

**修的事**：先前 7 頁登入鈕都 `void signInWithGoogle()` 把錯誤吞掉（這次 `auth/unauthorized-domain` 就是這樣變成「沒反應」查不到原因）。現在：
- **錯誤看得到**：登入失敗顯示可讀中文（含網域未授權/網路失敗/未啟用）。
- **更耐 popup/COOP**：popup 被封鎖 → 自動 fallback 整頁 redirect。
- **DRY**：7 處重複的吞錯 pattern 收斂成一個共用元件。

## 2. 測試結果
```
pnpm typecheck  → ✓
pnpm test       → ✓ 56 passed（本次無新增測試——純 UI/auth 流程，邏輯已在型別與人工實測層）
pnpm lint       → ✓（註：lint script 只掃 app/lib/schema；components 未納入既有 lint 範圍，但 typecheck 有涵蓋）
```

## 3. GLM finding 統計（詳見 `task/REVIEW.md`）
- 🐛 2：**1 真已修**（redirect 觸發後 `finally setBusy(false)` 會讓按鈕在導頁前閃回、可能被重複點 → 改回傳 `"redirecting"`、元件保持 busy 不重置）、**1 FALSE POSITIVE**（「getRedirectResult 對正常訪客噴 no-auth-event」——核實 Firebase：無 pending redirect 時 resolve `null` 不 reject，故無 console 噪音）
- ⚠️ 3：1 scoped out（redirect 回來的錯誤只 console.warn、未上 UI——PLAN 已列後續，popup 路徑已完整顯示錯誤）、1 既有非本次（5s loading timeout）、1 已被修法涵蓋（跨瀏覽器 redirect Promise 行為）
- ❓ 2：均已釐清

## 4. Known issues / 待實測（部署後）
- **正常 popup 登入**：照舊。
- **popup 被封鎖**（瀏覽器設定擋 popup）→ 應自動 redirect 登入。
- **未授權網域 / 其他錯誤**→ 按鈕下方顯示紅字可讀訊息（不再沒反應）。
- **已知限制**：redirect fallback 回來後若失敗（如仍未授權網域）目前只 `console.warn`、UI 不顯示——要顯示需把 `useAuth` 回傳擴成含 error 再串到各頁，列為後續。實務衝擊低（unauthorized-domain 已修、網路錯為暫時性）。
- `components/` 不在 `pnpm lint` 範圍（既有 script 限制，同 `components/bookings.tsx`）；typecheck 已涵蓋。

## 5. 部署
本 PR 合併進 main 後，App Hosting 會自動 build/deploy（同前）。合併前正式站的登入已可用（authorized domain 已加）；本 PR 是讓**未來任何 auth 問題都看得到 + 更耐 popup 封鎖**。

---
**狀態：實作完成、驗收未過。等 peanut 確認後才可宣告 Done。**
