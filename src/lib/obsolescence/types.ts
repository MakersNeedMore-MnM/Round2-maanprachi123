/**
 * Shared contract between the analysis engine (src/convex/engine), the
 * Convex backend and the React UI. Pure types + declared constants only —
 * no runtime dependencies, safe to import from anywhere.
 */

/** Ordered pipeline stages; the report UI renders these live while a scan runs. */
export const SCAN_STAGES = [
  "queued",
  "crawl",
  "assets",
  "analyze-js",
  "analyze-css",
  "compat",
  "hpf",
  "score",
  "done",
] as const;

export type ScanStage = (typeof SCAN_STAGES)[number];

export interface StageInfo {
  key: ScanStage;
  label: string;
  blurb: string;
}

export const STAGE_INFO: StageInfo[] = [
  { key: "queued", label: "Queued", blurb: "Waiting to start" },
  { key: "crawl", label: "Load site", blurb: "Fetch the live document over HTTP" },
  { key: "assets", label: "Fetch resources", blurb: "Scripts, stylesheets, fonts, media sizes" },
  { key: "analyze-js", label: "Scan JavaScript", blurb: "Detect modern language features actually shipped" },
  { key: "analyze-css", label: "Scan CSS", blurb: "Detect modern CSS features actually shipped" },
  { key: "compat", label: "Check devices", blurb: "Cross-check features against device support tables" },
  { key: "hpf", label: "Measure ΔHPF", blurb: "Chromium dual-run: baseline vs throttled TBT (when the worker is configured)" },
  { key: "score", label: "Compute score", blurb: "Weigh payload, compatibility, hazards and measured ΔHPF" },
  { key: "done", label: "Report ready", blurb: "Results and fix list" },
];

/** Device profiles audited against. Keys mirror src/convex/engine/compat-data.ts. */
export interface DeviceProfileView {
  key: string;
  label: string;
  era: string;
  browsers: { browser: string; version: string }[];
}

export type SupportLevel = "yes" | "partial" | "no" | "unknown";

/**
 * Declared budgets a page is measured against. Values are deliberate
 * engineering judgments (sources noted) so the scoring is transparent
 * rather than hidden.
 */
export const BUDGETS = {
  /** Raw JavaScript (uncompressed) before low-end parse cost dominates. ~Chrome DevRel guidance. */
  jsKB: 300,
  /** Total sampled resource weight. HTTP Archive 2025 median is 2,164 KB — this is deliberately lower. */
  totalKB: 1500,
  requests: 50,
  cssKB: 100,
  fontKB: 150,
} as const;

/** Category weights for the composite score. Declared, not hidden. */
export const CATEGORY_WEIGHTS = {
  payload: 0.4,
  compat: 0.35,
  hazards: 0.25,
} as const;

/**
 * Weights used when a measured ΔHPF is available (renormalized to 1.0).
 * The measured hardware penalty becomes a first-class score driver instead
 * of a footnote.
 */
export const CATEGORY_WEIGHTS_WITH_HPF = {
  payload: 0.3,
  compat: 0.25,
  hazards: 0.2,
  hpf: 0.25,
} as const;

/** Static parse-cost assumption, always labeled as an estimate in the UI. */
export const LOW_END_PARSE_SPEED_MB_S = 1.0;

export const GRADES = [
  {
    max: 19,
    grade: "Resilient",
    note: "Light and compatible enough that it should run well on decade-old hardware.",
  },
  {
    max: 39,
    grade: "Tolerable",
    note: "Projected to stay usable on older devices, with some avoidable strain.",
  },
  {
    max: 59,
    grade: "Strained",
    note: "Likely jank and long waits on low-end hardware, based on the static audit.",
  },
  {
    max: 79,
    grade: "Exclusionary",
    note: "Projected to be actively unpleasant or broken for low-end and aging devices.",
  },
  {
    max: 100,
    grade: "Hostile",
    note: "Likely effectively unusable on older hardware — a strong upgrade push.",
  },
] as const;

