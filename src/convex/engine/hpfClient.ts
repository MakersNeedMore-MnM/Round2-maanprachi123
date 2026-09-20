/**
 * Bridge to the ΔHPF worker (hpf-worker/): a real Chromium dual-run that
 * measures baseline TBT, throttled TBT, and ΔHPF. This client is called from
 * the `runScan` Node action when HPF_WORKER_URL is configured (project
 * Keys/API-keys). Every failure mode degrades honestly: the caller gets
 * `{ measurement: null, reason }` and the report labels ΔHPF as unavailable —
 * nothing is faked.
 */
import type { HpfMeasurement } from "../../lib/obsolescence/types";

export interface HpfAttempt {
  measurement: HpfMeasurement | null;
  reason?: string;
}

export function hpfWorkerConfigured(): boolean {
  return Boolean(process.env.HPF_WORKER_URL?.trim());
}

/**
 * Ask the worker for a dual-run measurement. `budgetMs` is passed through so
 * the worker can size its per-run timeouts to fit the Convex action budget.
 */
export async function fetchHpfMeasurement(
  url: string,
  budgetMs: number,
): Promise<HpfAttempt> {
  const base = process.env.HPF_WORKER_URL?.trim();
  if (!base) {
    return {
      measurement: null,
      reason: "HPF_WORKER_URL is not configured for this deployment — the audit ran as a static audit",
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(3_000, budgetMs));
  const startedAt = Date.now();
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/measure`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url, budgetMs }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return {
        measurement: null,
        reason: `HPF worker responded HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      };
    }
    const data = (await res.json()) as HpfMeasurement;
    const complete =
      data &&
      typeof data === "object" &&
      data.baseline &&
      data.throttled &&
      typeof data.baseline.tbtMs === "number" &&
      typeof data.throttled.tbtMs === "number";
    if (!complete) {
      return {
        measurement: null,
        reason: `HPF worker returned an incomplete measurement after ${((Date.now() - startedAt) / 1000).toFixed(1)} s`,
      };
    }
    return { measurement: data };
  } catch (err) {
    const reason =
      err instanceof Error
        ? err.name === "AbortError"
          ? `the ΔHPF worker did not answer within the ${Math.round(budgetMs / 1000)} s audit budget`
          : err.message
        : String(err);
    return { measurement: null, reason };
  } finally {
    clearTimeout(timer);
  }
}
