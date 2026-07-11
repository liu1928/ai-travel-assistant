# MEMORY — 累積踩雷與決策紀錄

> 每輪任務結束後在這裡補一段：root cause、決策、被否決的方案。下一輪任務開始前先看這份，
> 不用重新理解一次。

---

## 2026-07-11：三項修正（生成天數 / 編輯重排 / 航班換源 AeroDataBox）

**任務來源**：peanut 回報三個使用問題 → 先做根因調查（每題一調查 agent＋一反方驗證 agent，
主張全 confirmed 才報告）→ peanut 拍板方案 → PLAN 確認 → 實作。分支 `feat/three-fixes`。

**Root cause（三題都是「機制沒做」，非偶發 bug）**：
1. 生成缺天：SYSTEM_PROMPT 無天數覆蓋規則＋範例單日偏置；days 端到端 optional；
   schema 只驗 ≥1 天（`z.array().min()` 這類約束 SDK 不會送進 structured outputs 的 API 端
   grammar，只在 client 驗）。→ 修法三層：prompt 硬規則＋`inferMinDays` 推斷＋生成後
   `checkDayCoverage` 驗證重試（比照 lib/tagging.ts「務必涵蓋每一個編號」的既有模式）。
2. 編輯不重排：time 是無時長概念的字串、PATCH 純覆蓋、Routes 增值只有生成一個入口。
   → 免 LLM 本地重排：**差分優先**（相鄰 time 差當有效時長，舊行程零遷移可用）→
   durationMin（新欄位，AI 生成帶出）→ 預設 60。PLAN 原寫 durationMin 優先，實作時想清楚
   改差分優先——刪中間項後項剛好提前被刪項原佔時段，沒動到的項目不飄移。
3. 航班舊時刻：AviationStack 免費層 /flights 不帶日期只回「今天這班」，表單日期根本沒送出，
   資料日期在解析層被丟棄。**不是資料過期，是查錯日期**。→ 換 AeroDataBox：
   `GET /flights/number/{no}/{dateLocal}` 原生航班號+日期直查（免費層未來 365 天）。

**供應商評比（經官方原文複核，未來換源可參考）**：AeroDataBox（RapidAPI $0、直查、local 時間
自帶）＞ Amadeus（production 2000 次/月免費但要簽約+72h 審核、LCC 覆蓋風險）＞ FlightAware
（$5/月免費額度但回 UTC 要自己轉時區）＞ AviationStack 升 Basic（$49.99/月仍是機場式查詢，否決）。
AeroDataBox 注意：回應是**陣列**、local 時間就地切（跟 AviationStack 的 UTC 坑相反）、
換季班表最慢 2 週反映、免費層需綁卡（hard limit 不扣款）。

**GLM 仲裁（兩輪，8 修/2 假/12 不修）**：
- 兩條 [FALSE POSITIVE] 又是「反例自己沒驗」型：說 regex 不支援「三十」（實際 m[1]=三 m[2]=十
  → 30，且它自己論述中段演示「二十」是對的、結論自相矛盾）；說 `\d{2}:\d{2}` 會吃 "08:5"（不會）。
  **GLM 給的具體反例一律自己跑一次再判**（本 repo 第三次驗證此鐵律）。
- 真 finding 裡最有價值的兩條：`inferMinDays` 慣用語誤判（三天兩頭/這兩天→黑名單剔除）、
  未填日期用 UTC 今日會在台北清晨查到前一天（→ Asia/Taipei formatter）。中文 NLP 推斷
  與「今日」語意都要想時區與慣用語。

**流程/環境踩雷**：
- PowerShell `>` 重導又產 UTF-16（上輪已記過，這輪又踩一次才想起來）——**產 diff 一律用
  Bash tool**。已知教訓要在動手前翻 MEMORY，不是踩到才想起。
- superRefine 放在 `z.array(...).superRefine(...)`（欄位層）不影響 `.extend()`，
  tripWithBookingsSchema 自動繼承。
- `pnpm lint` 不含 components/ 的既有限制仍在（靠 typecheck 把關）。

