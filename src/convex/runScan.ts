"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { analyzeUrl, normalizeScanUrl } from "./engine/pipeline";
import { fetchHpfMeasurement, hpfWorkerConfigured } from "./engine/hpfClient";

/**
 * Runs the Obsolescence Score pipeline for a queued scan row. The client
 * calls this directly after `scans.create`; stage progress is streamed into
 * the row so the report page renders the pipeline live.
 *
 * Returns a result object rather than throwing, so fire-and-forget callers
 * never produce unhandled rejections; failures land on the row itself.
 */
export const run = action({
  args: { id: v.id("scans"), url: v.string() },
  handler: async (ctx, { id, url }) => {
    const startedAt = Date.now();
    try {
      const normalized = normalizeScanUrl(url);
      // When HPF_WORKER_URL is set, the pipeline attempts a real Chromium
      // dual-run (baseline TBT vs throttled TBT → ΔHPF) and folds it into
      // the score. Otherwise the report honestly labels ΔHPF unavailable.
      const report = await analyzeUrl(
        normalized,
        async (stage, note) => {
          await ctx.runMutation(internal.scans.setStage, { id, stage, note });
        },
        hpfWorkerConfigured() ? fetchHpfMeasurement : undefined,
      );
      await ctx.runMutation(internal.scans.finish, {
        id,
        report,
        scoreValue: report.score.value,
        grade: report.score.grade,
        durationMs: report.durationMs,
      });
      return { ok: true as const };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(internal.scans.fail, {
        id,
        error: message,
        durationMs: Date.now() - startedAt,
      });
      return { ok: false as const, error: message };
    }
  },
});
