import { describe, it, expect } from "vitest";
import { classifyStatus } from "../place-status";

describe("classifyStatus（specs/place-freshness.md §1.2）", () => {
  it("404 → NOT_FOUND（不管 body 內容）", () => {
    const r = classifyStatus(404, null);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("NOT_FOUND");
  });

  it("缺 businessStatus 欄位 → OPERATIONAL", () => {
    const r = classifyStatus(200, {});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("OPERATIONAL");
  });

  it("BUSINESS_STATUS_UNSPECIFIED → OPERATIONAL（不誤標警示）", () => {
    const r = classifyStatus(200, { businessStatus: "BUSINESS_STATUS_UNSPECIFIED" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("OPERATIONAL");
  });

  it("businessStatus: OPERATIONAL → OPERATIONAL", () => {
    const r = classifyStatus(200, { businessStatus: "OPERATIONAL" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("OPERATIONAL");
  });

  it("CLOSED_TEMPORARILY → 原樣回傳", () => {
    const r = classifyStatus(200, { businessStatus: "CLOSED_TEMPORARILY" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("CLOSED_TEMPORARILY");
  });

  it("CLOSED_PERMANENTLY → 原樣回傳", () => {
    const r = classifyStatus(200, { businessStatus: "CLOSED_PERMANENTLY" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("CLOSED_PERMANENTLY");
  });

  it("非 2xx 非 404（例如 500/403）→ err", () => {
    expect(classifyStatus(500, {}).ok).toBe(false);
    expect(classifyStatus(403, {}).ok).toBe(false);
  });

  it("非 2xx 時忽略 body 內容，不會誤判成正常營業", () => {
    const r = classifyStatus(500, { businessStatus: "OPERATIONAL" });
    expect(r.ok).toBe(false);
  });
});
