# task/REVIEW.md — GLM-5.2 異質審查

- 時間戳：2026-07-09 17:3x（Asia/Taipei）
- 審查範圍：Foundation Hardening 項目 A（每日用量護欄）本次 diff
  - 新增 `lib/quotas.ts`、`lib/rate-limit.ts`、`lib/__tests__/rate-limit.test.ts`、`firestore.rules`
  - 8 個付費 route 插入 gate、`firebase.json` 掛 firestore、`.env.example` 加 quota 變數
- Reviewer：MCP `glm-reviewer` `review_code`，focus=`security`
- ⚠️ Reviewer 意見僅為「懷疑」，以下先原封記錄，再逐條仲裁（實際驗證後才算數）。

---

## 一、GLM 原始回覆（原封不動）

這份程式碼在「單人低併發」與「fail-open 刻意決策」的前提下，邏輯大致正確，但以 security 角度審視，存在幾個嚴重的防護盲點與設計瑕疵。

### 🐛 問題點

**1. `decide` 函式未防範負數成本，導致限流繞過**
`checkAndConsume` 的 `cost` 參數預設值來自 `SERVICE_COST_USD[service]`，但函式簽名允許傳入任意 `cost`。如果呼叫端傳入負數（例如 `checkAndConsume(uid, "places_search", -1)`），`decide` 函式中的 `userCost + cost` 與 `globalCost + cost` 會被扣減。攻擊者若找到能傳入負數的路徑，或者未來開發新功能時不慎傳入，將使 `estCostUsd` 歸零甚至變成負數，徹底繞過每日預算限制。
`decide` 必須加入防禦：`if (cost <= 0) return "circuit_open";` 或在 `checkAndConsume` 起點就 `return err`。

**2. `numEnv` 解析邏輯瑕疵，導致小數預算失效**
`Number(envOr(key, String(def)))` 在 `def` 為小數（如 `0.5`）時，`String(0.5)` 是 `"0.5"`，這沒問題。但若未來有人傳入科學記號或開發者在本機設定 `QUOTA_USER_DAILY_USD=0.5.5`，`Number` 會解析出 `NaN`，此時 `Number.isFinite(n)` 會是 false，這算正確防呆。但真正的問題在於：如果環境變數設為 `0`，`n > 0` 為 false，會退回 `def`。這在 fail-open 語境下是危險的——如果維運人員想「暫時關閉付費 API」而設定 `QUOTA_GLOBAL_DAILY_USD=0`，系統會默默退回預設的 10 美元繼續放行，而不是熔斷。

### ⚠️ 風險

**1. Firestore Transaction 無法保證強一致性，存在超支風險**
Firestore 的 `runTransaction` 會在文件衝突時重試。但在 `maxInstances: 2` 的環境下，若兩個請求同時讀取到 `globalCost = 9.98`，且 `cost = 0.02`，兩者都會判斷 `9.98 + 0.02 <= 10` 並嘗試寫入。Firestore 會偵測到衝突並重試其中一個，重試時會重新讀取到 `10.00`，此時 `10.00 + 0.02 > 10` 會正確觸發 `circuit_open`。**這部分邏輯是正確的**。
但真正的風險在於：如果未來專案升級或放寬 `maxInstances`，Firestore Transaction 的樂觀鎖在高併發下會導致大量重試，最終可能因為重試次數耗盡而拋出例外。由於你的 `catch` 是 fail-open，這會導致所有請求在高峰期免費放行。

**2. `retryAfterSec` 與 HTTP Header 的 Timezone 漂移風險**
`secondsToTaipeiMidnight` 使用 `now + 8 * 3600_000` 計算，這在伺服器端是對的。但 `Retry-After` HTTP Header 的語意是「客戶端應該在 N 秒後重試」。如果客戶端（如手機 App）的系統時區不是 UTC+8，它收到 `Retry-After: 3600` 後，當地時間可能還沒到午夜，重試依然會被擋下。這不是 security 漏洞，但會導致客戶端無謂重試，增加伺服器負擔。

**3. 缺少對 `uid` 的格式驗證**
`checkAndConsume(uid: string, ...)` 直接將 `uid` 拼接進 Firestore Document ID：`${uid}__${date}`。雖然 `uid` 來自 `requireUid`，但如果 Auth SDK 驗證邏輯未來被改動，或 `uid` 包含 `/` 或特殊字元，可能會導致 Firestore Document Path 解析異常。應在函式入口斷言 `uid` 不包含 `__` 與路徑保留字。

### 💡 建議

**1. 確保 `cost` 不可被外部覆蓋**
既然 `SERVICE_COST_USD` 是固定的 `as const` 表，`checkAndConsume` 的 `cost` 參數應該移除，直接在函式內部讀取 `SERVICE_COST_USD[service]`。這可以完全消除人為傳錯或被惡意傳入負數的風險。

**2. `firestore.rules` 的縱深防禦可以更嚴格**
`usage/**` 與 `users/{uid}/**` 皆 `allow read, write: if false` 是好的。但建議明確禁止 `list` 操作：
```
match /usage/{doc} {
  allow read, write, list: if false;
}
```
雖然 Admin SDK 不受 rules 限制，但若未來有其他 client SDK 誤用，`list` 可能會洩漏所有使用者的每日用量統計。

### ❓ 待釐清問題

1. **`requireUid` 是否依賴 Firebase Auth Session Token？** 如果是，外洩的 Bearer Token 在過期前依然可以瘋狂打 API。本功能只是「延緩」帳單失控，無法「阻止」。這是否符合專案預期？
2. **為何 `checkAndConsume` 要將 `cost` 設為可選參數？** 這是否預留了未來讓某些 API 呼叫端「自定義成本」的需求？如果有，這會是個安全破口，因為呼叫端可以傳 `0` 來規避限流。
3. **`firestore.rules` 是否有針對 `usage` 集合的文件 ID 格式做驗證？** 例如限制只能是 `*__*` 格式，防止未來其他 Admin SDK 邏輯誤寫入非預期格式的文件？

