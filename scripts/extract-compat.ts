/**
 * Extracts the caniuse support tables this project needs from caniuse-lite
 * into a checked-in, version-stamped TypeScript module
 * (src/convex/engine/compat-data.ts), so the compatibility engine depends on
 * real support data without importing caniuse-lite at runtime.
 *
 * Regenerate after bumping caniuse-lite:  bun run scripts/extract-compat.ts
 *
 * Data credit: caniuse-lite (CC-BY-4.0), https://github.com/browserslist/caniuse-lite
 * Features missing from caniuse-lite carry a curated support table (marked
 * source: "curated") based on documented engine release versions.
 */
import * as featureIndex from "caniuse-lite/data/features";
import unpackFeature from "caniuse-lite/dist/unpacker/feature";
import { writeFileSync } from "node:fs";
import pkg from "../node_modules/caniuse-lite/package.json";

type Level = "yes" | "partial" | "no" | "unknown";
type ProfileKey = "android66" | "android96" | "ios12" | "ios13";

const PROFILES: {
  key: ProfileKey;
  label: string;
  era: string;
  targets: { browser: string; version: string }[];
}[] = [
  // Android WebView/Chrome for Android share the desktop Chromium engine at the
  // same version numbers, but caniuse-lite only tracks the current and_chr
  // version — so desktop "chrome" at the matching engine version is the honest
  // proxy for the engine inside Android WebView, paired with Samsung Internet
  // (worse-of wins) to catch Samsung-specific gaps.
  {
    key: "android66",
    label: "Android WebView 66",
    era: "Android 9-era low-end devices (Chromium 66)",
    targets: [
      { browser: "chrome", version: "66" },
      { browser: "samsung", version: "8.2" },
    ],
  },
  {
    key: "android96",
    label: "Android WebView 96",
    era: "Android 11-era mid-range devices (Chromium 96)",
    targets: [
      { browser: "chrome", version: "96" },
      { browser: "samsung", version: "12.0" },
    ],
  },
  {
    key: "ios12",
    label: "iOS Safari 12",
    era: "iPhone 6/5s-era devices that stopped at iOS 12",
    targets: [{ browser: "ios_saf", version: "12.4" }],
  },
  {
    key: "ios13",
    label: "iOS Safari 13",
    era: "A9/A10 iPhones that stopped at iOS 13",
    targets: [{ browser: "ios_saf", version: "13.6" }],
  },
];

const RANK: Record<Level, number> = { unknown: 0, no: 1, partial: 2, yes: 3 };

/** caniuse version keys can be exact ("66") or ranges ("12.2-12.5"). */
function resolveVersionKey(
  stats: Record<string, string>,
  target: string,
): string | null {
  if (Object.prototype.hasOwnProperty.call(stats, target)) return target;
  const t = Number.parseFloat(target);
  if (Number.isNaN(t)) return null;
  for (const key of Object.keys(stats)) {
    if (!key.includes("-")) continue;
    const [a, b] = key.split("-");
    const lo = Number.parseFloat(a);
    const hi = Number.parseFloat(b);
    if (!Number.isNaN(lo) && !Number.isNaN(hi) && t >= lo && t <= hi) {
      return key;
    }
  }
  const lower = Object.keys(stats)
    .map((k) => ({ k, n: Number.parseFloat(k) }))
    .filter((x) => !Number.isNaN(x.n) && x.n <= t)
    .sort((a, b) => b.n - a.n);
  return lower.length > 0 ? lower[0].k : null;
}

/** "y" → yes, "a #3" → partial, "n d" → no, "y d" (behind flag) → partial. */
function flagToLevel(flag: string): Level {
  const tokens = flag.split(" ");
  const base = tokens[0] ?? "";
  const behindFlag = tokens.includes("d");
  if (base.startsWith("y")) return behindFlag ? "partial" : "yes";
  if (base.startsWith("a")) return "partial";
  if (base.startsWith("n")) return "no";
  return "unknown";
}

/** Worst of several browsers in a profile; "unknown" never masks a known result. */
function worst(levels: Level[]): Level {
  const known = levels.filter((l) => l !== "unknown");
  if (known.length === 0) return "unknown";
  return known.reduce<Level>(
    (acc, l) => (RANK[l] < RANK[acc] ? l : acc),
    "yes",
  );
}

interface FeatureDef {
  id: string;
  label: string;
  category: "js" | "css";
  tokens: string[];
  weight: number;
  fix: string;
  slug?: string;
}

