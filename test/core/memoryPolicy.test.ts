/**
 * Task 1.2 — memoryPolicy: POLICY map, normalize(loose)->key, headingFor(key).
 * Tests: each canonical changeType → its file; loose strings normalize; unknown → undefined.
 */
import { describe, it, expect } from "vitest";
import {
  POLICY,
  normalize,
  headingFor,
} from "../../src/core/memoryPolicy.js";

describe("POLICY map (1.2)", () => {
  it("1.2a maps each canonical changeType to its file", () => {
    expect(POLICY["file-responsibility"]).toBe("file-index.md");
    expect(POLICY["api-behavior"]).toBe("api-map.md");
    expect(POLICY["data-model"]).toBe("data-model.md");
    expect(POLICY["architectural-decision"]).toBe("decisions.md");
    expect(POLICY["external-integration"]).toBe("external-integrations.md");
    expect(POLICY["testing-process"]).toBe("test-plan.md");
    expect(POLICY["risk"]).toBe("known-issues.md");
  });

  it("1.2b has exactly 7 entries", () => {
    expect(Object.keys(POLICY)).toHaveLength(7);
  });
});

describe("normalize (1.2)", () => {
  it("1.2c passes through canonical keys unchanged", () => {
    expect(normalize("file-responsibility")).toBe("file-responsibility");
    expect(normalize("api-behavior")).toBe("api-behavior");
    expect(normalize("data-model")).toBe("data-model");
    expect(normalize("architectural-decision")).toBe("architectural-decision");
    expect(normalize("external-integration")).toBe("external-integration");
    expect(normalize("testing-process")).toBe("testing-process");
    expect(normalize("risk")).toBe("risk");
  });

  it("1.2d maps 'api' loose string to api-behavior", () => {
    expect(normalize("api")).toBe("api-behavior");
    expect(normalize("API changed")).toBe("api-behavior");
    expect(normalize("endpoint")).toBe("api-behavior");
  });

  it("1.2e maps 'decision' to architectural-decision", () => {
    expect(normalize("decision")).toBe("architectural-decision");
    expect(normalize("architectural decision")).toBe("architectural-decision");
  });

  it("1.2f maps 'risk' / 'bug' loose strings to risk", () => {
    expect(normalize("risk discovered")).toBe("risk");
    expect(normalize("bug")).toBe("risk");
  });

  it("1.2g maps 'test' / 'testing' loose strings to testing-process", () => {
    expect(normalize("test")).toBe("testing-process");
    expect(normalize("testing")).toBe("testing-process");
  });

  it("1.2h maps 'file' / 'module' loose strings to file-responsibility", () => {
    expect(normalize("file")).toBe("file-responsibility");
    expect(normalize("module")).toBe("file-responsibility");
  });

  it("1.2i maps 'data' / 'model' / 'schema' loose strings to data-model", () => {
    expect(normalize("data")).toBe("data-model");
    expect(normalize("schema")).toBe("data-model");
  });

  it("1.2j maps 'integration' / 'external' loose strings to external-integration", () => {
    expect(normalize("integration")).toBe("external-integration");
    expect(normalize("external")).toBe("external-integration");
  });

  it("1.2k returns undefined for unknown change types", () => {
    expect(normalize("completely-unknown-type")).toBeUndefined();
    expect(normalize("")).toBeUndefined();
    expect(normalize("foo bar baz")).toBeUndefined();
  });
});

describe("headingFor (1.2)", () => {
  it("1.2l returns a heading string for each canonical key", () => {
    expect(headingFor("file-responsibility")).toBeTruthy();
    expect(headingFor("api-behavior")).toBeTruthy();
    expect(headingFor("data-model")).toBeTruthy();
    expect(headingFor("architectural-decision")).toBeTruthy();
    expect(headingFor("external-integration")).toBeTruthy();
    expect(headingFor("testing-process")).toBeTruthy();
    expect(headingFor("risk")).toBeTruthy();
  });

  it("1.2m returns undefined for unknown key", () => {
    expect(headingFor("unknown-key")).toBeUndefined();
  });
});
