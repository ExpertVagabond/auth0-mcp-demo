// Runs scripts/walkthrough.mjs non-interactively and checks that it exits 0 with every step passing.
// The walkthrough picks free ports, so this does not collide with e2e.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/walkthrough.mjs", import.meta.url));

test("walkthrough runs all six steps and exits 0", async () => {
  const { code, stdout, stderr } = await new Promise((resolve) => {
    execFile(process.execPath, [script], { timeout: 60_000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr });
    });
  });
  assert.equal(code, 0, `exit ${code}\n${stdout}\n${stderr}`);
  assert.match(stdout, /All 6 steps matched/);
  assert.equal((stdout.match(/^ {2}Result: .*PASS$/gm) ?? []).length, 6);
  assert.equal((stdout.match(/^ {2}✓ {2}\d/gm) ?? []).length, 6);
  assert.doesNotMatch(stdout, /\x1b\[/, "no ANSI codes when stdout is not a TTY");
});
