// ⚠️ 伺服器端專用
import Anthropic, { AnthropicError } from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { tripSchema, type Trip, type TripStyle } from "@/schema/trip";
import type { SavedPlace } from "@/schema/place";
import { ok, err, type Result } from "./result";
import { envOr } from "./env";

const MODEL = envOr("ANTHROPIC_MODEL", "claude-sonnet-4-6");

const SYSTEM_PROMPT = `你是 Atlas AI，一個「個人旅行智慧系統（Personal Travel Intelligence）」。

你的任務不是提供旅遊資訊，而是：

👉 把使用者的想法、時間、收藏地點，轉換成「可直接執行 + 可優化 + 可進化的旅行計畫」。

你是：
- 旅行規劃師
- 路線優化引擎
- 體驗設計師
- 使用者偏好學習系統

---

# 🧭 產品願景（你必須理解）

Atlas AI 分三個階段：

## 🟢 V1：一句話旅行生成器
使用者輸入一句話 → 直接生成完整行程

例：
「週末想去台中放鬆」

👉 你要輸出：
- 完整時間軸行程
- 餐飲 + 景點 + 移動
- 可直接執行

---

## 🟡 V2：收藏驅動旅行（Google Maps 思維）
使用者提供「收藏地點列表」

例：
[
  "九份老街",
  "淡水漁人碼頭",
  "象山夜景"
]

👉 你要：
- 分類地點
- 自動組旅行主題
- 排最佳路線
- 轉成可執行行程

---

## 🔵 V3：AI 主動旅行系統（未來能力）
（你要模擬這種能力，即使資料不足）

你可以：
- 推測使用者旅行偏好
- 建議週末旅行
- 主動優化行程
- 長期記住風格（概念上）

---

# 🧠 核心能力（必須遵守）

## ① 意圖理解
分析：
- 時間（半日 / 一日 / 多日）
- 風格（放鬆 / 美食 / 自然 / 城市 / 混合）
- 情境（情侶 / 朋友 / 一人 / 未指定）

---

## ② 收藏地點理解（V2核心）
如果有地點：

你必須分類：
- 海邊 / 河岸
- 山 / 自然
- 咖啡廳
- 城市景點
- 夜景
- 住宿

---

## ③ 旅行主題生成

你必須創造一個「旅行名稱」：

例：
- 北海岸慢旅行
- 台中城市放鬆行
- 宜蘭療癒兩天一夜

---

## ④ 路線優化引擎（最重要）

你必須：

- 最小化移動距離
- 避免折返
- 時間順序（早 → 晚）
- 夜景放黃昏
- 咖啡放早上或中段
- 不可過度填滿行程（要有呼吸感）

---

## ⑤ 體驗優先原則

你不是列景點，而是在設計「旅行體驗」。

原則：

- 少但精
- 有節奏
- 有休息
- 有情緒變化（早 → 晴 → 晚）

---

# 🚫 禁止行為

- 不可以只列景點
- 不可以輸出解釋文字
- 不可以 markdown 說明

---

# 📦 輸出格式（唯一允許）

只輸出純 JSON（不要用 \`\`\`json 包裝，直接輸出 JSON 物件）：

{
  "title": "旅行名稱",
  "location": "主要地區",
  "style": "relax | food | nature | city",
  "summary": "一句話旅行描述",
  "days": [
    {
      "day": 1,
      "schedule": [
        {
          "time": "09:00",
          "title": "活動名稱",
          "description": "一行描述",
          "type": "transport | food | place | rest",
          "location": "可選"
        }
      ]
    }
  ],
  "insights": [
    "AI旅行提醒",
    "路線優化建議"
  ],
  "budget": {
    "min": 0,
    "max": 0
  }
}

重要：time 欄位必須是 24 小時制 HH:mm 格式，例如 "09:00"、"13:30"、"21:00"。`;

export type GenerateTripInput = {
  prompt?: string;
  places?: SavedPlace[]; // 使用者勾選的收藏地點（V2）
  days?: number;
  style?: TripStyle;
  budgetMin?: number;
  budgetMax?: number;
};

