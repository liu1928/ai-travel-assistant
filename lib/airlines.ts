// 2 碼 IATA 航空公司代碼 → 中文名稱。純資料 + 純函式、可 client 用（離線、零 API）。
// 見 specs/flight-airline-autofill.md。以台灣出發常見航線為主，缺的補進表即可（零風險）。

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

/**
 * 從航班號取航空公司名稱。純函式、離線查表。
 * 規則：前 2 碼英數為 IATA 代碼，且後面要接數字才算航班號（避免打一半就亂填）。
 * 未知代碼或格式不符 → undefined（呼叫端就不自動填）。
 */
export function airlineFromFlightNo(flightNo: string): string | undefined {
  const s = flightNo.trim().toUpperCase();
  const m = s.match(/^([0-9A-Z]{2})\s?\d/);
  if (!m) return undefined;
  return IATA_AIRLINES[m[1]];
}

/**
 * 航班號變更時算出新的航空公司欄值，維持 autofill 語意（純函式、可單測）：
 * - 使用者手填的航空公司（非 autofill 帶的）→ 一律不動。
 * - 空的、或先前是 autofill 帶的 → 依新航班號更新；新代碼未知時把殘留的 autofill 值清掉。
 */
export function nextAirline(oldFlightNo: string, oldAirline: string, newFlightNo: string): string {
  const wasAutofilled = oldAirline !== "" && oldAirline === airlineFromFlightNo(oldFlightNo);
  const userTyped = oldAirline.trim() !== "" && !wasAutofilled;
  if (userTyped) return oldAirline;
  return airlineFromFlightNo(newFlightNo) ?? (wasAutofilled ? "" : oldAirline);
}
