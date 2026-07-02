// ⚠️ 伺服器端專用
import { takeoutFileSchema, takeoutFeatureSchema } from "@/schema/takeout";
import { importCandidates, type ImportSummary, type ImportCandidate } from "./import-core";
import { ok, err, type Result } from "./result";

export type TakeoutError =
  | { kind: "invalid_json" }
  | { kind: "invalid_format"; message: string };

export async function importTakeout(
  uid: string,
  raw: string,
): Promise<Result<ImportSummary, TakeoutError>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err({ kind: "invalid_json" });
  }

  const file = takeoutFileSchema.safeParse(parsed);
  if (!file.success) {
    return err({ kind: "invalid_format", message: file.error.issues[0]?.message ?? "格式錯誤" });
  }

  const candidates: ImportCandidate[] = [];
  for (const rawF of file.data.features) {
    const f = takeoutFeatureSchema.safeParse(rawF);
    if (!f.success) continue;
    const loc = f.data.properties.location;
    if (!loc?.name) continue;
    const [lng, lat] = f.data.geometry.coordinates;
    candidates.push({ name: loc.name, lat, lng });
  }

  const dropped = file.data.features.length - candidates.length;
  const summary = await importCandidates(uid, candidates);
  summary.invalid += dropped;
  return ok(summary);
}