const FEATURE_DEFS: FeatureDef[] = [
  // ---- JavaScript surface (breaks scripts outright on old engines) ----
  {
    id: "optional-chaining",
    label: "Optional chaining (`?.`)",
    category: "js",
    tokens: ["\\?\\.[\\w("],
    weight: 3,
    fix: "Lower the TypeScript/Babel target below Chrome 80 (e.g. browserslist `chrome 66`) so `?.` compiles away, or add the official transform.",
  },
  {
    id: "nullish-coalescing",
    label: "Nullish coalescing (`??`)",
    category: "js",
    tokens: ["\\?\\?(?!=)"],
    weight: 3,
    fix: "Compile `??` for legacy targets (Babel nullish-coalescing transform) or replace with explicit `=== null || === undefined` checks.",
  },
  {
    id: "logical-assignment",
    label: "Logical assignment (`&&=`, `||=`, `??=`)",
    category: "js",
    tokens: ["\\?\\?=|\\|\\|=|&&="],
    weight: 3,
    fix: "Compile logical assignment operators for old engines (Babel logical-assignment-operators plugin) or expand into plain if-statements.",
  },
  {
    id: "private-class-members",
    label: "Private class members (`#field`)",
    category: "js",
    tokens: ["#[\\w]+\\s*(?:\\(|=)|\\.#\\w+"],
    weight: 2,
    fix: "Transpile private class members for legacy engines, or rename them to conventional `_`-prefixed fields.",
  },
  {
    id: "promise-allsettled",
    label: "Promise.allSettled / Promise.any",
    category: "js",
    tokens: ["Promise\\.(?:allSettled|any)\\b"],
    weight: 2,
    fix: "Add a small `Promise.allSettled` polyfill or switch to `Promise.all` with per-promise catch handlers.",
  },
  {
    id: "string-replaceall",
    label: "String.prototype.replaceAll",
    category: "js",
    tokens: ["\\.replaceAll\\s*\\("],
    weight: 2,
    fix: "Use `split().join()` or a global regex replace for engines without String.prototype.replaceAll.",
  },
  {
    id: "array-at",
    label: "Array.prototype.at (negative indexing)",
    category: "js",
    tokens: ["\\.at\\s*\\("],
    weight: 2,
    fix: "Replace `.at(-1)` with `arr[arr.length - 1]`, or add an Array.prototype.at polyfill.",
  },
  {
    id: "object-fromentries",
    label: "Object.fromEntries",
    category: "js",
    tokens: ["Object\\.fromEntries\\b"],
    weight: 2,
    fix: "Add the tiny Object.fromEntries polyfill, or build the object with `reduce()`.",
  },
  {
    id: "structured-clone",
    label: "structuredClone()",
    category: "js",
    tokens: ["structuredClone\\s*\\("],
    weight: 2,
    fix: "Use a JSON round-trip or a deep-clone helper instead of structuredClone() on legacy engines.",
  },
  {
    id: "bigint",
    label: "BigInt literals (`123n`)",
    category: "js",
    tokens: ["(?<![\\w.])\\d+n\\b"],
    weight: 2,
    slug: "bigint",
    fix: "Avoid BigInt on legacy engines, or gate the code path behind `typeof BigInt !== 'undefined'` with a fallback.",
  },
  {
    id: "es6-module-dynamic-import",
    label: "Dynamic `import()`",
    category: "js",
    tokens: ["\\bimport\\s*\\("],
    weight: 1,
    slug: "es6-module-dynamic-import",
    fix: "Ensure your bundler lowers `import()` for old targets or falls back to static imports.",
  },
  {
    id: "wasm",
    label: "WebAssembly",
    category: "js",
    tokens: ["WebAssembly\\."],
    weight: 1,
    slug: "wasm",
    fix: "Provide a JavaScript fallback when `WebAssembly` is undefined.",
  },
  {
    id: "webgpu",
    label: "WebGPU",
    category: "js",
    tokens: ["navigator\\.gpu\\b"],
    weight: 1,
    slug: "webgpu",
    fix: "Gate WebGPU access behind feature detection with a WebGL/canvas 2D fallback.",
  },
  // ---- CSS surface (degrades rendering on old engines) ----
  {
    id: "css-has",
    label: "`:has()` selector",
    category: "css",
    tokens: [":has\\s*\\("],
    weight: 3,
    slug: "css-has",
    fix: "Replace `:has()` selectors with a class toggled in JS, or add an `@supports not (selector(:has(*)))` fallback block.",
  },
  {
    id: "css-nesting",
    label: "Native CSS nesting (`&`)",
    category: "css",
    tokens: ["&\\s*[.{,>+~:\\[]"],
    weight: 2,
    slug: "css-nesting",
    fix: "Compile nested CSS with a build step (PostCSS Nesting or your Tailwind pipeline) so selectors ship flat.",
  },
  {
    id: "css-container-queries",
    label: "Container queries",
    category: "css",
    tokens: ["@container\\b", "container-type\\s*:"],
    weight: 3,
    slug: "css-container-queries",
    fix: "Provide media-query fallbacks inside `@supports not (container-type: inline-size)` for the same breakpoints.",
  },
  {
    id: "css-subgrid",
    label: "CSS subgrid",
    category: "css",
    tokens: ["grid-template-(?:columns|rows)\\s*:[^;}]*\\bsubgrid\\b"],
    weight: 2,
    slug: "css-subgrid",
    fix: "Define explicit grid tracks instead of `subgrid`, or gate it behind `@supports`.",
  },
  {
    id: "css-color-function",
    label: "Modern color spaces (oklch/oklab/lab/lch)",
    category: "css",
    tokens: ["\\b(?:oklch|oklab|lch|lab)\\s*\\("],
    weight: 2,
    slug: "css-color-function",
    fix: "Ship legacy `rgb()`/`hsl()` values first and override them inside `@supports (color: oklch(0% 0 0))`.",
  },
  {
    id: "css-cascade-layers",
    label: "Cascade layers (`@layer`)",
    category: "css",
    tokens: ["@layer\\b"],
    weight: 2,
    slug: "css-cascade-layers",
    fix: "Flatten `@layer` blocks in the build, or provide an unlayered fallback with the same cascade order.",
  },
  {
    id: "css-backdrop-filter",
    label: "backdrop-filter",
    category: "css",
    tokens: ["backdrop-filter\\s*:"],
    weight: 1,
    slug: "css-backdrop-filter",
    fix: "Provide a solid or semi-opaque background fallback where backdrop-filter is unsupported.",
  },
  {
    id: "css-math-functions",
    label: "CSS math functions (clamp/min/max/round)",
    category: "css",
    tokens: ["\\b(?:round|mod|rem)\\s*\\(|\\b(?:clamp|min|max)\\s*\\("],
    weight: 1,
    slug: "css-math-functions",
    fix: "Precompute clamp() values as custom properties with static fallbacks; round()/mod() need Chromium 108+.",
  },
  {
    id: "css-text-wrap-balance",
    label: "text-wrap: balance",
    category: "css",
    tokens: ["text-wrap\\s*:\\s*balance"],
    weight: 1,
    slug: "css-text-wrap-balance",
    fix: "Treat `text-wrap: balance` as a progressive enhancement only; ensure headlines wrap acceptably without it.",
  },
  {
    id: "css-aspect-ratio",
    label: "aspect-ratio",
    category: "css",
    tokens: ["aspect-ratio\\s*:"],
    weight: 1,
    fix: "Use the padding-top aspect pattern (or a fixed-height fallback) for engines without `aspect-ratio`.",
  },
];

