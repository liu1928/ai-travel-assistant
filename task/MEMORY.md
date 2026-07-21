# MEMORY — 累積踩雷與決策紀錄

> 每輪任務結束後在這裡補一段：root cause、決策、被否決的方案。下一輪任務開始前先看這份，
> 不用重新理解一次。

---

## 2026-07-11（下半）：JX302 查無航班 / 行程對不上週幾與時段

**背景**：緊接在同日「三項修正」（見下一節）之後，peanut 實測就回報兩個新問題——AeroDataBox
換源後 JX302 查不到、以及那輪剛加的天數硬規則沒類推到「週幾」和「時段」。

**JX302 root cause（實測 API 驗證，非猜測）**：AeroDataBox 對「今天已進即時追蹤但還沒正式
排班」的航班，出發端只給 `predictedTime` 不給 `scheduledTime`；`dateLocalRole=Departure`
在這種資料型態下查詢回 204，換 `dateLocalRole=Arrival` 查同一天同一航班立刻 200。程式原本
①寫死 Departure 角色沒有 fallback、②`pickFlight` 只讀 scheduledTime 沒 fallback 到
predictedTime，兩個疊加才變成「查無」。**教訓：換新資料源上線後，第一個真實世界的冷門案例
（非熱門航線的即時追蹤航班）就踩到主流測試（BR198 對照組）測不出的資料型態分支**——這類
「欄位存在與否互斥」的 API 行為，光看文件容易漏，要嘛多測幾種真實航班，要嘛程式面對「缺
預期欄位」要有 fallback 而非直接濾掉。

**週幾/時段 root cause**：跟同日稍早「生成缺天」是同一類問題（prompt 沒硬規則 + 沒生成後
驗證），但多一層更根本的限制——沒有 `startDate` 錨點，「週三」在數學上算不出對應第幾天，
這不是 prompt 沒寫好，是必要輸入缺失。跟 peanut 確認後選「前端擋下、要求先填日期」（而非
靜默 fallback 猜測），實作沿用 `lib/trip-days.ts` 那套 inferMinDays/checkDayCoverage 的
模式（新函式 extractWeekdaySignal/extractTimeOfDaySignal/expectedDayForWeekday/
checkWeekdayTimeSignal），複用 generateTrip 既有的重試迴圈。

**GLM 這輪最有價值的一條**：「下週三」原本被我的正則直接吃成「週三」，`expectedDayForWeekday`
算出錯誤天數，但 `checkWeekdayTimeSignal` 照樣回報「驗證通過」——**這比完全不驗證更糟**，
因為使用者會看到一個被系統背書過的錯誤答案。這正好打臉我自己寫在註解裡的原則（「沒有錨點
就不驗，寧可不驗也不要用錯誤的猜測」）——原則對了，但沒把「下」這個修飾詞算進「有沒有可靠
錨點」的判斷裡。**教訓：寫「沒把握就不驗」這類保守原則時，要盤點所有會產生「看似有把握、
實則算錯」的輸入變體（相對日期修飾詞是最容易漏的一種），不能只擋「完全沒訊號」的情況。**

**其他 GLM finding 判斷**：predictedTime 可能因即時追蹤延誤導致 dataDate 跟請求日期不符——
GLM 指出這風險只存在於 Departure 路徑（因為我當時只在 Arrival fallback 路徑驗證
`dataDate===date`），兩路徑標準不一致；順手補齊對稱驗證。「只認第一個星期幾」「時段用
substring 誤判否定句」兩條記錄為已知限制不修——前者需要 schema 結構化標記（大工程，peanut
沒選這個方案），後者最壞後果只是多一次 correction retry，不會產生「錯誤但顯示通過」的
後果（跟「下週三」那條性質不同，這是判斷「要不要修」時的關鍵區分：會不會讓使用者對錯誤
結果產生錯誤信心，比會不會誤觸發更值得優先修）。

