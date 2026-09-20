/**
 * Scoring module. Every budget and weight is declared in
 * src/lib/obsolescence/types.ts and re-displayed in the UI, so the number
 * is always explainable. All inputs are real measurements from the
 * pipeline; the two static estimates (parse seconds, category badness) are
 * labeled as estimates in the report itself.
 */
import {
  BUDGETS,
  CATEGORY_WEIGHTS,
  CATEGORY_WEIGHTS_WITH_HPF,
  LOW_END_PARSE_SPEED_MB_S,
  gradeFor,
  type AssetSummary,
  type CategoryPart,
  type CategoryScore,
  type FeatureVerdict,
  type Finding,
  type HpfMeasurement,
  type ScanReport,
} from "../../lib/obsolescence/types";
import { HPF_FORMULA, HPF_SETUP_HINT, HPF_STATUS_NOTE } from "./hpf";

/** Verdict rows carry the compat-table weight (1–3) used by the scoring engine. */
type VerdictWithWeight = FeatureVerdict & { weight: number };

export interface Observations {
  url: string;
  finalUrl: string;
  host: string;
  title?: string;
  httpStatus: number;
  htmlKb: number;
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
  assets: AssetSummary[];
  verdicts: VerdictWithWeight[];
  profiles: ScanReport["profiles"];
  durationMs: number;
}

function badness(actual: number, budget: number): number {
  if (budget <= 0) return 0;
  return Math.min(100, Math.round((actual / budget) * 45));
}

function computePayload(obs: Observations): CategoryScore {
  const jsKb = round1(obs.externalJsKb + obs.inlineJsKb);
  const cssKb = round1(obs.externalCssKb + obs.inlineCssKb);
  const totalKb = round1(
    obs.htmlKb + jsKb + cssKb + obs.fontKb + obs.mediaHeadKb,
  );

  const jsPart = badness(jsKb, BUDGETS.jsKB);
  const totalPart = badness(totalKb, BUDGETS.totalKB);
  const requestPart = badness(obs.requestsSampled, BUDGETS.requests);
  const cssPart = badness(cssKb, BUDGETS.cssKB);
  const fontPart = badness(obs.fontKb, BUDGETS.fontKB);

  const value = Math.round(
    jsPart * 0.45 +
      totalPart * 0.25 +
      requestPart * 0.15 +
      cssPart * 0.075 +
      fontPart * 0.075,
  );

  return {
    key: "payload",
    label: "Payload burden",
    value,
    note: "Measured weight and sampled request count versus declared budgets for low-end devices (see budgets below).",
    parts: [
      {
        label: "JavaScript (incl. inline)",
        actual: fmtKb(jsKb),
        budget: `${BUDGETS.jsKB} KB`,
        badness: jsPart,
      },
      {
        label: "Total measured weight",
        actual: fmtKb(totalKb),
        budget: `${BUDGETS.totalKB} KB`,
        badness: totalPart,
      },
      {
        label: "Requests (sampled)",
        actual: `${obs.requestsSampled}`,
        budget: `${BUDGETS.requests}`,
        badness: requestPart,
      },
      { label: "CSS (incl. inline)", actual: fmtKb(cssKb), budget: `${BUDGETS.cssKB} KB`, badness: cssPart },
      { label: "Web fonts", actual: fmtKb(obs.fontKb), budget: `${BUDGETS.fontKB} KB`, badness: fontPart },
    ],
  };
}

function computeCompat(obs: Observations): CategoryScore {
  let raw = 0;
  const parts: CategoryPart[] = [];
  for (const verdict of obs.verdicts) {
    const noCount = verdict.brokenProfiles.length;
    const partialCount = verdict.degradedProfiles.length;
    if (noCount === 0 && partialCount === 0) continue;
    const contribution = Math.min(
      100,
      verdict.weight * (noCount * 6 + partialCount * 2.5),
    );
    raw += contribution;
    parts.push({
      label: verdict.label,
      actual:
        noCount > 0
          ? `unsupported on ${noCount}/${obs.profiles.length} target devices`
          : `degraded on ${partialCount}/${obs.profiles.length} target devices`,
      badness: Math.round(contribution),
    });
  }
  const value = Math.min(100, Math.round(raw));
  parts.sort((a, b) => b.badness - a.badness);
  return {
    key: "compat",
    label: "Compatibility breakage",
    value,
    note: "Shipped language/CSS features checked against caniuse support tables for the target devices.",
    parts: parts.slice(0, 8),
  };
}

