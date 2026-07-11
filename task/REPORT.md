<!-- 產生日期: 2026-07-11 | 產生模型: claude-fable-5 | 引用 REVIEW.md 時間戳: 2026-07-11 13:55–14:12 (Asia/Taipei)，第 1 輪三批 + 第 2 輪 delta -->

# REPORT — 三項修正：生成天數完整性 / 編輯本地重排 / 航班換源 AeroDataBox

> 依據 GLM 審查：`task/REVIEW.md`。PLAN：`task/PLAN.md`（peanut 2026-07-11 確認：問題一 a+b、問題二 durationMin 替代案＋兩個附帶修補、問題三換 AeroDataBox）。分支：`feat/three-fixes`（off main 73427e5d，未合併，等驗收）。

## 做了什麼

1. **修正一（生成天數完整性）**：SYSTEM_PROMPT 加天數覆蓋硬規則＋輸出範例改雙日；buildUserMessage 天數改硬指令；新 `lib/trip-days.ts`——`inferMinDays`（沒填天數時從 prompt 抽「第N天/N天M夜/N日遊」推最低天數，含慣用語黑名單）＋`checkDayCoverage`（day 從 1 連續、指定→恰好、推斷→至少）；`generateTrip` 生成後驗證、不符帶修正指示自動重試 1 次、再不符回 refusal；schema `superRefine` 驗連續性；max_tokens 隨預期天數 8192–32000 動態調。
2. **修正二（編輯本地重排，免 LLM）**：schema 加 `durationMin`（optional、上限 1440，舊資料免遷移）；新 `lib/trip-edit.ts`——進編輯模式對原始排程差分算「有效時長」（優先序：相鄰 time 差 → durationMin → 60 分）掛在項目上，刪除/排序後以「當天第一項原始時間」為錨點重推所有 time（所見即所得）；附帶修補：儲存時濾過期車程 insights、空天自動移除＋天數重編號（原本會 400 儲存失敗）。
3. **修正三（航班換源）**：新 `lib/aerodatabox.ts` 取代 AviationStack（舊檔保留備查標 deprecated）——`GET /flights/number/{航班號}/{出發日}?dateLocalRole=Departure` 直查該日排定班表（免費層可查未來 365 天）；前端把該列日期一併送查、成功訊息標「YYYY-MM-DD 班表」、未填日期以台灣時區今日近似並提示；route 加收 date 驗格式。

### 與 PLAN 的兩個偏離（均有記錄理由）
- **有效時長優先序**：PLAN 原寫 durationMin 優先，實作改為**差分優先**——刪中間項目時後項剛好提前「被刪項原佔時段」，且舊行程（無 durationMin）重排結果與原排程完全一致；durationMin 補末項與亂序的洞。見 lib/trip-edit.ts 註解。
- **max_tokens 動態調整**：PLAN 修正一未列，但天數硬規則會逼出長輸出，不調會把長天數行程變假性 refusal，屬達成目標的必要配套。

## 改動檔案（17 檔，+852/−72；diff 見 task/diff.patch）

| 檔案 | 變更 |
|---|---|
| `lib/trip-days.ts`（新） | inferMinDays（含 IDIOM_RE 黑名單）+ checkDayCoverage |
| `lib/trip-edit.ts`（新） | timeToMin/minToTime/effectiveDurations/attachDurations/reflowTimes/isRouteInsight |
| `lib/aerodatabox.ts`（新） | lookupFlight(flightNo, dateLocal?) + splitLocalDateTime/pickFlight 純函式 |
| `lib/anthropic.ts` | SYSTEM_PROMPT 天數規則＋durationMin；buildUserMessage 硬指令；generateTrip 重試迴圈＋動態 max_tokens |
| `schema/trip.ts` | durationMin（int/positive/max 1440/optional）；days superRefine 連續性 |
| `app/api/trip/generate/route.ts` | days sanitize（防浮點垃圾值）；車程文案耦合警示註解 |
| `app/trips/[id]/page.tsx` | 編輯草稿掛時長＋錨點重排；儲存清洗（空天移除重編號、過期 insights 過濾、剝 UI 欄位）；提示文案 |
| `app/trip/page.tsx` | 本地型別加 durationMin（pass-through） |
| `app/api/flight/lookup/route.ts` | 換源 aerodatabox；收 date；錯誤文案更新 |
| `components/bookings.tsx` | 查航班帶日期；身分守衛加日期；成功訊息標班表日期/未填提示 |
| `lib/aviationstack.ts` | 檔頭標 deprecated（保留備查） |
| `lib/quotas.ts` / `.env.example` | flight_lookup 註解；AERODATABOX_* 變數 |
| `lib/__tests__/`（4 個新測試檔） | trip-days / trip-edit / trip-schema / aerodatabox |
| `task/SPEC.md` | §3 加 durationMin 與 day 連續性；§4 記錄 prompt 修訂（解除「一字不改」，peanut 核准）與生成後防線 |
| `specs/flight-lookup.md` | 標記 §0–§7 為歷史；新增 §8 換源 AeroDataBox（決策、實作差異、新限制） |