---

## 二、仲裁（逐條實際驗證）

### 🐛-1 負數 cost 繞過限流 → **真（P1，已修）**
- 驗證：`cost` 是可選參數（item B 逐筆計費會用到，不移除），現有 8 個呼叫端都用預設值。但傳負數確實會讓 `decide` 的 `userCost + cost` 變小，甚至把 Firestore 計數往下扣，繞過限流。雖然 `cost` 全由伺服器端程式決定（非攻擊者可控），但這是真實防禦缺口，且未來 item B 傳入 `單價 × 筆數` 時若筆數算錯可能為負。
- 處置：**在 `checkAndConsume` 起點 clamp `const spend = Math.max(0, cost)`**（保留參數供 item B，同時杜絕負數；`0` 合法代表「本次無付費工作」，放行且不扣款）。新增 `decide` 對 `cost=0` 的回歸測試。

### 🐛-2 `QUOTA=0` 退回預設而非熔斷 → **P2（不修，設計取捨 + 文件化替代法）**
- 驗證屬實：`n > 0` 會讓 `0` 退回預設。但這是**刻意**的：`0`／負數視為無效設定 → 退回安全預設，避免一個 typo（`QUOTA=0`）就把全站付費功能打死。
- 「緊急關閉付費 API」有更安全做法：設極小正值（如 `QUOTA_GLOBAL_DAILY_USD=0.001`），第一次呼叫成本 `0.02 > 0.001` 即 `circuit_open` 熔斷。**已於 REPORT/PLAN 記錄此 kill-switch 用法**，不改 `numEnv` 語意。

### ⚠️-1 Transaction 一致性 → **FALSE POSITIVE（現況正確；未來已記錄）**
- Reviewer 自己確認「這部分邏輯是正確的」。`runTransaction` 樂觀鎖在 `maxInstances:2` 下正確。所述為「未來放大實例數」的假設情境，`specs/foundation-hardening.md §11` 已記錄「未來放大實例數需重估」。**現況非 bug，不修。**

### ⚠️-2 `Retry-After` 時區漂移 → **FALSE POSITIVE**
- `Retry-After: <秒數>`（delta-seconds 形式）語意就是「從現在起等 N 秒」，**與客戶端時區無關**。`secondsToTaipeiMidnight` 回的正是「距配額重置（台北午夜 = `taipeiDate` 跨日）還有幾秒」，兩者精準對齊。客戶端等滿該秒數，配額桶就換日。Reviewer 把 delta-seconds 誤解為「重試於某牆鐘時刻」。**不修。**

### ⚠️-3 / ❓-3 `uid` 格式驗證 / doc ID 碰撞 → **P2（不修）**
- `uid` 來自 Firebase `verifyIdToken`，Firebase 簽發（非使用者可選），[A-Za-z0-9] 短字串、不含 `/`，可安全當 doc ID。`${uid}__${date}` 與 `__global__${date}` 不會碰撞（要碰撞需 uid 恰為 `_global_` 之類，Firebase 不會發）。非攻擊者可控、無可利用性，防禦性斷言價值低。**不修。**

### 💡-1 移除 `cost` 參數 → **部分採納（用 clamp 取代移除）**
- 不移除（item B 逐筆計費需要），改用 🐛-1 的 `Math.max(0, cost)` clamp 達同等防護。

### 💡-2 rules 明確 deny `list` → **FALSE POSITIVE（已被 read 涵蓋）**
- Firestore rules 的 `read` = `get` + `list`。`allow read: if false` **已經**擋掉 `list`。`allow read, write, list` 多餘（`list` 是 `read` 的子操作，非獨立 top-level）。現有 `allow read, write: if false` 已達 reviewer 想要的效果。**不修。**

### ❓-1 外洩 token 仍可打到過期 → **設計符合預期（已釐清）**
- 對，token 過期前仍可打，但**每日用量護欄把單一 uid 的傷害上限鎖在 `USER_DAILY_BUDGET_USD`／天**，全域熔斷再鎖總量——是「封頂」不只「延緩」。token 撤銷/輪替是另一層（不在本 spec）。符合「防帳單失控」目標。

### ❓-2 `cost` 為何可選 → **已釐清**
- 為 item B 的「import cost = 單價 × 筆數」預留。配合 🐛-1 clamp，`0` 合法（無付費工作）、負數夾成 `0`，呼叫端皆伺服器端不可由使用者控制，無破口。

---

## 三、本輪修正動作

1. `lib/rate-limit.ts`：`checkAndConsume` 起點加 `const spend = Math.max(0, cost)`，後續 `decide` 與 `FieldValue.increment` 一律用 `spend`（🐛-1）。
2. `lib/__tests__/rate-limit.test.ts`：加 `decide` 對 `cost=0`（放行不扣）的回歸測試（🐛-1 佐證）。
3. 其餘 findings 依上述仲裁：3 條 FALSE POSITIVE、3 條 P2 不修（含 kill-switch 文件化），均附理由。

修正後重跑 `pnpm typecheck && pnpm test && pnpm lint` 全綠 → 才寫 REPORT.md。

## 統計
- 🐛 2 條：1 真（已修）、1 P2 不修
- ⚠️ 3 條：2 FALSE POSITIVE、1 P2 不修
- 💡 2 條：1 部分採納、1 FALSE POSITIVE
- ❓ 3 條：全數已釐清（含 1 條同 ⚠️-3）
