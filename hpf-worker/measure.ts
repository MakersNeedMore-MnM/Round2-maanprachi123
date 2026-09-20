/**
 * ΔHPF measurement core — a real Chromium dual-run via Playwright + CDP.
 *
 * Baseline run: the page is loaded in a fresh context with default CPU and
 * network conditions.
 * Low-end run:  the same page is loaded in another fresh context with
 *               CDP `Emulation.setCPUThrottlingRate` (CPU slowdown) and
 *               CDP `Network.emulateNetworkConditions` (3G-class profile).
 *
 * TBT (Total Blocking Time) is measured in the page via PerformanceObserver
 * `longtask` entries: every long task contributes (duration − 50 ms). The
 * observation window is navigation start → `settleMs` after the load event,
 * which is the standard TBT definition over a documented window. Both runs
 * use the identical window, so the ratio is meaningful.
 *
 * Nothing here is simulated: if a run fails or times out, the result says so
 * and the engine falls back to the static audit with clear labeling.
 */
import { chromium, type Browser } from "playwright";
import type { HpfMeasurement, HpfRunMetrics } from "../src/lib/obsolescence/types";

export interface NetworkProfile {
  name: string;
  latencyMs: number;
  downloadKbps: number;
  uploadKbps: number;
}

/** 3G-class profiles (values follow Chrome DevTools/Lighthouse conventions). */
export const NETWORK_PROFILES = {
  fast3g: { name: "Fast 3G", latencyMs: 150, downloadKbps: 1638, uploadKbps: 750 },
  slow3g: { name: "Slow 3G", latencyMs: 400, downloadKbps: 400, uploadKbps: 400 },
} as const;

export type NetworkProfileKey = keyof typeof NETWORK_PROFILES;

export function resolveNetworkProfile(key: string | undefined): NetworkProfile | null {
  if (!key || key === "none") return null;
  return NETWORK_PROFILES[key as NetworkProfileKey] ?? NETWORK_PROFILES.fast3g;
}

export interface MeasureOptions {
  url: string;
  /** CPU slowdown factor for the low-end run. Default 4 (pitch: 4–6×). */
  cpuThrottleRate?: number;
  /** Throttled-run network profile key. Default "fast3g". */
  networkProfile?: string;
  /** Observation window after the load event. Default 6000 ms. */
  settleMs?: number;
  /** Per-run navigation timeout. Default 45 000 ms. */
  runTimeoutMs?: number;
  /** Overall wall-clock cap; per-run timeouts shrink to fit. Default none. */
  totalBudgetMs?: number;
}

const DEFAULTS = {
  cpuThrottleRate: 4,
  networkProfile: "fast3g",
  settleMs: 6_000,
  runTimeoutMs: 45_000,
};

/** Injected before any page script; accumulates long-task blocking time. */
const INIT_OBSERVER = () => {
  const w = window as unknown as { __hpfObs?: { blocking: number; count: number } };
  const store = { blocking: 0, count: 0 };
  w.__hpfObs = store;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > 50) {
          store.blocking += entry.duration - 50;
          store.count += 1;
        }
      }
    }).observe({ type: "longtask", buffered: true } as PerformanceObserverInit);
  } catch {
    /* longtask unsupported — metrics stay 0 */
  }
};

type RunMetrics = HpfRunMetrics & { finalUrl?: string };

