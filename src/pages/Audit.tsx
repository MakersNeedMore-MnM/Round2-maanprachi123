import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { ScanProgress } from "@/components/ScanProgress";
import { ScanReportView } from "@/components/ScanReportView";
import { SiteFooter, SiteHeader } from "@/components/SiteHeader";
import type { ScanReport } from "@/lib/obsolescence/types";
import { useQuery } from "convex/react";
import { Link, useParams } from "react-router";

/** Convex document ids are lowercase base32-ish strings; guard the URL param. */
const ID_PATTERN = /^[a-z0-9]{16,64}$/;

export default function Audit() {
  const { id } = useParams<{ id: string }>();
  const validId = id !== undefined && ID_PATTERN.test(id);
  // The regex guard above has validated the shape; Convex wants the branded type.
  const scan = useQuery(
    api.scans.get,
    validId ? { id: id as Id<"scans"> } : "skip",
  );

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader active="audit" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        {scan === undefined ? (
          validId ? (
            <p className="text-sm text-muted-foreground">Loading audit…</p>
          ) : (
            <div className="flex flex-col gap-3">
              <h1 className="display-heading text-3xl">Audit not found</h1>
              <p className="text-sm text-muted-foreground">
                This audit does not exist.{" "}
                <Link to="/dashboard" className="underline underline-offset-2">
                  Back to the console.
                </Link>
              </p>
            </div>
          )
        ) : scan === null ? (
          <div className="flex flex-col gap-3">
            <h1 className="display-heading text-3xl">Audit not found</h1>
            <p className="text-sm text-muted-foreground">
              This audit does not exist or was removed.{" "}
              <Link to="/dashboard" className="underline underline-offset-2">
                Back to the console.
              </Link>
            </p>
          </div>
        ) : scan.status === "done" && scan.report ? (
          <ScanReportView report={scan.report as ScanReport} />
        ) : scan.status === "error" ? (
          <div className="flex flex-col gap-3">
            <h1 className="display-heading text-3xl">Audit failed</h1>
            <p className="text-sm text-muted-foreground">{scan.error}</p>
            <Link to="/dashboard" className="text-sm underline underline-offset-2">
              Start a new audit.
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground">
                Audit in progress
              </p>
              <h1 className="display-heading mt-2 text-3xl">{scan.host}</h1>
            </div>
            <ScanProgress stage={scan.stage} note={scan.stageNote} />
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
