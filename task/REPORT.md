<!-- 產生日期: 2026-07-09 | 產生模型: claude-opus-4-8 | 引用 REVIEW.md 時間戳: 2026-07-09 17:3x（Asia/Taipei）| 下次審視: 做 Foundation B/C/D/E 或部署 firestore.rules 前 -->

# REPORT — Foundation Hardening 項目 A：每日用量護欄

> 任務來源：`specs/foundation-hardening.md` 項目 A（升級藍圖第一步）。計畫見 `task/PLAN.md`。
> 依 CLAUDE.md Executor 流程完成：實作 → 自我驗證 → GLM 審查（`task/REVIEW.md`）→ 仲裁 → 本報告。
> **未宣告 Done——等 peanut 驗收。**

## 1. 改了哪些檔案（14 檔，+297 行，純新增無刪改）

| 檔案 | 改動 |
|---|---|
| `lib/quotas.ts`（新） | 成本表 `SERVICE_COST_USD` + 每日預算（`USER=2` / `GLOBAL=10`，`numEnv` 防呆可 env 覆寫） |
| `lib/rate-limit.ts`（新） | 純函式 `decide()` / `taipeiDate()` / `secondsToTaipeiMidnight()`；Firestore token bucket `checkAndConsume()`（fail-open）；`rateLimitHttp()` 對映 |
| `lib/__tests__/rate-limit.test.ts`（新） | `decide` / 時間換算 / clamp 回歸，共 9 個 case |
| `firestore.rules`（新） | `usage/**` 與 `users/{uid}/**` 全鎖（Admin SDK 專用；縱深防禦） |
| `firebase.json` | 掛 `firestore.rules` |
| `.env.example` | 加 `QUOTA_USER_DAILY_USD` / `QUOTA_GLOBAL_DAILY_USD` 註解 |
| 8 個付費 route | `requireUid` 後插 gate：`places` / `trip.generate` / `import.{takeout,sharelink,extension}` / `collection`(POST) / `collection.retag` / `collection.retag-empty`（extension 併 CORS headers） |

**行為**：per-uid 每日累積預估花費超過 `$2` → 該入口回 `429 + Retry-After`；全域超過 `$10` → 所有付費入口回 `503` 熔斷。計數存 Firestore `usage/{uid}__{台北日期}` 與 `usage/__global__{台北日期}`，用 `runTransaction` 原子累加。純讀取入口（`/api/dna`、`GET /api/collection`、行程列表）不限流。

## 2. 測試結果

```
pnpm typecheck  → ✓（tsc --noEmit 無錯）
pnpm test       → ✓ 3 files / 32 passed（新增 rate-limit 9 case，含 clamp 回歸）
pnpm lint       → ✓（eslint 無輸出）
```
> `checkAndConsume` 的 Firestore wiring 屬薄殼（決策邏輯已抽純函式單測），需 peanut 在真環境實測限流觸發（見 §5）。

## 3. GLM finding 統計（詳見 `task/REVIEW.md`）

- 🐛 2：**1 真已修**（負數 cost 繞過 → `checkAndConsume` 加 `Math.max(0, cost)` clamp + 回歸測試）、1 P2 不修
- ⚠️ 3：**2 FALSE POSITIVE**（① transaction 一致性 reviewer 自認現況正確；② `Retry-After` delta-seconds 與客戶端時區無關，reviewer 誤解語意）、1 P2 不修
- 💡 2：1 部分採納（用 clamp 取代移除 `cost` 參數，保留給 item B）、**1 FALSE POSITIVE**（rules `read` 已涵蓋 `list`，無需另寫）
- ❓ 3：全數已釐清

**唯一實質修正**：負數 cost clamp（🐛-1）。其餘經實際驗證為誤判或刻意設計取捨，均在 REVIEW.md 附理由。

## 4. 需 peanut 決定 / 執行的事

1. **部署 `firestore.rules`**（禁動清單，我不自動跑）。請你執行：
   ```
   ! firebase deploy --only firestore:rules
   ```
   （功能上 client 本就不直連 Firestore，未部署也不影響限流運作；此步為縱深防禦。）
2. **正式站 quota 生效**：程式 default 已是 `USER=2/GLOBAL=10`，App Hosting 直接生效無需設 env。若要調整，在 `apphosting.yaml` 加 `QUOTA_USER_DAILY_USD` / `QUOTA_GLOBAL_DAILY_USD`（改 yaml 要重部署才生效）。
3. **緊急關閉付費 API（kill-switch）**：設 `QUOTA_GLOBAL_DAILY_USD=0.001`（極小正值）即第一次呼叫就熔斷；**勿設 `0`**（`0` 視為無效設定會退回預設 10，見 REVIEW 🐛-2）。

## 5. Known issues / 待實測

- **Firestore 限流實測**：把 `QUOTA_USER_DAILY_USD` 暫設極小 → 連打 `/api/trip/generate` 應在第 2 次回 429；`QUOTA_GLOBAL_DAILY_USD` 極小 → 回 503；還原後一般使用正常。（自動化只覆蓋純邏輯，交易層需真環境。）
- **fail-open 取捨（你已拍板）**：Firestore 交易本身故障時放行 + log，護欄短暫失效——換取不因 Firestore 抖動癱瘓全站。
- **成本是粗估上界**，非精算帳單；GCP/Anthropic budget alert 照設，不被本功能取代。
- **未來放大 `maxInstances`** 需重估交易競爭與 fail-open 影響（已記 `specs/foundation-hardening.md §11`）。

## 6. 後續（不在本輪，各自獨立任務）

Foundation Hardening 還有 **B**（匯入筆數上限 + 標籤分批，會把 `import_resolve` 改逐筆計費）、**C**（車程 coords 壓縮 bug）、**D**（批次標籤靜默空標籤）、**E**（記帳頁入口）。之後可接 `specs/persona-mode.md`（分身模式）與 `specs/reverse-curation.md`（反向策展）。

---
**狀態：實作完成、驗收未過。等 peanut 確認後才可宣告 Done。**