async function runOnce(
  browser: Browser,
  url: string,
  opts: {
    throttleRate: number;
    network: NetworkProfile | null;
    timeoutMs: number;
    settleMs: number;
  },
): Promise<RunMetrics> {
  const context = await browser.newContext({
    viewport: { width: 1350, height: 940 },
  });
  try {
    const page = await context.newPage();

    if (opts.throttleRate > 1) {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: opts.throttleRate });
    }
    if (opts.network) {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable", {});
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: opts.network.latencyMs,
        downloadThroughput: (opts.network.downloadKbps * 1024) / 8,
        uploadThroughput: (opts.network.uploadKbps * 1024) / 8,
      });
    }

    await page.addInitScript(INIT_OBSERVER);

    const response = await page.goto(url, {
      waitUntil: "load",
      timeout: opts.timeoutMs,
    });
    await page.waitForTimeout(opts.settleMs);

    const metrics = await page.evaluate(() => {
      const w = window as unknown as { __hpfObs?: { blocking: number; count: number } };
      const nav = performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;
      const fcp = performance
        .getEntriesByType("paint")
        .find((p) => p.name === "first-contentful-paint");
      return {
        tbtMs: w.__hpfObs ? Math.round(w.__hpfObs.blocking) : null,
        longTasks: w.__hpfObs ? w.__hpfObs.count : null,
        fcpMs: fcp ? Math.round(fcp.startTime) : null,
        loadMs: nav && nav.loadEventEnd > 0 ? Math.round(nav.loadEventEnd) : null,
      };
    });

    return {
      ok: true,
      httpStatus: response ? response.status() : undefined,
      finalUrl: page.url(),
      ...metrics,
    };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === "TimeoutError"
          ? `run timed out after ${opts.timeoutMs} ms`
          : err.message
        : String(err);
    return {
      ok: false,
      error: message,
      tbtMs: null,
      longTasks: null,
      fcpMs: null,
      loadMs: null,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Run the full dual-run and return a measurement object that conforms to the
 * shared `HpfMeasurement` contract. Both runs are always attempted; failures
 * are recorded on the run objects rather than thrown (except for launch
 * failures, which mean no browser is available at all).
 */
export async function measureHpfDualRun(opts: MeasureOptions): Promise<HpfMeasurement> {
  const startedAt = Date.now();
  const cpuThrottleRate = Math.max(1, opts.cpuThrottleRate ?? DEFAULTS.cpuThrottleRate);
  const profileKey = opts.networkProfile ?? DEFAULTS.networkProfile;
  const network = resolveNetworkProfile(profileKey);
  const settleMs = Math.max(1_000, opts.settleMs ?? DEFAULTS.settleMs);
  const networkProfileName = network ? network.name : "No network emulation";

  let runTimeoutMs = opts.runTimeoutMs ?? DEFAULTS.runTimeoutMs;
  if (opts.totalBudgetMs) {
    const perRun = Math.floor((opts.totalBudgetMs - 2 * settleMs - 3_000) / 2);
    runTimeoutMs = Math.max(6_000, Math.min(runTimeoutMs, perRun));
  }

  let browser: Browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not launch Chromium (${reason}). Run \`npx playwright install chromium\` — and, on Debian/Ubuntu, \`npx playwright install-deps chromium\` — then retry.`,
    );
  }

  try {
    const baseline = await runOnce(browser, opts.url, {
      throttleRate: 1,
      network: null,
      timeoutMs: runTimeoutMs,
      settleMs,
    });
    const throttled = await runOnce(browser, opts.url, {
      throttleRate: cpuThrottleRate,
      network,
      timeoutMs: runTimeoutMs,
      settleMs,
    });

    let hpf: number | null = null;
    let ratioReliable = false;
    let ratioNote: string | undefined;
    const b = baseline.tbtMs;
    const t = throttled.tbtMs;

    if (baseline.ok && throttled.ok && b !== null && t !== null) {
      if (b >= 100) {
        const raw = (t - b) / b;
        ratioReliable = true;
        hpf = Math.max(0, Math.round(raw * 100) / 100);
        if (raw < 0) {
          ratioNote =
            `The throttled run measured faster than the baseline (${t} ms vs ${b} ms) — ` +
            "run-to-run noise. ΔHPF is clamped to 0 for scoring.";
        }
      } else {
        ratioNote =
          `Baseline TBT (${b} ms) is below the 100 ms floor where the ratio is stable, ` +
          "so ΔHPF is reported as null and scoring uses the absolute throttled TBT instead.";
      }
    } else {
      ratioNote = "At least one of the two runs did not complete.";
    }

    return {
      url: opts.url,
      finalUrl: throttled.finalUrl ?? baseline.finalUrl,
      measuredAt: startedAt,
      durationMs: Date.now() - startedAt,
      config: {
        tool: "playwright-chromium",
        cpuThrottleRate,
        networkProfile: networkProfileName,
        settleMs,
      },
      baseline,
      throttled,
      hpf,
      ratioReliable,
      ratioNote,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}
