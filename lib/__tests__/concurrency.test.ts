import { describe, it, expect } from "vitest";
import { chunk } from "@/lib/concurrency";

describe("chunk", () => {
  it("整除：切成等大段", () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
  });

  it("有餘：最後一段較短", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("size >= 長度：單一段", () => {
    expect(chunk([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
  });

  it("空陣列 → 空", () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it("size <= 0 視為 1（不無限迴圈）", () => {
    expect(chunk([1, 2], 0)).toEqual([[1], [2]]);
    expect(chunk([1, 2], -5)).toEqual([[1], [2]]);
  });
});