**部署後才發現的 hotfix（同一輪）**：上面 JX302 修法（Departure→Arrival fallback）部署上線後，
peanut 立刻實測回報「航班查詢服務暫時無法使用」——不是原本要修的查無資料，是這次修法自己
引入的迴歸：兩次請求背靠背發生，撞上 RapidAPI BASIC 方案 1 req/s 限速，第二次被 429 擋下。
**教訓：手動驗證 API 行為時，如果測試指令之間有 `sleep`（不管是刻意加的還是指令執行本身的
延遲），驗證的是「有間隔的請求模式」，不代表程式實際「背靠背發起請求」時的行為一致**——
這輪部署前的實測（用 curl 分開測 Departure 和 Arrival、之間有其他指令與思考時間）剛好避開了
限速窗口，沒發現這個問題；上線後 Node fetch 兩次 `await` 之間幾乎零延遲，才踩到。修法：
`queryByRole` 內部遇 429 時 sleep(1100ms) 重試一次（查過 429 回應沒有 `Retry-After` header，
固定延遲是唯一辦法）。**下次改動任何「連續打同一個第三方 API 兩次以上」的邏輯，驗證時要用
最貼近程式實際執行節奏的方式測（背靠背、不插入延遲），不能只用分開下指令的手動測試代替。**

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

---

## 2026-07-21：Schedule Anchoring（地基）+ GLM review 工具連續第二輪失效

**任務**：實作 `specs/schedule-anchoring.md`（2026-07-21 定案 8 份延伸功能 spec 的共用地基）。做法見
task/PLAN.md 對應節、REPORT.md 對應節，不重複。這裡只記兩件下輪會再遇到的事。

**GLM review 工具本輪全滅**：4 次呼叫（1 次完整 diff + 3 次逐步縮小到 1.5KB 的 payload）——2 次 504、
2 次回傳 `<<ccr:…>>`（harness 壓縮成無法展開的內容參考）。**縮小 payload 這次沒用**（2026-07-20 那輪
「聚焦小批」至少換到 1 則可讀，這輪連 1.5KB 都被壓縮）。**教訓：這兩輪連續出問題，工具本身可能在
退化，不是單次網路抖動**——下輪如果又全滅，該做的不是繼續換小 payload 硬試，是直接跟 peanut 回報
「glm-reviewer 後端疑似有系統性問題，需要檢查」，別把時間耗在重試上。本輪的替代做法：針對 GLM
原本該檢查的 3 個最高風險點（型別放寬安全性、`filter()` 物件參照是否共用、覆寫 schema 後既有約束
是否還在）逐一自驗（含一個獨立 `node -e` 重現腳本），記錄自驗依據到 REVIEW.md，跟「GLM 說安全」明確
標成不同證據來源，不能混為一談。

**write-back 解耦設計的關鍵驗證**：這輪最重要的技術決策是「Routes 迴圈裡任一 stop 定位失敗就整天放棄
車程估計」跟「把已解析成功的 stop 寫回 placeId/lat/lng」要解耦——原本 `break` 拿掉後改成跑完全部
stops 才判斷 `allResolved`。這個設計成立的前提是 `array.filter()` 回傳的元素跟原陣列共用物件參照
（mutate 有效），**這是基礎 JS 語意但這輪特地寫了獨立腳本驗證而非憑印象假設**——因為如果這個前提
錯了，整個 spec 的核心價值（省下已經算出的資料）會在執行期悄悄失敗且沒有任何測試會抓到（單測目前
沒有覆蓋這條路徑，屬已知限制，下輪如果要加 route.ts 這條路徑的整合測試可以考慮，本輪沒做）。

**已知限制（未修）**：route.ts 的寫回邏輯（`stop.placeId = …` 那段）沒有自動化測試覆蓋——本專案
沒有 fetch mock 慣例，這條路徑目前只靠上面提到的獨立驗證腳本 + 型別系統把關，不是回歸測試。跟
2026-07-11 那輪「429 重試路徑沒有自動化測試」是同一類已知缺口。

---

## 2026-07-21（二）：Place Freshness（第二份下游 spec）+ GLM review 這輪恢復正常

**任務**：實作 `specs/place-freshness.md`。做法見 PLAN.md/REPORT.md 對應節。這裡記兩件事。

**GLM review 這輪完全恢復**（上一輪 schedule-anchoring 4 次全滅）：一次呼叫就拿到完整可讀全文，
4 條 finding 都能正常仲裁。**修正上一輪的推論**：連續退化不代表工具永久壞掉，可能真的只是那個
時段的暫時性問題（額度尖峰/服務抖動）。已更新跨 session 記憶 `glm-review-tool-issues`，記錄「已恢復」
這個新資料點，避免下次一看到失敗就直接放棄重試——但同一輪內重試 2-3 次仍全滅時，還是先切自我驗證，
不要無限重試。

