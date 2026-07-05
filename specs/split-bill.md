# Spec — Split Bill Link-out（Atlas → 分帳 app 連結）

## 1. 總覽

行程頁「去分帳」連結 → 帶行程資訊開新分頁到 split-bill → split-bill 依 URL 參數分流到專屬落地頁 → 使用者確認後才建立帳本 → 導回首頁，既有邏輯自然帶出新帳本。

```
Atlas /trips/[id] 頁「去分帳 →」
   │   href = {SPLIT_BILL_URL}/?from=atlas&title=...&days=...&budget=...
   ▼
split-bill main.tsx 讀 URLSearchParams
   │
   ├─ from !== "atlas"  → mount <App />（原本行為，完全不變）
   │
   └─ from === "atlas"  → mount <AtlasImport search={...} />
          │
          ├─ parseAtlasParams()：title 缺失/空白 → 顯示「這個連結不完整」錯誤卡，不寫入任何資料
          │
          └─ title 有效 → 顯示確認卡片（標題/天數/預算）
                 │（使用者點「建立帳本」）
                 ▼
             createTrip(title, {days, budget}) + addMembers(id, members)
                 │
                 ▼
             window.location.href = "/"（整頁導回，非 client navigation）
                 │
                 ▼
             <App /> 既有「預設選最新行程」邏輯（trips[0]，createdAt desc）自然帶出新帳本
```

- Atlas 端：`https://ai-travel-assistant--ai-travel-assistant-20e55.asia-east1.hosted.app`（正式 backend；未來改指 atlas.oioi8.com）
- split-bill 端：本地無後端 PWA，這次**不部署**——`NEXT_PUBLIC_SPLIT_BILL_URL` 未設定時 Atlas 端連結自動隱藏，安全併入 main。

## 2. 契約

### split-bill：`src/lib/atlasParams.ts`

```ts
export type AtlasParams =
  | { ok: true; title: string; days?: number; budget?: number; members: string[] }
  | { ok: false };

export function parseAtlasParams(search: URLSearchParams): AtlasParams;
```

### split-bill：`src/main.tsx` 分流

```ts
const isAtlasHandoff = new URLSearchParams(window.location.search).get("from") === "atlas";
// isAtlasHandoff ? <AtlasImport search={...} /> : <App />
```

### split-bill：`src/db.ts` 擴充

```ts
createTrip(name: string, extra?: { days?: number; budget?: number }): Promise<string>
addMembers(tripId: string, names: string[]): Promise<void>
```

### split-bill：`src/types.ts` 擴充

```ts
export type Trip = {
  id: string;
  name: string;
  createdAt: number;
  days?: number;
  budget?: number; // 分（cents），比照 Expense.amount 的單位慣例
};
```

### Atlas：`app/trips/[id]/page.tsx`

```ts
const SPLIT_BILL_URL = process.env.NEXT_PUBLIC_SPLIT_BILL_URL;
function buildSplitBillHref(base: string, trip: SavedTrip): string;
```

### 參數對照表

| 參數 | 必填 | Atlas 端怎麼產生 | split-bill 端規則 |
|---|---|---|---|
| `from` | 是 | 固定值 `atlas` | 唯一觸發 `AtlasImport` 的條件；其他值/缺參數一律走原本 `App` |
| `title` | 是 | `trip.title` | trim 後為空 → 顯示錯誤卡，不建立任何資料 |
| `days` | 否 | `String(trip.days.length)` | 非正整數 → 忽略，不阻擋建立 |
| `budget` | 否 | `String(trip.budget.max)`（台幣整數） | 轉成分（`toCents`）存入；負數/NaN → 忽略 |
| `members` | 否 | 目前不產生（Atlas 無旅伴資料） | 逗號分隔、trim、去空字串後逐一 `addMember`；缺參數＝空陣列 |

## 3. 設計決策

- **不加 router、不用獨立網址路徑**：分流用 query param（`from=atlas`）判斷，任何靜態主機都不用設定 SPA fallback/rewrite，部署最簡單。
- **分流寫在 `main.tsx` 最上層，不是 `App` 內部條件判斷**：保證兩棵元件樹完全獨立，`<App />` 那行文字不變，零回歸風險。
- **不自動建立帳本，需要明確按鈕點擊**：split-bill 沒有 dedupe key，若落地即自動寫入，重新整理或連結被打開兩次都會造成重複帳本。
- **用整頁導回（`window.location.href`）而非任何 client-side 狀態接力**：沒有 router 可用，且能保證 `AtlasImport` 的狀態/effect 完全卸載，`App.tsx` 重新從 Dexie 查詢。
- **`budget` 存分，對齊 `Expense.amount` 既有慣例**：避免同一個 `Trip` 型別裡混用兩種金額單位；URL 參數本身維持人類可讀的台幣整數，方便肉眼檢查連結內容，轉換發生在 `parseAtlasParams` 這一層。
- **`days`/`budget` 格式錯誤一律安靜忽略，只有 `title` 缺失才視為無效連結**：這是使用者點按鈕真正想要的唯一資訊；天數/預算算加值資訊，壞掉不該擋住建帳本。
- **`members` 目前解析但 Atlas 不產生**：前瞻性支援，Atlas 目前沒有旅伴資料模型。
- **環境變數未設時「去分帳」連結直接不渲染（而非顯示但 disabled）**：split-bill 這次不部署，正式站不會出現半成品按鈕。

