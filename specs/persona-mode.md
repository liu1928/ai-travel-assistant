# Spec — Persona Mode（分身模式：讓 Travel DNA 真正驅動生成）※ 規劃中，未實作

> 狀態：spec 已定稿待實作。實作時照本文件執行；有歧義回來改本文件，不要口頭發散。
> 前置：建議 `specs/foundation-hardening.md` 的 A（用量護欄）先落地，因本功能會略增每次生成的 input token。

## 0. 為什麼是這份（最高 CP 值的一補）

**全案最諷刺的缺口**：產品定位是「收藏驅動的個人化」，但 `lib/travel-dna.ts` 聚合出的整體偏好分布**從來沒進過生成 prompt**。`lib/anthropic.ts` 的 `buildUserMessage` 只把「勾選地點」的 `name/tags/address` 逐條列出，使用者的**長期風格畫像完全沒帶進去**。結果是：同樣輸入「沖繩 3 天」，你和陌生人拿到幾乎一樣的行程。而 `SYSTEM_PROMPT` 還花大段要 AI「模擬 V3 主動推薦 / 推測偏好」——那是沒有真實訊號餵它的 dead prompt。

本 spec 用**一個低風險、估工 S 的改動**：把 `computeTravelDna` 的結果注入生成 prompt，讓個人化名符其實，並兌現 ROADMAP 說的「V3 主動推薦第一步」。

## 1. 總覽

```
POST /api/trip/generate    ← Firebase Auth
   │
   ├─ (既有) 有勾選 placeIds → listPlaces(uid) 撈收藏
   │
   ├─ (新增) computeTravelDna(uid)   ← lib/travel-dna.ts，已存在
   │         └ TravelDna { totalPlaces, tagCounts[], topTags[], summary }
   │
   ▼
generateTrip({ ..., dna })  ← lib/anthropic.ts
   │   buildUserMessage 新增一段「使用者長期旅行偏好畫像」
   │   SYSTEM_PROMPT 新增：每個 stop 的 description 需連結收藏 pattern（可稽核）
   │                       + 每天保留 1 個「反 DNA 驚喜位」並說明理由
   │
   ▼
tripSchema 結構化輸出（schema 不動）→ 前端時間軸
```

**核心**：DNA 只影響「生成時餵給模型的 user message + system 指令」，**`tripSchema`（AI 輸出 schema）一個字都不動**——沿用本專案「航班/租車不進 schema」的分層哲學，DNA 是輸入訊號不是輸出欄位。

## 2. 契約

### 2.1 `lib/anthropic.ts` — `GenerateTripInput` 新增

```ts
import type { TravelDna } from "./travel-dna"; // type-only import，無 runtime 循環依賴

export type GenerateTripInput = {
  // ...既有欄位不變（prompt/places/days/style/budget/startDate/holidays/flights/carRentals）
  dna?: TravelDna; // 使用者長期偏好畫像，可選；缺席或收藏太少則不注入
};
```

### 2.2 `buildUserMessage` 新增段落（比照 holidays 的作法，有資料才附）

注入條件：`dna && dna.totalPlaces >= DNA_MIN_PLACES`（預設 5；冷啟動收藏太少時偏好是雜訊，不注入）。

格式（範例）：

```
使用者長期旅行偏好畫像（依歷史收藏聚合，供個人化排程參考）：
- 主要偏好：咖啡 42%、海景 31%、文化 18%（共 37 個收藏）
- 一句話：你的收藏偏好咖啡、海景，看起來是個喜歡這類行程的旅人。

請據此個人化：
- 盡量從使用者收藏或符合上述偏好的方向選點與排序。
- 每個景點/餐飲的 description 至少有一句「為你而選」的理由，並盡量引用可驗證的收藏證據
  （例：「你收藏的咖啡有 8 成是老宅改建，這間也是」），不要空泛恭維。
- 每天刻意保留 1 個「略微跳出你既有偏好」的探索點，並在該 stop 的 description 說明為什麼想幫你破框。
```

- 百分比取 `tagCounts` 的 `ratio`，只列前 3–4 個非零 tag。
- 段落保持精簡（控制 input token）。

### 2.3 `SYSTEM_PROMPT` 調整（`lib/anthropic.ts`）

- 移除／改寫 V3「模擬主動推薦」那段虛假指示（`lib/anthropic.ts` 約 60–69 行）——改成明確「若提供偏好畫像，據此個人化」的真實指令。
- 加入「為你而選」理由與「反 DNA 驚喜位」的行為要求（與 §2.2 呼應，避免只寫在 user message）。
- **不改** `tripSchema`、不改輸出 JSON 範例的欄位結構。

### 2.4 `app/api/trip/generate/route.ts`

- 在撈收藏後、呼叫 `generateTrip` 前，`const dnaResult = await computeTravelDna(auth.value);`
- **best-effort**：`computeTravelDna` 失敗（回 `err`）→ 不阻擋生成，`dna` 傳 `undefined`（比照 holidays/Routes 的降級哲學，DNA 是加值訊號）。
- 成功則把 `dnaResult.value` 傳入 `generateTrip({ ..., dna })`。