**沒有 fetch mock 慣例時的測試策略**：`fetchBusinessStatus` 本身包一層 `fetch`，直接測會需要
mock。這輪做法是抽出純函式 `classifyStatus(httpStatus, body)` 只測分類邏輯（404/缺欄位/UNSPECIFIED/
CLOSED_*/非 2xx），完全不用碰網路——跟 `lib/aviationstack.ts` 的 `hhmmFromScheduled` 抽出手法同一招。
`fetchBusinessStatus` 本身（含 fetch 呼叫、try/catch）維持不測，記為已知缺口（跟 429 重試路徑同類）。
**這個「抽純函式」招式看起來會是本專案處理『I/O 包裝函式想測分類/決策邏輯』的標準解法**，下次遇到
類似情境（呼叫外部 API 但邏輯核心是純判斷）可以直接套用，不用重新想。

**GLM 這輪最有價值的一條**：抓到 `checkAndConsume` 的 cost 參數傳入 `n * 單價` 有浮點數精度問題
（`50*0.017=0.8500000000000001`）——實測後確認量級對美元級預算完全無感知（護欄本來就是「粗估上界」，
不是精算帳單），但這提醒了一件事：**所有服務成本加總本來就是浮點數**（`estCostUsd` 全用 `+`），
這是全域既有特性，不是這輪新增的問題，仲裁時要說清楚「真但不修，因為是既有系統性行為」而不是輕描
淡寫「不算 bug」。

**GLM 誤判**：「`trip.insights.push` 沒效果，懷疑是唯讀物件」——只是因為只餵了片段 diff，沒看到
`const trip = result.value`（一般可變物件）跟既有 Routes insights push 是同一個模式。**教訓：送審
片段 diff 給 GLM 時，如果改動的變數在片段外有定義來源，GLM 容易對型別/可變性做出錯誤假設**——這類
finding 用 grep 找一下變數宣告處就能秒判真假，比爭論「理論上可能怎樣」快很多。

---

## 2026-07-21（三）：Opening Hours（第三份下游 spec）+ GLM review 同一天內又全滅

**任務**：實作 `specs/opening-hours.md`。做法見 PLAN.md/REPORT.md 對應節。這裡記三件事。

**GLM review 這輪又全滅，且推翻了「縮小 payload 有效」的假設**：同一天內 place-freshness 那輪才剛
一次成功，這輪 3 次呼叫（完整 diff、聚焦片段、縮到 20 行的最小算式）全部被壓縮成 `<<ccr:…>>`——
**連 20 行都會被壓縮，證明縮小 payload 不是穩定解法，只是偶爾湊巧有效的手段之一**。已更新跨 session
記憶 `glm-review-tool-issues` 修正這個認知：不再假設「縮小payload=解法」，改成「每次呼叫都當作有
一定機率失敗，同輪重試 2-3 次仍全滅就切自我驗證」，不再對失敗模式做過度推論（之前分別下過「連續退化」
「間歇性但可預期」兩個結論，這輪證明兩個都下得太早）。

**Context7 查證 API 契約，沒有憑印象猜**：Google Places API (New) 的 `regularOpeningHours` 對「全週
24 小時營業」的表示法（單一 period、`open={day:0,hour:0,minute:0}`、無 `close`）不是憑經驗猜的，
是用 Context7 查 Google 官方文件（`/websites/developers_google_maps_places_web-service`）核對過的
原文：「if a place is always open, the close field will not be set. Clients can rely on always
open being represented as an open period containing day 0, hour 0, minute 0」。**這類「輸入資料
的邊界表示法」不確定時，先查文件比憑印象寫程式再測試更快**——如果猜錯，寫的單測會驗證錯誤的假設，
自己還會覺得測試都過了很安心，其實整個 24h 判斷都是錯的。

**自我審查抓到一個 GLM 沒機會看到的真實邊界**：「缺 close 的防禦分支」跟同一天正常時段的 period 若
先後出現，`push` 會把 "24h" 跟時段字串混進同一個逗號分隔字串，產生髒資料。這條不是 GLM 抓到的（GLM
這輪完全沒回應），是在自己重新看 `compressOpeningHours` 邏輯、寫防禦性單測時發現的。**教訓：GLM 不可用
時的自我驗證不是照抄 PLAN 裡列的風險點就結束，讀自己寫的程式碼時，順手多想一輪「這個防禦分支跟其他
分支同時觸發會怎樣」，往往能抓到 reviewer 也會抓的那類問題。**

