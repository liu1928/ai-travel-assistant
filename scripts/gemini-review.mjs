// Gemini diff review（CLAUDE.md 步驟 4 用）——直接打 REST API，不走 gemini CLI。
// 原因：agentic CLI 遇到 429（額度不足）會靜默無限重試，看起來像卡死（實測 19+ 小時），
// REST 直呼則錯誤立刻浮現。詳見 task/MEMORY.md 2026-07-03 條目。
//
// 用法（在專案根目錄執行）：
//   git diff > task/diff.patch          # 或 git show <commit> --format="" > task/diff.patch
//   node scripts/gemini-review.mjs > task/REVIEW.md
//
// GEMINI_API_KEY 從 .env.local（gitignored）自動載入；也可用環境變數覆寫。
// 輸出寫到 stdout，由呼叫端決定導向；錯誤走 stderr + 非零 exit code。
import fs from "fs";

if (!process.env.GEMINI_API_KEY) {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // .env.local 不存在就算了，下面統一報錯
  }
}
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("缺 GEMINI_API_KEY：請在 .env.local 加一行 GEMINI_API_KEY=<key>（見 .env.example）");
  process.exit(1);
}

const diffPath = process.argv[2] ?? "task/diff.patch";
let diff;
try {
  diff = fs.readFileSync(diffPath, "utf8");
} catch {
  console.error(`讀不到 diff 檔：${diffPath}（先跑 git diff > task/diff.patch）`);
  process.exit(1);
}

const prompt = `你是 code reviewer，只找問題、不做決策、不寫修正程式碼。
以下是一個 Next.js + TypeScript + zod + Firebase 專案的 diff。
請直接依據這份 diff review，依嚴重度分類列出：
- P0：會造成資料損毀、安全漏洞、production 掛掉
- P1：明確 bug、race condition、edge case 遺漏
- P2：可讀性、風格、小改善
每條 finding 附上：檔案位置、你懷疑的原因、如何驗證。
沒有問題就明確說「無 P0/P1 finding」。

=== DIFF 開始 ===
${diff}
=== DIFF 結束 ===`;

const res = await fetch(
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
  {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
    }),
  },
);

if (!res.ok) {
  console.error(`Gemini API 錯誤 HTTP ${res.status}：${await res.text()}`);
  process.exit(1);
}

const data = await res.json();
const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
if (!text) {
  console.error(`空回應：${JSON.stringify(data).slice(0, 2000)}`);
  process.exit(1);
}
console.log(text);
console.error(`OK（${text.length} 字，finishReason: ${data.candidates?.[0]?.finishReason}）`);
