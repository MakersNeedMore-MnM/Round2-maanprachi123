import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";

function safeHost(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).host;
  } catch {
    return url;
  }
}

/** Create a queued scan row; the client then kicks the `runScan` action. */
export const create = mutation({
  args: { url: v.string() },
  handler: async (ctx, { url }) => {
    return await ctx.db.insert("scans", {
      url: url.trim(),
      host: safeHost(url),
      status: "queued",
      stage: "queued",
      createdAt: Date.now(),
    });
  },
});

export const get = query({
  args: { id: v.id("scans") },
  handler: (ctx, { id }) => ctx.db.get(id),
});

export const getById = internalQuery({
  args: { id: v.id("scans") },
  handler: (ctx, { id }) => ctx.db.get(id),
});

/** Recent completed audits for the landing page strip. */
export const listRecent = query({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query("scans").order("desc").take(80);
    return docs
      .filter((d) => d.status === "done" && d.scoreValue !== undefined)
      .slice(0, 8)
      .map((d) => ({
        _id: d._id,
        host: d.host,
        url: d.url,
        scoreValue: d.scoreValue as number,
        grade: d.grade as string,
        completedAt: d.completedAt ?? d.createdAt,
      }));
  },
});

export const setStage = internalMutation({
  args: { id: v.id("scans"), stage: v.string(), note: v.optional(v.string()) },
  handler: (ctx, { id, stage, note }) =>
    ctx.db.patch(id, {
      status: "running",
      stage,
      stageNote: note,
    }),
});

export const finish = internalMutation({
  args: {
    id: v.id("scans"),
    report: v.any(),
    scoreValue: v.number(),
    grade: v.string(),
    durationMs: v.number(),
  },
  handler: (ctx, { id, report, scoreValue, grade, durationMs }) =>
    ctx.db.patch(id, {
      status: "done",
      stage: "done",
      stageNote: undefined,
      report,
      scoreValue,
      grade,
      durationMs,
      completedAt: Date.now(),
    }),
});

export const fail = internalMutation({
  args: { id: v.id("scans"), error: v.string(), durationMs: v.optional(v.number()) },
  handler: (ctx, { id, error, durationMs }) =>
    ctx.db.patch(id, {
      status: "error",
      stageNote: undefined,
      error,
      durationMs,
      completedAt: Date.now(),
    }),
});

