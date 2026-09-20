/**
 * Compatibility layer: turns detected feature usage into per-device
 * verdicts using the extracted caniuse support tables
 * (src/convex/engine/compat-data.ts — real data, version-stamped).
 */
import {
  COMPAT_DATA_SOURCE,
  FEATURES,
  PROFILES,
  type CompatFeature,
  type ProfileKey,
  type SupportLevel,
} from "./compatData";
import type { FeatureHit } from "./detect";
import type { DeviceProfileView, FeatureVerdict } from "../../lib/obsolescence/types";

export const COMPAT_PROVENANCE = COMPAT_DATA_SOURCE;

export const PROFILE_VIEWS: DeviceProfileView[] = PROFILES;

/** Verdict rows carry the compat-table weight (1–3) used by the scoring engine. */
export type FeatureVerdictWithWeight = FeatureVerdict & { weight: number };

const featureById = new Map<string, CompatFeature>(FEATURES.map((f) => [f.id, f]));

/**
 * Merge per-blob scans into per-feature verdicts. A feature is flagged only
 * when the support table says at least one target device profile lacks it.
 */
export function evaluateFeatures(hits: Map<string, FeatureHit>): FeatureVerdictWithWeight[] {
  const verdicts: FeatureVerdictWithWeight[] = [];
  for (const hit of hits.values()) {
    const data = featureById.get(hit.id);
    if (!data) continue;

    const support: Record<string, SupportLevel> = { ...data.support };
    const brokenProfiles = (Object.keys(data.support) as ProfileKey[]).filter(
      (key) => data.support[key] === "no",
    );
    const degradedProfiles = (Object.keys(data.support) as ProfileKey[]).filter(
      (key) => data.support[key] === "partial",
    );

    const impact =
      hit.weight *
      (brokenProfiles.length * 6 + degradedProfiles.length * 2.5) *
      Math.min(1, hit.count / 3 + 0.34);

    verdicts.push({
      id: hit.id,
      label: hit.label,
      category: hit.category,
      source: data.source,
      weight: data.weight,
      count: hit.count,
      assets: hit.assets,
      support,
      brokenProfiles,
      degradedProfiles,
      fix: data.fix,
      impact: Math.round(impact * 10) / 10,
    });
  }
  return verdicts.sort((a, b) => b.impact - a.impact);
}