---

## 2026-07-21（四）：Flight Day Status——同一支端點多解析欄位、零額外成本

**核心技巧**：AeroDataBox 的班表查詢跟即時動態查詢是**同一個端點、同一次 HTTP 呼叫**，只是回應裡
臨近出發日會多帶 `status`/`revisedTime`/`terminal`/`gate` 這幾個欄位。所以「加即時動態功能」不是
新增一個查詢路徑，是讓 `pickFlight` 多解析幾個欄位——`mode` 參數只在 route 層控制「date 必須是今天」
的驗證閘門，不影響底層怎麼打 API。**下次遇到「同一個免費/低成本 API 想加新功能」的 spec，先確認
既有呼叫的回應裡是不是已經有想要的資料，而不是預設要新開端點/新打一次 API。**

**欄位名一律真實呼叫核對，不憑文件猜**：用正式站金鑰查 BR198 today，拿到真實回應才確認
`revisedTime`/`terminal`/`gate` 這些欄位名——跟上一輪 opening-hours 查 Context7 文件是同一個原則的
不同做法（有文件查文件，沒有可靠文件就直接打 API 看真實回應），兩者都是「不憑印象寫程式」。

**GLM review 這輪又全滅（第三次）**：連 20 行等級的最小片段都失敗過，這輪也是。目前累計：
schedule-anchoring 全滅、place-freshness 成功、opening-hours 全滅、flight-day-status 全滅——
4 輪裡 3 輪失敗。已在跨 session 記憶更新這個比例，供 peanut 判斷是否要換審查後端。

---

## 2026-07-21（五）：Map View——自我審查抓到 React useEffect 依賴陣列真 bug

**這輪最重要的教訓**：GLM 又全滅（連續第 4 次裡第 4 次失敗），但自我審查時真的抓到一個 GLM 原本該
抓的問題——`FitBounds` 元件的 `useEffect(() => {...}, [points, map])`，`points` 是父層 render body
內聯計算（沒 `useMemo`）的新陣列，導致任何無關的頁面重render（例如編輯別天備註）都會重跑
`fitBounds`、蓋掉使用者手動平移過的地圖視野。**教訓：GLM 送審 prompt 裡列的風險點，就算工具本身
掛掉，仍然是很好的自我審查檢查清單**——這條就是照著送審 prompt 第 3 點的問題意識去追蹤程式碼才
找到的，不是憑空想到。以後 GLM 不可用時，送審 prompt 寫的 4-5 個具體疑問，逐條自己追一遍程式碼
路徑，比籠統地重讀一次 diff 更容易抓到真問題。

**同名地點的名稱對映風險不是新問題**：`resolveDayMapItems`/`loadCollectionCoords` 都用
`Map<name, coords>` 做名稱對映，同名地點會後蓋前——但這跟 schedule-anchoring 那輪 `route.ts` 的
`placeByName` 是同一種手法、同一個既有限制（task/SPEC.md §9 已記錄）。**教訓：新功能重用既有的
「已知限制」手法時，不用重新論證這是不是問題——指認出「這跟哪個既有限制同根同源」就夠了，不必
每次都重新評估風險等級。**

---

## 2026-07-21（六）：Day Regenerate——spec 已經預先回答的問題，自我審查前先查 spec 本文

**這輪最重要的教訓**：GLM 又全滅，自我審查時本來想深究「同時重生兩個不同天會不會互相覆蓋
（read-modify-write race）」，準備當一個真發現的 bug 處理——**結果 `grep specs/day-regenerate.md`
發現 spec §2 早就寫了「併發：last-write-wins 可接受（單人使用），不做樂觀鎖」，這是 peanut/spec
作者已經想過、已經拍板接受的設計，不是我漏想的風險**。教訓：**自我審查一個「這樣設計會不會有問題」
的疑慮之前，先回頭查一次對應 spec 的「設計決策」章節有沒有已經討論過**——這比自己重新論證一輪、
甚至誤判成新 bug 去修，省時間也不會畫蛇添足動了 spec 明確不要的東西（加樂觀鎖）。

