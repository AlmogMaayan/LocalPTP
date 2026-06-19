/**
 * ReviewReport schema (task 1.2) — arrays default to [], summary/recommendation
 * tolerate omission.
 */
import { describe, it, expect } from "vitest";
import { reviewReportSchema } from "../../src/types/review.js";

describe("reviewReportSchema (1.2)", () => {
  it("parses a fully-specified report", () => {
    const r = reviewReportSchema.parse({
      summary: "Looks fine.",
      blocking: ["missing null check"],
      nonBlocking: ["rename var"],
      missingTests: ["edge case"],
      scopeCreep: ["unrelated refactor"],
      recommendation: "approve",
    });
    expect(r.summary).toBe("Looks fine.");
    expect(r.blocking).toEqual(["missing null check"]);
    expect(r.recommendation).toBe("approve");
  });

  it("defaults all arrays to [] when omitted", () => {
    const r = reviewReportSchema.parse({ summary: "ok", recommendation: "merge" });
    expect(r.blocking).toEqual([]);
    expect(r.nonBlocking).toEqual([]);
    expect(r.missingTests).toEqual([]);
    expect(r.scopeCreep).toEqual([]);
  });

  it("defaults summary/recommendation to empty strings when omitted", () => {
    const r = reviewReportSchema.parse({});
    expect(r.summary).toBe("");
    expect(r.recommendation).toBe("");
    expect(r.blocking).toEqual([]);
  });

  it("drops non-string array members tolerantly", () => {
    const r = reviewReportSchema.parse({
      summary: "ok",
      blocking: ["a", 42, "b"],
    });
    expect(r.blocking).toEqual(["a", "b"]);
  });
});
