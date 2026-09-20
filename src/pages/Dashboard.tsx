import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ScanProgress } from "@/components/ScanProgress";
import { ScanReportView } from "@/components/ScanReportView";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import type { ScanReport } from "@/lib/obsolescence/types";
import { useAction, useMutation, useQuery } from "convex/react";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

export default function Dashboard() {
  const { user } = useAuth();
  const [url, setUrl] = useState("");
  const [scanId, setScanId] = useState<Id<"scans"> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const startedFor = useRef<Id<"scans"> | null>(null);

  const createScan = useMutation(api.scans.create);
  const runScan = useAction(api.runScan.run);
  const scan = useQuery(api.scans.get, scanId ? { id: scanId } : "skip");
  const recent = useQuery(api.scans.listRecent, {});

  // Kick the pipeline action exactly once per created scan. Stage progress
  // streams through the scan row, so the query below updates live.
  useEffect(() => {
    if (!scan || scan.status !== "queued" || startedFor.current === scan._id) return;
    startedFor.current = scan._id;
    void runScan({ id: scan._id, url: scan.url }).catch((err) => {
      console.error("runScan failed:", err);
      toast.error("The audit could not run. Check the URL and try again.");
    });
  }, [scan, runScan]);

  const running = scan?.status === "queued" || scan?.status === "running";

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || submitting || running) return;
    setSubmitting(true);
    setFormError(null);
    setScanId(null);
    try {
      const id = await createScan({ url: trimmed });
      setScanId(id);
      setUrl("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not start the audit.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader active="audit" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <div className="flex flex-col gap-12">
          {/* Audit form */}
          <section>
            <h1 className="display-heading text-3xl">Audit a site</h1>
            <p className="mt-2 max-w-prose text-sm leading-6 text-muted-foreground">
              Enter any live URL. The engine fetches the real document, weighs what it
              ships, checks compatibility against aging device profiles, and returns a
              score with specific fixes. When the ΔHPF browser worker is configured, the
              audit also runs a real throttled Chromium measurement.
            </p>
            {user && (
              <p className="mt-1 text-xs text-muted-foreground/70">
                Signed in as {user.email ?? user.name ?? "anonymous session"}
              </p>
            )}
            <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="example.com"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                disabled={submitting || running}
                className="h-11 flex-1 bg-card"
              />
              <Button
                type="submit"
                className="h-11 gap-2"
                disabled={submitting || running || url.trim().length === 0}
              >
                {running ? "Auditing…" : "Run audit"}
                <ArrowRight className="size-4" />
              </Button>
            </form>
            {formError && <p className="mt-2 text-sm text-destructive">{formError}</p>}
          </section>

          {/* Live progress */}
          {scan && running && (
            <section className="rounded-lg border border-border bg-card p-6">
              <ScanProgress stage={scan.stage} note={scan.stageNote} />
              <p className="mt-5 text-xs text-muted-foreground">
                A typical audit takes ten to thirty seconds.
              </p>
            </section>
          )}

          {/* Failure */}
          {scan?.status === "error" && (
            <section className="rounded-lg border border-destructive/40 bg-card p-6">
              <h2 className="text-sm font-medium">The audit failed</h2>
              <p className="mt-1 text-sm text-muted-foreground">{scan.error}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4 gap-2"
                onClick={() => {
                  startedFor.current = null;
                  setScanId(null);
                }}
              >
                <RotateCcw className="size-3.5" />
                Try another URL
              </Button>
            </section>
          )}

          {/* Report */}
          {scan?.status === "done" && scan.report && (
            <section className="flex flex-col gap-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">
                  Audit complete
                </p>
                <div className="flex gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/audit/${scan._id}`}>Permalink</Link>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      startedFor.current = null;
                      setScanId(null);
                    }}
                  >
                    New audit
                  </Button>
                </div>
              </div>
              <ScanReportView report={scan.report as ScanReport} />
            </section>
          )}

          {/* Recent audits */}
          <section>
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground">
              Recent audits
            </h2>
            {recent === undefined ? (
              <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
            ) : recent.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No audits yet — run the first one above.
              </p>
            ) : (
              <ul className="mt-2">
                {recent.map((r) => (
                  <li key={r._id}>
                    <Link
                      to={`/audit/${r._id}`}
                      className="flex items-baseline justify-between gap-4 border-b border-border/60 py-3 transition-colors last:border-b-0 hover:bg-muted/40"
                    >
                      <span className="truncate text-sm font-medium">{r.host}</span>
                      <span className="flex shrink-0 items-baseline gap-4">
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
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
