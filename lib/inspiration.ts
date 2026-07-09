// ⚠️ 伺服器端專用：反向策展——貼一段外部文字 → Claude 抽地點 → 用 Travel DNA 過濾評分。
// 見 specs/reverse-curation.md。預覽階段不寫 DB（人工勾選才收藏，見 confirm route）。
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { PlaceTag, PlaceSearchResult } from "@/schema/place";
import { resolveCandidate } from "./import-core";
import { tagPlaces } from "./tagging";
import { computeTravelDna } from "./travel-dna";
import { checkAndConsumeImports } from "./rate-limit";
import { mapLimit } from "./concurrency";
import { ok, err, type Result } from "./result";
import { envOr } from "./env";

const MODEL = envOr("ANTHROPIC_TAGGING_MODEL", "claude-haiku-4-5-20251001");

const EXTRACT_CAP = (() => {
  const n = Number(envOr("INSPIRATION_EXTRACT_CAP", "20"));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
})();

const EXTRACT_SYSTEM = `你從一段旅遊文字（遊記／社群貼文／景點清單）中，抽出「明確提到的地點名稱」。
只抽真正可搜尋的地點／店家／景點名稱，不要抽形容詞、心情、活動、食物名或泛稱（例如「海邊」「很chill的咖啡廳」不算）。
每個地點回傳 { name, context }：name 是可拿去地圖搜尋的地點名，context 是原文提到它的簡短脈絡（可留空）。
找不到明確地點就回空陣列。`;

const extractSchema = z.object({
  places: z.array(z.object({ name: z.string().min(1), context: z.string().optional() })),
});

export type ScoredCandidate = {
  place: PlaceSearchResult;
  tags: PlaceTag[];
  fitScore: number; // 0–100
  fitStars: 1 | 2 | 3 | 4 | 5;
  isGapFiller: boolean; // 命中你少/沒收藏的 tag（策展缺口）
  reason: string;
  lowConfidence: boolean; // 名稱解析可能綁錯（同名／無座標 bias），請人工確認
};

export type InspirationError =
  | { kind: "missing_key" }
  | { kind: "missing_maps_key" }
  | { kind: "dna_error" } // DNA 讀取失敗（≠ 空收藏；避免整批誤判成低分/補盲區）
  | { kind: "refusal" }
  | { kind: "rate_limited" }
  | { kind: "api_error"; message: string };

export type FitResult = Pick<ScoredCandidate, "fitScore" | "fitStars" | "isGapFiller" | "reason">;

const GAP_THRESHOLD = 0.05; // ratio 低於此視為「你少收藏」
const SCALE = 2.2; // 契合度縮放（可調；讓「命中你的主偏好」落在高星）

function starsFromScore(s: number): 1 | 2 | 3 | 4 | 5 {
  if (s >= 80) return 5;
  if (s >= 60) return 4;
  if (s >= 40) return 3;
  if (s >= 20) return 2;
  return 1;
}

/**
 * 依候選 tag 與使用者 DNA 偏好分布（tag→ratio）算契合度。純函式、可單測。
 * 契合 = 0.7*最強匹配 + 0.3*匹配廣度，×SCALE 後夾到 0–100。
 * isGapFiller：命中你低/零收藏的 tag 且整體 fit 不高 → 理由改「補盲區」。
 * 理由用確定性模板（不再多打一次 AI，省成本）。
 */
