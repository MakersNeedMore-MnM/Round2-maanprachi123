/**
 * Pipeline: URL → crawl → measure → detect → compat → score.
 * Pure TypeScript (no Convex imports) so the same engine drives the web
 * action and the stand-alone CLI. Every number in the outgoing report is
 * measured here or explicitly labeled as an estimate.
 */
import { bytesToText, fetchResource, headContentLength, kb, type FetchedResource } from "./http";
import {
  countFontFaces,
  extractFontUrls,
  parseHtml,
  type ParsedPage,
} from "./crawl";
import { scanText, type FeatureHit } from "./detect";
import { COMPAT_PROVENANCE, evaluateFeatures, PROFILE_VIEWS } from "./compat";
import { assembleReport, type Observations } from "./score";
import type {
  AssetSummary,
  HpfMeasurement,
  ScanReport,
  ScanStage,
} from "../../lib/obsolescence/types";

export type Progress = (stage: ScanStage, note?: string) => void | Promise<void>;

/** Attempts a real ΔHPF dual-run; wired from runScan via engine/hpfClient. */
export type HpfProvider = (
  url: string,
  budgetMs: number,
) => Promise<{ measurement: HpfMeasurement | null; reason?: string }>;

/** Hard wall-clock budget for the static analysis (Convex actions cap at 60 s). */
export const PIPELINE_DEADLINE_MS = 40_000;

/** Total wall-clock the pipeline may use when a ΔHPF dual-run is attempted. */
export const HPF_DEADLINE_MS = 55_000;

const MAX_SCRIPTS = 12;
const MAX_STYLESHEETS = 8;
const MAX_FONTS = 6;
const MAX_IMAGE_HEADS = 12;
const CONCURRENCY = 5;