**刻意不做的重構也要寫進 PLAN 說明**：spec 用詞「抽成可複用 helper」容易誤導成「把舊程式碼也重構
成呼叫新 helper」，但這輪判斷主生成路徑的錨定邏輯跟車程估計交織太深，硬拆分對已上線核心功能風險
不成比例，選擇兩處保留小段重複邏輯。**教訓：spec 用詞暗示但沒明講的重構範圍，若判斷要縮小範圍，
一定要在 PLAN.md 寫清楚為什麼，不要無聲地選擇「安全」的那條路而不留紀錄**——不然下一輪的人（或
未來的自己）看到兩處相似程式碼，可能會誤以為是疏漏而去「修正」成重複呼叫，反而引入原本要避免的
迴歸風險。

---

## 2026-07-21（七）：Export & Offline——沒有影像生成工具時的 PWA icon 替代方案

**環境限制的誠實替代方案**：spec 要求 PWA icon 產 192/512 PNG 兩檔，但這個環境沒有影像生成工具，
手刻 PNG 二進位編碼器（IHDR/IDAT/CRC32）風險高且沒有圖檢視工具能立即發現壞圖。改用單一 SVG 檔案
在 manifest 宣告兩個 sizes 條目——**這不是偷懶跳過，是在 PLAN.md 明確記錄的替代方案**，附上「peanut
之後可換真正品牌 PNG，manifest 結構不用改」的銜接說明。教訓：遇到「這個環境做不到 spec 字面要求」
的情況，不要嘗試用高風險的臨時方案硬做到位（PNG 手刻編碼器一旦有 bug 就是靜默壞圖，沒工具能發現），
找一個功能等價、風險可控的替代方案，誠實記錄偏差比硬做更負責任。

**GLM review 這輪兩批都完整成功——確認之前「連續失敗」不是趨勢**：前 4 輪（schedule-anchoring/
opening-hours/flight-day-status/map-view/day-regenerate）大多全滅，這輪兩批都一次成功。7 輪累計
2 成功 5 全滅，**確認失敗率高但完全不可預測，不是「越來越糟」或「某個時段容易失敗」這種可操作的
規律**。已更新跨 session 記憶，把這個結論明確記下來，避免下次又重新猜測規律浪費時間。

**Next.js metadata.themeColor 已棄用，用 Context7 查證後才改**：原本直接寫 `metadata.themeColor`
（憑舊印象），Context7 查 Next.js 官方文件才發現 v14 起要移到獨立 `viewport` export。**教訓：連
「這行程式碼感覺很眼熟」的 API 用法都可能是舊版本記憶，Next.js/React 生態這類 metadata/config API
變動頻繁，落筆前查一次 Context7 比事後被 typecheck 或 runtime warning 抓到更省事**——這次是自己
主動查證，不是被逼著查，值得繼續保持。

---

## 2026-07-21（八）：Trip Day Mode（組裝件，8 份延伸功能 spec 全部做完）——App Router 沒有
## template.tsx 時 page 元件切換動態路由參數不會自動重掛載，是這輪自我審查抓到的真問題

**這輪最重要的技術教訓**：兩個新 `useEffect` 原本只用 `[tripDay]`（衍生值,不是 state）當
dependency，自我審查時想到「如果同一 session 內從行程 A 切到行程 B，剛好兩個行程都算出
`tripDay=2`，React 會不會誤判成沒變化而不重跑 effect」——**這個疑慮是真的**，用 Context7 查證
Next.js App Router 的機制後確認：只有 `template.tsx` 才會在動態 segment（含參數值）變化時強制
remount，一般 `page.tsx` 預設不會，這個路由（`app/trips/[id]/`）只有 `page.tsx`，代表元件 state
在切換不同行程 id 時會留存。修法：兩個 effect 的 deps 都加 `params.id`，確保換行程一定觸發，
不受衍生值巧合相同影響。**教訓：任何 `useEffect` 的 deps 只放「衍生值」而不放「觸發這次衍生值
重算的來源」時，都要想一遍「如果來源變了但衍生值算出來剛好一樣，會不會漏觸發」**——這類 bug
不會被 typecheck/build 抓到（型別正確、JSX 正確），只有真的想過資料流才會發現，是這次自我審查
（沒有 GLM 可用）主動想到的，不是照抄 GLM 給的懷疑清單。

