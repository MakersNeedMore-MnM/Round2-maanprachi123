import {
  BUDGETS,
  CATEGORY_WEIGHTS,
  CATEGORY_WEIGHTS_WITH_HPF,
  LOW_END_PARSE_SPEED_MB_S,
  type HpfMeasurement,
  type ReportHpf,
  type ScanReport,
  type Severity,
  type SupportLevel,
} from "@/lib/obsolescence/types";
import { format } from "date-fns";
import { Check, Minus, X } from "lucide-react";

/* ---------- formatting helpers ---------- */

function fmtKb(n: number): string {
  return n >= 1024 ? `${(n / 1024).toFixed(1)} MB` : `${Math.round(n)} KB`;
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Plain-language explanation of a measured ΔHPF. */
function hpfPlainLanguage(m: HpfMeasurement): string {
  const baselineTbt = m.baseline.tbtMs ?? 0;
  const throttledTbt = m.throttled.tbtMs ?? 0;
  if (m.ratioReliable && m.hpf !== null) {
    return `Under the low-end profile (×${m.config.cpuThrottleRate} CPU throttle, ${m.config.networkProfile}), the page took about ${(1 + m.hpf).toFixed(1)}× longer to shed main-thread work: TBT rose from ${fmtInt(baselineTbt)} ms at full speed to ${fmtInt(throttledTbt)} ms.`;
  }
  return `The baseline run was nearly block-free (${fmtInt(baselineTbt)} ms TBT), so the baseline-to-throttled ratio is not stable. The low-end run (×${m.config.cpuThrottleRate} CPU, ${m.config.networkProfile}) measured ${fmtInt(throttledTbt)} ms of blocking time, which is what the score uses.`;
}

function profileShort(label: string): string {
  return label.replace("Android WebView", "Android").replace("iOS Safari", "iOS");
}

function describeSupport(level: SupportLevel | undefined): string {
  switch (level) {
    case "yes":
      return "fully supported";
    case "partial":
      return "partially supported — degraded experience";
    case "no":
      return "not supported — likely broken";
    default:
      return "support unknown";
  }
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

const severityClass: Record<Severity, string> = {
  critical: "text-[11px] font-medium uppercase tracking-wider text-destructive",
  warning: "text-[11px] font-medium uppercase tracking-wider text-foreground",
  notice: "text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70",
};

/** What each score category is actually based on, shown next to its name. */
const CATEGORY_BASIS: Record<string, string> = {
  payload: "measured sizes & counts",
  compat: "caniuse cross-check",
  hazards: "static scan estimates",
  hpf: "measured Chromium dual-run",
};

/* ---------- small building blocks ---------- */

function SupportMark({ level }: { level: SupportLevel | undefined }) {
  if (level === "yes") return <Check className="size-3.5" />;
  if (level === "no") return <X className="size-3.5 text-destructive" />;
  if (level === "partial") return <Minus className="size-3.5" />;
  return <Minus className="size-3.5 text-muted-foreground/40" />;
}

function MethodList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h4>
      <ul className="mt-2.5 flex flex-col gap-1.5">
        {items.map((item, i) => (
          <li key={i} className="text-xs leading-5 text-muted-foreground">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Hardware Penalty Factor section — measured dual-run, or an honest unavailable panel. */
function HpfSection({ hpf }: { hpf: ReportHpf }) {
  if (hpf.status === "measured") {
    const m = hpf.measurement;
    const deltaPct = m.ratioReliable && m.hpf !== null ? Math.round(m.hpf * 100) : null;
    return (
      <section className="rule pt-8">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
          Hardware Penalty Factor
        </h3>
        <p className="mt-2 max-w-prose text-sm text-muted-foreground">
          Measured in real Chromium (Playwright): the page was loaded twice — once at
          full speed, once under a low-end profile. TBT is the sum of long-task time
          beyond 50 ms per task, from navigation until{" "}
          {Math.round(m.config.settleMs / 1000)} s after load, identically in both runs.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[420px] max-w-md border-collapse text-sm">
            <tbody>
              <tr className="border-b border-border/60">
                <td className="py-2.5 pr-4 text-muted-foreground">Baseline TBT</td>
                <td className="py-2.5 text-right tabular-nums">
                  {fmtInt(m.baseline.tbtMs ?? 0)} ms
                </td>
              </tr>
              <tr className="border-b border-border/60">
                <td className="py-2.5 pr-4 text-muted-foreground">Low-end TBT</td>
                <td className="py-2.5 text-right tabular-nums">
                  {fmtInt(m.throttled.tbtMs ?? 0)} ms
                </td>
              </tr>
              <tr className="border-b border-border/60">
                <td className="py-2.5 pr-4 text-muted-foreground">Performance delta</td>
                <td className="py-2.5 text-right tabular-nums">
                  {deltaPct !== null ? `+${deltaPct}%` : "—"}
                </td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 font-medium">ΔHPF</td>
                <td className="py-2.5 text-right font-medium tabular-nums">
                  {m.ratioReliable && m.hpf !== null ? m.hpf.toFixed(2) : "—"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {m.ratioNote && (
          <p className="mt-2 max-w-prose text-xs leading-5 text-muted-foreground/80">
            {m.ratioNote}
          </p>
        )}
        <p className="mt-4 max-w-prose text-sm leading-6">{hpfPlainLanguage(m)}</p>
        <p className="mt-3 max-w-prose font-mono text-xs leading-5 text-muted-foreground/80">
          Measured {format(new Date(m.measuredAt), "MMM d, HH:mm")} · Playwright Chromium ·
          ×{m.config.cpuThrottleRate} CPU + {m.config.networkProfile} · both runs
          completed in {(m.durationMs / 1000).toFixed(1)} s
        </p>
      </section>
    );
  }

  const reason =
    hpf.status === "unavailable"
      ? hpf.reason
      : "written before ΔHPF integration — rerun the audit to pick up the new pipeline";
  const setup = hpf.status === "unavailable" ? hpf.setup : undefined;
  return (
    <section className="rule pt-8">
      <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
        Hardware Penalty Factor
      </h3>
      <div className="mt-4 rounded-md border border-border bg-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-sm font-medium">
            ΔHPF throttled dual-run — not measured in this environment
          </h4>
          <code className="font-mono text-xs text-muted-foreground">{hpf.formula}</code>
        </div>
        <p className="mt-2 max-w-prose text-sm leading-6 text-muted-foreground">
          {hpf.note}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">This audit: {reason}.</p>
        {setup && (
          <pre className="mt-3 overflow-x-auto rounded-md border border-border/70 bg-background p-3 font-mono text-xs leading-5 text-muted-foreground">
            {setup}
          </pre>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Once the worker is running and HPF_WORKER_URL is set, new audits measure and
          score ΔHPF automatically. Until then, everything above is static analysis.
        </p>
      </div>
    </section>
  );
}

/* ---------- main report ---------- */

export function ScanReportView({ report }: { report: ScanReport }) {
  const hpfMeasured = report.hpf.status === "measured";
  const weights = hpfMeasured ? CATEGORY_WEIGHTS_WITH_HPF : CATEGORY_WEIGHTS;
  return (
    <article className="flex flex-col gap-12">
      {/* Identification */}
      <header>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Audit report</p>
        <h2 className="display-heading mt-2 text-4xl leading-tight">{report.host}</h2>
        {report.title && <p className="mt-1 text-sm text-muted-foreground">{report.title}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>Fetched {format(new Date(report.fetchedAt), "MMM d, yyyy · HH:mm")}</span>
          <span aria-hidden>·</span>
          <span>{(report.durationMs / 1000).toFixed(1)} s analysis</span>
          <span aria-hidden>·</span>
          <span>HTTP {report.httpStatus}</span>
          <span aria-hidden>·</span>
          <a
            href={report.finalUrl}
            target="_blank"
            rel="noreferrer"
            className="max-w-[320px] truncate underline underline-offset-2 hover:text-foreground"
          >
            {report.finalUrl}
          </a>
        </div>
      </header>

      {/* Score — static audit, not a measured low-end-device run */}
      <section className="rule pt-8">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Obsolescence score ·{" "}
          {hpfMeasured ? "static audit + measured ΔHPF" : "static audit"}
        </p>
        <div className="mt-4 grid gap-8 md:grid-cols-[auto_1fr] md:items-center">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-6xl font-light tabular-nums tracking-tight">
                {report.score.value}
              </span>
              <span className="text-sm text-muted-foreground">/100</span>
            </div>
            <p className="mt-1 text-sm font-medium">{report.score.grade}</p>
          </div>
          <div>
            <div className="relative h-1.5 w-full rounded-full bg-muted">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-foreground"
                style={{ width: `${report.score.value}%` }}
              />
            </div>
            <div className="relative mt-1 h-2">
              {[20, 40, 60, 80].map((pct) => (
                <span
                  key={pct}
                  className="absolute top-0 h-2 w-px bg-border"
                  style={{ left: `${pct}%` }}
                />
              ))}
            </div>
            <p className="mt-3 max-w-prose text-sm text-muted-foreground">
              {report.score.gradeNote}
            </p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              Higher means more pressure on older devices.
            </p>
          </div>
        </div>
        <div className="mt-6 max-w-prose">
          <p className="text-sm leading-6 text-muted-foreground">
            {hpfMeasured
              ? "This score combines measured payload data from the live crawl, a caniuse cross-check of the JavaScript and CSS the site ships, static main-thread hazard estimates, and a measured Hardware Penalty Factor from a real Chromium dual-run (full speed vs a throttled low-end profile). Measured and estimated inputs are labeled throughout."
              : "This is a static audit score, not a measured low-end-device performance run. It combines measured payload data — asset sizes, request counts, and fetch times captured by the live crawl — with a caniuse cross-check of the JavaScript and CSS the site ships, and static main-thread hazard estimates. No throttled browser test has executed on this page."}
          </p>
          {!hpfMeasured && (
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-border px-3 py-1 text-muted-foreground">
                ΔHPF throttled dual-run — not measured in this environment
              </span>
            </div>
          )}
        </div>
      </section>

      {/* Verdict */}
      <section className="rule pt-8">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
          Plain-language verdict
        </h3>
        <div className="mt-3 flex flex-col gap-3">
          {report.verdict.map((line, i) => (
            <p
              key={i}
              className={
                i === 0 ? "text-base leading-7" : "text-sm leading-6 text-muted-foreground"
              }
            >
              {line}
            </p>
          ))}
        </div>
      </section>

      {/* Category drivers */}
      <section className="rule pt-8">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground">Score drivers</h3>
        <div className="mt-4 flex flex-col gap-10">
          {report.categories.map((cat) => (
            <div key={cat.key}>
              <div className="flex items-baseline justify-between gap-4">
                <h4 className="text-sm font-medium">
                  {cat.label}
                  <span className="ml-2 text-xs font-normal text-muted-foreground/70">
                    {CATEGORY_BASIS[cat.key]}
                  </span>
                </h4>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {cat.value}/100
                </span>
              </div>
              <div className="mt-2 h-1 w-full rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-foreground"
                  style={{ width: `${Math.min(100, cat.value)}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{cat.note}</p>
              {cat.parts.length > 0 && (
                <ul className="mt-3">
                  {cat.parts.map((part) => (
                    <li key={part.label} className="border-t border-border/60 py-2.5">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-sm">
                        <span>{part.label}</span>
                        <span className="tabular-nums text-xs text-muted-foreground">
                          {part.actual}
                          {part.budget ? ` · budget ${part.budget}` : ""}
                        </span>
                      </div>
                      <div className="mt-1.5 h-0.5 w-full bg-muted">
                        <div
                          className="h-full bg-foreground/60"
                          style={{ width: `${Math.min(100, part.badness)}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Findings */}
      <section className="rule pt-8">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
          Actionable findings
        </h3>
        {report.findings.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No issues surfaced — the page is light, compatible, and free of the worst
            main-thread hazards.
          </p>
        ) : (
          <ul className="mt-2">
            {report.findings.map((f) => (
              <li key={f.id} className="border-b border-border/60 py-5 last:border-b-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className={severityClass[f.severity]}>{f.severity}</span>
                  <h4 className="text-sm font-medium">{f.title}</h4>
                  <span className="text-xs text-muted-foreground/60">{f.category}</span>
                </div>
                <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">{f.detail}</p>
                {f.evidence.length > 0 && (
                  <ul className="mt-2.5 flex flex-col gap-0.5">
                    {f.evidence.map((e, i) => (
                      <li key={i} className="truncate font-mono text-xs text-muted-foreground/80">
                        {e}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 border-l-2 border-foreground/20 pl-3">
                  <p className="max-w-prose text-sm leading-6">{f.fix}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Device compatibility */}
      <section className="rule pt-8">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground">
          Device compatibility
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Detected language and CSS features, cross-checked against caniuse support tables
          for the target device profiles.
        </p>
        {report.features.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No modern JavaScript or CSS features were detected in the scanned code.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Feature</th>
                  <th className="py-2 pr-4 font-medium">Used</th>
                  <th className="py-2 font-medium">Support on target devices</th>
                </tr>
              </thead>
              <tbody>
                {report.features.map((f) => (
                  <tr key={f.id} className="border-b border-border/60 align-top">
                    <td className="py-3 pr-4">
                      <div className="font-medium">{f.label}</div>
                      {(f.brokenProfiles.length > 0 || f.degradedProfiles.length > 0) && (
                        <div className="mt-1 max-w-prose text-xs leading-5 text-muted-foreground">
                          {f.fix}
                        </div>
                      )}
                    </td>
                    <td className="py-3 pr-4 tabular-nums text-muted-foreground">×{f.count}</td>
                    <td className="py-3">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        {report.profiles.map((p) => (
                          <span
                            key={p.key}
                            className="flex items-center gap-1.5 text-xs text-muted-foreground"
                            title={`${p.label}: ${describeSupport(f.support[p.key])}`}
                          >
                            <SupportMark level={f.support[p.key]} />
                            {profileShort(p.label)}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <HpfSection hpf={report.hpf} />

      {/* Sampled assets */}
      <section className="rule pt-8">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground">Sampled assets</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Decompressed sizes measured by fetching each file; wire sizes shown where the
          server reported them.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[600px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-4 font-medium">File</th>
                <th className="py-2 pr-4 font-medium">Kind</th>
                <th className="py-2 pr-4 text-right font-medium">Size</th>
                <th className="py-2 pr-4 text-right font-medium">Fetch</th>
                <th className="py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {report.assets.map((a, i) => (
                <tr key={`${a.url}-${i}`} className="border-b border-border/60">
                  <td
                    className="max-w-[300px] truncate py-2.5 pr-4 font-mono text-xs"
                    title={a.url}
                  >
                    {displayUrl(a.url)}
                  </td>
                  <td className="py-2.5 pr-4 text-xs text-muted-foreground">
                    {a.kind}
                    {a.blocking ? " · blocking" : ""}
                  </td>
                  <td className="py-2.5 pr-4 text-right text-xs tabular-nums">
                    {a.ok ? fmtKb(a.kb) : "—"}
                    {a.ok && a.wireKb !== undefined && a.wireKb < a.kb
                      ? ` (wire ${fmtKb(a.wireKb)})`
                      : ""}
                  </td>
                  <td className="py-2.5 pr-4 text-right text-xs tabular-nums text-muted-foreground">
                    {a.ms} ms
                  </td>
                  <td className="py-2.5 text-xs text-muted-foreground">{a.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Method + honesty */}
      <section className="rule pt-8">
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground">Method</h3>
        <div className="mt-4 grid gap-8 md:grid-cols-3">
          <MethodList title="Measured" items={report.method.measured} />
          <MethodList title="Estimated" items={report.method.estimated} />
          <MethodList title="Planned / not yet measured" items={report.method.notMeasured} />
        </div>
        <p className="mt-6 font-mono text-xs leading-5 text-muted-foreground/80">
          Declared budgets — JavaScript {BUDGETS.jsKB} KB · total {BUDGETS.totalKB} KB · CSS{" "}
          {BUDGETS.cssKB} KB · fonts {BUDGETS.fontKB} KB · {BUDGETS.requests} requests.
          Category weights — payload {weights.payload} · compatibility {weights.compat} ·
          hazards {weights.hazards}
          {hpfMeasured ? ` · ΔHPF ${CATEGORY_WEIGHTS_WITH_HPF.hpf}` : ""}. Parse-cost
          estimate assumes ~{LOW_END_PARSE_SPEED_MB_S} MB/s on a 2018-class device.
        </p>
      </section>
    </article>
  );
}
