/**
 * Static feature detection over the site's real shipped code. MVP uses
 * targeted regexes (deliberately conservative patterns, match counts
 * reported); AST-based parsing is a Phase 2 upgrade slot. Detection alone
 * never implies breakage — the compat layer decides that against device
 * support tables.
 */
import { FEATURES } from "./compatData";

export interface FeatureHit {
  id: string;
  label: string;
  category: "js" | "css";
  weight: number;
  count: number;
  assets: string[];
}

const compiled = FEATURES.map((feature) => ({
  feature,
  regexes: feature.tokens.map((source) => new RegExp(source, "g")),
}));

function countMatches(text: string, re: RegExp): number {
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    count += 1;
    if (match[0].length === 0) re.lastIndex += 1;
    if (count >= 500) break;
  }
  re.lastIndex = 0;
  return count;
}

/**
 * Scan one source blob (a script/stylesheet asset or an inline block) and
 * accumulate per-feature hits into `into`.
 */
export function scanText(
  text: string,
  category: "js" | "css",
  asset: string,
  into: Map<string, FeatureHit>,
): void {
  if (!text) return;
  for (const { feature, regexes } of compiled) {
    if (feature.category !== category) continue;
    let count = 0;
    for (const re of regexes) count += countMatches(text, re);
    if (count === 0) continue;
    const existing = into.get(feature.id);
    if (existing) {
      existing.count += count;
      if (!existing.assets.includes(asset)) existing.assets.push(asset);
    } else {
      into.set(feature.id, {
        id: feature.id,
        label: feature.label,
        category: feature.category,
        weight: feature.weight,
        count,
        assets: [asset],
      });
    }
  }
}