**待 peanut（見 REPORT）**：RapidAPI 註冊+AERODATABOX_API_KEY 進 Secret Manager、
apphosting.yaml 綁 secret（diff 已列在 REPORT，等確認）、部署後 BR/CI/JX/IT 實測。

---

## 2026-07-10：Flight Lookup（AviationStack 帶航線+時刻）

**做法**：航班 autofill 第二層。按鈕觸發 → `POST /api/flight/lookup` → `lib/aviationstack.ts`
`lookupFlight`。requireUid + `checkAndConsume("flight_lookup")` 控成本。只帶航線+時刻不帶日期
（real-time 端點回典型排定、不保證使用者未來日）。

**關鍵技術點（會再遇到）**：
- **AviationStack `scheduled` 是 UTC**（`...T09:00:00+00:00`），另有 `timezone` 欄（IANA）。
  **必須用 `Intl.DateTimeFormat` 把 UTC instant 轉機場當地**（09:00 UTC = 17:00 台北），不能切字串。
  用 **`hourCycle:"h23"`**（非 `hour12:false`）避免午夜輸出 `"24:00"`。**缺 offset 補 `Z` 強制 UTC**
  （否則 `new Date` 當伺服器本地時間、全錯）。純函式 `hhmmFromScheduled` 抽出來單測。
- **航班號 regex 要允許數字開頭**：`/^[0-9A-Z]{2}\d{1,4}[A-Z]?$/`。`IATA_AIRLINES` 表有
  `7C`（濟州）、`5J`（宿霧）、`3K`、`B7`（立榮）等數字開頭代碼。**GLM round-2 建議改 `[A-Z]{2}`
  ——採納會炸掉這些合法航空（regression）**，已否決。教訓：GLM 對 domain 常識的建議要對照實際資料表驗。
- **前端 async 回填的 race**：查詢期間使用者若增刪/改列，用 render 期閉包的陣列重建會覆寫並行編輯/寫錯列。
  解法＝**functional update（`onFlightsChange((prev)=>…)`，讀最新 state）+ 身分守衛
  （`idx===i && f.flightNo.trim()===capturedNo`）**。前提：呼叫端直傳 `setFlightDrafts`，
  故把 prop 型別放寬成 `Dispatch<SetStateAction<FlightDraft[]>>` 即可傳 functional updater。

**決策**：`checkAndConsume` 對 AviationStack（硬月額度 100/月）仍走全域 fail-open（peanut 政策），
未改 fail-close——記 known issue 交 peanut。key 走 query（AviationStack 強制），程式不記/不回傳完整 URL。

**流程踩雷**：Edit 換 `old_string` 時**別把還在用的宣告行（`const body = …`）一起吃掉**——
route 這次就漏刪 body 宣告、typecheck 才抓到。動多行替換前確認被刪的行沒有下游引用。

---

## 2026-07-10：住宿欄位（Lodging Field）——第三種訂位資料

**做法**：完全比照既有 flights/carRentals 的「draft 字串表單 → zod schema →
`tripWithBookingsSchema` → 儲存/顯示/編輯 → 生成 prompt 硬約束」路徑，加第三種
`lodgings`。`tripSchema`（AI 輸出）**絕不加** lodgings，走「使用者輸入 → route 附掛」，
沿用防 AI 編造分層。舊 Firestore 文件靠 `.default([])` 零遷移。

**關鍵決策/被否決方案（GLM 審查後仲裁，見該輪 REVIEW.md）**：
- GLM 兩條 🐛 皆 FALSE POSITIVE：`LodgingDraft` 全欄位是 `string`（draft 恆由
  `emptyLodging`/`lodgingToDraft` 全填字串），`.trim()` 不會遇 undefined；空 draft
  仍渲染成卡片，故 `第 i+1 筆` 錯誤訊息與畫面位置一致，不誤導。**下次遇 GLM 說某某
  「若型別是 string|undefined 會崩」先確認實際型別**，本專案 draft 型別一律全 string。
- GLM 三條 ⚠️（日期曆法未驗、prompt injection、陣列無 `.max()`）皆「真但不修」：
  全是**既有全域特性**（flights/carRentals 同樣沒做），非本次新增引入，硬修會破壞對稱
  且擴大 SPEC。記為 known issue 交 peanut，不在單一 feature 分支偷做全域強化。