**8 份延伸功能 spec 全數做完**：schedule-anchoring（地基）→ place-freshness → opening-hours →
flight-day-status → map-view → day-regenerate → export-offline → trip-day-mode（組裝件，
最後做），完全照 task/MEMORY.md 之前記錄的依賴順序執行，沒有遇到需要臨時調整順序的情況。
GLM review 8 輪累計只有 2 輪成功（place-freshness、export-offline），其餘 6 輪全靠自我驗證
撐過去，過程中抓到至少 3 個自我審查才發現、GLM 完全沒機會確認的真問題（opening-hours 的
compressOpeningHours 缺 close 混雜、map-view 的 FitBounds useEffect 依賴陣列、這輪的
useEffect deps 缺 params.id）——**印證了「GLM 不可用時，照送審 prompt 的問題意識自己追一遍
程式碼路徑」這套自我驗證流程是有實際產出的，不是形式上交差**。

---

## 2026-07-21（九）：租車建議 + 可變現租車連結——找免費 API 這類需求，先假設「沒有真正免費的
## 即時報價/預訂 API」，優先找「可複製既有模式的零成本替代方案」而非硬啃 API 審核

**根因/決策脈絡**：peanut 問「有沒有免費可用的租車相關 MCP 或資訊」。研究流程：先廣泛搜尋
Kayak/Amadeus/Booking Demand API/Expedia Rapid Car/RapidAPI 市集/MCP 生態圈，全部確認需要業務
申請或簽約審核（跟先前已被否決的 Amadeus 航班 API 同樣門檻）——**這類「即時報價/預訂」的 API
幾乎不存在真正免審核的免費版本，是這個領域（旅遊產業 B2B 資料）的常態，之後遇到類似「XX 有沒有
免費 API」的需求，可以先假設答案是否定的，把研究力氣放在找「零成本替代方案」而非窮舉更多家
供應商**。找到的兩個可行方案都是**複製本專案既有模式**：Rentalcars Connect（跟住宿的
`buildLodgingLink` 同構的聯盟連結）+ Google Places `car_rental` 類型（複用已經在付費使用的
`places_search` 護欄桶，零新增成本類別）。

**URL 格式不確定時，用 `firecrawl_interact` 實際操作一次拿真實格式，比查文件或用印象猜更可靠**：
Rentalcars Connect 的 deep-link 格式研究階段查不到（網域未解析／首頁 JS 動態表單無暴露欄位名），
改用 `firecrawl_interact` 驅動真實瀏覽器跑一次搜尋（填 pickup/dropoff/日期 → 送出 → 擷取產生的
URL），**第一次呼叫失敗（"Job not found"，重試同一個呼叫就成功，判斷是暫時性問題）**，第二次
拿到完整真實 URL，用 `Grep -o` 從過大的暫存輸出檔案精準截取關鍵字串（比整份讀取有效率很多）。
這個真實 URL 格式（`locationName`/`puDay`/`puMonth`/`puYear`/`puHour`/`puMinute`/`ftsType=C`
等）直接寫進 `lib/car-rental-link.ts`，**沒有再靠猜測**。聯盟 ID 參數名稱（`aid`）則是另外
`firecrawl_search` 查到 Booking.com 官方遷移文件裡 `cars.booking.com` 的範例確認的，兩邊資訊
互相佐證後才落筆，不是單一來源的猜測。

**GLM review 本輪 4 次呼叫全滅（累計 9 輪 2 成功 7 全滅）**：延續 [[glm-review-tool-issues]]
的結論——失敗率高但不可預測，不必再嘗試找規律。自我驗證流程本輪也抓到一個真問題：
`suggestCarRentals` 原本只寫 `includedType: "car_rental"`，用 Context7 查 Google Places API
官方文件才發現「`includedType` 預設只在『適用時』套用，不保證每次都過濾」，要額外加
`strictTypeFiltering: true` 才能保證結果只回 `car_rental` 類型——**這是自己主動送 Context7 查
才發現的落差，不是 GLM 抓到的**（GLM 這次連跑都跑不動），再次印證「自己重讀送審問題清單、
針對每個問題實際查證」比空等 GLM 有產出。