/** Curated support tables for features caniuse-lite does not ship.
 *  Based on documented engine release versions (Chromium/Safari release notes). */
const CURATED: Record<string, Record<ProfileKey, Level>> = {
  "optional-chaining": { android66: "no", android96: "yes", ios12: "no", ios13: "yes" }, // Chromium 80+, Safari 13.1+
  "nullish-coalescing": { android66: "no", android96: "yes", ios12: "no", ios13: "yes" }, // Chromium 80+, Safari 13.1+
  "logical-assignment": { android66: "no", android96: "yes", ios12: "no", ios13: "no" }, // Chromium 85+, Safari 14+
  "private-class-members": { android66: "no", android96: "yes", ios12: "no", ios13: "no" }, // Chromium 74+, Safari 14.1+
  "promise-allsettled": { android66: "no", android96: "yes", ios12: "no", ios13: "yes" }, // Chromium 76+, Safari 13+
  "string-replaceall": { android66: "no", android96: "yes", ios12: "no", ios13: "yes" }, // Chromium 85+, Safari 13.1+
  "array-at": { android66: "no", android96: "no", ios12: "no", ios13: "no" }, // Chromium 92+, Safari 15.4+
  "object-fromentries": { android66: "no", android96: "yes", ios12: "no", ios13: "no" }, // Chromium 73+, Safari 15.4+
  "structured-clone": { android66: "no", android96: "no", ios12: "no", ios13: "no" }, // Chromium 98+, Safari 15.4+
  "css-aspect-ratio": { android66: "no", android96: "yes", ios12: "no", ios13: "no" }, // Chromium 88+, Safari 15+
};

