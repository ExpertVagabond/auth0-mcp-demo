// One command that proves the local demo reproduces: preflight, the test suite, then the six demo requests.
// Prints one line per check and a final VERIFIED / NOT VERIFIED line. Exit code 0 only if all three pass.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const node = process.execPath;
const run = (args) => spawnSync(node, args, { cwd: root, encoding: "utf8" });

const doctor = run(["scripts/doctor.mjs"]);
const tests = run(["--test", "--test-reporter=tap", "test/e2e.test.mjs", "test/walkthrough.test.mjs"]);
const demo = run(["scripts/walkthrough.mjs", "--json"]);

const count = (name) => new RegExp(`^# ${name} (\\d+)$`, "m").exec(tests.stdout)?.[1];
const passed = count("pass");
const total = count("tests");
let result = {};
try { result = JSON.parse(demo.stdout); } catch {}

const checks = [
  ["doctor", doctor.status === 0, doctor.status === 0 ? "ready" : "failed (run npm run doctor for details)"],
  ["tests", tests.status === 0, passed && total ? `${passed}/${total} passing` : "run npm test for details"],
  ["demo", demo.status === 0 && result.ok === true, `${result.passed ?? 0}/${result.total ?? 6} requests matched`],
];
for (const [name, ok, detail] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(7)} ${detail}`);
const ok = checks.every(([, pass]) => pass);
console.log(ok ? "VERIFIED: the local demo reproduces on this machine." : "NOT VERIFIED: see the FAIL lines above.");
process.exit(ok ? 0 : 1);