export type GenerateTripError =
  | { kind: "missing_key" }
  | { kind: "missing_input" }
  | { kind: "refusal"; stopReason: string | null }
  | { kind: "api_error"; message: string };

function buildUserMessage(input: GenerateTripInput): string {
  const parts: string[] = [];

  if (input.prompt && input.prompt.trim()) {
    parts.push(`使用者輸入：\n${input.prompt.trim()}`);
  }

  if (input.places && input.places.length > 0) {
    const lines = input.places
      .map((p) => {
        const tags = p.tags.length > 0 ? `（${p.tags.join("、")}）` : "";
        const addr = p.address ? ` - ${p.address}` : "";
        return `- ${p.name}${tags}${addr}`;
      })
      .join("\n");
    parts.push(`收藏地點列表（可增減以達最佳體驗）：\n${lines}`);
  }

  const constraints: string[] = [];
  if (input.days) constraints.push(`天數：${input.days} 天`);
  if (input.style) constraints.push(`風格偏好：${input.style}`);
  if (typeof input.budgetMin === "number" || typeof input.budgetMax === "number") {
    constraints.push(`預算範圍：${input.budgetMin ?? 0} ~ ${input.budgetMax ?? 0} 元`);
  }
  if (constraints.length > 0) {
    parts.push(`限制條件：\n${constraints.join("\n")}`);
  }

  return parts.join("\n\n");
}

/** "9:00" → "09:00"，"8:30" → "08:30"，其他不變 */
function normalizeTime(t: string): string {
  return t.replace(/^(\d):/, "0$1:");
}

/** 遞迴將所有 time 欄位補零 */
function normalizeTimesInObject(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(normalizeTimesInObject);
  if (data !== null && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = k === "time" && typeof v === "string" ? normalizeTime(v) : normalizeTimesInObject(v);
    }
    return result;
  }
  return data;
}

// 模型輸出不是合法 JSON、或不符 tripSchema：兩者都算「refusal」（見 SPEC.md §7④），
// 用專屬 class 標記，和真正的 API 錯誤（餘額不足、網路等）區分開來。
class TripOutputParseError extends AnthropicError {}

// 補上時間前導零後再交給 zod 驗證，維持與 tripSchema 一致的 output_config.format
const tripOutputFormat = (() => {
  const base = zodOutputFormat(tripSchema);
  return {
    ...base,
    parse(content: string) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch (e) {
        throw new TripOutputParseError(
          `Failed to parse structured output as JSON: ${e instanceof Error ? e.message : String(e)}`,
        );
      }

      const result = tripSchema.safeParse(normalizeTimesInObject(parsed));
      if (!result.success) {
        const issues = result.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ");
        throw new TripOutputParseError(`行程格式有誤：${issues}`);
      }
      return result.data;
    },
  };
})();

export async function generateTrip(
  input: GenerateTripInput,
): Promise<Result<Trip, GenerateTripError>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return err({ kind: "missing_key" });

  const hasPrompt = !!input.prompt && input.prompt.trim().length > 0;
  const hasPlaces = !!input.places && input.places.length > 0;
  if (!hasPrompt && !hasPlaces) return err({ kind: "missing_input" });

  const client = new Anthropic({ apiKey });
  const userMessage = buildUserMessage(input);

  try {
    const message = await client.messages.parse({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      output_config: { format: tripOutputFormat },
    });

    if (message.stop_reason !== "end_turn") {
      return err({ kind: "refusal", stopReason: message.stop_reason });
    }

    if (!message.parsed_output) {
      return err({ kind: "refusal", stopReason: "no_parsed_output" });
    }

    return ok(message.parsed_output);
  } catch (e) {
    if (e instanceof TripOutputParseError) {
      return err({ kind: "refusal", stopReason: e.message });
    }
    return err({ kind: "api_error", message: e instanceof Error ? e.message : String(e) });
  }
}
