// ⚠️ 伺服器端專用：呼叫 Claude 為地點打標籤
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import {
  taggingResultSchema,
  placeTag,
  type PlaceSearchResult,
  type PlaceTag,
} from "@/schema/place";
import { ok, err, type Result } from "./result";
import { envOr } from "./env";

const MODEL = envOr("ANTHROPIC_TAGGING_MODEL", "claude-haiku-4-5-20251001");
const TAG_LIST = placeTag.options.join("、");

const SYSTEM_PROMPT = `你是地點分類器。根據地點名稱、地址與 Google 類型，從下列固定分類中挑出 1–4 個最貼切的標籤，不可自創分類：
${TAG_LIST}

只挑真正相關的，寧少勿濫。`;

export type TaggingError =
  | { kind: "missing_key" }
  | { kind: "refusal"; stopReason: string | null }
  | { kind: "api_error"; message: string };

function describe(place: PlaceSearchResult): string {
  return [
    `名稱：${place.name}`,
    place.address ? `地址：${place.address}` : null,
    `Google 類型：${place.googleTypes.join(", ") || "（無）"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function tagPlace(
  place: PlaceSearchResult,
): Promise<Result<PlaceTag[], TaggingError>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return err({ kind: "missing_key" });
  const client = new Anthropic({ apiKey });
  try {
    const message = await client.messages.parse({
      model: MODEL,
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: describe(place) }],
      output_config: { format: zodOutputFormat(taggingResultSchema) },
    });
    if (message.parsed_output === null) {
      return err({ kind: "refusal", stopReason: message.stop_reason });
    }
    return ok(message.parsed_output.tags);
  } catch (e) {
    return err({ kind: "api_error", message: e instanceof Error ? e.message : String(e) });
  }
}

// 每批送 tagPlaces 的建議上限；呼叫端（import-core / retag）用它 chunk，讓單批遠低於
// max_tokens 上限，避免輸出被截斷造成尾段地點靜默拿空標籤。
export const TAG_BATCH_SIZE = 30;

// 可自我對位的批次結構：讓模型回填 index，而非靠陣列位置對齊（防截斷後靜默錯位）。
const batchItemSchema = z.object({ index: z.number().int(), tags: z.array(placeTag).max(4) });
const batchSchema = z.object({ items: z.array(batchItemSchema) });
type BatchItem = z.infer<typeof batchItemSchema>;

/**
 * 依模型回填的 index 把標籤對回原清單（1-based）。純函式、可單測。
 * 缺任一編號（疑似輸出被截斷）→ err，不靜默補 []（見 SPEC.md §7① 的「標籤悄悄變空」故障）。
 */
export function alignBatchTags(
  items: BatchItem[],
  count: number,
): Result<PlaceTag[][], TaggingError> {
  const byIndex = new Map<number, PlaceTag[]>();
  for (const it of items) {
    if (byIndex.has(it.index)) {
      return err({ kind: "api_error", message: `標籤輸出有重複編號：${it.index}` });
    }
    byIndex.set(it.index, it.tags);
  }
  const out: PlaceTag[][] = [];
  for (let i = 0; i < count; i++) {
    const tags = byIndex.get(i + 1);
    if (tags === undefined) {
      return err({ kind: "api_error", message: `標籤輸出不完整（疑似截斷）：缺第 ${i + 1} 筆` });
    }
    out.push(tags);
  }
  return ok(out);
}

export async function tagPlaces(
  places: PlaceSearchResult[],
): Promise<Result<PlaceTag[][], TaggingError>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return err({ kind: "missing_key" });
  if (places.length === 0) return ok([]);
  const client = new Anthropic({ apiKey });

  const numbered = places
    .map((p, i) => `${i + 1}. ${describe(p).replace(/\n/g, " / ")}`)
    .join("\n");

  try {
    const message = await client.messages.parse({
      model: MODEL,
      // 4096：一批最多 TAG_BATCH_SIZE(30) 個地點，每筆 {index, tags(中文)} 的 JSON
      // 逼近 2048，上調避免截斷 → alignBatchTags 頻繁報錯 → 整批降級（GLM REVIEW ❓-1）。
      max_tokens: 4096,
      system: `${SYSTEM_PROMPT}\n\n會給你一份編號地點清單。請對每個地點回傳一個物件 { index, tags }：index 是清單上的編號（從 1 開始），tags 是該地點的標籤。務必涵蓋每一個編號，不可遺漏。`,
      messages: [{ role: "user", content: numbered }],
      output_config: { format: zodOutputFormat(batchSchema) },
    });
    if (message.parsed_output === null) {
      return err({ kind: "refusal", stopReason: message.stop_reason });
    }
    return alignBatchTags(message.parsed_output.items, places.length);
  } catch (e) {
    return err({ kind: "api_error", message: e instanceof Error ? e.message : String(e) });
  }
}