## 測試結果

- `pnpm typecheck`：過（tsc --noEmit 無錯）
- `pnpm test`：**14 files / 133 tests 全過**（新增 40 條：天數推斷/覆蓋 20、時間重排 13、schema 7、AeroDataBox 解析 9…含慣用語與上限回歸）
- `pnpm lint`：過（0 errors 0 warnings）
- `pnpm build`：過（Next.js 16.2.9 production build 成功）

## GLM finding 統計（詳 task/REVIEW.md 仲裁表）

- 兩輪合計：🐛 2、⚠️ 13、💡 9、❓ 8。
- **判真並修掉 8 條**：慣用語黑名單、max_tokens 上蓋 32000、durationMin 上限 1440、prompt 範例錨定、車程文案耦合註解、未填日期改 Asia/Taipei、formatter 模組常數、days sanitize。
- **[FALSE POSITIVE] 2 條**：numFrom「三十」（regex 實際支援、有單測反證）、splitLocalDateTime "08:5"（`\d{2}` 不會匹配）。
- **記錄不修 12 條**：P2 / 既有慣例 / 已核准取捨（各條理由見 REVIEW.md）。

## Known issues / 需要 peanut 決定的事

1. **修正三上線前置（我不能動的部分）**：
   - 請至 https://rapidapi.com/aedbx-aedbx/api/aerodatabox 註冊並訂閱 **BASIC（$0/月，需綁信用卡；600 units≈300 次查詢/月，hard limit 超額只擋請求不扣款）**，把 `X-RapidAPI-Key` 給我或自行放入 Secret Manager（secret 名 `AERODATABOX_API_KEY`）。
   - `apphosting.yaml` 需要的 diff（**等你確認我再改**，改完要重部署才生效）：
     ```yaml
     # env 區塊新增（AVIATIONSTACK_* 兩筆保留不動）：
       - variable: AERODATABOX_API_KEY
         secret: AERODATABOX_API_KEY
     ```
     （`AERODATABOX_BASE_URL` 用程式預設 `https://aerodatabox.p.rapidapi.com`，不必進 yaml。）
   - 拿到 key 後建議先實測 BR/CI/JX/IT 各一班 2 週後航班，比對航司官網時刻（台灣 schedules 覆蓋 94%，台虎為 LCC 建議驗證班表深度）。
2. **本機 `.env.local`**：請自行加 `AERODATABOX_API_KEY=<key>`（我不動 .env.local）。
3. **未合併**：改動都在 `feat/three-fixes`，驗收後再merge 到 main（會觸發 App Hosting 部署——修正三在 key 設好前，查航班會回「伺服器尚未設定 AeroDataBox 金鑰」，修正一/二不受影響）。
4. **殘留已知限制**（已記錄、不阻擋）：AeroDataBox 換季班表最慢約 2 週反映；未填日期以台灣時區近似今日；重排 clamp 在 23:59；superRefine 會擋 Firestore 手改出來的不連續 day 文件（編輯儲存會自我修復）。
5. **人工實測基準（部署後）**：①「第三天要去迪士尼的五天東京行」→ 5 天完整行程且第 3 天含迪士尼；②刪掉行程中午項目 → 下午時間自動提前、舊車程 insights 消失；③查 2 週後 BR198 → 帶入時刻與長榮官網一致、訊息標示班表日期。

**依鐵律停止於此，等待 peanut 驗收。**
