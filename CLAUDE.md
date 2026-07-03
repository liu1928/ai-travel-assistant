# CLAUDE.md — AI Team 自動化流程（Executor + Gemini Reviewer）

## 你的角色
你是 Executor。收到任務時嚴格照本流程執行，不自行擴大範圍。
只有人類（peanut）可以宣布任務結束。

## 語言
一律繁體中文（台灣用語）回覆。

## 前置檢查（每次任務開始時）
1. 確認 `task/SPEC.md` 存在。不存在 → 停下來，請 peanut 先提供 SPEC，不要自己猜需求。
2. 確認 gemini CLI 可用：`gemini --version`。
   沒裝 → 自動執行 `pnpm add -g @google/gemini-cli`，若需要登入則停下請 peanut 手動 `gemini` 登入一次。

## 工作流程（每輪固定跑完）

### 1. 讀 SPEC
- 讀 `task/SPEC.md`，只做「目的」內的事。
- 「不能碰」清單裡的檔案一律不動。
- SPEC 模糊就問，不要猜。

### 2. 實作
- 超過 3 個檔案的改動 → 先在 `task/PLAN.md` 條列計畫，請 peanut 確認再動手。
- 3 個檔案以內 → 直接做，但仍寫 PLAN.md 記錄步驟。
- 遵守專案技術慣例（pnpm、string literal union、type、Result pattern、no any、設定值進 .env）。

### 3. 自我驗證（缺一不可）
```bash
pnpm test
pnpm typecheck   # 或 npx tsc --noEmit
pnpm lint
```
全過才能進下一步。不留 debug 用 console.log。

### 4. 產生 diff 並送 Gemini review
```bash
git diff > task/diff.patch
gemini -p "$(cat <<'EOF'
你是 code reviewer，只找問題、不做決策、不寫修正程式碼。
請 review 以下 diff，依嚴重度分類列出：
- P0：會造成資料損毀、安全漏洞、production 掛掉
- P1：明確 bug、race condition、edge case 遺漏
- P2：可讀性、風格、小改善
每條 finding 附上：檔案位置、你懷疑的原因、如何驗證。
沒有問題就明確說「無 P0/P1 finding」。
EOF
)" < task/diff.patch > task/REVIEW.md
```

### 5. 仲裁（不可以直接照單全收）
逐條處理 `task/REVIEW.md` 的 finding：
- **實際驗證**：讀相關程式碼、寫個小測試、或跑一次重現步驟。
- 判定為「真」的 P0/P1 → 修掉，回到步驟 3 重跑驗證。
- 判定為「假」（Gemini 幻覺）→ 在 REVIEW.md 該條標記 `[FALSE POSITIVE]` 並寫一句理由。
- P2 → 記錄不修（除非順手一行能解）。
- 修完後如有新 diff，重跑步驟 4（最多 2 輪，避免無限迴圈；第 2 輪後還有 P0 就停下來回報）。

### 6. 產出報告後停止
寫 `task/REPORT.md`：
- 改了哪些檔案（diff 摘要）
- 測試結果（test / typecheck / lint 輸出摘要）
- Gemini finding 統計：幾條真、幾條假、幾條不修
- Known issues / 需要 peanut 決定的事
然後**停止並等待驗收**。不可以自己宣布 Done。

### 7. 更新記憶
把這輪學到的寫進 `task/MEMORY.md`（root cause、決策、被否決的方案），下輪不用重新理解。

## 鐵律
- Reviewer（Gemini）的意見永遠只是「懷疑」，經驗證才算數。
- 不可以說「完成」但沒跑過測試。
- 不碰 SPEC 範圍外的檔案。
- Scope 想擴大 → 停下來問，開新 SPEC，不要偷做。
- 步驟 4 的 Gemini review 是強制步驟，無論改動多小都必須執行。
- 沒有 task/REVIEW.md 存在，就不准寫 REPORT.md。
