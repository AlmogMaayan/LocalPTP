/**
 * Active pointer (tasks 4.1–4.3).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  writeActive,
  readActive,
  resolveActive,
} from "../../src/core/activePointer.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lc-active-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const orchDir = (): string => path.join(tmp, ".ai-orchestrator");

describe("writeActive / readActive (4.1)", () => {
  it("round-trips the pointer atomically", async () => {
    const ptr = {
      taskPath: path.join(tmp, "ai", "tasks", "t.md"),
      sessionPath: path.join(tmp, "ai", "sessions", "s.md"),
    };
    await writeActive(orchDir(), ptr);
    const read = await readActive(orchDir());
    expect(read).toEqual(ptr);
    // The temp file should not linger.
    const entries = await fs.readdir(orchDir());
    expect(entries).toEqual(["active.json"]);
  });

  it("readActive returns undefined when no pointer exists", async () => {
    const read = await readActive(orchDir());
    expect(read).toBeUndefined();
  });

  it("overwrites a prior pointer (last write wins)", async () => {
    await writeActive(orchDir(), { taskPath: "a", sessionPath: "b" });
    await writeActive(orchDir(), { taskPath: "c", sessionPath: "d" });
    expect(await readActive(orchDir())).toEqual({ taskPath: "c", sessionPath: "d" });
  });
});

describe("resolveActive missing-target detection (4.2)", () => {
  it("flags a pointer whose task file is deleted", async () => {
    const taskPath = path.join(tmp, "ai", "tasks", "gone.md");
    const sessionPath = path.join(tmp, "ai", "sessions", "gone_session.md");
    await fs.mkdir(path.dirname(sessionPath), { recursive: true });
    await fs.writeFile(sessionPath, "# Session\n", "utf8");
    // task file intentionally NOT created
    await writeActive(orchDir(), { taskPath, sessionPath });

    const res = await resolveActive(orchDir());
    expect(res.kind).toBe("missing-target");
    if (res.kind === "missing-target") {
      expect(res.missing).toContain(taskPath);
    }
  });

  it("returns `none` when there is no pointer", async () => {
    const res = await resolveActive(orchDir());
    expect(res.kind).toBe("none");
  });

  it("returns `ok` with both paths present", async () => {
    const taskPath = path.join(tmp, "ai", "tasks", "t.md");
    const sessionPath = path.join(tmp, "ai", "sessions", "s.md");
    await fs.mkdir(path.dirname(taskPath), { recursive: true });
    await fs.mkdir(path.dirname(sessionPath), { recursive: true });
    await fs.writeFile(taskPath, "# Task\n", "utf8");
    await fs.writeFile(sessionPath, "# Session\n", "utf8");
    await writeActive(orchDir(), { taskPath, sessionPath });

    const res = await resolveActive(orchDir());
    expect(res.kind).toBe("ok");
    if (res.kind === "ok") {
      expect(res.pointer.taskPath).toBe(taskPath);
    }
  });
});
