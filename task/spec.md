# Atlas AI — 行程生成 Spec

> 本文件是「行程生成」功能的唯一規格來源（single source of truth）。
> 涵蓋：資料流、API 契約、Schema、System Prompt 位置、故障模式與診斷順序。

---

## 1. 功能總覽

一句話（V1）或收藏地點（V2）→ Claude Sonnet 生成結構化行程 JSON → Google Routes API 補真實車程（best-effort）→ 前端時間軸呈現 → 可儲存至 Firestore。

```
使用者輸入
   │
   ▼
POST /api/trip/generate        ← Firebase Auth（Bearer ID token）
   │
   ├─ listPlaces(uid)          ← 有勾選 placeIds 時撈收藏
   │
   ▼
generateTrip()                 ← lib/anthropic.ts
   │   model: envOr("ANTHROPIC_MODEL", "claude-sonnet-4-6")
   │   messages.parse + zodOutputFormat(tripSchema)
   │
   ▼
Routes API 增值（best-effort）  ← lib/routes.ts
   │   相鄰兩點車程（n-1 段，上限 20 段）
   │   travelMode: DRIVE | WALK | TRANSIT（使用者選，預設 DRIVE）
   │   失敗不影響主結果，只少一行 insights
   │
   ▼
回傳 { trip }                  → 前端 /trip 頁呈現
   │
   ▼（使用者按「儲存行程」）
POST /api/trips                → Firestore users/{uid}/trips
```

---

## 2. API 契約

### 2.1 POST `/api/trip/generate`

**Request body**（全部欄位可選，但 prompt 和 placeIds 至少要有一個）：

```ts
{
  prompt?: string;        // V1：一句話描述
  placeIds?: string[];    // V2：收藏地點的 placeId 陣列
  days?: number;          // 天數限制
  style?: "relax" | "food" | "nature" | "city";
  budgetMin?: number;
  budgetMax?: number;
  travelMode?: "DRIVE" | "WALK" | "TRANSIT";  // 預設 DRIVE
}
```

**Headers**：`Authorization: Bearer <Firebase ID token>`（必要）

**成功回應** `200`：`{ trip: Trip }`

**錯誤回應**：
| 狀態 | body.error | 原因 |
|---|---|---|
| 401 | （auth 錯誤訊息） | 未登入或 token 過期 |
| 400 | `請求格式錯誤` | body 不是合法 JSON |
| 400 | `伺服器尚未設定 Anthropic 金鑰` | 缺 ANTHROPIC_API_KEY |
| 400 | `請至少輸入一句話或選擇收藏地點` | prompt 和 places 都空 |
| 400 | `AI 無法根據目前輸入生成行程，請調整內容` | Claude refusal / parse 失敗 |
| 400 | `行程生成失敗，請稍後再試` | Anthropic API 錯誤（含餘額不足、無效 model、網路） |

### 2.2 POST `/api/trips`（儲存）

Request：`{ trip: Trip }`（必須通過 tripSchema 驗證）
成功 `200`：`{ trip: SavedTrip }`（含 id、createdAt）

### 2.3 GET `/api/trips`（列表）/ GET `/api/trips/[id]`（單筆）

成功：`{ trips: SavedTrip[] }` / `{ trip: SavedTrip }`

### 2.4 PATCH `/api/trips/[id]`（編輯）

Request：`{ trip: Trip }`（完整行程覆蓋，保留原 createdAt，寫入 updatedAt）
成功 `200`：`{ trip: SavedTrip }`

### 2.5 DELETE `/api/trips/[id]`

成功 `200`：`{ ok: true }`

---

## 3. Trip Schema（schema/trip.ts）

```ts
{
  title: string;              // 旅行名稱，非空
  location: string;           // 主要地區，非空
  style: "relax" | "food" | "nature" | "city";
  summary: string;            // 一句話描述，非空
  days: [                     // 至少 1 天
    {
      day: number;            // 正整數
      schedule: [             // 每天至少 1 項
        {
          time: string;       // 嚴格 HH:mm（regex 驗證）
          title: string;      // 非空
          description: string;// 非空
          type: "transport" | "food" | "place" | "rest";
          location?: string;  // 可選，導航連結優先用這個
        }
      ]
    }
  ];
  insights: string[];         // AI 提醒 + Routes API 車程資訊會 push 進來
  budget: { min: number; max: number };  // max >= min（refine 驗證）
}
```

SavedTrip = Trip + `{ id: string; createdAt: number; updatedAt?: number }`

