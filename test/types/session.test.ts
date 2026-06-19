/**
 * Session type shape (task 1.2).
 */
import { describe, it, expect } from "vitest";
import type { Session } from "../../src/types/session.js";

describe("session type (1.2)", () => {
  it("a Session is structurally valid", () => {
    const session: Session = {
      path: "/ai/sessions/2026-06-18_0930_demo_session.md",
      taskPath: "/ai/tasks/2026-06-18_0930_demo.md",
      status: "active",
      objective: "Demo the thing.",
      currentState: "Just started.",
      nextStep: "step-1: Inspect",
      raw: "# Session: Demo\n",
    };
    expect(session.taskPath).toContain("demo.md");
    expect(session.status).toBe("active");
  });
});
