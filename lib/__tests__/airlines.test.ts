import { describe, it, expect } from "vitest";
import { airlineFromFlightNo, nextAirline } from "@/lib/airlines";

describe("airlineFromFlightNo", () => {
  it("常見航班號 → 航空公司名", () => {
    expect(airlineFromFlightNo("BR198")).toBe("長榮航空");
    expect(airlineFromFlightNo("CI202")).toBe("中華航空");
    expect(airlineFromFlightNo("JX801")).toBe("星宇航空");
  });

  it("含空白、小寫也可解析", () => {
    expect(airlineFromFlightNo("br 198")).toBe("長榮航空");
    expect(airlineFromFlightNo("  JL96 ")).toBe("日本航空");
  });

  it("數字開頭的 IATA 代碼（7C/5J/3K/B7）", () => {
    expect(airlineFromFlightNo("7C123")).toBe("濟州航空");
    expect(airlineFromFlightNo("B7301")).toBe("立榮航空");
  });

  it("未知代碼 → undefined", () => {
    expect(airlineFromFlightNo("ZZ999")).toBeUndefined();
  });

  it("只有代碼沒接數字 → undefined（避免打一半亂填）", () => {
    expect(airlineFromFlightNo("BR")).toBeUndefined();
    expect(airlineFromFlightNo("TPE")).toBeUndefined();
    expect(airlineFromFlightNo("")).toBeUndefined();
  });
});

describe("nextAirline（航班號變更時的 autofill 語意）", () => {
  it("空 → 依新航班號帶入", () => {
    expect(nextAirline("", "", "BR198")).toBe("長榮航空");
  });

  it("先前 autofill 的值 + 改成不同航空代碼 → 更新成新的", () => {
    expect(nextAirline("BR198", "長榮航空", "CI202")).toBe("中華航空");
  });

  it("先前 autofill + 改成未知代碼 → 清掉殘留 autofill 值", () => {
    expect(nextAirline("BR198", "長榮航空", "ZZ999")).toBe("");
    expect(nextAirline("BR198", "長榮航空", "")).toBe("");
  });

  it("使用者手填的航空公司 → 一律不動", () => {
    expect(nextAirline("BR198", "EVA Air", "CI202")).toBe("EVA Air");
    expect(nextAirline("", "我自己填的", "BR198")).toBe("我自己填的");
  });

  it("同航空只改班次數字 → 維持不變", () => {
    expect(nextAirline("BR198", "長榮航空", "BR200")).toBe("長榮航空");
  });
});