function computeHazards(obs: Observations): CategoryScore {
  const parts: CategoryPart[] = [];
  let raw = 0;

  const push = (label: string, actual: string, value: number) => {
    if (value <= 0) return;
    raw += value;
    parts.push({ label, actual, badness: Math.round(value) });
  };

  push(
    "Scripts blocking first render",
    `${obs.blockingScripts} in <head>`,
    Math.min(60, obs.blockingScripts * 10),
  );
  push(
    "document.write() usage",
    `${obs.docWriteHits} call sites`,
    Math.min(50, obs.docWriteHits * 8),
  );
  push("Synchronous XHR", obs.syncXhrHits > 0 ? "used" : "none", obs.syncXhrHits > 0 ? 40 : 0);
  push("Viewport meta missing", obs.viewportMeta ? "present" : "missing", obs.viewportMeta ? 0 : 25);
  push("eval() usage", `${obs.evalHits} call sites`, Math.min(30, obs.evalHits * 5));
  const dimRatio = obs.imagesTotal > 0 ? obs.imagesWithoutDimensions / obs.imagesTotal : 0;
  push(
    "Images without width/height",
    `${obs.imagesWithoutDimensions}/${obs.imagesTotal}`,
    Math.round(dimRatio * 30),
  );
  const extraHosts = Math.max(0, obs.thirdPartyScriptHosts.length - 2);
  push(
    "Third-party script origins",
    `${obs.thirdPartyScriptHosts.length} origins`,
    Math.min(40, extraHosts * 8),
  );

  const value = Math.min(100, Math.round(raw));
  parts.sort((a, b) => b.badness - a.badness);
  return {
    key: "hazards",
    label: "Main-thread hazards",
    value,
    note: "Static estimates of main-thread jank on slow CPUs — pattern counts, not measured timing. When the ΔHPF worker is configured, the measured hardware penalty is scored alongside these.",
    parts: parts.slice(0, 8),
  };
}

/**
 * ΔHPF → 0–100 badness. Declared curves, same style as the payload budgets:
 * a reliable ratio maps ΔHPF 0 → 0, ΔHPF 1 (2× slower) → 22, ΔHPF 2 → 44,
 * ΔHPF ≈ 4.5 → 100. When the ratio is unreliable (tiny baseline), the score
 * falls back to absolute throttled TBT against a 4.5 s budget.
 */
function computeHpfCategory(m: HpfMeasurement): CategoryScore {
  const baselineTbt = m.baseline.tbtMs ?? 0;
  const throttledTbt = m.throttled.tbtMs ?? 0;
  const value =
    m.ratioReliable && m.hpf !== null
      ? Math.min(100, Math.round(m.hpf * 22))
      : Math.min(100, Math.round(throttledTbt / 45));

  return {
    key: "hpf",
    label: "Hardware penalty (ΔHPF)",
    value,
    note: `Measured in Chromium: ×${m.config.cpuThrottleRate} CPU throttle + ${m.config.networkProfile}. TBT window: navigation → ${Math.round(m.config.settleMs / 1000)} s after load, both runs.`,
    parts: [
      {
        label: "ΔHPF (throttled vs baseline TBT)",
        actual:
          m.ratioReliable && m.hpf !== null
            ? `+${Math.round(m.hpf * 100)}% (${m.hpf.toFixed(2)})`
            : "ratio unreliable — absolute TBT used",
        badness: value,
      },
      {
        label: "Throttled TBT",
        actual: fmtMs(throttledTbt),
        budget: "4,500 ms",
        badness: Math.min(100, Math.round(throttledTbt / 45)),
      },
      {
        label: "Baseline TBT",
        actual: fmtMs(baselineTbt),
        budget: "1,000 ms",
        badness: Math.min(100, Math.round(baselineTbt / 10)),
      },
    ],
  };
}

