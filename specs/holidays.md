# Spec — Holidays（日曆/連假感知行程）

## 1. 總覽

使用者填出發日期 → 後端偵測目的地國家 → 查當地假日（行程期間 ± 1 天緩衝）→ 餵進 AI 的 user message → AI 調整行程避開人潮 + insights 提醒。

```
/trip 表單「出發日期」（可留空）
   │
   ▼
POST /api/trip/generate { startDate: "YYYY-MM-DD", ... }
   │
   ├─ guessCountry(地址+名稱+prompt)   ← lib/holidays.ts
   │     地址字串比對關鍵字（日本/Japan/沖繩...→ JP），預設 TW
   │
   ├─ holidaysInRange(country, startDate, days)
   │     TW → TaiwanCalendar 開源 JSON（含補班補假）
   │     其他 → Nager.Date 免費公開 API（免金鑰）
   │
   ▼
generateTrip({ ..., startDate, holidays })
   │     user message 附上假日清單 + 指令：
   │     「熱門景點避開假日尖峰、餐廳提醒訂位、insights 明確提醒」
   ▼
行程 JSON（insights 含人潮預警）
```

## 2. 契約

### lib/holidays.ts

```ts
type Holiday = { date: string; name: string };  // date: YYYY-MM-DD

guessCountry(texts: string[]): string
// 關鍵字比對：JP/KR/TH/VN/SG/MY/HK/US，預設 "TW"

holidaysInRange(countryCode: string, startDate: string, days: number): Promise<Holiday[]>
// 範圍 = startDate 前 1 天 ~ startDate + days 天
// 跨年份自動查兩年
// 任何錯誤回 []（best-effort）
```

### 資料來源

| 國家 | 來源 | 特性 |
|---|---|---|
| TW | `cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/{year}.json` | 含台灣特有補班/補假/彈性放假，免金鑰 |
| 其他 | `date.nager.at/api/v3/PublicHolidays/{year}/{code}` | 免費免金鑰，涵蓋 100+ 國 |

### generateTrip 新增輸入

```ts
{
  startDate?: string;              // YYYY-MM-DD
  holidays?: { date, name }[];     // 查到的假日
}
```

user message 附加內容：
- 出發日期 + 星期幾（讓 AI 知道是不是週末）
- 假日清單 + 明確指令（避尖峰/訂位提醒/insights 預警）

## 3. 設計決策

- **best-effort 哲學**（與 Routes API 一致）：假日查詢任何失敗都不影響行程生成，只是少了人潮預警
- **不存資料庫**：假日資料即查即用，不快取（個人規模，查詢次數極低）
- **國家偵測用關鍵字**而非 geocoding API：零成本、夠準（誤判時 AI 拿到不相關假日也不會壞事，頂多 insights 多餘）
- **startDate 不存入 Trip schema**：目前只作為生成 context；未來若要「行程綁定日期」再擴充 schema

## 4. 影響檔案

| 檔案 | 變更 |
|---|---|
| `lib/holidays.ts` | 新增 |
| `lib/anthropic.ts` | GenerateTripInput 加 startDate/holidays；user message 組裝 |
| `app/api/trip/generate/route.ts` | 接收 startDate、查假日、傳入 |
| `app/trip/page.tsx` | 表單加「出發日期」date input |

## 5. 驗證基準

- 碼層：`pnpm typecheck && pnpm test && pnpm lint` 全綠
- 實測 1：出發日期選台灣連假（如 2026-09-25 教師節連假前後）→ insights 應出現人潮提醒
- 實測 2：日期留空 → 行為與之前完全相同
- 實測 3：勾選沖繩群組地點 + 填日期 → 應查日本假日（可從 insights 內容判斷）

## 6. 故障模式

| 症狀 | 原因 | 解法 |
|---|---|---|
| 沒有人潮提醒 | 期間真的沒假日 / 資料源掛了（best-effort 吞掉） | 正常；懷疑資料源時直接開瀏覽器打 API URL 確認 |
| 國家偵測錯誤 | 地址無關鍵字 | 補 guessCountry 規則；影響輕微 |
| TaiwanCalendar 該年份 404 | 年度資料尚未發布 | 自動回空陣列；等上游更新 |

---

分帳串連（Expense Integration）規劃已經促成獨立 spec，見 [`specs/split-bill.md`](./split-bill.md)。
