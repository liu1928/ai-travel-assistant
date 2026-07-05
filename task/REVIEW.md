<!-- 產生日期: 2026-07-06 | 審查者: GLM-5.2（mcp glm-reviewer/review_code）| 範圍: lib/sharelink.ts SSRF 修補 + lib/__tests__/sharelink.test.ts + .gitignore -->

# REVIEW — sharelink SSRF 修補（GLM-5.2 異質審查）

> 依 workspace 根 CLAUDE.md「GLM 異質審查（強制，所有專案適用）」執行；該節明文取代
> 專案 CLAUDE.md 步驟 4 的 Gemini 流程。審查結果原封不動記錄於下，後附逐條仲裁。
> ⚠️ 兩份 CLAUDE.md 對「用 GLM 還是 Gemini」不一致，見 REPORT.md 待決事項。
> （前一輪 REVIEW 內容為航班/租車 Gemini review，git 歷史保留，本檔覆寫為本輪。）

---

## 第一輪 GLM 回覆（原文重點）

### 🐛 問題點
1. `GOOGLE_MAPS_HOST` 正規表達式存在 SSRF 繞過風險 — 認為只限制結尾、忽略子網域，
   `https://google.evil.com/` 會被放行。
2. `isMapsUrl` 的 `includes` 子字串檢查可被繞過 — `https://attacker.com/?fake=google.com/maps`
   或 `https://attacker.com/google.com/maps` 會通過最後一道防線。

### ⚠️ 風險
1. `redirect: "follow"` 仍有殘留轉址 SSRF（短連結被劫持/允許導向非 Google）。
2. DNS Rebinding：check 與 use 之間 DNS 可被改指向內網。
3. `AbortSignal.timeout` 在舊 Node/Edge runtime 相容性。

### 💡 建議
1. Regex 改嚴格比對或改用明確 Set。
2. `isMapsUrl` 拋棄 `includes`，改 `URL` 解析嚴格檢查 hostname + pathname。

### ❓ 待釐清
1. 為何要支援國別 TLD？只收 `maps.app.goo.gl` 是否更安全。

---

## 第一輪仲裁（逐條，經實際驗證）

- **🐛1 → [FALSE POSITIVE]**。Regex 是 `^...$` 錨定的，GLM 誤讀為未錨定。實測
  `node -e` 驗證：`google.evil.com`、`google.evil.jp`、`maps.google.com.evil.com` 全數 `false`，
  `www.google.com`、`maps.google.co.jp`、`google.com` 為 `true`。並有單元測試覆蓋且通過。
- **🐛2 → 真，已採納**。`isMapsUrl` 原本用 `includes` 子字串，確實可被
  `attacker.com/?x=google.com/maps` 騙過（雖然輸入已被 `isAllowedInputUrl` 擋、只有可信短連結
  轉址才會走到這，但屬防禦縱深弱點）。已改為解析 `new URL(url).hostname` 精確比對，
  並補單元測試（見 `isMapsUrl (post-redirect guard)`）。
- **⚠️1 redirect follow → 接受殘留**。輸入已限可信 Google 網域；Google 短連結只導向 Google
  自家網域，最終網址再經（強化後的）`isMapsUrl` 驗 hostname。要完全掌控需 `redirect:"manual"`
  逐跳驗證，超出本次「修驗證順序」範圍，記為已知限制。
- **⚠️2 DNS rebinding → 接受殘留**。Node 原生 fetch 無法根除；對「只打 Google 網域」的場景
  風險極低，不在本次範圍。
- **⚠️3 AbortSignal.timeout → 非問題**。本路由是 Node runtime（用 firebase-admin），Cloud Run
  Node 20，支援 `AbortSignal.timeout`（Node ≥ 17.3）。typecheck 通過。
- **💡1/💡2 → 已採納 isMapsUrl 部分**；Regex 維持（已驗證安全）。
- **❓1 → 保留國別 TLD**。使用者可能直接貼國別完整網址；且原碼也非只收短連結。

---

## 第二輪 GLM 回覆（原文重點，針對強化後的 isMapsUrl）

### 🐛 問題點：無。

### ⚠️ 風險
1. TOCTOU / DNS Rebinding（已知並接受）。
2. `redirect:"follow"` 依賴「Google 短連結只導向 Google」的現狀假設而非程式強制（長期維護風險）。
3. `AbortSignal.timeout` 執行環境相依（需 Node ≥ 17.3）。

### 💡 建議
1. `isMapsUrl` 與 `isAllowedInputUrl` 邏輯重複，可 DRY。
2. `resolveUrl` 直接回傳 `e.message` 可能洩漏內部網路/錯誤細節，建議回固定訊息 + server log。

### ❓ 待釐清
1. `finalUrl` 是否可能非 https？`isMapsUrl` 沒檢查 protocol。
2. `GOOGLE_MAPS_HOST` 對 `google.com.au`/`com.tw` 這類「com.XX」網域涵蓋不到。

---

## 第二輪仲裁

- **🐛：無** → 通過。
- **⚠️1/⚠️2/⚠️3 → 同第一輪，接受殘留 / 非問題**。
- **💡1 DRY → 不改**。兩函式語意刻意不同（輸入強制 https；最終網址不再被 fetch，只被解析取值），
  分開更能表達意圖；重複僅一行 host 判斷，維護成本低。
- **💡2 錯誤訊息 → 不改，記 P2**。輸入已限 Google 網域，fetch 錯誤只會來自 Google 網域，洩漏面
  很小；且 SPEC §7 與 MEMORY 都強調「保留原始錯誤利於診斷」。權衡後保留原訊息。
- **❓1 finalUrl protocol → 低風險，不改**。`finalUrl` 之後只被 regex 取 place_id/名稱座標，
  不會被再次 fetch，故 http 的 finalUrl 不構成二次 SSRF。
- **❓2 com.au/com.tw 涵蓋 → 已知限制，不擴大範圍**。原 `includes` 版本同樣不接受
  `google.com.au`（"google.com.au/maps" 不含子字串 "google.com/maps"），故無回歸。
  國別 `com.XX` 支援屬功能增強，不塞進這次安全修補；記入 REPORT 供 peanut 決定。

**結論：兩輪審查後無 P0/P1 未處理項。停止 review（達 2 輪上限，且無阻斷性 finding）。**