function fmtMs(n: number): string {
  return `${Math.round(n).toLocaleString("en-US")} ms`;
}

function buildFindings(obs: Observations, payload: CategoryScore, compat: CategoryScore): Finding[] {
  const findings: Finding[] = [];
  const jsKb = round1(obs.externalJsKb + obs.inlineJsKb);

  // 1. JavaScript payload over budget — name the actual heaviest assets.
  if (jsKb > BUDGETS.jsKB) {
    const heaviest = obs.assets
      .filter((a) => a.kind === "script" && a.ok)
      .sort((a, b) => b.kb - a.kb)
      .slice(0, 3)
      .map((a) => `${displayUrl(a.url)} — ${fmtKb(a.kb)}`);
    findings.push({
      id: "js-budget",
      title: `JavaScript payload is ${fmtKb(jsKb)} — ${round1(jsKb / BUDGETS.jsKB)}× the ${BUDGETS.jsKB} KB budget for old devices`,
      severity: jsKb > BUDGETS.jsKB * 2 ? "critical" : "warning",
      category: "payload",
      detail: `On a low-end 2018 phone this implies roughly ${round1(jsKb / 1024 / LOW_END_PARSE_SPEED_MB_S)} s of parse-and-execute work before the page is interactive (static estimate at ~${LOW_END_PARSE_SPEED_MB_S} MB/s; not a measured run).`,
      evidence: heaviest.length > 0 ? heaviest : ["inline scripts only"],
      fix: `Cut ${displayUrl(obs.assets.filter((a) => a.kind === "script").sort((a, b) => b.kb - a.kb)[0]?.url ?? "the largest bundle")} first: run a bundle analyzer (e.g. source-map-explorer), drop unused dependencies, and split routes so only the critical path ships on first load.`,
    });
  }

  // 2. Total weight over budget.
  const totalKb = round1(obs.htmlKb + jsKb + obs.externalCssKb + obs.inlineCssKb + obs.fontKb + obs.mediaHeadKb);
  if (totalKb > BUDGETS.totalKB) {
    findings.push({
      id: "total-budget",
      title: `Total measured weight is ${fmtKb(totalKb)} (budget: ${BUDGETS.totalKB} KB)`,
      severity: "warning",
      category: "payload",
      detail: "On the slow connections typical of budget devices this weight alone stretches first render — an inference from the measured size, not a throttled measurement.",
      evidence: [`${obs.requestsSampled} requests sampled`],
      fix: "Set hard performance budgets in CI and lazy-load everything below the fold (images, embeds, non-critical scripts).",
    });
  }

  // 3. Per-feature compatibility findings — worst first.
  const breaking = obs.verdicts.filter((v) => v.brokenProfiles.length > 0);
  for (const verdict of breaking.slice(0, 5)) {
    findings.push({
      id: `compat-${verdict.id}`,
      title: `Ships ${verdict.label} — unsupported on ${verdict.brokenProfiles.map(profileLabel).join(", ")}`,
      severity: verdict.weight >= 3 ? "critical" : "warning",
      category: "compatibility",
      detail: `Used ${verdict.count}× in ${verdict.assets.map(displayUrl).join(", ")}.`,
      evidence: verdict.assets.map(displayUrl),
      fix: verdict.fix,
    });
  }
  const degrading = obs.verdicts.filter(
    (v) => v.brokenProfiles.length === 0 && v.degradedProfiles.length > 0 && v.weight >= 2,
  );
  for (const verdict of degrading.slice(0, 3)) {
    findings.push({
      id: `degrade-${verdict.id}`,
      title: `Ships ${verdict.label} — degrades on ${verdict.degradedProfiles.map(profileLabel).join(", ")}`,
      severity: "notice",
      category: "compatibility",
      detail: `Used ${verdict.count}× in ${verdict.assets.map(displayUrl).join(", ")}.`,
      evidence: verdict.assets.map(displayUrl),
      fix: verdict.fix,
    });
  }

  // 4. Blocking scripts — name them.
  if (obs.blockingScripts > 0) {
    const blocking = obs.assets
      .filter((a) => a.kind === "script" && a.blocking)
      .map((a) => displayUrl(a.url));
    findings.push({
      id: "blocking-scripts",
      title: `${obs.blockingScripts} script${obs.blockingScripts === 1 ? "" : "s"} block the first render`,
      severity: obs.blockingScripts >= 3 ? "warning" : "notice",
      category: "hazards",
      detail: "Parser-blocking scripts in <head> stall rendering — the effect is multiplied on slow CPUs and networks.",
      evidence: blocking.slice(0, 5),
      fix: `Add \`defer\` (or \`async\`) to ${blocking.slice(0, 3).join(", ") || "these tags"}, or move them to the end of <body>.`,
    });
  }

  if (obs.docWriteHits > 0) {
    findings.push({
      id: "docwrite",
      title: `document.write() used at ${obs.docWriteHits} call site${obs.docWriteHits === 1 ? "" : "s"}`,
      severity: "warning",
      category: "hazards",
      detail: "document.write() forces the parser to stop and can re-run layout — a classic source of multi-second delays on low-end devices.",
      evidence: obs.assets.filter((a) => a.kind === "script").slice(0, 4).map((a) => displayUrl(a.url)),
      fix: "Replace document.write() with DOM APIs (createElement/appendChild) or modern injection; load third-party embeds asynchronously.",
    });
  }

  if (obs.syncXhrHits > 0) {
    findings.push({
      id: "sync-xhr",
      title: "Synchronous XHR in use",
      severity: "warning",
      category: "hazards",
      detail: "Synchronous XHR freezes the entire main thread — browsers warn against it and low-end devices lock up visibly.",
      evidence: ["XMLHttpRequest.open(..., false)"],
      fix: "Replace with fetch() plus async handling; if the call gates rendering, show a skeleton state instead of blocking.",
    });
  }

  if (!obs.viewportMeta) {
    findings.push({
      id: "viewport",
      title: "No viewport meta tag",
      severity: "warning",
      category: "layout",
      detail: "Without <meta name=\"viewport\">, mobile browsers render at a desktop width and scale down — unreadable on small screens.",
      evidence: ["<head>"],
      fix: "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> to the document head.",
    });
  }

  if (obs.fontFaces > obs.fontFaceMissingDisplay && obs.fontFaceMissingDisplay > 0) {
    findings.push({
      id: "font-display",
      title: `${obs.fontFaceMissingDisplay} @font-face rule${obs.fontFaceMissingDisplay === 1 ? "" : "s"} without font-display`,
      severity: "notice",
      category: "rendering",
      detail: "Without font-display, text is invisible while fonts download on slow connections (FOIT).",
      evidence: ["@font-face rules"],
      fix: "Add `font-display: swap` to every @font-face rule so text renders immediately in a fallback face.",
    });
  }

  if (obs.imagesTotal > 0 && obs.imagesWithoutDimensions / obs.imagesTotal > 0.3) {
    findings.push({
      id: "img-dims",
      title: `${obs.imagesWithoutDimensions} of ${obs.imagesTotal} images lack width/height`,
      severity: "notice",
      category: "layout",
      detail: "Images without declared dimensions cause layout shift as they arrive — cumulative layout shift is worse on slow CPUs.",
      evidence: ["<img> tags"],
      fix: "Set width/height attributes (or aspect-ratio CSS) on the listed images to reserve their layout space.",
    });
  }

  if (obs.renderBlockingStylesheets >= 3) {
    findings.push({
      id: "blocking-css",
      title: `${obs.renderBlockingStylesheets} render-blocking stylesheets`,
      severity: "notice",
      category: "rendering",
      detail: "Every blocking stylesheet delays first paint; low-end devices compound the wait with slow CSS parsing.",
      evidence: obs.assets.filter((a) => a.kind === "style").slice(0, 4).map((a) => displayUrl(a.url)),
      fix: "Inline the critical CSS for the first viewport and load the rest asynchronously (media=\"print\" onload swap, or rel=preload + onload).",
    });
  }

  if (obs.thirdPartyScriptHosts.length > 4) {
    findings.push({
      id: "third-party",
      title: `${obs.thirdPartyScriptHosts.length} third-party script origins`,
      severity: "notice",
      category: "hazards",
      detail: "Each origin adds DNS + TLS + execution cost you do not control; on old devices third-party JS is often the top main-thread consumer.",
      evidence: obs.thirdPartyScriptHosts.slice(0, 6),
      fix: "Audit each third-party origin: self-host what you can, lazy-load the rest after first interaction, and drop unused tags.",
    });
  }

  if (obs.evalHits > 0) {
    findings.push({
      id: "eval",
      title: `eval() used at ${obs.evalHits} call site${obs.evalHits === 1 ? "" : "s"}`,
      severity: "notice",
      category: "hazards",
      detail: "eval() blocks JIT optimization and compiles code at runtime — expensive on weak CPUs.",
      evidence: ["script sources"],
      fix: "Replace eval() with JSON.parse or data-driven lookups.",
    });
  }

  const severityRank: Record<Finding["severity"], number> = { critical: 0, warning: 1, notice: 2 };
  findings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  return findings.slice(0, 12);
}

