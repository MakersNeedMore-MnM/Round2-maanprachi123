/**
 * HTML parsing for the crawler: extract the resource graph of the real
 * document — scripts (blocking or not), stylesheets, inline code, images,
 * font preloads — using cheerio on the fetched HTML.
 */
import * as cheerio from "cheerio";

export interface ScriptTag {
  url: string;
  blocking: boolean;
  isModule: boolean;
}

export interface StylesheetTag {
  url: string;
  blocking: boolean;
  media: string;
}

export interface ImageTag {
  url: string;
  hasDimensions: boolean;
}

export interface ParsedPage {
  finalUrl: string;
  host: string;
  title?: string;
  viewportMeta: boolean;
  scripts: ScriptTag[];
  stylesheets: StylesheetTag[];
  inlineScripts: string[];
  inlineStyles: string[];
  images: ImageTag[];
  preconnects: number;
  preloadFontUrls: string[];
}

const INLINE_SCRIPT_CAP = 200_000;
const INLINE_TOTAL_CAP = 600_000;

function isSkippableUrl(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  return (
    t.startsWith("data:") ||
    t.startsWith("blob:") ||
    t.startsWith("javascript:") ||
    t.startsWith("about:") ||
    t.startsWith("mailto:") ||
    t.startsWith("#")
  );
}

export function parseHtml(html: string, finalUrl: string): ParsedPage {
  const $ = cheerio.load(html);
  const host = new URL(finalUrl).host;

  const resolveUrl = (raw: string | undefined): string | null => {
    if (!raw || isSkippableUrl(raw)) return null;
    try {
      return new URL(raw.trim(), finalUrl).toString();
    } catch {
      return null;
    }
  };

  const title = $("title").first().text().trim() || undefined;

  let viewportMeta = false;
  $("meta").each((_, el) => {
    const name = ($(el).attr("name") ?? "").toLowerCase();
    if (name === "viewport") viewportMeta = true;
  });

  const scripts: ScriptTag[] = [];
  const inlineScripts: string[] = [];
  let inlineBudget = INLINE_TOTAL_CAP;
  $("script").each((_, el) => {
    const $el = $(el);
    const src = resolveUrl($el.attr("src"));
    const isModule = ($el.attr("type") ?? "").trim().toLowerCase() === "module";
    const hasAsync = $el.attr("async") !== undefined;
    const hasDefer = $el.attr("defer") !== undefined;
    if (src) {
      const inHead = (el.parent as { tagName?: string } | null)?.tagName === "head";
      scripts.push({
        url: src,
        blocking: inHead && !hasAsync && !hasDefer,
        isModule,
      });
      return;
    }
    const code = ($el.html() ?? "").trim();
    if (code.length > 0 && inlineBudget > 0) {
      const slice = code.slice(0, Math.min(code.length, INLINE_SCRIPT_CAP, inlineBudget));
      inlineBudget -= slice.length;
      inlineScripts.push(slice);
    }
  });

  const stylesheets: StylesheetTag[] = [];
  const inlineStyles: string[] = [];
  $("link[rel~='stylesheet']").each((_, el) => {
    const $el = $(el);
    const href = resolveUrl($el.attr("href"));
    if (!href) return;
    const media = ($el.attr("media") ?? "all").trim().toLowerCase() || "all";
    stylesheets.push({ url: href, blocking: media === "all" || media === "", media });
  });
  $("style").each((_, el) => {
    const css = ($(el).html() ?? "").trim();
    if (css) inlineStyles.push(css.slice(0, INLINE_SCRIPT_CAP));
  });

  const images: ImageTag[] = [];
  $("img").each((_, el) => {
    if (images.length >= 40) return;
    const $el = $(el);
    const srcset = $el.attr("srcset");
    const firstSrcset = srcset ? srcset.split(",")[0]?.trim().split(/\s+/)[0] : undefined;
    const url = resolveUrl($el.attr("src") ?? firstSrcset);
    if (!url) return;
    const width = $el.attr("width");
    const height = $el.attr("height");
    const hasDimensions =
      width !== undefined && height !== undefined && width !== "auto" && height !== "auto";
    images.push({ url, hasDimensions });
  });

  let preconnects = 0;
  const preloadFontUrls: string[] = [];
  $("link").each((_, el) => {
    const $el = $(el);
    const rel = ($el.attr("rel") ?? "").toLowerCase();
    if (rel === "preconnect" || rel === "dns-prefetch") preconnects += 1;
    if (rel === "preload" && ($el.attr("as") ?? "").toLowerCase() === "font") {
      const href = resolveUrl($el.attr("href"));
      if (href && preloadFontUrls.length < 8) preloadFontUrls.push(href);
    }
  });

  return {
    finalUrl,
    host,
    title,
    viewportMeta,
    scripts,
    stylesheets,
    inlineScripts,
    inlineStyles,
    images,
    preconnects,
    preloadFontUrls,
  };
}

/** Extract font URLs declared inside fetched CSS (one hop, capped). */
export function extractFontUrls(css: string, cssBaseUrl: string, cap = 6): string[] {
  const found: string[] = [];
  const re = /url\(\s*(['"]?)([^'")]+\.(?:woff2?|ttf|otf|eot))\1\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css)) !== null && found.length < cap) {
    try {
      const abs = new URL(match[2], cssBaseUrl).toString();
      if (!found.includes(abs)) found.push(abs);
    } catch {
      // relative URL that cannot resolve — skip
    }
  }
  return found;
}

export function countFontFaces(css: string): { faces: number; withDisplay: number } {
  const faces = (css.match(/@font-face/gi) ?? []).length;
  const withDisplay = (css.match(/font-display\s*:/gi) ?? []).length;
  return { faces, withDisplay: Math.min(faces, withDisplay) };
}