## 4. 影響檔案

| 檔案 | Repo | 變更 |
|---|---|---|
| `src/types.ts` | split-bill | `Trip` 加 `days`/`budget` 非必填欄位 |
| `src/db.ts` | split-bill | `createTrip` 加可選第二參數；新增 `addMembers` |
| `src/lib/atlasParams.ts` | split-bill | 新增 |
| `src/lib/atlasParams.test.ts` | split-bill | 新增 |
| `src/AtlasImport.tsx` | split-bill | 新增 |
| `src/main.tsx` | split-bill | 加 `from=atlas` 分流 |
| `src/components/TripView.tsx` | split-bill | 加 days/budget 顯示行（新 header，不是改既有的） |
| `app/trips/[id]/page.tsx` | ai travel assistant | 加 `buildSplitBillHref` + 「去分帳」連結 |
| `.env.example` | ai travel assistant | 加 `NEXT_PUBLIC_SPLIT_BILL_URL` |
| `specs/split-bill.md` | ai travel assistant | 本檔案，新增 |
| `specs/holidays.md` | ai travel assistant | 移除 97-123 行舊草稿，改指向本檔案 |

## 5. 驗證基準

兩邊指令不同：
- Atlas：`pnpm typecheck && pnpm test && pnpm lint`
- split-bill：`pnpm typecheck && pnpm test`（split-bill 目前沒有 `lint` script，既有現況，非本次需修）

實測（本機 `pnpm dev` 兩邊都跑，Atlas `.env.local` 設 `NEXT_PUBLIC_SPLIT_BILL_URL=http://localhost:5173`）：
1. 直接開 split-bill（無 query params）→ 跟改動前完全一樣，不 mount 任何新元件。
2. 從 Atlas 已存行程點「去分帳」→ 確認卡片顯示正確標題/天數/預算 → 點「建立帳本」→ 導回 `/` → `TripSwitcher` 選到新帳本，金額顯示跟 Atlas 上看到的台幣數字一致。
3. 手動打 `?from=atlas`（無 `title`）→ 錯誤卡片，Dexie 沒寫入任何東西。
4. `?from=atlas&title=測試&days=abc&budget=-100` → 確認卡片只顯示標題，天數/預算那行不出現。
5. 確認卡片重新整理兩次才點建立 → 仍然只有一筆帳本。
6. Atlas 端 `NEXT_PUBLIC_SPLIT_BILL_URL` 留空 → 「去分帳」連結不渲染，其餘頁面不受影響。
7. split-bill 開一個舊行程（沒有 days/budget）→ 沒有新的 header 那行，畫面跟改動前一致。

## 6. 故障模式

| 症狀 | 原因 | 解法 |
|---|---|---|
| Atlas 上看不到「去分帳」連結 | `NEXT_PUBLIC_SPLIT_BILL_URL` 未設定，或設完沒重新 build/deploy | `NEXT_PUBLIC_` 變數 build 時內嵌，改完要重新 `next build`/重新部署 |
| 分帳 app 顯示「這個連結不完整」 | `title` 參數遺失/被截斷（連結被手動修改或轉貼時截斷） | 檢查 query string 是否完整；正常情況不會發生，因為 `trip.title` 是 zod `min(1)` 必填欄位 |
| 同一趟旅行出現多筆重複帳本 | 對同一個連結按了不只一次「建立帳本」（不同分頁，或重新整理後再點一次） | 已知限制，設計上刻意不做 dedupe；多餘帳本需使用者自行刪除 |
| 天數/預算沒有顯示在帳本裡 | 該帳本是用「＋ 新行程」手動建立的，本來就沒有這兩個欄位 | 正常行為，非 bug；只有透過 Atlas 建立的帳本才帶這些值 |

## 7. 已知限制（非 bug）

- 重複帳本沒有 dedupe 機制（見故障模式）。
- `target="_blank"` 是判斷取捨：讓使用者分帳時行程頁還開著可以對照。
- split-bill 沒有 `lint` script，沿用既有現況。
- split-bill 這次未部署；階段 2（資料互通，Atlas 顯示「這趟花了多少」）待階段 1 使用一陣子後有痛點再評估。
