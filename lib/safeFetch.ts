/**
 * Fail-closed helpers for the social-video resolver (server-only use).
 *
 * Two jobs:
 *  1. parseHttpsUrl — one strict URL gate: https only, no userinfo, default port only,
 *     no control characters / backslashes / inner whitespace.
 *  2. fetchJsonBounded — a request to ONE fixed, pre-approved official host with redirects
 *     DISABLED, a hard deadline and a response-size cap. It validates the destination BEFORE
 *     connecting and never throws.
 *
 * Why exact hosts instead of an IP filter: every destination here is a fixed provider hostname
 * we control in code (tiktok.com, graph.facebook.com, googleapis.com). A caller cannot choose the
 * host, so there is no attacker-controlled DNS to rebind. We do NOT resolve or pin addresses; a
 * DNS precheck alone would not stop rebinding and the runtime fetch cannot pin without a new
 * dependency. See docs/social-intake-resolver-security.md.
 */

export const MAX_JSON_BYTES = 64 * 1024;
export const DEFAULT_REQUEST_TIMEOUT_MS = 4000;
const MAX_URL_LENGTH = 2048;

/**
 * Never valid in a link we accept: any Unicode whitespace or separator (incl. NBSP, U+2028/9), control
 * and format characters (zero-width, bidi marks, soft hyphen) and backslash.
 */
const FORBIDDEN_URL_CHARS = /[\p{White_Space}\p{Z}\p{Cc}\p{Cf}\\]/u;
const HTTPS_PREFIX = /^https:\/\//i; // literal scheme + "//" (case-insensitive); "https:/x", "https:x" are refused

/** True when a raw string contains a character no accepted link may contain. */
export function hasForbiddenUrlChars(raw: string): boolean {
  return FORBIDDEN_URL_CHARS.test(raw);
}

/**
 * Parse a raw string (or an existing URL) into an https URL with no userinfo and no explicit
 * non-default port. Returns null for anything else (http, ftp, javascript:, malformed, ...).
 */
export function parseHttpsUrl(raw: unknown): URL | null {
  let u: URL;
  if (raw instanceof URL) {
    u = raw;
  } else {
    if (typeof raw !== "string") return null;
    const s = raw.trim();
    if (s === "" || s.length > MAX_URL_LENGTH || hasForbiddenUrlChars(s)) return null;
    // Raw grammar BEFORE the WHATWG parser normalizes anything away: the literal "https://", and an
    // authority with no "@" at all (so an EMPTY userinfo like "https://@host/" is refused too).
    if (!HTTPS_PREFIX.test(s)) return null;
    const authority = s.slice(8).split(/[/?#]/, 1)[0];
    if (authority === "" || authority.includes("@")) return null;
    try {
      u = new URL(s);
    } catch {
      return null;
    }
  }
  if (u.protocol !== "https:") return null;
  if (u.username !== "" || u.password !== "") return null;
  if (u.port !== "") return null; // the URL parser already drops the default :443
  if (u.hostname === "") return null;
  return u;
}

export type BoundedJsonResult =
  | { ok: true; data: Record<string, unknown> }
  | {
      ok: false;
      reason: "blocked" | "http" | "redirect" | "too-large" | "parse" | "timeout" | "network";
      status?: number;
    };

export interface BoundedFetchOptions {
  /** Exact hostnames this call may connect to. */
  allowedHosts: ReadonlySet<string>;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
}

/** Read at most `maxBytes` of the body; null when it is larger (the stream is cancelled). */
async function readBoundedText(res: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * GET a JSON object from an approved host. The URL is checked BEFORE any request is made;
 * redirects are never followed (a 3xx is a failure); time and size are bounded.
 */
export async function fetchJsonBounded(url: URL, opts: BoundedFetchOptions): Promise<BoundedJsonResult> {
  const safe = parseHttpsUrl(url);
  if (!safe || !opts.allowedHosts.has(safe.hostname)) return { ok: false, reason: "blocked" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(safe.href, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
      headers: { accept: "application/json", ...opts.headers },
    });
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, reason: "redirect", status: res.status };
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, reason: "http", status: res.status };
    }
    const text = await readBoundedText(res, opts.maxBytes ?? MAX_JSON_BYTES);
    if (text === null) return { ok: false, reason: "too-large" };
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, reason: "parse" };
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, reason: "parse" };
    return { ok: true, data: data as Record<string, unknown> };
  } catch {
    return { ok: false, reason: controller.signal.aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Plain text safe to store and render: control and bidi-override characters removed, whitespace
 * collapsed, length capped. Provider text is data only; it is never interpreted as HTML.
 */
export function safeText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v
    .replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (s === "") return null;
  return s.length > max ? s.slice(0, max).trimEnd() : s;
}