- GLM `checkInTime:"25:99"` 具體例**有誤**——`timePattern /^([01]\d|2[0-3]):[0-5]\d$/`
  已擋 25:99。GLM 舉的反例要自己驗，別照單全收。

**驗證慣例踩雷**：
- `git diff > task/diff.patch` 用 **PowerShell `>`** 會產出 **UTF-16**（Read 會顯示成
  亂碼/寬字元散開）。要餵 GLM/人看的 diff 改用 **Bash 的 `git diff > file`**（UTF-8）。
- `next build` 會把 `next-env.d.ts` 從 `./.next/dev/types/...` 改成 `./.next/types/...`
  （dev↔prod route types 路徑），這是**建置噪音**，commit 前 `git checkout -- next-env.d.ts`
  還原，別混進 feature commit。
- `pnpm lint` 的 scope 是 `app lib schema`，**不含 `components/`**；改 `components/*.tsx`
  要靠 `pnpm typecheck` 把關（直接 `npx eslint components/x.tsx` 會回 "File ignored"）。

---

## 2026-07-03：Gemini CLI 在 headless review 場景下會卡死

**現象**：`gemini -p "<review prompt>" < diff.patch > review.md` 這種 headless 用法，
在本機環境下會近乎無限久地卡住（實測過 19+ 小時無進展），不管在原專案目錄還是乾淨的
臨時目錄都一樣。

**Root cause（已證實）**：**API key 所屬專案的預付額度用完了。** 繞過 CLI 直接打
Gemini REST API 立刻收到 `HTTP 429 RESOURCE_EXHAUSTED: "Your prepayment credits are
depleted"`。agentic CLI 收到 429 不會報錯退出，而是靜默無限重試+指數退避——
看起來像卡死，其實是在無聲等額度。這就是為什麼空目錄一樣卡、19 小時零進展。

**重要教訓**：CLI 卡住不動時，先繞過它直接打底層 API 拿原始錯誤——一次 curl/fetch
就拿到明確的 429，比對著 CLI 猜行為（ripgrep、approval mode、目錄大小……全是白猜）
省非常多時間。這跟 task/SPEC.md §7 故障診斷「直接用 curl/node 腳本打 API 看原始錯誤」
是同一個道理，適用於任何 agentic 工具。

**已知會遇到的連鎖問題**：
1. `gemini` 預設用 `oauth-personal` 登入方式——Google 已停用這個免費個人帳號的
   Code Assist 存取，會報 `IneligibleTierError`。解法：改用 API key
   （`~/.gemini/settings.json` 的 `security.auth.selectedType` 改成 `"gemini-api-key"`，
   並設 `GEMINI_API_KEY` 環境變數）。**這個設定是全域的，改一次之後應該就一直有效**，
   不用每次重設。
2. 就算認證修好了，agent 探索行為造成的卡死還是沒解決。
3. `--approval-mode yolo` 能解決「等互動確認」這個子問題（headless 沒有 TTY 可以按確認），
   但不是卡死的主因，加了之後還是會卡。

**被否決/驗證無效的方案**：
- 改認證方式 → 解決了認證，沒解決卡死。
- 加 `--yolo` + `timeout` → 逾時還是被砍，agent 探索行為本身太慢。
- 在乾淨臨時目錄只放 diff 檔重試 → 一樣卡死，而且觀察到 agent 自己爬到父目錄，
  代表問題不是「目錄裡東西太多」，是 agent 探索行為本身不受目前目錄限制。

**解法（等 peanut 處理額度後即可用）**：
- peanut 需要到 https://ai.studio/projects 儲值，或提供一組還有額度/免費配額的專案的 key。
- 額度恢復後，**建議直接用 REST API 而不是 CLI** 做 diff review：一次性呼叫、無工具、
  無檔案探索、錯誤會立刻浮現而不是靜默重試。可用腳本已寫好並驗證過流程（差額度而已）：
  `C:/Users/Peanut/.claude/jobs/1fd598bc/tmp/gemini-review/call-gemini.mjs`
  （讀 diff.patch → 打 `gemini-2.5-flash:generateContent` → 寫 review-out.md；
  之後可以把它搬進專案永久保存，例如 `scripts/gemini-review.mjs`）。
