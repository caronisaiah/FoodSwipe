import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Tag Automation B4 — bounded OFFICIAL-WEBSITE evidence collector (server-only).
 *
 * Fetches a small amount of cleaned text from a restaurant's OWN official website
 * for private, review-first tag suggestions. It is deliberately narrow and SAFE:
 *   - SAME-DOMAIN ONLY (the stored websiteDomain, or an admin-supplied same-domain URL)
 *   - https only; social/review/search domains are blocked
 *   - SSRF-reduced: rejects IP-literal hosts and hosts that resolve to private/
 *     reserved IPs (dns lookup); redirects are MANUAL and re-validated per hop.
 *     Node fetch does not let us pin the HTTPS connection to the pre-checked IP
 *     while preserving normal hostname verification, so DNS rebinding remains a
 *     residual risk between lookup and fetch. This route stays admin-only and is
 *     bounded by same-domain, HTTPS, redirect, timeout, page, and body caps.
 *   - <=3 pages, short per-page timeout, capped body + cleaned text
 *   - NO browser/JS, NO login/cookies/paywall bypass, NO media/PDF, NO crawler,
 *     NO scheduled job. Stores cleaned TEXT only — never raw HTML or media.
 */

const MAX_PAGES = 3;
const PAGE_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 3;
const MAX_HTML_BYTES = 2_000_000; // hard cap for declared and streamed body bytes
const MAX_CLEANED_PER_PAGE = 8000;
const MAX_CLEANED_TOTAL = 24000;
const USER_AGENT = "FoodSwipeBot/1.0 (+restaurant tag automation; admin-triggered)";

export type EvidenceSourceType = "homepage" | "menu" | "about" | "events" | "unknown";
export type EvidenceFetchStatus = "ok" | "empty" | "error" | "blocked";

export interface EvidenceDocument {
  sourceUrl: string;
  sourceDomain: string | null;
  sourceType: EvidenceSourceType;
  title: string | null;
  cleanedText: string;
  fetchStatus: EvidenceFetchStatus;
  error: string | null;
}

export interface CollectResult {
  documents: EvidenceDocument[];
  pagesFetched: number;
  okPages: number;
  totalCleanedChars: number;
  warnings: string[];
}

// Domains we must never fetch as "official website" evidence (defense in depth on
// top of the same-domain lock): social, reviews, search, maps, link shorteners.
const BLOCKED_DOMAINS = [
  "tiktok.com", "instagram.com", "facebook.com", "fb.com", "twitter.com", "x.com",
  "youtube.com", "youtu.be", "yelp.com", "google.com", "google.co", "goo.gl",
  "maps.app.goo.gl", "tripadvisor.com", "opentable.com", "doordash.com", "ubereats.com",
  "grubhub.com", "seamless.com", "linktr.ee", "bit.ly", "t.co", "reddit.com",
  "pinterest.com", "threads.net", "wikipedia.org", "foursquare.com",
];

// Same-domain link discovery: only follow links whose href/anchor text mentions
// these readable, on-topic sections.
const SECTION_KEYWORDS = ["menu", "food", "brunch", "drinks", "about", "private-dining", "private dining", "events"];

/** Normalize an input domain/host to a bare lowercase host (drops scheme/path/www-agnostic). */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  s = s.split("/")[0].split("?")[0].split("#")[0];
  s = s.split(":")[0]; // drop any port
  // Bare host sanity: letters/digits/dots/hyphens, at least one dot.
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s)) return null;
  return s;
}

function registrableMatch(host: string, allowed: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return h === allowed || h.endsWith(`.${allowed}`);
}

function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  return BLOCKED_DOMAINS.some((b) => h === b || h.endsWith(`.${b}`));
}

/** Reject private / reserved / loopback / link-local IPs (SSRF defense-in-depth). */
function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const p = ip.split(".").map((n) => parseInt(n, 10));
    if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
    const [a, b, c] = p;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
    if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
    if (a === 192 && b === 88 && c === 99) return true; // 6to4 relay anycast (deprecated)
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
    if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
    if (a >= 224) return true; // multicast/reserved
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    // Be conservative with embedded IPv4 forms. Public mapped addresses are rare
    // for restaurant sites, and blocking them keeps private ranges from sneaking in
    // through alternate notation.
    if (lower.startsWith("::ffff:")) {
      const mapped = lower.slice(7);
      return isIP(mapped) === 4 ? isPrivateIp(mapped) : true;
    }
    const parts = lower.split(":");
    const last = parts[parts.length - 1] ?? "";
    if (last.includes(".") && isIP(last) === 4) return isPrivateIp(last);
    if (/^fe[89ab]/.test(lower)) return true; // link-local fe80::/10
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local fc00::/7
    if (lower.startsWith("ff")) return true; // multicast
    if (lower.startsWith("2001:db8")) return true; // documentation
    if (lower.startsWith("2001:0:")) return true; // Teredo
    if (lower.startsWith("2001:10:")) return true; // ORCHID
    if (lower.startsWith("2002:")) return true; // 6to4
    return false;
  }
  return true; // not a valid IP literal → caller handles hostnames separately
}

