/**
 * Minimal HTTP layer for the crawler: real fetches with a desktop-browser
 * user agent (many sites serve stripped shells to unknown agents), timeouts,
 * and honest byte accounting.
 *
 * Note: fetch() auto-decompresses gzip/br, so `byteLength` is the
 * decompressed (parsed) size, while a `content-length` header — when the
 * server sent one — reflects the compressed wire size. Both are reported.
 */

const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export interface FetchedResource {
  ok: boolean;
  status: number;
  bytes: Uint8Array;
  byteLength: number;
  wireBytes?: number;
  contentType?: string;
  finalUrl: string;
  ms: number;
  error?: string;
}

export interface FetchOptions {
  timeoutMs?: number;
}

export async function fetchResource(
  url: string,
  opts: FetchOptions = {},
): Promise<FetchedResource> {
  const { timeoutMs = 8_000 } = opts;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": BROWSER_UA,
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    const bytes = new Uint8Array(await res.arrayBuffer());
    const wireHeader = res.headers.get("content-length");
    const wireBytes = wireHeader !== null ? Number(wireHeader) : undefined;
    return {
      ok: res.ok,
      status: res.status,
      bytes,
      byteLength: bytes.byteLength,
      wireBytes:
        wireBytes !== undefined && Number.isFinite(wireBytes) && wireBytes > 0
          ? wireBytes
          : undefined,
      contentType: res.headers.get("content-type") ?? undefined,
      finalUrl: res.url || url,
      ms: Date.now() - startedAt,
    };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.name === "AbortError"
          ? `timed out after ${timeoutMs} ms`
          : err.message
        : String(err);
    return {
      ok: false,
      status: 0,
      bytes: new Uint8Array(0),
      byteLength: 0,
      finalUrl: url,
      ms: Date.now() - startedAt,
      error: message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** HEAD probe for media declared sizes (no body download). */
export async function headContentLength(
  url: string,
  timeoutMs = 6_000,
): Promise<{ ok: boolean; bytes?: number; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": BROWSER_UA },
    });
    const len = Number(res.headers.get("content-length"));
    return {
      ok: res.ok,
      bytes: res.ok && Number.isFinite(len) && len > 0 ? len : undefined,
      status: res.status,
    };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

const textDecoder = new TextDecoder("utf-8", { fatal: false });

export interface DecodedBody {
  text: string;
  isText: boolean;
  truncated: boolean;
}

/** Decode a body, refusing obvious binary payloads; cap the analysis window. */
export function bytesToText(
  bytes: Uint8Array,
  maxChars = 1_500_000,
): DecodedBody {
  const probe = bytes.subarray(0, 512);
  let hasNull = false;
  for (const b of probe) {
    if (b === 0) {
      hasNull = true;
      break;
    }
  }
  const truncated = bytes.byteLength > maxChars;
  const text = textDecoder.decode(
    truncated ? bytes.subarray(0, maxChars) : bytes,
  );
  return { text, isText: !hasNull, truncated };
}

export function kb(bytes: number): number {
  return Math.round((bytes / 1024) * 10) / 10;
}
