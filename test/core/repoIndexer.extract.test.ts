import { describe, it, expect } from "vitest";
import { extractImports, extractExports } from "../../src/core/repoIndexer.js";

describe("extractImports - TypeScript/JavaScript", () => {
  it("3.1a import x from './p'", () => {
    const text = `import x from './p';\n`;
    expect(extractImports(text, "typescript")).toContain("./p");
  });

  it("3.1b import './side'", () => {
    const text = `import './side';\n`;
    expect(extractImports(text, "typescript")).toContain("./side");
  });

  it("3.1c require('m')", () => {
    const text = `const x = require('m');\n`;
    expect(extractImports(text, "javascript")).toContain("m");
  });

  it("3.1d dynamic import('d')", () => {
    const text = `const mod = import('d');\n`;
    expect(extractImports(text, "typescript")).toContain("d");
  });

  it("3.1e all four specifiers collected", () => {
    const text = [
      `import x from './p';`,
      `import './side';`,
      `const r = require('m');`,
      `const d = import('d');`,
    ].join("\n");
    const result = extractImports(text, "typescript");
    expect(result).toContain("./p");
    expect(result).toContain("./side");
    expect(result).toContain("m");
    expect(result).toContain("d");
  });

  it("3.1f de-duplicates specifiers", () => {
    const text = `import x from './p';\nimport y from './p';\n`;
    const result = extractImports(text, "typescript");
    expect(result.filter((s) => s === "./p")).toHaveLength(1);
  });
});

describe("extractExports - TypeScript/JavaScript", () => {
  it("3.2a export const A", () => {
    const result = extractExports("export const A = 1;\n", "typescript");
    expect(result).toContain("A");
  });

  it("3.2b export default function fn", () => {
    const result = extractExports("export default function fn() {}\n", "typescript");
    expect(result).toContain("fn");
  });

  it("3.2c export { B, C }", () => {
    const result = extractExports("export { B, C };\n", "typescript");
    expect(result).toContain("B");
    expect(result).toContain("C");
  });

  it("3.2d bare export default someExpr contributes no name", () => {
    const result = extractExports("export default someExpr;\n", "typescript");
    // 'someExpr' is an expression, not a declared name — should not be captured
    expect(result).not.toContain("someExpr");
  });

  it("3.2e re-export export * from './x' contributes no name", () => {
    const result = extractExports("export * from './x';\n", "typescript");
    expect(result).toHaveLength(0);
  });

  it("3.2f re-export export { B } from './x' contributes no name", () => {
    const result = extractExports("export { B } from './x';\n", "typescript");
    expect(result).toHaveLength(0);
  });

  it("3.2g re-export does not contribute an import either", () => {
    // extractImports should not pick up from 'export { B } from ...' either
    const result = extractImports("export { B } from './x';\n", "typescript");
    expect(result).not.toContain("./x");
  });
});

describe("extractImports - Python", () => {
  it("3.3a import os", () => {
    const result = extractImports("import os\n", "python");
    expect(result).toContain("os");
  });

  it("3.3b from app.models import User", () => {
    const result = extractImports("from app.models import User\n", "python");
    expect(result).toContain("app.models");
  });

  it("3.3c both specifiers", () => {
    const text = "import os\nfrom app.models import User\n";
    const result = extractImports(text, "python");
    expect(result).toContain("os");
    expect(result).toContain("app.models");
  });
});

describe("extractImports/extractExports guards", () => {
  it("3.4a unknown language returns empty arrays", () => {
    expect(extractImports("import x from './p'", "unknown")).toEqual([]);
    expect(extractExports("export const A = 1", "unknown")).toEqual([]);
  });
});
