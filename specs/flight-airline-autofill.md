# Spec — Flight Airline Autofill（打航班號自動帶航空公司）※ 規劃中，未實作

> 狀態：spec 已定稿待實作。實作時照本文件執行；有歧義回來改本文件，不要口頭發散。
> 這是「航班號 autofill」的**第一層（零 API、零成本、離線）**：只帶「航空公司名稱」。
> 帶航線+起降時刻的第二層（需 AeroDataBox/AviationStack 等付費 API + 日期）另開 spec，本輪不做。

## 0. 為什麼只帶航空公司名

- 航班號前 2 碼是 **IATA 航空公司代碼**（BR=長榮、CI=華航、JX=星宇…），可用**內建對照表離線查**，零 API、零成本、即時。
- 航線與起降**時刻**光靠航班號不夠（同航班號每天飛，需加「日期」查即時 API），且**必須來自真實航班 API、不能用 Claude 猜**——`specs/flights-rentals.md §3` 就是為了「防 AI 編造航班號/時刻」才把航班設計成手填。本層維持這個原則（純字典查表，非 AI）。

## 1. 總覽

`/trip` 生成表單與 `/trips/[id]` 編輯器共用的航班動態清單（`components/bookings.tsx` 的 `BookingsFields`）中：使用者在「航班號」欄輸入（如 `BR198`）→ 前端即時解析前 2 碼 → **若「航空公司」欄目前是空的，自動填入航空公司名稱**（長榮航空）。使用者仍可手動覆寫；已填的航空公司**不會被蓋掉**。

```
使用者在「航班號」input 打字 "BR198"
   │
   ▼
airlineFromFlightNo("BR198") → "長榮航空"（lib/airlines.ts，純函式離線查表）
   │
   ├─ 該筆 draft.airline 為空 → 一併 setFlight(airline = "長榮航空")
   └─ 該筆 draft.airline 非空（使用者已填）→ 不動
```

## 2. 契約

### 2.1 `lib/airlines.ts`（新，可在 client 用——純資料+純函式，無伺服器依賴）

```ts
// 2 碼 IATA 航空公司代碼 → 中文名稱（curated，以台灣/亞洲常見航線為主，可再擴充）
export const IATA_AIRLINES: Record<string, string> = {
  BR: "長榮航空", CI: "中華航空", JX: "星宇航空", AE: "華信航空", B7: "立榮航空", IT: "台灣虎航",
  JL: "日本航空", NH: "全日空", CX: "國泰航空", HX: "香港航空", UO: "香港快運",
  MU: "中國東方航空", CZ: "中國南方航空", CA: "中國國際航空", MF: "廈門航空",
  SQ: "新加坡航空", TR: "酷航", TG: "泰國航空", KE: "大韓航空", OZ: "韓亞航空", "7C": "濟州航空",
  VN: "越南航空", VJ: "越捷航空", PR: "菲律賓航空", "5J": "宿霧太平洋", MH: "馬來西亞航空", "3K": "捷星亞洲",
  QF: "澳洲航空", NZ: "紐西蘭航空",
  UA: "聯合航空", AA: "美國航空", DL: "達美航空",
  AF: "法國航空", LH: "漢莎航空", BA: "英國航空", KL: "荷蘭皇家航空",
  EK: "阿聯酋航空", QR: "卡達航空", TK: "土耳其航空",
};

// "BR198" / "br 198" → "長榮航空"；未知代碼或格式不符 → undefined（呼叫端就不自動填）
export function airlineFromFlightNo(flightNo: string): string | undefined;
```

- 解析規則：`trim`→大寫→取前 2 個英數字元當代碼，且**後面要接數字**才算航班號（`^([0-9A-Z]{2})\s?\d`），避免使用者才打 1-2 個字就亂填。查 `IATA_AIRLINES`，找不到回 `undefined`。

### 2.2 `components/bookings.tsx`

- 航班號 input 的 `onChange` 改成一個小 handler：先 `setFlight(i, "flightNo", value)`，再**只有當 `flights[i].airline.trim() === ""`** 時，`const name = airlineFromFlightNo(value); if (name) setFlight(i, "airline", name)`。
- 因為 `setFlight` 是「以 `flights` 為基準 map 出新陣列」，兩個欄位要在**同一次 `onFlightsChange`** 更新（避免用舊 state 覆寫）：實作時合併成一次 `onFlightsChange(flights.map(...))` 同時更新 flightNo + airline，或用 functional 更新確保不掉更新。
- 其餘表單邏輯（`draftsToBookings` 驗證、必填檢查）完全不動。

## 3. 設計決策

- **離線查表、非 AI**：沿用 flights-rentals spec「航班不讓 AI 生成」的原則；查表是確定性資料，不引入編造風險。
- **不覆寫使用者已填的航空公司**：autofill 只在欄位空白時作用，尊重手動輸入（例如廉航代碼共用、或使用者想填英文名）。
- **未知代碼不填**（回 undefined），不亂猜、不填錯。
- **表是 curated 子集**：以台灣出發常見航空為主，漏的之後補進 `IATA_AIRLINES` 即可（純資料變更、零風險）。
- **只帶名稱、不帶航線/時刻**：後者需付費 API + 日期，屬第二層另開 spec；本層維持零成本、零 key、零伺服器改動。

## 4. 影響檔案

| 檔案 | 變更 |
|---|---|
| `lib/airlines.ts` | 新增：`IATA_AIRLINES` 表 + `airlineFromFlightNo` 純函式 |
| `lib/__tests__/airlines.test.ts` | 新增：常見代碼、含空白、小寫、未知代碼→undefined、只打代碼沒數字→undefined |
| `components/bookings.tsx` | 航班號 `onChange` 加「空白才 autofill 航空公司」邏輯 |

## 5. 驗證基準

```bash
pnpm typecheck && pnpm test && pnpm lint
```
實測：
1. 航班號欄打 `BR198` → 航空公司欄自動變「長榮航空」。
2. 先手動在航空公司填「EVA Air」→ 再打航班號 `BR198` → 航空公司**維持** EVA Air（不被蓋）。
3. 打 `ZZ999`（未知代碼）→ 航空公司欄維持空白，不亂填。
4. 只打 `BR`（還沒數字）→ 不觸發 autofill。
5. 既有航班/租車儲存、生成流程完全不受影響（純前端便利功能）。

## 6. 故障模式

| 症狀 | 原因 | 解法 |
|---|---|---|
| 打了航班號沒帶出航空公司 | 代碼不在 `IATA_AIRLINES`，或後面還沒接數字 | 補代碼進表；正常情況打完整航班號才觸發 |
| 帶錯航空公司 | 表裡代碼對應錯 | 修 `IATA_AIRLINES`；使用者可手動覆寫 |
| 自動填蓋掉我手打的航空公司 | autofill 沒檢查「欄位為空」 | 確認只有 `airline.trim()===""` 才 autofill |

## 7. 已知限制（非 bug）

- 只帶**航空公司名稱**，不帶航線/起降時刻/日期（需付費航班 API + 日期，屬第二層另開 spec）。
- 代碼表是 curated 子集，罕見航空可能查不到（回 undefined，使用者手填）。
- 共用代碼 / 區域子公司（如某些廉航）可能對應到母公司名，非 bug。
