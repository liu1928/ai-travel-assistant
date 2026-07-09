import { describe, it, expect } from "vitest";
import { alignBatchTags } from "@/lib/tagging";

/**
 * D：批次標籤改用「模型回填 index」自我對位，取代靠陣列位置對齊。
 * alignBatchTags 是純函式，直接驗對位與「缺編號 → err（不靜默補 []）」。
 */
describe("alignBatchTags", () => {
  it("完整且順序 → 依 index 對齊", () => {
    const r = alignBatchTags(
      [
        { index: 1, tags: ["海景"] },
        { index: 2, tags: ["咖啡", "美食"] },
      ],
      2,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([["海景"], ["咖啡", "美食"]]);
  });

  it("亂序 index → 仍正確對回原位置", () => {
    const r = alignBatchTags(
      [
        { index: 2, tags: ["咖啡"] },
        { index: 1, tags: ["海景"] },
        { index: 3, tags: [] },
      ],
      3,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([["海景"], ["咖啡"], []]);
  });

  it("缺尾段編號（疑似截斷）→ err，不靜默補 []", () => {
    const r = alignBatchTags(
      [
        { index: 1, tags: ["海景"] },
        { index: 2, tags: ["咖啡"] },
      ],
      3, // 期望 3 筆，模型只回 2 筆
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("api_error");
  });

  it("缺中間編號 → err", () => {
    const r = alignBatchTags(
      [
        { index: 1, tags: ["海景"] },
        { index: 3, tags: ["夜景"] },
      ],
      3,
    );
    expect(r.ok).toBe(false);
  });

  it("重複 index → err（不讓後者靜默覆蓋前者）", () => {
    const r = alignBatchTags(
      [
        { index: 1, tags: ["海景"] },
        { index: 1, tags: ["咖啡"] }, // 重複
        { index: 2, tags: [] },
      ],
      2,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("api_error");
  });

  it("count=0 → ok 空陣列", () => {
    const r = alignBatchTags([], 0);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([]);
  });

  it("多回的超界 index 被忽略，只要 1..count 齊全就 ok", () => {
    const r = alignBatchTags(
      [
        { index: 1, tags: ["海景"] },
        { index: 2, tags: ["咖啡"] },
        { index: 9, tags: ["夜景"] }, // 超界，忽略
      ],
      2,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual([["海景"], ["咖啡"]]);
  });
});