## 3. 設計決策

- **DNA 是輸入不是輸出**：絕不進 `tripSchema`（否則 structured output 會逼模型「生成」偏好數字）。沿用航班/租車的分層原則。
- **`totalPlaces < DNA_MIN_PLACES` 不注入**：冷啟動收藏太少，偏好分布是雜訊，硬注入會讓行程過擬合到 1–2 個 tag。
- **失敗降級不阻擋**：DNA 查詢失敗只是少個人化，不讓主生成掛掉（與 holidays/Routes 一致）。
- **「反 DNA 驚喜位」是刻意設計**：純注入偏好會讓行程僵化（只給咖啡）。保留每天 1 個探索點，讓分身「懂你 + 敢挑戰你」——這個張力才是競品的關聯過濾抄不走的口音。
- **「為你而選」要求可驗證證據**：避免公式化空話（「這很適合你」），要求引用收藏 pattern 的具體數字，順帶壓低編造風險（只講有資料根據的事）。
- **type-only import 避免耦合**：`anthropic.ts` 用 `import type { TravelDna }`，不引入 `travel-dna.ts` 的 runtime（後者相依 firebase-admin）。`buildUserMessage` 維持純函式、可單測。
- **prompt caching 界線**：固定 `SYSTEM_PROMPT` 前綴適合日後加 `cache_control`（另案），但 DNA 段落是**動態**、放在 user message，不快取——本 spec 不處理 caching，只確保 DNA 段落不污染可快取的固定前綴。

## 4. 影響檔案

| 檔案 | 變更 |
|---|---|
| `lib/anthropic.ts` | `GenerateTripInput` 加 `dna?`；`buildUserMessage` 加偏好畫像段落；`SYSTEM_PROMPT` 改寫 V3 段 + 加「為你而選 / 反 DNA 驚喜位」指令 |
| `app/api/trip/generate/route.ts` | 生成前 `computeTravelDna(uid)`，best-effort 傳入 |
| `lib/__tests__/anthropic.test.ts`（或新增） | 測 `buildUserMessage`：有 DNA 且 `totalPlaces>=5` → 含畫像段；`<5` 或無 DNA → 不含；純函式好測 |

> 3 檔以內，可直接做但仍寫 `task/PLAN.md` 記錄步驟（依 `CLAUDE.md`）。

## 5. 驗證基準

```bash
pnpm typecheck && pnpm test && pnpm lint
```

實測：
1. 收藏 ≥ 5 個、偏好明顯（如多為咖啡）→ 生成行程的 stop description 出現引用收藏 pattern 的「為你而選」理由；且每天有一個明說「幫你破框」的探索點。
2. 收藏 < 5 個 → 不注入畫像，生成行為與現在一致（回歸不破）。
3. `computeTravelDna` 故意失敗（如斷 Firestore）→ 生成仍成功，只是沒個人化（best-effort 降級）。
4. 同一句「沖繩 3 天」在兩個偏好不同的帳號 → 產出的選點/理由**明顯不同**（個人化名符其實的人工判斷）。
5. `buildUserMessage` 單測涵蓋注入門檻與段落格式。

## 6. 故障模式

| 症狀 | 原因 | 解法 |
|---|---|---|
| 行程只給咖啡、太單調 | 偏好注入過強、探索位沒生效 | 檢查 SYSTEM_PROMPT 的「反 DNA 驚喜位」指令是否被遵守；必要時強化措辭或加 few-shot |
| description 的「為你而選」很公式化 | 缺可驗證證據約束 | 確認 prompt 要求引用具體收藏數字；補多樣句式示範 |
| 新帳號行程跟以前一樣 | `totalPlaces < 5` 未注入（預期） | 正常；收藏多了自然個人化 |
| input token / 成本上升 | DNA 段落 + 更長 description | 段落已精簡；搭配 `foundation-hardening` 的用量護欄與日後 caching |
| typecheck 報循環依賴 | 誤用 runtime import 而非 type-only | 確認是 `import type { TravelDna }` |

## 7. 已知限制（非 bug）

- **V3 完整版不在本 spec**：本 spec 只做「把 DNA 注入生成」。「使用者只給模糊 prompt / 不勾地點時，系統自動從收藏依偏好挑 top-k 餵生成（autoPick）」是 V3 下一步，另開 spec。
- **DNA 仍是淺層 count/ratio**：語意 embedding、地理聚類（「沖繩控 vs 咖啡控」多重人格）、時間窗（近期 vs 歷史）都不在本 spec，屬 Travel DNA v2 的後續。
- **無 eval**：個人化品質仍壓在 prompt 上；`foundation-hardening` 之後可接行程 eval harness 驗「個人化前後」的回歸（另案）。
- **偏好過擬合風險**：靠「反 DNA 驚喜位」緩解，非根治；需人工觀感調校。
