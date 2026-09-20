/**
 * ΔHPF CLI — one-shot dual-run from any machine with Chromium installed.
 *
 * Usage:
 *   npx tsx hpf-worker/cli.ts <url> [--cpu 4] [--network fast3g|slow3g|none]
 *       [--settle 6000] [--timeout 45000] [--out result.json]
 */
import { writeFile } from "node:fs/promises";
import { measureHpfDualRun } from "./measure";

interface CliArgs {
  url?: string;
  cpu: number;
  network: string;
  settle: number;
  timeout: number;
  out?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { cpu: 4, network: "fast3g", settle: 6_000, timeout: 45_000 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--cpu") args.cpu = Number(argv[++i]);
    else if (a === "--network") args.network = argv[++i] ?? args.network;
    else if (a === "--settle") args.settle = Number(argv[++i]);
    else if (a === "--timeout") args.timeout = Number(argv[++i]);
    else if (a === "--out") args.out = argv[++i];
    else if (!a.startsWith("--") && !args.url) args.url = a;
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url || !/^https?:\/\//i.test(args.url)) {
    console.error(
      "Usage: npx tsx hpf-worker/cli.ts <https://url> [--cpu 4] [--network fast3g|slow3g|none] " +
        "[--settle 6000] [--timeout 45000] [--out result.json]",
    );
    process.exit(2);
  }

  console.error(
    `ΔHPF dual-run: ${args.url} · low-end profile: ×${args.cpu} CPU + ${args.network}`,
  );
  try {
    const result = await measureHpfDualRun({
      url: args.url,
      cpuThrottleRate: args.cpu,
      networkProfile: args.network,
      settleMs: args.settle,
      runTimeoutMs: args.timeout,
    });
    const json = JSON.stringify(result, null, 2);
    if (args.out) {
      await writeFile(args.out, json, "utf8");
      console.error(`Wrote ${args.out}`);
    }
    console.log(json);
    process.exit(result.baseline.ok && result.throttled.ok ? 0 : 3);
  } catch (err) {
    console.error("Measurement failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

void main();