export function normalizeScanUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Enter a URL to audit.");
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`“${raw}” is not a valid URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http(s) URLs can be audited.");
  }
  if (!parsed.hostname.includes(".") || parsed.hostname.endsWith(".")) {
    throw new Error("That hostname does not look reachable.");
  }
  return parsed.toString();
}

function shortAssetName(url: string, pageHost: string): string {
  try {
    const u = new URL(url);
    const base = u.host === pageHost ? u.pathname : u.host + u.pathname;
    const name = base.split("/").filter(Boolean).pop() ?? base;
    return name.length > 44 ? `${name.slice(0, 41)}…` : name || u.host;
  } catch {
    return url.slice(0, 44);
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  deadline: number,
): Promise<{ results: R[]; skipped: number }> {
  const results: R[] = [];
  let skipped = 0;
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      if (Date.now() > deadline) {
        skipped = items.length - next;
        return;
      }
      const index = next;
      next += 1;
      results.push(await worker(items[index], index));
    }
  });
  await Promise.all(runners);
  return { results, skipped };
}

export async function analyzeUrl(
  rawUrl: string,
  onProgress?: Progress,
  hpfProvider?: HpfProvider,
): Promise<ScanReport> {
  const startedAt = Date.now();
  const deadline = startedAt + PIPELINE_DEADLINE_MS;
  const url = normalizeScanUrl(rawUrl);
  const progress = async (stage: ScanStage, note?: string) => {
    if (onProgress) await onProgress(stage, note);
  };

  // ---- 1. Crawl -----------------------------------------------------------
  await progress("crawl", new URL(url).host);
  const candidates =
    url.startsWith("http://") && !url.startsWith("http://localhost")
      ? [url, url.replace(/^http:/, "https:")]
      : [url];
  let doc: FetchedResource | null = null;
  let lastError = "unknown error";
  for (const candidate of candidates) {
    const res = await fetchResource(candidate, { timeoutMs: 12_000 });
    if (res.ok) {
      doc = res;
      break;
    }
    lastError = `HTTP ${res.status || "network error"}${res.error ? ` — ${res.error}` : ""}`;
  }
  if (!doc) {
    throw new Error(`Could not load ${url} (${lastError}).`);
  }
  const decoded = bytesToText(doc.bytes, 2_000_000);
  if (!decoded.isText) {
    throw new Error("The server returned binary content instead of an HTML document.");
  }
  const page: ParsedPage = parseHtml(decoded.text, doc.finalUrl);
  const htmlKb = kb(doc.byteLength);

  // ---- 2. Fetch subresources ----------------------------------------------
  const blockingScripts = page.scripts.filter((s) => s.blocking);
  const otherScripts = page.scripts.filter((s) => !s.blocking);
  const scriptSelection = [...blockingScripts, ...otherScripts].slice(0, MAX_SCRIPTS);
  const blockingStyles = page.stylesheets.filter((s) => s.blocking);
  const otherStyles = page.stylesheets.filter((s) => !s.blocking);
  const styleSelection = [...blockingStyles, ...otherStyles].slice(0, MAX_STYLESHEETS);

  const subresourceTotal = page.scripts.length + page.stylesheets.length;
  const assets: AssetSummary[] = [
    {
      url: page.finalUrl,
      host: page.host,
      kind: "document",
      kb: htmlKb,
      wireKb: doc.wireBytes !== undefined ? kb(doc.wireBytes) : undefined,
      ms: doc.ms,
      ok: true,
    },
  ];

  const jsSources: { asset: string; text: string }[] = page.inlineScripts.map(
    (text, i) => ({ asset: `(inline #${i + 1})`, text }),
  );
  const cssSources: { asset: string; text: string }[] = page.inlineStyles.map(
    (text, i) => ({ asset: `(inline <style> #${i + 1})`, text }),
  );

  await progress(
    "assets",
    `${scriptSelection.length + styleSelection.length} of ${subresourceTotal} subresources`,
  );

  interface FetchJob {
    url: string;
    kind: "script" | "style";
    blocking: boolean;
  }
  const jobs: FetchJob[] = [
    ...scriptSelection.map((s) => ({ url: s.url, kind: "script" as const, blocking: s.blocking })),
    ...styleSelection.map((s) => ({ url: s.url, kind: "style" as const, blocking: s.blocking })),
  ];

  const { results: fetchResults, skipped: fetchSkipped } = await mapWithConcurrency(
    jobs,
    CONCURRENCY,
    async (job) => {
      const res = await fetchResource(job.url, { timeoutMs: 8_000 });
      const name = shortAssetName(job.url, page.host);
      const summary: AssetSummary = {
        url: job.url,
        host: new URL(job.url).host,
        kind: job.kind,
        kb: res.ok ? kb(res.byteLength) : 0,
        wireKb: res.ok && res.wireBytes !== undefined ? kb(res.wireBytes) : undefined,
        ms: res.ms,
        blocking: job.blocking,
        ok: res.ok,
        note: res.ok
          ? res.status >= 400
            ? `HTTP ${res.status}`
            : undefined
          : `fetch failed: ${res.error ?? `HTTP ${res.status}`}`,
      };
      if (res.ok && res.status < 400) {
        const decodedAsset = bytesToText(res.bytes, 1_500_000);
        if (decodedAsset.isText) {
          if (job.kind === "script") jsSources.push({ asset: name, text: decodedAsset.text });
          else cssSources.push({ asset: name, text: decodedAsset.text });
        } else {
          summary.note = "binary payload — size recorded, not scanned";
        }
      }
      return summary;
    },
    deadline,
  );
  assets.push(...fetchResults);

  // Fonts declared in fetched CSS + preloads (one hop, capped).
  const fontUrls = new Set<string>(page.preloadFontUrls);
  for (const source of cssSources) {
    const baseUrl = source.asset.startsWith("(")
      ? page.finalUrl
      : jobs.find((j) => shortAssetName(j.url, page.host) === source.asset)?.url ?? page.finalUrl;
    for (const fontUrl of extractFontUrls(source.text, baseUrl, MAX_FONTS)) {
      if (fontUrls.size >= MAX_FONTS) break;
      fontUrls.add(fontUrl);
    }
  }

  let fontSkipped = 0;
  if (fontUrls.size > 0 && Date.now() < deadline) {
    await progress("assets", `${fontUrls.size} fonts`);
    const { results: fontResults, skipped } = await mapWithConcurrency(
      [...fontUrls],
      CONCURRENCY,
      async (fontUrl) => {
        const res = await fetchResource(fontUrl, { timeoutMs: 6_000 });
        const summary: AssetSummary = {
          url: fontUrl,
          host: new URL(fontUrl).host,
          kind: "font",
          kb: res.ok ? kb(res.byteLength) : 0,
          wireKb: res.ok && res.wireBytes !== undefined ? kb(res.wireBytes) : undefined,
          ms: res.ms,
          ok: res.ok,
          note: res.ok ? undefined : `fetch failed: ${res.error ?? `HTTP ${res.status}`}`,
        };
        return summary;
      },
      deadline,
    );
    assets.push(...fontResults);
    fontSkipped = skipped;
  }

  // Media sizes via HEAD (sample, no body download).
  const imageSample = page.images.slice(0, MAX_IMAGE_HEADS);
  let mediaHeadKb = 0;
  let mediaCounted = 0;
  if (imageSample.length > 0 && Date.now() < deadline) {
    const { results: headResults } = await mapWithConcurrency(
      imageSample,
      CONCURRENCY,
      async (image) => headContentLength(image.url, 6_000),
      deadline,
    );
    for (const head of headResults) {
      if (head.ok && head.bytes !== undefined) {
        mediaHeadKb += head.bytes;
        mediaCounted += 1;
      }
    }
  }

  // ---- 3. Analyze JavaScript ---------------------------------------------
  await progress("analyze-js", `${jsSources.length} sources`);
  const jsHits: Map<string, FeatureHit> = new Map();
  let inlineJsKb = 0;
  for (const inline of page.inlineScripts) inlineJsKb += inline.length;
  for (const source of jsSources) {
    scanText(source.text, "js", source.asset, jsHits);
  }

  // ---- 4. Analyze CSS ------------------------------------------------------
  await progress("analyze-css", `${cssSources.length} sources`);
  const cssHits: Map<string, FeatureHit> = new Map();
  let inlineCssKb = 0;
  for (const inline of page.inlineStyles) inlineCssKb += inline.length;
  let fontFaces = 0;
  let fontDisplays = 0;
  for (const source of cssSources) {
    scanText(source.text, "css", source.asset, cssHits);
    const counts = countFontFaces(source.text);
    fontFaces += counts.faces;
    fontDisplays += counts.withDisplay;
  }

  // ---- 5. Compatibility ----------------------------------------------------
  const mergedHits: Map<string, FeatureHit> = new Map([...jsHits, ...cssHits]);
  await progress("compat", `${mergedHits.size} features detected`);
  const verdicts = evaluateFeatures(mergedHits);

  // ---- 6. ΔHPF (measured, optional) -----------------------------------------
  // A real Chromium dual-run via the hpf-worker. Skipped — and reported as
  // such — when no worker is configured or too little of the budget remains.
  let hpfMeasurement: HpfMeasurement | null = null;
  let hpfReason: string | undefined;
  if (hpfProvider) {
    await progress("hpf", "Chromium dual-run: baseline vs throttled");
    const remaining = HPF_DEADLINE_MS - (Date.now() - startedAt);
    const budgetMs = Math.min(30_000, remaining - 1_000);
    if (budgetMs >= 12_000) {
      try {
        const attempt = await hpfProvider(url, budgetMs);
        hpfMeasurement = attempt.measurement;
        hpfReason = attempt.reason;
      } catch (err) {
        hpfReason = err instanceof Error ? err.message : String(err);
      }
    } else {
      hpfReason = "not enough time left in the audit budget for a dual browser run";
    }
  } else {
    await progress("hpf", "not configured — static audit only");
  }

  // ---- 7. Score ------------------------------------------------------------
  await progress("score", undefined);
  const thirdPartyHosts = [
    ...new Set(
      page.scripts
        .map((s) => {
          try {
            return new URL(s.url).host;
          } catch {
            return null;
          }
        })
        .filter((h): h is string => h !== null && h !== page.host),
    ),
  ].slice(0, 8);

  const externalJsKb = assets
    .filter((a) => a.kind === "script" && a.ok)
    .reduce((sum, a) => sum + a.kb, 0);
  const externalCssKb = assets
    .filter((a) => a.kind === "style" && a.ok)
    .reduce((sum, a) => sum + a.kb, 0);
  const fontKb = assets
    .filter((a) => a.kind === "font" && a.ok)
    .reduce((sum, a) => sum + a.kb, 0);

  const observations: Observations = {
    url,
    finalUrl: page.finalUrl,
    host: page.host,
    title: page.title,
    httpStatus: doc.status,
    htmlKb,
    externalJsKb,
    inlineJsKb: kb(inlineJsKb),
    externalCssKb,
    inlineCssKb: kb(inlineCssKb),
    fontKb,
    mediaHeadKb: kb(mediaHeadKb),
    mediaCounted,
    mediaTotal: page.images.length,
    requestsSampled: 1 + fetchResults.length + fontResultsCount(assets) + headResultsCount(mediaCounted),
    thirdPartyScriptHosts: thirdPartyHosts,
    blockingScripts: blockingScripts.length,
    renderBlockingStylesheets: blockingStyles.length,
    docWriteHits: jsSources.reduce(
      (sum, s) => sum + countOccurrences(s.text, /document\s*\.\s*(write|writeln)\s*\(/g),
      0,
    ),
    syncXhrHits: jsSources.reduce(
      (sum, s) => sum + countOccurrences(s.text, /\.open\s*\(\s*(['"])(?:GET|POST|PUT|DELETE|HEAD)\1\s*,[^)]*,\s*false\s*\)/gi),
      0,
    ),
    evalHits: Math.min(
      20,
      jsSources.reduce((sum, s) => sum + countOccurrences(s.text, /\beval\s*\(/g), 0),
    ),
    viewportMeta: page.viewportMeta,
    imagesWithoutDimensions: page.images.filter((i) => !i.hasDimensions).length,
    imagesTotal: page.images.length,
    largestJsAssetKb: Math.max(0, ...assets.filter((a) => a.kind === "script").map((a) => a.kb)),
    fontFaces,
    fontFaceMissingDisplay: Math.max(0, fontFaces - fontDisplays),
    skippedAssets: fetchSkipped + fontSkipped,
    subresourceTotal,
    assets: assets.slice(0, 20),
    verdicts,
    profiles: PROFILE_VIEWS,
    durationMs: Date.now() - startedAt,
  };

  const report = assembleReport(observations, hpfMeasurement, hpfReason);
  void COMPAT_PROVENANCE; // surfaced through method notes / UI footer instead
  await progress("done", undefined);
  return report;
}

function fontResultsCount(assets: AssetSummary[]): number {
  return assets.filter((a) => a.kind === "font").length;
}

function headResultsCount(mediaCounted: number): number {
  return mediaCounted;
}

function countOccurrences(text: string, re: RegExp): number {
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    count += 1;
    if (match[0].length === 0) re.lastIndex += 1;
    if (count >= 50) break;
  }
  re.lastIndex = 0;
  return count;
}