---

## 4. System Prompt

- 位置：`lib/anthropic.ts` 的 `SYSTEM_PROMPT` 常數
- 內容：使用者提供的「Atlas AI 個人旅行智慧系統」V1/V2/V3 規格**原文，一字不改**
- 輸出約束：只輸出 JSON（實際由 `zodOutputFormat(tripSchema)` structured outputs 強制）

## 5. 模型設定

| 用途 | 環境變數 | 預設值 |
|---|---|---|
| 行程生成 | `ANTHROPIC_MODEL` | `claude-sonnet-4-6` |
| 地點標籤 | `ANTHROPIC_TAGGING_MODEL` | `claude-haiku-4-5-20251001` |

⚠️ 讀取一律用 `envOr()`（lib/env.ts），因為 `.env.local` 的空字串值會讓 `??` fallback 失效（歷史踩雷）。

## 6. Routes API 增值規則（lib/routes.ts）

- 只算「相鄰兩點」實際車程（n-1 段），不做 n×n 矩陣（控制成本）
- 超過 20 段自動跳過
- 座標來源優先序：收藏地點的已知座標 → `resolveCoordinates()`（Places Text Search 名稱解析）
- 任何失敗（API error、缺 key、超段數）都不讓生成失敗，只是 insights 少一行
- 成功時 push：`第 N 天移動時間約 X 分鐘（開車/步行/大眾運輸）`

---

## 7. 故障模式與診斷順序（按歷史踩雷頻率排序）

生成失敗時**照這個順序查**，不要猜：

### ① Anthropic 餘額不足（最常見，發生過）
**症狀**：前端顯示「行程生成失敗，請稍後再試」
**診斷**：直接用 curl / node 腳本打 API 看原始錯誤：
```
status 400 + "Your credit balance is too low"
```
**解法**：console.anthropic.com → Plans & Billing 儲值
**注意**：此故障會連帶讓「匯入地點的標籤」悄悄變空（tagPlaces 失敗被容錯吞掉），儲值後要跑「一鍵批次重新標籤」

### ② .env 空字串 model（發生過）
**症狀**：同上，API 回 invalid model
**診斷**：檢查 `.env.local` 是否有 `ANTHROPIC_MODEL=`（等號後空白）
**解法**：已用 envOr() 根治；若新增環境變數讀取，一律用 envOr()

### ③ Auth token 過期
**症狀**：401
**解法**：前端重新登入；authedFetch 會自動帶新 token

### ④ Claude refusal / schema 驗證失敗
**症狀**：「AI 無法根據目前輸入生成行程」
**原因**：輸入太怪（如空泛到無法排程）或生成的 JSON 不符 tripSchema（time 格式錯、budget min>max）
**診斷**：dev server 終端機看 message.stop_reason
**解法**：調整輸入；若頻繁發生，檢查 System Prompt 與 schema 是否衝突

### ⑤ 檔案整合問題（覆蓋檔案後）
**症狀**：typecheck / build 錯誤，或 dev server 直接掛
**診斷**：`pnpm typecheck && pnpm test && pnpm lint`
**解法**：看錯誤訊息定位；常見是覆蓋時漏了對照表某個檔案、或新舊檔案 import 對不上

### ⑥ Routes API 相關（不會導致生成失敗）
Routes 是 best-effort，就算 GOOGLE_MAPS_API_KEY 失效也只會少 insights，不會讓生成掛掉。如果懷疑 Routes 有問題，看 insights 有沒有「移動時間約 X 分鐘」那行。

---

## 8. 驗證基準

任何改動後必須全綠才算完成：
```bash
pnpm typecheck && pnpm test && pnpm lint
```

實測基準（人工）：
- V1：「週末想去台中放鬆」→ 應生成完整一日時間軸（歷史成功案例：台中城市放鬆行）
- V2：勾選 3+ 個同區域收藏 → 應生成含這些地點的行程
- 儲存 → /trips 列表可見 → 點入檢視 → 編輯（刪除/排序）→ 儲存變更 → 刪除

## 9. 已知限制（非 bug）

- V3（AI 主動推薦）未實作，System Prompt 只是要求模擬
- resolveCoordinates 用名稱模糊比對，非 place_id 精確對應
- 行程生成品質完全依賴 prompt，尚無固定 eval 基準
- Routes API 只估相鄰兩點，不做全域路線最佳化（AI 排序 + 真實車程驗證的組合）
