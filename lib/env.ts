// 讀取環境變數，把空字串也當成「沒設定」（.env 常見的 KEY= 空值陷阱）
export function envOr(key: string, fallback: string): string {
  const value = process.env[key];
  return value && value.trim() !== "" ? value : fallback;
}
