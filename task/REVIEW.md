# task/REVIEW.md — 登入錯誤顯示 + popup fallback（GLM-5.2 異質審查）

- 時間戳：2026-07-09 21:1x（Asia/Taipei）
- 審查範圍：`lib/use-auth.ts`（signInWithGoogle 加 redirect fallback + 可讀錯誤、useAuth 加 getRedirectResult）、`components/google-signin.tsx`（新）、7 頁登入鈕替換
- Reviewer：MCP `glm-reviewer` `review_code`
- ⚠️ 意見僅為「懷疑」，先原封記錄，再逐條仲裁。

---

## 一、GLM 原始回覆（原封不動）

這份程式碼在錯誤處理與元件抽取的方向上是正確的，解決了過去 `void` 吞掉錯誤的問題。但有幾個與 Firebase Auth 生命週期及 Next.js 行為相關的關鍵細節被忽略了。

### 🐛 問題點
**1. `signInWithRedirect` 觸發後，`finally { setBusy(false) }` 會導致按鈕狀態閃爍與誤導**
當 `signInWithPopup` 失敗並進入 fallback 呼叫 `signInWithRedirect` 時，瀏覽器會「離開當前頁面」導頁。但在離開前，`await signInWithRedirect` 的 Promise 會 resolve，導致 `finally` 被執行、`setBusy(false)` 被觸發，讓使用者在頁面卸載前一刻看到按鈕從「登入中...」跳回「用 Google 登入」，產生 UI 閃爍；若 redirect 延遲/失敗，使用者可能點第二次。

**2. `getRedirectResult` 放在 `useAuth`，會導致未登入者噴出 `auth/no-auth-event` 警告**
未從 redirect 回來的正常造訪者，Firebase 會嘗試解析不存在的 redirect 憑證並 reject（通常 `auth/no-auth-event`），雖被 `.catch()` 吞掉並 `console.warn`，但每個新造訪者都會在 console 留一條警告。

### ⚠️ 風險
1. **`getRedirectResult` 的錯誤未傳遞給 UI**：redirect 回來若因 unauthorized-domain 失敗，只 `console.warn`，畫面什麼都不顯示，違背「顯示可讀錯誤」初衷。
2. **`useAuth` 5 秒 loading timeout 可能畫面不一致**：真的 >5s 初始化時 loading 被強制 false 但 user 仍 null，短暫顯示未登入再跳已登入，閃爍。
3. **`signInWithRedirect` 的 Promise 行為依賴瀏覽器**：有時不 resolve 而直接中斷腳本，`await` 後期待往下走不夠穩健。

### 💡 建議
1. 修正控制流：觸發 redirect 後直接 return，不讓 `finally` 執行 `setBusy(false)`；更嚴謹可拋 `RedirectInProgressError`。
2. `getRedirectResult` 只在需要時呼叫，過濾 `auth/no-auth-event`，真實錯誤透過 state 傳 UI。

### ❓ 待釐清
1. 為什麼把 `getRedirectResult` 放 `useAuth` 而非登入入口？
2. `auth/cancelled-popup-request` 靜默返回是否讓使用者困惑？

---

## 二、仲裁（逐條實際驗證）

### 🐛-1 redirect 後 finally 重置 busy → 閃爍/重複點 → **真（已修）**
- 屬實：`signInWithRedirect` resolve 後 `finally` 會把 busy 關掉，頁面卸載前閃一下。
- 修法：`signInWithGoogle` 回傳 `"done" | "redirecting"`；元件改成「`outcome === "redirecting"` 時 `return`、不執行後面的 `setBusy(false)`」（移除 `finally`，只在 done/error 才重置）。導頁中保持 busy、按鈕停在「登入中…」。

### 🐛-2 getRedirectResult 對正常訪客噴警告 → **FALSE POSITIVE**
- 核實 Firebase 行為：`getRedirectResult(auth)` 對「沒有 pending redirect」的正常造訪**resolve `null`、不 reject**（不會有 `auth/no-auth-event`）。我的 `.catch()` 只在**真的 redirect 失敗**時觸發。故正常訪客**不會**在 console 留警告。前提不成立。

### ⚠️-1 getRedirectResult 錯誤未傳 UI → **已知限制（本輪 scoped out，附理由）**
- 屬實但**已在 PLAN「不在本輪」明列**：本輪只 `console.warn`。理由：(a) popup 路徑（絕大多數使用者）已完整顯示錯誤；(b) redirect 是 fallback，其錯誤要顯示需把 `useAuth` 回傳擴成含 error 再串到 7 頁，屬另一輪；(c) 實務衝擊低——unauthorized-domain 已修好、network 為暫時性。保留 `console.warn`（dev 可見），UI 顯示列後續。

### ⚠️-2 5 秒 loading timeout 閃爍 → **不修（既有程式、非本次引入）**
- `setTimeout(...5000)` 是**改動前就有**的 IndexedDB 封鎖防呆（原碼有註解），本次沒動它。onAuthStateChanged 正常 <5s 觸發、不閃；>5s 是慢速環境的既有取捨。非本輪 scope。

### ⚠️-3 signInWithRedirect Promise 跨瀏覽器行為 → **本次修法已涵蓋**
- 若 redirect 不 resolve（腳本中斷）：`await` 掛住、後面不執行，但頁面正在導頁 → 無害。若 resolve：回 `"redirecting"`、元件 return 保持 busy。兩種情況都正確。無需額外處理。

### 💡-1 控制流修正 → **採納**（見 🐛-1；用回傳值取代拋自訂 error，更簡潔）
### 💡-2 過濾 no-auth-event + 傳 UI → **不採納過濾**（getRedirectResult 正常 resolve null 不 reject，無需過濾）；傳 UI 同 ⚠️-1 列後續

### ❓-1 getRedirectResult 放 useAuth → **已釐清（合理）**
- useAuth 是唯一「每頁都掛、最早執行」的 auth hook，在此呼叫一次即消化 pending redirect（成功由 onAuthStateChanged 接手）。正常訪客 resolve null、無副作用。放這裡最省、單一入口。

### ❓-2 cancelled-popup-request 靜默 → **已釐清（合理）**
- 元件有 `disabled={busy}` 擋連點，理論上不觸發；真發生（race）代表使用者重複點，靜默是對的（不該把「你點太快」當錯誤丟給使用者）。

---

## 三、本輪修正動作
1. `lib/use-auth.ts`：`signInWithGoogle` 回傳 `"done" | "redirecting"`（🐛-1）。
2. `components/google-signin.tsx`：`handleClick` 改成「redirecting → return 保持 busy」、移除 `finally`（🐛-1）。
3. 其餘：🐛-2 FALSE POSITIVE、⚠️-2 既有非本次、⚠️-1/💡-2 UI 顯示 redirect 錯誤 scoped out（已於 PLAN 列），均附理由。

驗證：`pnpm typecheck / test(56) / lint` 全綠。

## 統計
- 🐛 2：1 真已修（busy 閃爍）、1 FALSE POSITIVE（no-auth-event 前提不成立）
- ⚠️ 3：1 scoped out（redirect 錯誤 UI）、1 既有非本次（5s timeout）、1 已被修法涵蓋
- 💡 2：1 採納、1 部分不採納（無需過濾）
- ❓ 2：均已釐清