export function scoreFit(tags: PlaceTag[], ratios: Map<PlaceTag, number>): FitResult {
  if (tags.length === 0) {
    return { fitScore: 0, fitStars: 1, isGapFiller: false, reason: "還沒標到標籤，收藏後可再重新標籤" };
  }
  const matched = tags.map((t) => ratios.get(t) ?? 0);
  const maxR = Math.max(...matched);
  const sumR = matched.reduce((a, b) => a + b, 0);
  const raw = 0.7 * maxR + 0.3 * Math.min(1, sumR);
  const fitScore = Math.round(Math.min(1, raw * SCALE) * 100);
  const fitStars = starsFromScore(fitScore);

  // 依 ratio 由低到高排序，讓「補盲區」理由指向你最空白的方向（非候選 tag 的原始順序）
  const gapTags = tags
    .filter((t) => (ratios.get(t) ?? 0) < GAP_THRESHOLD)
    .sort((a, b) => (ratios.get(a) ?? 0) - (ratios.get(b) ?? 0));
  const isGapFiller = gapTags.length > 0 && fitScore < 50;

  const topMatchTag = tags[matched.indexOf(maxR)] ?? tags[0];
  const topPct = Math.round((ratios.get(topMatchTag) ?? 0) * 100);

  let reason: string;
  if (isGapFiller) {
    reason = `這是你較少收藏的「${gapTags[0]}」方向，想拓展品味可以收`;
  } else if (fitScore >= 70) {
    reason = `很符合你（你的收藏有 ${topPct}% 是「${topMatchTag}」）`;
  } else if (fitScore >= 40) {
    reason = `跟你的「${topMatchTag}」偏好有點合`;
  } else {
    reason = "跟你目前的收藏偏好關聯不高，斟酌收";
  }
  return { fitScore, fitStars, isGapFiller, reason };
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[\s\-·・,，.。()（）]/g, "");
}
function nameLooselyMatches(extracted: string, resolved: string): boolean {
  const a = normalizeName(extracted);
  const b = normalizeName(resolved);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

export async function extractAndScore(
  uid: string,
  text: string,
): Promise<Result<{ items: ScoredCandidate[]; truncated: number; resolveFailed: number }, InspirationError>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return err({ kind: "missing_key" });
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!mapsKey) return err({ kind: "missing_maps_key" });

  // DNA 先讀、fail-fast（在昂貴的抽取/解析前）。空收藏合法（新使用者仍可用，ratios 為空）；
  // 只有「讀取失敗」才報 dna_error，避免整批被誤判成低分/補盲區（GLM/verify correctness）。
  const dnaResult = await computeTravelDna(uid);
  if (!dnaResult.ok) return err({ kind: "dna_error" });
  const ratios = new Map<PlaceTag, number>();
  for (const tc of dnaResult.value.tagCounts) ratios.set(tc.tag, tc.ratio);

  // 抽地點（Haiku 結構化輸出）
  const client = new Anthropic({ apiKey });
  let rawPlaces: { name: string; context?: string }[];
  try {
    const msg = await client.messages.parse({
      model: MODEL,
      max_tokens: 2048,
      system: EXTRACT_SYSTEM,
      messages: [{ role: "user", content: text }],
      output_config: { format: zodOutputFormat(extractSchema) },
    });
    if (msg.parsed_output === null) return err({ kind: "refusal" });
    rawPlaces = msg.parsed_output.places;
  } catch (e) {
    return err({ kind: "api_error", message: e instanceof Error ? e.message : String(e) });
  }

  // 去重（正規化名）+ 上限截斷
  const seen = new Set<string>();
  const uniq: { name: string; context?: string }[] = [];
  for (const p of rawPlaces) {
    const key = normalizeName(p.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniq.push(p);
  }
  const capped = uniq.slice(0, EXTRACT_CAP);
  const truncated = uniq.length - capped.length;
  if (capped.length === 0) return ok({ items: [], truncated: 0, resolveFailed: 0 });

  // 2. 匯入筆數額度（解析前先扣，超過整批不解析）
  const gate = await checkAndConsumeImports(uid, capped.length);
  if (!gate.ok) return err({ kind: "rate_limited" });

  // 3. 解析成真 place_id（名稱 Text Search，無 bias → 低信心以名稱比對標記）
  const resolved = await mapLimit(capped, 5, (p) => resolveCandidate({ name: p.name }, mapsKey));
  const pairs = capped
    .map((p, i) => ({ extracted: p, place: resolved[i] }))
    .filter((x): x is { extracted: { name: string; context?: string }; place: PlaceSearchResult } => x.place !== null);
  const resolveFailed = capped.length - pairs.length; // 抽到但無法定位（前端要交代，不靜默消失）
  if (pairs.length === 0) return ok({ items: [], truncated, resolveFailed });

  // 標籤（DNA 已在開頭讀好）
  const tagsResult = await tagPlaces(pairs.map((x) => x.place));
  const tagsList = tagsResult.ok ? tagsResult.value : pairs.map(() => []);

  // 契合度評分
  const items: ScoredCandidate[] = pairs.map((x, i) => {
    const tags = tagsList[i] ?? [];
    const fit = scoreFit(tags, ratios);
    return {
      place: x.place,
      tags,
      ...fit,
      lowConfidence: !nameLooselyMatches(x.extracted.name, x.place.name),
    };
  });

  return ok({ items, truncated, resolveFailed });
}