- 若堅持用 CLI，記得它遇到 429 會靜默重試看起來像卡死——先打一次 REST API 確認額度
  再跑 CLI。

**這輪的結論（最終）**：peanut 換了有額度的 key 後，用 REST 腳本一次跑成，review 完成
並逐條仲裁完畢（8 條 findings，0 條真 P0/P1）。可重複使用的腳本已永久存放在
`scripts/gemini-review.mjs`，用法：
`GEMINI_API_KEY=<key> node scripts/gemini-review.mjs > task/REVIEW.md`。
**以後步驟 4 直接用這個腳本，不要用 gemini CLI**（CLI 遇 429 靜默重試 = 假死）。

**仲裁品質觀察（供未來輪參考）**：這次 Gemini 的 4 條 P1 全部經驗證為誤判/降級——
其中一條（isFlightEmpty）是明確誤讀 `every` 語意，寫 10 行重現腳本就推翻了。
印證 CLAUDE.md 鐵律「Reviewer 的意見永遠只是懷疑，經驗證才算數」不是空話：
如果照單全收會白做四個「修正」，其中一個還會把正確的邏輯改壞。

---

## 2026-07-03：`task/SPEC.md` vs `specs/*.md` 的路徑慣例落差

CLAUDE.md 前置檢查寫「確認 task/SPEC.md 存在」，但本專案實際慣例是：`task/SPEC.md`
專屬於「行程生成」核心功能的單一事實來源；其他功能（假日、分帳串連、航班租車）各自
在 `specs/` 底下有自己的 spec 檔（`holidays.md`、`split-bill.md`、`flights-rentals.md`）。
下一輪任務如果 SPEC 不在 `task/SPEC.md`，先去 `specs/` 底下找對應檔名，不用停下來問
「SPEC 在哪」——這個路徑差異是已知的，不是任務本身的模糊。

---

## 2026-07-06：SSRF 修補一輪（sharelink），三個可重用教訓

**任務**：peanut 口頭指派三件安全/清理小改（非 task/SPEC.md）。實際只有 sharelink SSRF
是真正的程式碼改動；另兩件是清 build 產物 + 一項查證後發現不成立。

**教訓 1：審查者已從 Gemini 換成 GLM-5.2，但兩份 CLAUDE.md 不同步。**
根 `D:\claude\CLAUDE.md` 有「GLM 異質審查（強制，所有專案適用）」一節，明文取代本專案
CLAUDE.md 步驟 4 的 Gemini。工具是 MCP `mcp__glm-reviewer__review_code`（Claude Code 端
若看不到要先 `claude mcp add glm-reviewer ...` 註冊）。本輪用了 GLM。**待 peanut 定調**本專案
往後用哪個並更新落敗的文件——在他回覆前，兩者擇一都算合規（都寫 task/REVIEW.md、都卡 REPORT.md）。

**教訓 2：「加 prompt caching」對本專案的 Sonnet 4.6 是 no-op。**
`SYSTEM_PROMPT` 只有 ~900 tokens，低於 Sonnet 4.6 的快取門檻 **2048 tokens**（Opus 系是 4096）。
低於門檻加 `cache_control` 不報錯也不快取。以後有人再提「開快取省錢」，先量 system prompt 的
token 數對照門檻，別憑感覺加。

**教訓 3：Cloud Run request timeout 不能在 apphosting.yaml 設。**
App Hosting `runConfig` 只有 cpu/memoryMiB/maxInstances/minInstances/concurrency/vpcAccess，
**沒有 timeoutSeconds**。要調 timeout 得用 `gcloud run services update <svc> --timeout=N`（Cloud Run 層）。
別在 apphosting.yaml 加會被忽略的欄位——這正是 CLAUDE.md「不要憑記憶填設定值」要防的坑。

**GLM 仲裁品質**：第一輪它把一條「regex 子網域繞過」報成 🐛，實測（`node -e` + 單測）證明 regex
有 `^...$` 錨點、`google.evil.com` 被擋 → false positive。又一次印證鐵律：reviewer 意見先驗證再算數。