function buildVerdict(
  obs: Observations,
  score: number,
  payload: CategoryScore,
  compat: CategoryScore,
  hazards: CategoryScore,
  hpfCategory: CategoryScore | null,
  hpf: HpfMeasurement | null,
): string[] {
  const lines: string[] = [];
  const { grade, note } = gradeFor(score);
  lines.push(
    `${obs.host} scores ${score}/100 for obsolescence pressure — “${grade}”. ${note}`,
  );

  if (hpf && hpfCategory) {
    const baselineTbt = hpf.baseline.tbtMs ?? 0;
    const throttledTbt = hpf.throttled.tbtMs ?? 0;
    lines.push(
      hpf.ratioReliable && hpf.hpf !== null
        ? `Measured hardware penalty: TBT rose from ${fmtMs(baselineTbt)} at full speed to ${fmtMs(throttledTbt)} under the low-end profile (×${hpf.config.cpuThrottleRate} CPU, ${hpf.config.networkProfile}) — ΔHPF ${hpf.hpf.toFixed(2)}, about ${(1 + hpf.hpf).toFixed(1)}× longer to shed main-thread work. This is a real browser measurement.`
        : `Measured hardware penalty: the baseline run was nearly block-free (${fmtMs(baselineTbt)} TBT), so the ratio is unstable; the low-end run measured ${fmtMs(throttledTbt)} of blocking time (×${hpf.config.cpuThrottleRate} CPU, ${hpf.config.networkProfile}), which is what the score uses.`,
    );
  }

  const jsKb = round1(obs.externalJsKb + obs.inlineJsKb);
  if (jsKb > 0) {
    const seconds = round1(jsKb / 1024 / LOW_END_PARSE_SPEED_MB_S);
    lines.push(
      jsKb > BUDGETS.jsKB
        ? `The page ships ${fmtKb(jsKb)} of JavaScript. On a low-end 2018 Android, that implies roughly ${seconds} s of parse-and-execute work before it becomes interactive — a static estimate at ~${LOW_END_PARSE_SPEED_MB_S} MB/s, not a measured run.`
        : `The JavaScript payload (${fmtKb(jsKb)}) is modest — parsing it should not strain older phones.`,
    );
  } else {
    lines.push("No JavaScript was found in the document or its fetched subresources.");
  }

  const broken = obs.verdicts.filter((v) => v.brokenProfiles.length > 0);
  const degraded = obs.verdicts.filter((v) => v.degradedProfiles.length > 0);
  if (broken.length > 0) {
    const worst = broken.slice(0, 3).map((v) => v.label).join("; ");
    lines.push(
      `${broken.length} shipped feature${broken.length === 1 ? " is" : "s are"} unsupported on at least one target device (${worst})` +
        (degraded.length > 0 ? `, and ${degraded.length} more degrade gracefully-but-visibly.` : "."),
    );
  } else if (obs.verdicts.length > 0) {
    lines.push(
      `All ${obs.verdicts.length} detected modern features are supported on the target device profiles.`,
    );
  } else {
    lines.push("No modern JavaScript or CSS features were detected in the fetched code.");
  }

  const hazardBits: string[] = [];
  if (obs.blockingScripts > 0) {
    hazardBits.push(`${obs.blockingScripts} script${obs.blockingScripts === 1 ? "" : "s"} block the first render`);
  }
  if (obs.docWriteHits > 0) hazardBits.push(`document.write() appears ${obs.docWriteHits}×`);
  if (obs.syncXhrHits > 0) hazardBits.push("synchronous XHR freezes the main thread");
  if (hazardBits.length > 0) lines.push(`Main-thread hazards: ${hazardBits.join("; ")}.`);

  lines.push(
    hpfCategory
      ? `Category drivers: payload ${payload.value}/100, compatibility ${compat.value}/100, hazards ${hazards.value}/100, measured ΔHPF ${hpfCategory.value}/100 (weights ${CATEGORY_WEIGHTS_WITH_HPF.payload}/${CATEGORY_WEIGHTS_WITH_HPF.compat}/${CATEGORY_WEIGHTS_WITH_HPF.hazards}/${CATEGORY_WEIGHTS_WITH_HPF.hpf}).`
      : `Category drivers: payload ${payload.value}/100, compatibility ${compat.value}/100, hazards ${hazards.value}/100 (weights ${CATEGORY_WEIGHTS.payload}/${CATEGORY_WEIGHTS.compat}/${CATEGORY_WEIGHTS.hazards}).`,
  );
  return lines;
}

