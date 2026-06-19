import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    globals: false,
    // Several suites spawn real `node`/`git` subprocesses (the step/run/test-fix
    // loops + temp git repos); under full-suite parallelism these can exceed the
    // 5s default, so raise the per-test ceiling.
    testTimeout: 30000,
  },
});
