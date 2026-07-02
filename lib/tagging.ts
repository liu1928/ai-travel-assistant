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

const batchSchema = z.object({ tags: z.array(z.array(placeTag).max(4)) });

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
      max_tokens: 2048,
      system: `${SYSTEM_PROMPT}\n\n會給你一份編號地點清單，請回傳 tags 陣列，tags[i] 對應第 (i+1) 個地點的標籤。`,
      messages: [{ role: "user", content: numbered }],
      output_config: { format: zodOutputFormat(batchSchema) },
    });
    if (message.parsed_output === null) {
      return err({ kind: "refusal", stopReason: message.stop_reason });
    }
    const out = places.map((_, i) => message.parsed_output!.tags[i] ?? []);
    return ok(out);
  } catch (e) {
    return err({ kind: "api_error", message: e instanceof Error ? e.message : String(e) });
  }
}
