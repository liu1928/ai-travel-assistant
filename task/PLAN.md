# PLAN — 登入錯誤顯示 + popup 失敗 fallback 到 redirect

> 任務來源：peanut 指示（正式站踩到「Google 登入沒反應」根因＝首頁 `void signInWithGoogle()` 吞掉錯誤；
> 剛用「加 authorized domain」解了當下的 unauthorized-domain，本輪把「未來任何 auth 錯誤都看得到 + 更耐 popup/COOP」補起來）。
> 上一輪 PLAN（反向策展）已 commit，git 歷史保留，本檔覆寫。分支 `feat/auth-error-surface`（off main）。

## 問題
- `signInWithGoogle()` = `await signInWithPopup(...)`，失敗直接丟例外。
- 7 個頁面的登入鈕都是 `onClick={() => void signInWithGoogle()}` → **錯誤被 `void` 吞掉**，使用者看到「沒反應」也查不到原因（這次 `auth/unauthorized-domain` 就是這樣被埋掉）。
- popup 在被封鎖 / COOP 情境下會失敗，沒有 fallback。

## 做法

### 1. `lib/use-auth.ts`
- `signInWithGoogle()` 改為：
  - `try signInWithPopup`；
  - **popup 被封鎖/環境不支援**（`auth/popup-blocked`、`operation-not-supported-in-this-environment`、`web-storage-unsupported`）→ **fallback `signInWithRedirect`**（整頁導頁）。
  - **使用者關掉/重複點**（`popup-closed-by-user`、`cancelled-popup-request`、`user-cancelled`）→ 視為取消，不當錯誤（return）。
  - 其餘（`unauthorized-domain`/`network-request-failed`/…）→ **throw 可讀中文訊息**（`authErrorMessage(code)`）讓 UI 顯示。
- `useAuth()` effect 加 `getRedirectResult(auth).catch(console.warn)`：消化 redirect 回來的結果（成功由 `onAuthStateChanged` 接手），失敗記 log 不吞。

### 2. `components/google-signin.tsx`（新）
- `<GoogleSignInButton />`：內含 busy/error state，`await signInWithGoogle()` → catch 顯示紅字錯誤。沿用既有 teal 按鈕樣式（視覺不變），錯誤 `<p>` 顯示在按鈕下方。

### 3. 7 個頁面替換登入鈕
`app/page.tsx`（SignIn）、`app/import`、`app/trip`、`app/trips`、`app/trips/[id]`、`app/trips/[id]/expenses`、`app/dna`：
- 把 `<button onClick={() => void signInWithGoogle()}>用 Google 登入</button>` 換成 `<GoogleSignInButton />`。
- 各檔 import：移除已不用的 `signInWithGoogle`，加 `GoogleSignInButton`（`app/page.tsx` 保留 `signOutUser`）。

## 設計決策
- 只對「popup 環境問題」fallback redirect，不對所有錯誤 fallback（避免 unauthorized-domain 這種終端錯誤還去 redirect 又失敗、或非預期導頁）；終端錯誤改用「顯示可讀訊息」讓使用者/開發者看得到。
- 共用元件消除 7 處重複的吞錯 pattern（DRY）。
- 視覺不變（同 class）；只多了錯誤訊息與 busy 狀態。

## 驗收
```bash
pnpm typecheck && pnpm test && pnpm lint
```
實測（部署後）：正常 popup 登入照舊；擋 popup（瀏覽器封鎖）→ 自動 redirect 登入；未授權網域 → 畫面顯示「網域未授權」而非沒反應。
完成後：git diff → GLM review → REVIEW.md 仲裁 → REPORT.md → commit → push → PR。

## 不在本輪
- getRedirectResult 錯誤的 UI 顯示（本輪只 console.warn）。
