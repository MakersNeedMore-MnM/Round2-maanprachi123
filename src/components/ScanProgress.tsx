import { Loader2 } from "lucide-react";
import {
  SCAN_STAGES,
  STAGE_INFO,
} from "@/lib/obsolescence/types";

const STAGE_INDEX = new Map<string, number>(SCAN_STAGES.map((s, i) => [s, i]));

/**
 * Live stage list for a running scan. `stage` is the latest stage written to
 * the scan row; stages before it are done, it is active, later ones pending.
 */
export function ScanProgress({
  stage,
  note,
  compact = false,
}: {
  stage: string | undefined;
  note?: string | null;
  compact?: boolean;
}) {
  const currentIndex = stage ? (STAGE_INDEX.get(stage) ?? 0) : 0;

  return (
    <ol className={compact ? "flex flex-wrap gap-x-5 gap-y-2" : "flex flex-col gap-3"}>
      {STAGE_INFO.map((info) => {
        const index = STAGE_INDEX.get(info.key) ?? 0;
        const state =
          index < currentIndex ? "done" : index === currentIndex ? "active" : "pending";
        return (
          <li
            key={info.key}
            className={
              compact
                ? "flex items-center gap-1.5 text-xs"
                : "flex items-baseline gap-3 text-sm"
            }
          >
            {state === "active" ? (
              <Loader2
                className={compact ? "size-3 animate-spin" : "size-3.5 shrink-0 translate-y-0.5 animate-spin"}
              />
            ) : (
              <span
                className={
                  compact
                    ? "inline-block size-1.5 rounded-full " +
                      (state === "done" ? "bg-foreground" : "bg-border")
                    : "inline-block size-1.5 shrink-0 translate-y-[-2px] rounded-full " +
                      (state === "done" ? "bg-foreground" : "bg-border")
                }
              />
            )}
            <span
              className={
                state === "pending" ? "text-muted-foreground/60" : state === "done" ? "text-muted-foreground" : "font-medium"
              }
            >
              {info.label}
            </span>
            {!compact && state === "active" && note && (
              <span className="text-xs text-muted-foreground">{note}</span>
            )}
            {!compact && state === "done" && (
              <span className="text-xs text-muted-foreground/60">{info.blurb}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
