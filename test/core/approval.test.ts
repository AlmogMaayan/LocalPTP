/**
 * Approval seam — injectable approve() (task 6.1).
 */
import { describe, it, expect } from "vitest";
import { autoApprove, autoDeny, type Approver } from "../../src/core/approval.js";

describe("approval seam (6.1)", () => {
  it("autoApprove resolves true", async () => {
    const approve: Approver = autoApprove;
    expect(await approve("Apply this patch?")).toBe(true);
  });

  it("autoDeny resolves false", async () => {
    const approve: Approver = autoDeny;
    expect(await approve("Apply this patch?")).toBe(false);
  });

  it("an arbitrary injected stub is honored", async () => {
    const seen: string[] = [];
    const stub: Approver = async (prompt) => {
      seen.push(prompt);
      return prompt.includes("yes");
    };
    expect(await stub("say yes")).toBe(true);
    expect(await stub("say no")).toBe(false);
    expect(seen).toEqual(["say yes", "say no"]);
  });
});