/** Validate a candidate URL stays on the allowed official domain (sync checks only). */
export function validateEvidenceUrl(
  raw: string,
  allowedHost: string,
): { ok: true; url: URL } | { ok: false; reason: string } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "Invalid URL." };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "Only https is allowed." };
  const host = u.hostname.toLowerCase();
  if (isIP(host) !== 0) return { ok: false, reason: "IP-literal hosts are not allowed." };
  if (u.port && u.port !== "443") return { ok: false, reason: "Non-standard ports are not allowed." };
  if (isBlockedHost(host)) return { ok: false, reason: "Social/review/search domains are not allowed." };
  if (!registrableMatch(host, allowedHost)) {
    return { ok: false, reason: `Off-domain URL (expected ${allowedHost}).` };
  }
  return { ok: true, url: u };
}

/**
 * Async SSRF guard: the host must resolve only to public IPs.
 *
 * Residual risk: this does not pin the later HTTPS fetch to these exact answers,
 * because Node's global fetch does not expose a safe per-request DNS pinning hook
 * that also preserves normal TLS hostname verification in this app. We therefore
 * re-run this check before every request/redirect and keep collection admin-only,
 * same-domain, HTTPS-only, short-lived, and body/page bounded.
 */
async function hostResolvesPublic(host: string): Promise<boolean> {
  try {
    const addrs = await lookup(host, { all: true });
    if (!addrs.length) return false;
    return addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}

async function readResponseTextBounded(
  res: Response,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (!res.body) return { ok: true, text: "" };

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      if (received > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // Best effort: the size cap has already been enforced for our process.
        }
        return { ok: false, error: "Response too large." };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, error: "Failed reading response body." };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder("utf-8", { fatal: false }).decode(bytes) };
}

// ---- HTML → cleaned text ----
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => {
      const code = parseInt(d, 10);
      return Number.isFinite(code) && code > 0 && code < 0x10ffff ? String.fromCodePoint(code) : " ";
    });
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  const t = decodeEntities(m[1].replace(/\s+/g, " ").trim());
  return t.length ? t.slice(0, 200) : null;
}

