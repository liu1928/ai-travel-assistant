# Gemini Review — 航班與租車資訊（commit 2d6d0071）

## 狀態：已完成（第 5 次嘗試，改走 REST API 成功）

前 4 次嘗試用 gemini CLI 全部卡死，root cause 是 **API key 所屬專案預付額度用完**
（直接打 REST API 拿到 `429 RESOURCE_EXHAUSTED: "Your prepayment credits are depleted"`）；
agentic CLI 收到 429 不報錯、靜默無限重試，看起來像卡死（實測 19+ 小時零進展）。
peanut 換了一組有額度的 key 後，改用**直接呼叫 Gemini REST API**（`gemini-2.5-flash`,
temperature 0.2，diff 全文餵進 prompt，無工具、無檔案探索）一次成功。

> 教訓（已寫入 task/MEMORY.md）：agentic 工具卡住時，先繞過它直接打底層 API 看原始錯誤。
> 前 4 次對著 CLI 猜（ripgrep、approval mode、目錄大小）全是白猜。

### 嘗試紀錄摘要
1. CLI 預設 OAuth → `IneligibleTierError`（Google 已停用個人免費帳號的這種登入）
2. CLI + API key → 卡死 19h27m（wall-clock）/ 53s CPU，手動砍掉
3. CLI + `--approval-mode yolo` + timeout 240s → 逾時被砍
4. CLI 在只有 diff.patch 的乾淨臨時目錄 → 一樣逾時，且觀察到 agent 自己爬到 `D:\claude`
5. **REST API 直呼（換新 key）→ 成功**，腳本另存於 `scripts/gemini-review.mjs`

---

## Gemini 原始 findings（P0：0，P1：4，P2：4）+ 逐條仲裁

### P0
無 P0 finding。

### P1-1：generate route 的 400 錯誤訊息過於籠統，未帶 zod 詳細錯誤
**[FALSE POSITIVE as P1 → 降級 P2，不修]**
仲裁理由：錯誤訊息文字是 `specs/flights-rentals.md` §2.2 明訂的 API 契約
（「失敗 → 400 `航班或租車資料格式不正確`」），且與本專案既有錯誤訊息風格一致
（trips route 的「行程資料格式不正確」同樣不帶欄位細節）。正常流量不會踩到這個 400——
前端 `draftsToBookings` 先驗必填、時間/日期用原生 `type="time"`/`type="date"` 輸入，
格式從輸入端就保證正確；這個 400 是給非 UI 客戶端的後擋。要加 zod issues 細節屬
API 契約變更，需先改 spec，不在本次範圍。

### P1-2：draftsToBookings 錯誤訊息沒指出具體缺哪個欄位
**[FALSE POSITIVE as P1 → 降級 P2，不修]**
仲裁理由：這是 UX 精緻度問題，不是 bug——訊息已指出第幾筆+列出所有必填欄位，
使用者看著表單（就在眼前、欄位有 `*` 標記）能自行對照。逐欄位報錯要把驗證邏輯
從「第一個錯就返回」改成收集式，複雜度增加與效益不成比例（個人工具、每筆最多 8 欄）。

### P1-3：isFlightEmpty 會把「必填已填、可選全空」的資料誤判為空而靜默丟棄
**[FALSE POSITIVE，已實測推翻]**
仲裁理由：Gemini 誤讀了 `every` 的語意。`Object.values(d).every((v) => v.trim() === "")`
只有在**所有**欄位皆空時才回 true；必填欄位有值 → `every` 為 false → 資料正常處理。
實測驗證（重現腳本跑過）：
```
必填已填、可選全空 → isFlightEmpty = false （Gemini 宣稱會是 true）
全部欄位皆空     → isFlightEmpty = true
```

### P1-4：saveBookings 淺層合併可能覆蓋並行編輯的其他欄位
**[FALSE POSITIVE for 目前 UI；屬 spec 已文件化的整筆覆蓋語意，不修]**
仲裁理由：逐一走過本頁兩個編輯模式的互動路徑——每次儲存成功後都會
`setView({ status: "ready", trip: data.trip })` 重新同步 `view.trip`，之後任何一邊再儲存
都是從最新狀態展開，單頁內不存在資料遺失路徑（天數編輯未儲存時本來就不該被送出）。
真正的 lost-update 只發生在**多分頁同時編輯同一行程**，這是 PATCH「整筆覆蓋」語意
（`task/SPEC.md` §2.4）的固有性質，屬已知設計取捨，個人單機使用場景可接受。
Gemini 自己的備註也承認「目前 UI 可能沒有直接導致此問題的並行編輯功能」。

### P2-1：動態清單用 `key={i}`，刪除中間項時可能有渲染問題
**[部分成立，記錄不修]**
仲裁理由：所有輸入框都是 controlled（value 來自 state），刪除中間項後內容由 state 決定，
資料正確性不受影響；受影響的只有 focus 位置可能跳動。改用 uuid key 要動型別、
工廠函式、兩個 map，不是順手一行。記錄，未來如果實際觀察到輸入異常再修。

### P2-2：Body 型別用 `unknown` 不夠精確
**[不修]**
仲裁理由：刻意為之且已有註解（「使用者輸入的訂位資料，進來先過 zod」）——
未經驗證的原始 JSON 本來就該是 unknown，型別在 safeParse 後收窄，這是 zod 的正確用法。

### P2-3：buildUserMessage 字串拼接可讀性
**[不修]**
仲裁理由：與同檔案既有段落（places/holidays 組裝）風格一致，單獨改這段反而不一致。

### P2-4：「補填只做記錄」提示文字視覺層級不夠突出
**[不修]**
仲裁理由：主觀 UX 建議，現有位置（按鈕旁）與樣式與整頁其他輔助文字一致。

---

## 統計與結論

| 項目 | 數量 |
|---|---|
| Gemini findings 總數 | 8（P0×0、P1×4、P2×4）|
| 仲裁為「真」需要修碼的 P0/P1 | **0** |
| 明確誤讀（實測推翻） | 1（P1-3）|
| P1 降級為 P2 / 已知設計取捨 | 3（P1-1、P1-2、P1-4）|
| P2 記錄不修 | 4 |

**無程式碼變更**——所有 P1 經驗證均為誤判、降級或 spec 已文件化的設計取捨，
故不需要回到步驟 3 重跑驗證迴圈（沒有新 diff）。
