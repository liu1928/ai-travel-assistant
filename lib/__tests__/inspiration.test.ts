import { describe, it, expect } from "vitest";
import { scoreFit } from "@/lib/inspiration";
import type { PlaceTag } from "@/schema/place";

const ratios = (m: Record<string, number>) => new Map<PlaceTag, number>(Object.entries(m) as [PlaceTag, number][]);

describe("scoreFit（反向策展契合度）", () => {
  it("命中你的主偏好 → 高分高星、非補盲區", () => {
    const r = scoreFit(["咖啡"], ratios({ 咖啡: 0.5 }));
    expect(r.fitStars).toBe(5);
    expect(r.fitScore).toBeGreaterThanOrEqual(80);
    expect(r.isGapFiller).toBe(false);
    expect(r.reason).toContain("很符合你");
    expect(r.reason).toContain("50%");
  });

  it("命中零收藏 tag → 低分 + 補盲區", () => {
    const r = scoreFit(["夜景"], ratios({ 咖啡: 0.5 }));
    expect(r.fitStars).toBe(1);
    expect(r.isGapFiller).toBe(true);
    expect(r.reason).toContain("較少收藏");
    expect(r.reason).toContain("夜景");
  });

  it("空 tags → 0 分 1 星、非補盲區", () => {
    const r = scoreFit([], ratios({ 咖啡: 0.5 }));
    expect(r.fitScore).toBe(0);
    expect(r.fitStars).toBe(1);
    expect(r.isGapFiller).toBe(false);
    expect(r.reason).toContain("還沒標到標籤");
  });

  it("多個匹配 tag → 分數更高", () => {
    const r = scoreFit(["咖啡", "海景"], ratios({ 咖啡: 0.4, 海景: 0.3 }));
    expect(r.fitStars).toBe(5);
    expect(r.isGapFiller).toBe(false);
  });

  it("弱匹配 → 中低分、不算補盲區", () => {
    const r = scoreFit(["城市"], ratios({ 城市: 0.15 }));
    expect(r.fitScore).toBeGreaterThan(0);
    expect(r.fitScore).toBeLessThan(50);
    expect(r.isGapFiller).toBe(false); // 0.15 >= GAP_THRESHOLD(0.05)
  });

  it("星等隨分數單調不減（0→低星、強匹配→高星）", () => {
    const low = scoreFit(["親子"], ratios({}));
    const high = scoreFit(["咖啡"], ratios({ 咖啡: 0.6 }));
    expect(high.fitStars).toBeGreaterThanOrEqual(low.fitStars);
    expect(high.fitScore).toBeGreaterThan(low.fitScore);
  });
});