/** Strip scripts/styles/boilerplate, then tags; keep readable body text (bounded). */
export function cleanHtmlToText(html: string): string {
  let s = html;
  // Drop non-content blocks entirely.
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(script|style|noscript|template|svg|head|nav|footer|form|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  // Block-level tags → newlines so words don't run together.
  s = s.replace(/<\/(p|div|li|h[1-6]|section|article|br|tr|td)>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  s = s.replace(/[ \t ]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").replace(/^\s+|\s+$/g, "");
  if (s.length > MAX_CLEANED_PER_PAGE) s = s.slice(0, MAX_CLEANED_PER_PAGE).trim();
  return s;
}

function classifySource(url: URL): EvidenceSourceType {
  const p = (url.pathname + " " + url.search).toLowerCase();
  if (url.pathname === "/" || url.pathname === "") return "homepage";
  if (/menu|food|drinks|brunch/.test(p)) return "menu";
  if (/about|story|team/.test(p)) return "about";
  if (/event|private-dining|private dining|booking/.test(p)) return "events";
  return "unknown";
}

/** Discover same-domain section links from homepage HTML. */
function discoverLinks(html: string, base: URL, allowedHost: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([base.href]);
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  let scanned = 0;
  while ((m = re.exec(html)) !== null && scanned < 300) {
    scanned++;
    const href = m[1];
    const anchor = m[2].replace(/<[^>]+>/g, " ").toLowerCase();
    let abs: URL;
    try {
      abs = new URL(href, base);
    } catch {
      continue;
    }
    if (abs.protocol !== "https:") continue;
    if (!registrableMatch(abs.hostname.toLowerCase(), allowedHost)) continue;
    abs.hash = "";
    if (seen.has(abs.href)) continue;
    const hay = `${abs.pathname.toLowerCase()} ${anchor}`;
    if (!SECTION_KEYWORDS.some((k) => hay.includes(k))) continue;
    seen.add(abs.href);
    out.push(abs.href);
  }
  return out;
}

/** Fetch one validated same-domain page (manual redirects, re-validated per hop). */
async function fetchPage(
  startUrl: string,
  allowedHost: string,
): Promise<{ status: EvidenceFetchStatus; url: string; html: string; error: string | null }> {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const v = validateEvidenceUrl(current, allowedHost);
    if (!v.ok) return { status: "blocked", url: current, html: "", error: v.reason };
    if (!(await hostResolvesPublic(v.url.hostname))) {
      return { status: "blocked", url: current, html: "", error: "Host does not resolve to a public address." };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
    try {
      const res = await fetch(v.url, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: { "user-agent": USER_AGENT, accept: "text/html" },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return { status: "error", url: current, html: "", error: `Redirect with no location (${res.status}).` };
        try {
          current = new URL(loc, v.url).href; // re-validated at loop top
        } catch {
          return { status: "error", url: current, html: "", error: "Bad redirect target." };
        }
        continue;
      }
      if (!res.ok) return { status: "error", url: v.url.href, html: "", error: `HTTP ${res.status}.` };
      const ct = (res.headers.get("content-type") ?? "").toLowerCase();
      if (!ct.includes("text/html") && !ct.includes("text/plain") && !ct.includes("application/xhtml+xml")) {
        return { status: "error", url: v.url.href, html: "", error: `Unsupported content-type (${ct || "unknown"}).` };
      }
      const len = parseInt(res.headers.get("content-length") ?? "0", 10);
      if (Number.isFinite(len) && len > MAX_HTML_BYTES) {
        return { status: "error", url: v.url.href, html: "", error: "Response too large." };
      }
      const body = await readResponseTextBounded(res, MAX_HTML_BYTES);
      if (!body.ok) return { status: "error", url: v.url.href, html: "", error: body.error };
      return { status: "ok", url: v.url.href, html: body.text, error: null };
    } catch (e) {
      const aborted = e instanceof Error && e.name === "AbortError";
      return { status: "error", url: v.url.href, html: "", error: aborted ? "Timed out." : "Fetch failed." };
    } finally {
      clearTimeout(timer);
    }
  }
  return { status: "error", url: current, html: "", error: "Too many redirects." };
}

/**
 * Collect bounded official-website evidence for a restaurant/candidate.
 * `domain` is the stored bare host; `adminUrl` (optional) must be same-domain.
 */
export async function collectWebsiteEvidence(opts: {
  domain: string | null | undefined;
  adminUrl?: string | null;
}): Promise<CollectResult> {
  const warnings: string[] = [];
  const host = normalizeDomain(opts.domain);
  if (!host) {
    return { documents: [], pagesFetched: 0, okPages: 0, totalCleanedChars: 0, warnings: ["No official website domain on file."] };
  }
  if (isBlockedHost(host)) {
    return { documents: [], pagesFetched: 0, okPages: 0, totalCleanedChars: 0, warnings: ["Stored domain is a blocked (social/review/search) domain."] };
  }

  // Seed URL: an admin-supplied same-domain URL, else the homepage.
  let seed = `https://${host}/`;
  if (opts.adminUrl && opts.adminUrl.trim()) {
    const v = validateEvidenceUrl(opts.adminUrl.trim(), host);
    if (!v.ok) {
      return { documents: [], pagesFetched: 0, okPages: 0, totalCleanedChars: 0, warnings: [`Supplied URL rejected: ${v.reason}`] };
    }
    seed = v.url.href;
  }

  const queue: string[] = [seed];
  const documents: EvidenceDocument[] = [];
  let pagesFetched = 0;
  let okPages = 0;
  let totalCleaned = 0;
  const fetchedUrls = new Set<string>();

  while (queue.length > 0 && pagesFetched < MAX_PAGES) {
    const url = queue.shift() as string;
    if (fetchedUrls.has(url)) continue;
    fetchedUrls.add(url);
    pagesFetched++;

    const page = await fetchPage(url, host);
    if (page.status !== "ok") {
      documents.push({
        sourceUrl: page.url,
        sourceDomain: host,
        sourceType: "unknown",
        title: null,
        cleanedText: "",
        fetchStatus: page.status,
        error: page.error,
      });
      continue;
    }

    let cleaned = cleanHtmlToText(page.html);
    if (totalCleaned + cleaned.length > MAX_CLEANED_TOTAL) {
      cleaned = cleaned.slice(0, Math.max(0, MAX_CLEANED_TOTAL - totalCleaned)).trim();
    }
    totalCleaned += cleaned.length;
    let finalUrlObj: URL;
    try {
      finalUrlObj = new URL(page.url);
    } catch {
      finalUrlObj = new URL(seed);
    }
    documents.push({
      sourceUrl: page.url,
      sourceDomain: host,
      sourceType: classifySource(finalUrlObj),
      title: extractTitle(page.html),
      cleanedText: cleaned,
      fetchStatus: cleaned.length > 0 ? "ok" : "empty",
      error: null,
    });
    if (cleaned.length > 0) okPages++;

    // Discover more same-domain section links from the FIRST (homepage) fetch only.
    if (pagesFetched === 1) {
      for (const link of discoverLinks(page.html, finalUrlObj, host)) {
        if (queue.length + pagesFetched >= MAX_PAGES) break;
        if (!fetchedUrls.has(link)) queue.push(link);
      }
    }
  }

  if (okPages === 0) warnings.push("No readable text collected from the official website.");
  return { documents, pagesFetched, okPages, totalCleanedChars: totalCleaned, warnings };
}