function main(): void {
  const index = featureIndex as unknown as Record<string, unknown>;
  const unpack = unpackFeature as unknown as (
    packed: unknown,
  ) => { stats: Record<string, Record<string, string>> };

  const errors: string[] = [];
  const warnings: string[] = [];

  const features = FEATURE_DEFS.map((def) => {
    let support: Record<ProfileKey, Level> | undefined;
    let source: "caniuse" | "curated";

    if (def.slug) {
      const packed = index[def.slug];
      if (packed === undefined) {
        warnings.push(`slug not in caniuse-lite index: ${def.slug} (falling back to curated)`);
      } else {
        const stats = unpack(packed).stats;
        support = {} as Record<ProfileKey, Level>;
        for (const profile of PROFILES) {
          const levels = profile.targets.map((t): Level => {
            const browserStats = stats[t.browser];
            if (!browserStats) return "unknown";
            const key = resolveVersionKey(browserStats, t.version);
            if (!key) {
              warnings.push(`${def.id}: no version key for ${t.browser} ${t.version}`);
              return "unknown";
            }
            return flagToLevel(browserStats[key] ?? "?");
          });
          support[profile.key] = worst(levels);
        }
        source = "caniuse";
      }
    }

    if (!support) {
      support = CURATED[def.id];
      source = "curated";
      if (!support) errors.push(`no support data for feature ${def.id}`);
    }

    return {
      id: def.id,
      label: def.label,
      category: def.category,
      tokens: def.tokens,
      weight: def.weight,
      source,
      fix: def.fix,
      support: support as Record<ProfileKey, Level>,
    };
  });

  if (errors.length > 0) {
    console.error("FATAL:", errors.join("; "));
    process.exit(1);
  }

  const summary = PROFILES.map((p) => {
    const counts = { yes: 0, partial: 0, no: 0, unknown: 0 } as Record<Level, number>;
    for (const f of features) counts[f.support[p.key]] += 1;
    return `  ${p.key}: yes=${counts.yes} partial=${counts.partial} no=${counts.no} unknown=${counts.unknown}`;
  }).join("\n");

  const generatedAt = new Date().toISOString().slice(0, 10);
  const source = `// Generated by scripts/extract-compat.ts — do not edit by hand.
// Regenerate with: bun run scripts/extract-compat.ts
// Support data © caniuse-lite contributors, CC-BY-4.0 — https://github.com/browserslist/caniuse-lite
// Rows with source "curated" are not in caniuse-lite; their support tables follow
// documented Chromium/Safari release versions.

export const COMPAT_DATA_SOURCE = ${JSON.stringify(
    {
      package: "caniuse-lite",
      version: pkg.version,
      generatedAt,
      license: "CC-BY-4.0",
      url: "https://github.com/browserslist/caniuse-lite",
    },
    null,
    2,
  )} as const;

export type SupportLevel = "yes" | "partial" | "no" | "unknown";
export type ProfileKey = ${PROFILES.map((p) => JSON.stringify(p.key)).join(" | ")};

export interface DeviceProfile {
  key: ProfileKey;
  label: string;
  era: string;
  browsers: { browser: string; version: string }[];
}

export const PROFILES: DeviceProfile[] = ${JSON.stringify(PROFILES.map((p) => ({ key: p.key, label: p.label, era: p.era, browsers: p.targets })), null, 2)};

export interface CompatFeature {
  id: string;
  label: string;
  category: "js" | "css";
  /** Regex sources; a single hit marks the feature as shipped by the site. */
  tokens: string[];
  /** 1–3; higher weight = likelier to break rendering or interaction. */
  weight: number;
  support: Record<ProfileKey, SupportLevel>;
  source: "caniuse" | "curated";
  fix: string;
}

export const FEATURES: CompatFeature[] = ${JSON.stringify(features, null, 2)};
`;

  const out = new URL("../src/convex/engine/compat-data.ts", import.meta.url);
  writeFileSync(out, source, "utf8");
  console.log(`wrote ${out.pathname}`);
  console.log(`caniuse-lite ${pkg.version}, ${features.length} features`);
  console.log(summary);
  if (warnings.length > 0) console.log(`warnings:\n  ${warnings.join("\n  ")}`);
}

main();
