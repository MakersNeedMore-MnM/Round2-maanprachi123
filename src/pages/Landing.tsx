import { api } from "@/convex/_generated/api";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import type { ScanReport } from "@/lib/obsolescence/types";
import { useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router";

const HOW_STEPS = [
  {
    n: "01",
    title: "Load the live site",
    body: "The engine fetches the real document over HTTPS and maps every script, stylesheet, font, and image reference it declares — no screenshots, no simulated pages.",
  },
  {
    n: "02",
    title: "Weigh what ships",
    body: "Scripts, stylesheets, and fonts are downloaded and measured. Render-blocking files are prioritized; media is sized through HEAD requests.",
  },
  {
    n: "03",
    title: "Check device support",
    body: "The JavaScript and CSS the site actually ships is cross-checked against caniuse support tables for four aging device profiles, from Android WebView 66 to iOS Safari 13.",
  },
  {
    n: "04",
    title: "Score and explain",
    body: "Payload, compatibility, and main-thread hazards combine into one 0–100 score — joined by a measured hardware penalty (ΔHPF) whenever the Chromium worker is configured — explained in plain language with specific, prioritized fixes.",
  },
];

const GRADE_BANDS = [
  { max: 19, grade: "Resilient" },
  { max: 39, grade: "Tolerable" },
  { max: 59, grade: "Strained" },
  { max: 79, grade: "Exclusionary" },
  { max: 100, grade: "Hostile" },
];

export default function Landing() {
  const recent = useQuery(api.scans.listRecent, {});
  const latest = recent?.[0];
  const latestScan = useQuery(api.scans.get, latest ? { id: latest._id } : "skip");
  const latestReport =
    latestScan && latestScan.status === "done"
      ? (latestScan.report as ScanReport | undefined)
      : undefined;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader active="method" />

      {/* Hero */}
      <section className="border-b border-border/70">
        <div className="mx-auto grid w-full max-w-6xl gap-12 px-6 py-20 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:py-28">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          >
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Internal tool · Device longevity
            </p>
            <h1 className="display-heading mt-4 max-w-xl text-5xl leading-[1.08] sm:text-6xl">
              Websites are quietly retiring perfectly good phones.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground">
              Obsolescence Score audits any live URL and measures what the page really
              ships — JavaScript weight, render-blocking behavior, modern API usage —
              then scores how hard it pressures older devices toward the upgrade bin.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg" className="h-11 gap-2 px-6">
                <Link to="/dashboard">
                  Run an audit
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <a
                href="#method"
                className="rounded-md px-4 py-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                Read the method
              </a>
            </div>
          </motion.div>

          {/* Latest real audit as the hero artifact */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: "easeOut" }}
            className="rounded-lg border border-border bg-card p-8"
          >
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              {latestReport ? "Most recent audit" : "Live readout"}
            </p>
            {latestReport ? (
              <>
                <div className="mt-4 flex items-baseline gap-2">
                  <span className="text-6xl font-light tabular-nums tracking-tight">
                    {latestReport.score.value}
                  </span>
                  <span className="text-sm text-muted-foreground">/100</span>
                </div>
                <p className="mt-1 text-sm font-medium">{latestReport.score.grade}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {latestReport.host}
                </p>
                <div className="mt-6 flex flex-col gap-3">
                  {latestReport.categories.map((cat) => (
                    <div key={cat.key}>
                      <div className="flex items-baseline justify-between text-xs">
                        <span className="text-muted-foreground">{cat.label}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {cat.value}/100
                        </span>
                      </div>
                      <div className="mt-1 h-1 w-full rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-foreground"
                          style={{ width: `${Math.min(100, cat.value)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="mt-4 text-sm leading-6 text-muted-foreground">
                No audits yet. The first one you run will appear here with its live
                score — measured, not simulated.
              </p>
            )}
          </motion.div>
        </div>
      </section>

      {/* Method */}
      <section id="method" className="scroll-mt-16 border-b border-border/70">
        <div className="mx-auto w-full max-w-6xl px-6 py-20">
          <h2 className="display-heading text-3xl">How an audit runs</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            Every audit follows the same pipeline, end to end, on the live site.
          </p>
          <div className="mt-10 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            {HOW_STEPS.map((step) => (
              <div key={step.n} className="rule pt-5">
                <p className="font-mono text-xs text-muted-foreground/70">{step.n}</p>
                <h3 className="mt-2 text-sm font-medium">{step.title}</h3>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Honesty */}
      <section className="border-b border-border/70 bg-secondary/40">
        <div className="mx-auto w-full max-w-6xl px-6 py-20">
          <h2 className="display-heading text-3xl">Measured, estimated, and honestly missing</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            Nothing in a report is simulated. Where a number is an estimate, the report
            says so — and what cannot be measured yet is listed, not faked.
          </p>
          <div className="mt-10 grid gap-10 md:grid-cols-3">
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Measured
              </h3>
              <ul className="mt-3 flex flex-col gap-2 text-sm leading-6 text-muted-foreground">
                <li>Live HTTP fetch of the document and up to twenty subresources</li>
                <li>Decompressed and wire byte sizes, per-asset fetch times</li>
                <li>Media sizes sampled through HEAD requests</li>
                <li>Feature detection across all shipped JavaScript and CSS</li>
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Estimated
              </h3>
              <ul className="mt-3 flex flex-col gap-2 text-sm leading-6 text-muted-foreground">
                <li>
                  Low-end parse seconds, from a static ~1 MB/s assumption for 2018-class
                  hardware
                </li>
                <li>Category pressure curves against the declared budgets</li>
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Not yet measured
              </h3>
              <ul className="mt-3 flex flex-col gap-2 text-sm leading-6 text-muted-foreground">
                <li>
                  Throttled dual-run ΔHPF — time on a full-speed run versus a throttled
                  low-end simulation. Needs headless Chromium with CPU throttling;
                  planned next.
                </li>
                <li>AST-level code parsing beyond today's targeted detection</li>
                <li>Full page weight beyond the media sample</li>
              </ul>
            </div>
          </div>
          <div className="mt-12 flex flex-wrap items-baseline gap-x-6 gap-y-2">
            {GRADE_BANDS.map((band) => (
              <p key={band.grade} className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{band.grade}</span> · ≤{" "}
                {band.max}
              </p>
            ))}
          </div>
        </div>
      </section>

      {/* Recent audits */}
      <section className="border-b border-border/70">
        <div className="mx-auto w-full max-w-6xl px-6 py-20">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="display-heading text-3xl">Recent audits</h2>
            <Link
              to="/dashboard"
              className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Run yours
            </Link>
          </div>
          {recent === undefined ? null : recent.length === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">
              No audits yet — run the first one from the console.
            </p>
          ) : (
            <ul className="mt-8">
              {recent.map((r) => (
                <li key={r._id}>
                  <Link
                    to={`/audit/${r._id}`}
                    className="flex items-baseline justify-between gap-4 border-b border-border/60 py-4 transition-colors last:border-b-0 hover:bg-muted/40"
                  >
                    <span className="truncate text-sm font-medium">{r.host}</span>
                    <span className="flex shrink-0 items-baseline gap-5">
                      <span className="text-xs text-muted-foreground">{r.grade}</span>
                      <span className="text-sm tabular-nums">{r.scoreValue}</span>
                      <span className="w-24 text-right text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(r.completedAt), { addSuffix: true })}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Closing CTA */}
      <section>
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center px-6 py-24 text-center">
          <h2 className="display-heading max-w-2xl text-4xl leading-tight">
            Find out what your site costs an old phone.
          </h2>
          <Button asChild size="lg" className="mt-8 h-11 gap-2 px-6">
            <Link to="/dashboard">
              Open the console
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