export function assembleReport(
  obs: Observations,
  hpf?: HpfMeasurement | null,
  hpfReason?: string,
): ScanReport {
  // “Measured” requires BOTH Chromium runs to have completed with TBT data.
  const hpfMeasurement =
    hpf &&
    hpf.baseline.ok &&
    hpf.throttled.ok &&
    hpf.baseline.tbtMs !== null &&
    hpf.throttled.tbtMs !== null
      ? hpf
      : null;

  const payload = computePayload(obs);
  const compat = computeCompat(obs);
  const hazards = computeHazards(obs);
  const hpfCategory = hpfMeasurement ? computeHpfCategory(hpfMeasurement) : null;

  const weights = hpfCategory ? CATEGORY_WEIGHTS_WITH_HPF : CATEGORY_WEIGHTS;
  const value = Math.round(
    payload.value * weights.payload +
      compat.value * weights.compat +
      hazards.value * weights.hazards +
      (hpfCategory ? hpfCategory.value * CATEGORY_WEIGHTS_WITH_HPF.hpf : 0),
  );
  const { grade, note } = gradeFor(value);

  const jsKb = round1(obs.externalJsKb + obs.inlineJsKb);

  return {
    version: 1,
    url: obs.url,
    finalUrl: obs.finalUrl,
    host: obs.host,
    title: obs.title,
    fetchedAt: Date.now(),
    durationMs: obs.durationMs,
    httpStatus: obs.httpStatus,
    htmlKb: obs.htmlKb,
    metrics: {
      externalJsKb: round1(obs.externalJsKb),
      inlineJsKb: round1(obs.inlineJsKb),
      externalCssKb: round1(obs.externalCssKb),
      inlineCssKb: round1(obs.inlineCssKb),
      fontKb: round1(obs.fontKb),
      mediaHeadKb: round1(obs.mediaHeadKb),
      mediaCounted: obs.mediaCounted,
      mediaTotal: obs.mediaTotal,
      requestsSampled: obs.requestsSampled,
      thirdPartyScriptHosts: obs.thirdPartyScriptHosts,
      blockingScripts: obs.blockingScripts,
      renderBlockingStylesheets: obs.renderBlockingStylesheets,
      docWriteHits: obs.docWriteHits,
      syncXhrHits: obs.syncXhrHits,
      evalHits: obs.evalHits,
      viewportMeta: obs.viewportMeta,
      imagesWithoutDimensions: obs.imagesWithoutDimensions,
      imagesTotal: obs.imagesTotal,
      largestJsAssetKb: round1(obs.largestJsAssetKb),
      fontFaces: obs.fontFaces,
      fontFaceMissingDisplay: obs.fontFaceMissingDisplay,
      skippedAssets: obs.skippedAssets,
      subresourceTotal: obs.subresourceTotal,
    },
    jsKb,
    jsParseSecondsEstimate: round1(jsKb / 1024 / LOW_END_PARSE_SPEED_MB_S),
    categories: hpfCategory
      ? [payload, compat, hazards, hpfCategory]
      : [payload, compat, hazards],
    score: { value, grade, gradeNote: note },
    hpf: hpfMeasurement
      ? {
          status: "measured",
          measurement: hpfMeasurement,
          note: "Measured in a real Chromium dual-run — see the Hardware Penalty Factor section.",
        }
      : {
          status: "unavailable",
          reason:
            hpfReason ?? "the ΔHPF worker was not configured for this audit",
          formula: HPF_FORMULA,
          note: HPF_STATUS_NOTE,
          setup: HPF_SETUP_HINT,
        },
    verdict: buildVerdict(obs, value, payload, compat, hazards, hpfCategory, hpfMeasurement),
    features: obs.verdicts,
    findings: buildFindings(obs, payload, compat),
    assets: obs.assets,
    profiles: obs.profiles,
    method: {
      measured: buildMeasuredMethod(hpfMeasurement),
      estimated: [
        "Low-end parse seconds — assumes ~1 MB/s parse+execute on a 2018-class SoC; not a browser measurement",
        "Category badness curves — linear-to-budget scaling against the declared budgets shown in the report",
      ],
      notMeasured: buildNotMeasuredMethod(hpfMeasurement, hpfReason),
    },
  };
}

