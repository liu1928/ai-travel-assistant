import { describe, it, expect } from "vitest";
import { buildUserMessage, DNA_MIN_PLACES } from "@/lib/anthropic";
import type { TravelDna } from "@/lib/travel-dna";

/**
 * 分身模式：把 Travel DNA 偏好畫像注入生成 prompt。
 * buildUserMessage 是純函式，直接驗注入門檻與格式（不打 API）。
 */
const makeDna = (totalPlaces: number): TravelDna => ({
  totalPlaces,
  tagCounts: [
    { tag: "咖啡", count: 8, ratio: 0.5 },
    { tag: "海景", count: 5, ratio: 0.3125 },
  ],
  topTags: ["咖啡", "海景"],
  summary: "你的收藏偏好咖啡、海景，看起來是個喜歡這類行程的旅人。",
});

describe("buildUserMessage — Travel DNA 注入", () => {
  it("收藏 >= DNA_MIN_PLACES 時注入偏好畫像段（含 top tag % 與個人化指令）", () => {
    const msg = buildUserMessage({ prompt: "沖繩三天", dna: makeDna(16) });
    expect(msg).toContain("使用者長期旅行偏好畫像");
    expect(msg).toContain("咖啡 50%");
    expect(msg).toContain("海景 31%");
    expect(msg).toContain("為你而選");
    expect(msg).toContain("破框");
  });

  it("剛好等於 DNA_MIN_PLACES 也注入（>= 邊界）", () => {
    const msg = buildUserMessage({ prompt: "x", dna: makeDna(DNA_MIN_PLACES) });
    expect(msg).toContain("偏好畫像");
  });

  it("收藏 < DNA_MIN_PLACES 時不注入（冷啟動避免對雜訊過擬合）", () => {
    const msg = buildUserMessage({ prompt: "沖繩三天", dna: makeDna(DNA_MIN_PLACES - 1) });
    expect(msg).not.toContain("偏好畫像");
  });

  it("沒有 dna 時不注入（回歸不破，原輸入照舊）", () => {
    const msg = buildUserMessage({ prompt: "沖繩三天" });
    expect(msg).not.toContain("偏好畫像");
    expect(msg).toContain("沖繩三天");
  });

  it("tagCounts 為空時不注入（避免空畫像）", () => {
    const empty: TravelDna = { totalPlaces: 20, tagCounts: [], topTags: [], summary: "尚無標籤" };
    const msg = buildUserMessage({ prompt: "x", dna: empty });
    expect(msg).not.toContain("偏好畫像");
  });
});
