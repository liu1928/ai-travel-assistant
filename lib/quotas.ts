// ⚠️ 伺服器端專用：付費 API 用量護欄的成本表與每日預算設定
// 見 specs/foundation-hardening.md 項目 A、task/PLAN.md。
import { envOr } from "./env";

// 每次呼叫的「預估成本」美金（粗估上界，只為相對比較與熔斷，非精算帳單）。對照 COSTS.md 費率。
export const SERVICE_COST_USD = {
  places_search: 0.02, // Places Text Search 一次
  trip_generate: 0.06, // Sonnet 一次 + 數次 Places/Routes 的粗估上界
  tagging_batch: 0.01, // Haiku 批次/單筆一次
  import_resolve: 0.05, // 每次匯入請求固定（逐筆計費留待項目 B 的 MAX_IMPORT）
} as const;
export type PaidService = keyof typeof SERVICE_COST_USD;

// envOr 回非正數/非數字時退回預設（.env 常見的 KEY= 空值或誤填）
function numEnv(key: string, def: number): number {
  const n = Number(envOr(key, String(def)));
  return Number.isFinite(n) && n > 0 ? n : def;
}

// peanut 定（2026-07-09）：使用者每日 $2、全域每日 $10。env 仍可覆寫。
export const USER_DAILY_BUDGET_USD = numEnv("QUOTA_USER_DAILY_USD", 2);
export const GLOBAL_DAILY_BUDGET_USD = numEnv("QUOTA_GLOBAL_DAILY_USD", 10);

// 每日匯入解析上限（筆數，與 $ 護欄不同維度）。批次匯入的成本隨筆數增長，
// 但一次合法大匯入（數百筆）不該被 $2 預算擋掉；改用筆數上限：放行一兩次大匯入、
// 擋住「反覆大量匯入」把 Places 呼叫放大。預設 800，env 可覆寫。
export const USER_DAILY_IMPORT_LIMIT = numEnv("QUOTA_USER_DAILY_IMPORTS", 800);