export function gradeFor(value: number): { grade: string; note: string } {
  for (const band of GRADES) {
    if (value <= band.max) return { grade: band.grade, note: band.note };
  }
  return { grade: GRADES[GRADES.length - 1].grade, note: GRADES[GRADES.length - 1].note };
}

export type Severity = "critical" | "warning" | "notice";

export interface AssetSummary {
  url: string;
  host: string;
  kind: "document" | "script" | "style" | "font";
  kb: number;
  wireKb?: number;
  ms: number;
  blocking?: boolean;
  ok: boolean;
  note?: string;
}

export interface FeatureVerdict {
  id: string;
  label: string;
  category: "js" | "css";
  source: "caniuse" | "curated";
  count: number;
  assets: string[];
  support: Record<string, SupportLevel>;
  brokenProfiles: string[];
  degradedProfiles: string[];
  fix: string;
  impact: number;
}

export interface CategoryPart {
  label: string;
  actual: string;
  budget?: string;
  badness: number;
}

export interface CategoryScore {
  key: "payload" | "compat" | "hazards" | "hpf";
  label: string;
  value: number;
  note: string;
  parts: CategoryPart[];
}

export interface Finding {
  id: string;
  title: string;
  severity: Severity;
  category: string;
  detail: string;
  evidence: string[];
  fix: string;
}

/** One Chromium run of the ΔHPF dual-run. */
export interface HpfRunMetrics {
  ok: boolean;
  error?: string;
  /** Total Blocking Time over the measurement window (ms). */
  tbtMs: number | null;
  longTasks: number | null;
  fcpMs: number | null;
  loadMs: number | null;
  httpStatus?: number;
}

/** A complete, real browser measurement produced by hpf-worker. */
export interface HpfMeasurement {
  url: string;
  finalUrl?: string;
  measuredAt: number;
  durationMs: number;
  config: {
    tool: "playwright-chromium";
    cpuThrottleRate: number;
    networkProfile: string;
    settleMs: number;
  };
  baseline: HpfRunMetrics;
  throttled: HpfRunMetrics;
  /** (TBT_throttled − TBT_baseline) ÷ TBT_baseline; null when the baseline is too small for a stable ratio. */
  hpf: number | null;
  ratioReliable: boolean;
  ratioNote?: string;
}

/** The ΔHPF section of a scan report. Measured only when both browser runs completed. */
export type ReportHpf =
  | { status: "measured"; measurement: HpfMeasurement; note: string }
  | {
      status: "unavailable";
      reason: string;
      formula: string;
      note: string;
      setup: string;
    }
  /** Rows written before ΔHPF integration keep the legacy shape. */
  | { status: "todo"; formula: string; note: string };

export interface ScanReport {
  version: 1;
  url: string;
  finalUrl: string;
  host: string;
  title?: string;
  fetchedAt: number;
  durationMs: number;
  httpStatus: number;
  htmlKb: number;
  metrics: {
    externalJsKb: number;
    inlineJsKb: number;
    externalCssKb: number;
    inlineCssKb: number;
    fontKb: number;
    mediaHeadKb: number;
    mediaCounted: number;
    mediaTotal: number;
    requestsSampled: number;
    thirdPartyScriptHosts: string[];
    blockingScripts: number;
    renderBlockingStylesheets: number;
    docWriteHits: number;
    syncXhrHits: number;
    evalHits: number;
    viewportMeta: boolean;
    imagesWithoutDimensions: number;
    imagesTotal: number;
    largestJsAssetKb: number;
    fontFaces: number;
    fontFaceMissingDisplay: number;
    skippedAssets: number;
    subresourceTotal: number;
  };
  jsKb: number;
  jsParseSecondsEstimate: number;
  categories: CategoryScore[];
  score: { value: number; grade: string; gradeNote: string };
  hpf: ReportHpf;
  verdict: string[];
  features: FeatureVerdict[];
  findings: Finding[];
  assets: AssetSummary[];
  profiles: DeviceProfileView[];
  method: { measured: string[]; estimated: string[]; notMeasured: string[] };
}