function buildMeasuredMethod(hpf: HpfMeasurement | null): string[] {
  const base = [
    "Live HTTP fetch of the document and up to 20 subresources (scripts, styles, fonts), prioritizing render-blocking files",
    "Decompressed byte sizes, wire sizes where the server declares them, and per-asset fetch times",
    "Media sizes via HEAD requests for a sample of images",
    "Regex scan of shipped JavaScript/CSS for modern language and CSS features",
    "Support cross-check against caniuse-lite device tables (extracted, version-stamped)",
  ];
  if (hpf) {
    base.unshift(
      `Chromium dual-run TBT (Playwright): full speed vs ×${hpf.config.cpuThrottleRate} CPU + ${hpf.config.networkProfile}, measured in a real browser`,
    );
  }
  return base;
}

function buildNotMeasuredMethod(hpf: HpfMeasurement | null, reason?: string): string[] {
  const list: string[] = [];
  if (!hpf) {
    list.push(
      reason
        ? `Throttled dual-run ΔHPF — attempted but unavailable: ${reason}`
        : "Throttled dual-run ΔHPF (TBT full-speed vs throttled low-end) — configure the hpf-worker to enable it",
    );
  }
  list.push(
    "AST-level parsing — Phase 2 upgrade over the regex MVP detector",
    "Full page weight — media bytes use a HEAD-request sample, not a full download",
  );
  return list;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function fmtKb(n: number): string {
  return n >= 1024 ? `${round1(n / 1024)} MB` : `${Math.round(n)} KB`;
}

function displayUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? u.host : `${u.host}${u.pathname}`;
    const name = path.split("/").pop() ?? path;
    return name.length > 48 ? `${name.slice(0, 45)}…` : name || u.host;
  } catch {
    return url.length > 48 ? `${url.slice(0, 45)}…` : url;
  }
}

function profileLabel(key: string): string {
  switch (key) {
    case "android66":
      return "Android WebView 66";
    case "android96":
      return "Android WebView 96";
    case "ios12":
      return "iOS Safari 12";
    case "ios13":
      return "iOS Safari 13";
    default:
      return key;
  }
}
