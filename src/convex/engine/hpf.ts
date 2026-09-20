/**
 * Hardware Penalty Factor (ΔHPF) — constants and honest-status helpers.
 *
 * ΔHPF is a MEASURED signal: a real Chromium (Playwright) dual-run loads the
 * page at full speed and again under a low-end profile (CDP CPU throttling +
 * 3G network emulation), then
 *
 *     ΔHPF = (TBT_throttled − TBT_baseline) ÷ TBT_baseline
 *
 * The measurement itself lives in the standalone worker (hpf-worker/, plain
 * Node + Playwright) because this Convex sandbox cannot launch a browser.
 * The engine consumes its result through src/convex/engine/hpfClient.ts,
 * which calls the worker when HPF_WORKER_URL is configured. Numbers are never
 * fabricated: when no worker is configured — or the dual-run fails or times
 * out — reports say exactly that and the score stays static-only.
 */

export const HPF_FORMULA = "ΔHPF = (TBT_throttled − TBT_baseline) ÷ TBT_baseline";

export const HPF_STATUS_NOTE =
  "ΔHPF is measured by loading the page twice in real Chromium: once at full " +
  "speed, once with CPU throttling (Emulation.setCPUThrottlingRate, 4–6×) and " +
  "a 3G network profile (Network.emulateNetworkConditions), comparing Total " +
  "Blocking Time between the runs. Nothing simulates this: when the worker " +
  "is not configured, or a run fails, the report says so and the score uses " +
  "the static signals only.";

export const HPF_SETUP_HINT =
  "1. npm i -D playwright tsx   (or bun add -d playwright tsx)\n" +
  "2. npx playwright install chromium\n" +
  "3. npx tsx hpf-worker/server.ts        # serves POST /measure on :8787\n" +
  "4. Set HPF_WORKER_URL (e.g. http://localhost:8787) in the Keys/API-keys tab\n" +
  "One-off CLI: npx tsx hpf-worker/cli.ts <url>";
