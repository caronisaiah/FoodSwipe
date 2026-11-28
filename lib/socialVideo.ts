import type { LegalDisplayStatus } from "@/lib/types";
import { fetchJsonBounded, parseHttpsUrl, safeText } from "@/lib/safeFetch";
import { extractYouTubeId, fetchYouTubeMetadata, resolveYouTubeUrl } from "@/lib/youtube";

/**
 * Server-only social-video URL resolver for the intake/review queue (Phase 1).
 *
 * Detects platform, normalizes the URL (the dedupe key), extracts a platform
 * video id where possible, and resolves PUBLIC, OFFICIAL metadata only:
 *   - TikTok    — official public oEmbed (no key) for metadata + official Embed
 *                 Player iframe (tiktok.com/player/v1/{id}) so it plays inline.
 *                 embeddable once the numeric id is known; short links (/t/, vm./vt.)
 *                 are canonicalized by walking the redirect chain MANUALLY: every hop is
 *                 validated against exact TikTok hosts/paths BEFORE it is requested
 *                 (https only, max 3 hops, one deadline, body never read). Expansion is
 *                 OFF by default and unused by app routes: short links are refused and the
 *                 canonical link is requested. See docs/social-intake-resolver-security.md.
 *   - YouTube   — reuse lib/youtube (canonical + nocookie embed; optional Data API). embeddable.
 *   - Instagram — official /{p|reel|tv}/{code}/embed/ iframe so it plays inline
 *                 (no embed.js script, no token needed); oEmbed via
 *                 INSTAGRAM_OEMBED_TOKEN only ENRICHES metadata when configured. embeddable.
 *
 * Every embed is the platform's OWN official player/embed endpoint, validated by
 * lib/video.isEmbedUrlAllowed. Hard rules: NO scraping, NO unofficial downloaders,
 * NO media bytes downloaded/stored/rehosted; thumbnails are referenced URLs only.
 * Thumbnails are kept BY REFERENCE only (validated https), matching the existing
 * legal model (lib/video). Unknown/unsupported URLs return a validation error.
 */

export type SocialPlatform = "tiktok" | "instagram" | "youtube";

export type ResolverStatus =
  | "resolved" // official metadata fetched
  | "source-link-only" // valid URL, no metadata fetched (still reviewable)
  | "missing-credentials" // e.g. Instagram oEmbed token not configured
  | "error"; // resolver call failed (network/parse) — candidate still creatable

export interface ResolvedSocialVideo {
  platform: SocialPlatform;
  sourceUrl: string;
  normalizedSourceUrl: string;
  platformVideoId: string | null;
  creatorHandle: string | null;
  creatorName: string | null;
  caption: string | null;
  thumbnailUrl: string | null;
  embedUrl: string | null;
  attributionText: string | null;
  publishedAt: string | null;
  sourceFetchedAt: string | null;
  legalDisplayStatus: LegalDisplayStatus;
  resolverStatus: ResolverStatus;
  resolverError: string | null;
}

export type ResolveResult =
  | { ok: true; resolved: ResolvedSocialVideo }
  | { ok: false; error: string };

// Hosts a pasted TikTok link may use. Web hosts carry /@user/video/{id} (or /t/{code}); the short hosts
// carry only /{code}. The sets are exact: no suffix matching, so tiktok.com.evil.test and
// evil-tiktok.com never match.
const TIKTOK_WEB_HOSTS = new Set(["www.tiktok.com", "tiktok.com", "m.tiktok.com"]);
const TIKTOK_SHORT_HOSTS = new Set(["vm.tiktok.com", "vt.tiktok.com"]);
const TIKTOK_VIDEO_PATH = /^\/@([A-Za-z0-9._]{1,64})\/video\/(\d{6,25})\/?$/;
const TIKTOK_SHORT_CODE = "[A-Za-z0-9_-]{3,40}";
const TIKTOK_SHORT_HOST_PATH = new RegExp(`^/(${TIKTOK_SHORT_CODE})/?$`);
const TIKTOK_SHORT_WEB_PATH = new RegExp(`^/t/(${TIKTOK_SHORT_CODE})/?$`);
// /{p|reel|reels|tv}/{code}, optionally behind a /{username}/ prefix and with a trailing /embed.
const INSTAGRAM_POST_PATH = /^\/(?:[A-Za-z0-9._]{1,30}\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]{1,64})(?:\/embed)?\/?$/;
const TIKTOK_OEMBED_HOSTS: ReadonlySet<string> = new Set(["www.tiktok.com"]);
const INSTAGRAM_OEMBED_HOSTS: ReadonlySet<string> = new Set(["graph.facebook.com"]);
const TIKTOK_MAX_REDIRECTS = 3;
const TIKTOK_EXPANSION_DEADLINE_MS = 3500;
const INSTAGRAM_HOSTS = new Set(["www.instagram.com", "instagram.com", "m.instagram.com"]);
const YOUTUBE_HOSTS = new Set([
  "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com",
  "youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com",
]);

/**
 * The single input gate. Accepts a string or an already-parsed URL (extractTikTokId and
 * extractInstagramShortcode are called with both). https only, no userinfo, default port only.
 */
function parseUrl(raw: unknown): URL | null {
  return parseHttpsUrl(raw);
}

/** Detect the platform from a URL host, or null if unsupported. */
export function detectPlatform(raw: unknown): SocialPlatform | null {
  const u = parseUrl(raw);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  if (TIKTOK_WEB_HOSTS.has(host) || TIKTOK_SHORT_HOSTS.has(host)) return "tiktok";
  if (INSTAGRAM_HOSTS.has(host)) return "instagram";
  if (YOUTUBE_HOSTS.has(host)) return "youtube";
  return null;
}

type TikTokLink = { kind: "video"; user: string; id: string } | { kind: "short" };

/** Classify a TikTok URL by exact host + path shape, or null when it is not a supported link. */
function classifyTikTok(u: URL): TikTokLink | null {
  const host = u.hostname.toLowerCase();
  if (TIKTOK_WEB_HOSTS.has(host)) {
    const v = u.pathname.match(TIKTOK_VIDEO_PATH);
    if (v) return { kind: "video", user: v[1], id: v[2] };
    return TIKTOK_SHORT_WEB_PATH.test(u.pathname) ? { kind: "short" } : null;
  }
  if (TIKTOK_SHORT_HOSTS.has(host)) return TIKTOK_SHORT_HOST_PATH.test(u.pathname) ? { kind: "short" } : null;
  return null;
}

/** TikTok video id from a canonical /@user/video/{id} URL (short links → null). */
export function extractTikTokId(raw: unknown): string | null {
  const u = parseUrl(raw);
  if (!u) return null;
  const c = classifyTikTok(u);
  return c?.kind === "video" ? c.id : null;
}

function parseInstagramPost(u: URL): { kind: "p" | "reel" | "tv"; shortcode: string } | null {
  if (!INSTAGRAM_HOSTS.has(u.hostname.toLowerCase())) return null;
  const m = u.pathname.match(INSTAGRAM_POST_PATH);
  if (!m) return null;
  const kind = m[1] === "tv" ? "tv" : m[1] === "p" ? "p" : "reel";
  return { kind, shortcode: m[2] };
}

/** Instagram shortcode from /p/{code}/, /reel/{code}/, /reels/{code}/, /tv/{code}/. */
export function extractInstagramShortcode(raw: unknown): string | null {
  const u = parseUrl(raw);
  return u ? (parseInstagramPost(u)?.shortcode ?? null) : null;
}

/** Validate an https image URL for storage-by-reference (no CSS-breaking chars, no userinfo/port). */
function safeImageUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const s = v.trim();
  if (/[\s"'()\\<>]/.test(s)) return null;
  return parseHttpsUrl(s) ? s : null;
}

/** Provider text → plain, bounded text (never HTML). */
function clean(v: unknown, max = 300): string | null {
  return safeText(v, max);
}

/** Canonical, query-stripped URL used as the dedupe key. */
function normalizeUrl(platform: SocialPlatform, u: URL, videoId: string | null, shortcode: string | null): string {
  const host = u.hostname.toLowerCase().replace(/^m\./, "www.");
  if (platform === "youtube" && videoId) {
    return `https://www.youtube.com/watch?v=${videoId}`;
  }
  if (platform === "tiktok") {
    const video = classifyTikTok(u);
    if (video?.kind === "video") return `https://www.tiktok.com/@${video.user.toLowerCase()}/video/${video.id}`;
    // Short link (vm./vt.) or unusual path: strip query/hash, lowercase the HOST
    // only — short codes (e.g. /ZMabc123) are case-sensitive, so keep the path as-is.
    return `https://${host}${u.pathname.replace(/\/+$/, "")}`;
  }
  if (platform === "instagram" && shortcode) {
    const kind = parseInstagramPost(u)?.kind ?? "p";
    return `https://www.instagram.com/${kind}/${shortcode}/`;
  }
  // Fallback: host (lowercased) + original-case path, no query/hash.
  return `https://${host}${u.pathname.replace(/\/+$/, "")}`;
}

/* ---- platform resolvers ---- */

interface TikTokOEmbed {
  title?: unknown;
  author_name?: unknown;
  author_url?: unknown;
  thumbnail_url?: unknown;
}

async function resolveTikTok(u: URL, raw: string): Promise<ResolvedSocialVideo> {
  const videoId = extractTikTokId(u);
  const normalizedSourceUrl = normalizeUrl("tiktok", u, videoId, null);
  // Official TikTok Embed Player iframe (developers.tiktok.com/doc/embed-player;
  // no download/rehost). Needs the numeric id — short links are canonicalized
  // upstream in resolveSocialVideo, and anything still without an id stays
  // source-link-only.
  const embedUrl = videoId ? `https://www.tiktok.com/player/v1/${videoId}` : null;
  const base: ResolvedSocialVideo = {
    platform: "tiktok",
    sourceUrl: raw,
    normalizedSourceUrl,
    platformVideoId: videoId,
    creatorHandle: null,
    creatorName: null,
    caption: null,
    thumbnailUrl: null,
    embedUrl,
    attributionText: "TikTok post",
    publishedAt: null,
    sourceFetchedAt: null,
    legalDisplayStatus: embedUrl ? "embeddable" : "source-link-only",
    resolverStatus: "source-link-only",
    resolverError: null,
  };
  // Fixed official host; the video URL is only DATA in the query string. No redirects, bounded.
  const endpoint = new URL("https://www.tiktok.com/oembed");
  endpoint.searchParams.set("url", normalizedSourceUrl);
  const res = await fetchJsonBounded(endpoint, { allowedHosts: TIKTOK_OEMBED_HOSTS });
  if (!res.ok) {
    return {
      ...base,
      resolverStatus: "error",
      resolverError: res.status ? `TikTok oEmbed HTTP ${res.status}` : "TikTok oEmbed request failed",
    };
  }
  const data = res.data as TikTokOEmbed;
  const authorUrl = clean(data.author_url, 300);
  const handleFromUrl = authorUrl?.match(/@([A-Za-z0-9._]+)/)?.[1];
  const creatorName = clean(data.author_name, 200);
  return {
    ...base,
    creatorName,
    creatorHandle: handleFromUrl ? `@${handleFromUrl}` : null,
    caption: clean(data.title, 2000),
    thumbnailUrl: safeImageUrl(data.thumbnail_url),
    attributionText: creatorName ? `TikTok post by ${creatorName}` : "TikTok post",
    sourceFetchedAt: new Date().toISOString(),
    resolverStatus: "resolved",
  };
}

interface IgOEmbed {
  title?: unknown;
  author_name?: unknown;
  thumbnail_url?: unknown;
}

async function resolveInstagram(u: URL, raw: string): Promise<ResolvedSocialVideo> {
  const post = parseInstagramPost(u);
  const shortcode = post?.shortcode ?? null;
  const normalizedSourceUrl = normalizeUrl("instagram", u, null, shortcode);
  // Official Instagram /embed/ iframe (no download/rehost, no embed.js script).
  // Works for public posts without the oEmbed token; the token only enriches
  // metadata below. No shortcode (odd URL) → stays source-link-only.
  const embedUrl = post ? `https://www.instagram.com/${post.kind}/${post.shortcode}/embed/` : null;
  const base: ResolvedSocialVideo = {
    platform: "instagram",
    sourceUrl: raw,
    normalizedSourceUrl,
    platformVideoId: shortcode,
    creatorHandle: null,
    creatorName: null,
    caption: null,
    thumbnailUrl: null,
    embedUrl,
    attributionText: "Instagram post",
    publishedAt: null,
    sourceFetchedAt: null,
    legalDisplayStatus: embedUrl ? "embeddable" : "source-link-only",
    resolverStatus: "source-link-only",
    resolverError: null,
  };

  const token = process.env.INSTAGRAM_OEMBED_TOKEN;
  if (!token || token.trim() === "") {
    // No official credentials → don't fail; create a source-link-only candidate.
    return {
      ...base,
      resolverStatus: "missing-credentials",
      resolverError: "Instagram oEmbed not configured (INSTAGRAM_OEMBED_TOKEN unset); created as source-link-only.",
    };
  }
  const endpoint = new URL("https://graph.facebook.com/v19.0/instagram_oembed");
  endpoint.searchParams.set("url", normalizedSourceUrl);
  endpoint.searchParams.set("omitscript", "true");
  endpoint.searchParams.set("access_token", token.trim());
  // Fixed official host; redirects disabled so the access token can never be forwarded elsewhere.
  const res = await fetchJsonBounded(endpoint, { allowedHosts: INSTAGRAM_OEMBED_HOSTS });
  if (!res.ok) {
    return {
      ...base,
      resolverStatus: "error",
      resolverError: res.status ? `Instagram oEmbed HTTP ${res.status}` : "Instagram oEmbed request failed",
    };
  }
  const data = res.data as IgOEmbed;
  const creatorName = clean(data.author_name, 200);
  return {
    ...base,
    creatorName,
    creatorHandle: creatorName ? `@${creatorName}` : null,
    caption: clean(data.title, 2000),
    thumbnailUrl: safeImageUrl(data.thumbnail_url),
    attributionText: creatorName ? `Instagram post by ${creatorName}` : "Instagram post",
    sourceFetchedAt: new Date().toISOString(),
    resolverStatus: "resolved",
  };
}

async function resolveYouTube(raw: string): Promise<ResolvedSocialVideo> {
  const resolved = resolveYouTubeUrl(raw)!; // caller guarantees a valid id
  const { status, metadata } = await fetchYouTubeMetadata(resolved.videoId);
  const creatorName = clean(metadata?.channelTitle, 200);
  return {
    platform: "youtube",
    sourceUrl: resolved.sourceUrl,
    normalizedSourceUrl: resolved.sourceUrl, // already canonical watch URL
    platformVideoId: resolved.videoId,
    creatorHandle: creatorName ? `@${creatorName}` : null,
    creatorName,
    caption: clean(metadata?.title, 2000),
    thumbnailUrl: safeImageUrl(metadata?.thumbnailUrl),
    embedUrl: resolved.embedUrl, // nocookie — allowlisted for real embedding
    attributionText: creatorName ? `YouTube video by ${creatorName}` : "YouTube video",
    publishedAt: clean(metadata?.publishedAt, 40),
    sourceFetchedAt: status === "enriched" ? new Date().toISOString() : null,
    legalDisplayStatus: "embeddable",
    resolverStatus: status === "enriched" ? "resolved" : "source-link-only",
    resolverError:
      status === "missing-api-key"
        ? "YOUTUBE_API_KEY unset; embed works, metadata not enriched."
        : status === "failed"
          ? "YouTube metadata request failed; embed works, metadata not enriched."
          : null,
  };
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * Expand a TikTok short link (vm./vt./ /t/{code}) to its canonical /@user/video/{id} URL by walking
 * the redirect chain MANUALLY.
 *
 *  - Every hop is validated BEFORE it is requested: https, no userinfo, default port, and an exact
 *    TikTok short-link host + path. A Location that points anywhere else (another host, http, an
 *    IP literal, a userinfo trick, a non-short path) ends the walk with NO request made to it.
 *  - Redirects are never followed by fetch ("manual"); at most TIKTOK_MAX_REDIRECTS hops; loops stop;
 *    one deadline covers the whole walk; the response body is cancelled unread.
 *  - The canonical target is parsed from the Location header and never requested.
 *
 * Returns the canonical URL (query/hash stripped) or null. Never throws; null means the caller keeps
 * the link source-link-only.
 */
async function expandTikTokShortLink(start: URL): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIKTOK_EXPANSION_DEADLINE_MS);
  const visited = new Set<string>();
  try {
    let current: URL = start;
    for (let hop = 0; hop < TIKTOK_MAX_REDIRECTS; hop++) {
      // Gate BEFORE connecting: only an exact TikTok short-link shape may be requested.
      const safe = parseHttpsUrl(current);
      if (!safe || classifyTikTok(safe)?.kind !== "short") return null;
      const target = `https://${safe.hostname}${safe.pathname}`;
      if (visited.has(target)) return null; // loop
      visited.add(target);

      const res = await fetch(target, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: { accept: "text/html" },
      });
      await res.body?.cancel().catch(() => {}); // never read the body
      if (!isRedirectStatus(res.status)) return null;
      const location = res.headers.get("location");
      if (!location || location.length > 2048) return null;

      // Validate the RAW header value before any URL parsing. Only an absolute "https://..." or a
      // single-slash path on the current approved host is considered; "//host", "/\\host", "foo",
      // "http://", "javascript:" etc. end the walk. parseHttpsUrl then applies the full raw grammar.
      const isHostPath = location.startsWith("/") && !location.startsWith("//") && !location.startsWith("/\\");
      const nextSafe = parseHttpsUrl(isHostPath ? `https://${safe.hostname}${location}` : location);
      if (!nextSafe) return null;
      const c = classifyTikTok(nextSafe);
      if (c?.kind === "video") return `https://www.tiktok.com/@${c.user}/video/${c.id}`;
      current = nextSafe; // another short hop is re-validated at the top of the loop
    }
    return null; // too many redirects
  } catch {
    return null; // timeout / network → graceful source-link-only fallback
  } finally {
    clearTimeout(timer);
  }
}

export interface ResolveOptions {
  /**
   * Opt-in, internal only, unused by every app route: expand TikTok short links by walking their
   * (validated) redirects. Defaults to OFF: a short link is refused with zero requests and the
   * operator is asked for the canonical /@user/video/{id} link.
   */
  expandShortLinks?: boolean;
}

/**
 * Resolve a raw social URL into a review candidate's fields. Never throws; an
 * unsupported/invalid URL returns { ok: false, error }. A supported URL whose
 * metadata can't be fetched still returns ok:true with a source-link-only result.
 */
export async function resolveSocialVideo(raw: unknown, options: ResolveOptions = {}): Promise<ResolveResult> {
  const u = parseUrl(raw);
  if (!u) return { ok: false, error: "Not a valid URL. Use a full https:// link without a username, password or port." };
  const platform = detectPlatform(u.href);
  if (!platform) {
    return { ok: false, error: "Unsupported platform. Provide a TikTok, Instagram, or YouTube URL." };
  }
  const rawStr = u.href;

  if (platform === "youtube") {
    if (!extractYouTubeId(rawStr)) {
      return { ok: false, error: "Not a valid YouTube video URL (expected watch / youtu.be / shorts / embed)." };
    }
    return { ok: true, resolved: await resolveYouTube(rawStr) };
  }
  if (platform === "tiktok") {
    const link = classifyTikTok(u);
    if (!link) {
      return {
        ok: false,
        error: "Not a supported TikTok video link (expected tiktok.com/@user/video/{id} or a vm./vt./t/ short link).",
      };
    }
    // A canonical /@user/video/{id} URL embeds directly; a short link has no id, so canonicalize it by
    // walking its redirects with every hop validated first.
    let tkUrl = u;
    let tkRaw = rawStr;
    if (link.kind === "short") {
      // Default OFF: refused here, before any request (no hop, no oEmbed) and before any caller can insert.
      if (options.expandShortLinks !== true) {
        return {
          ok: false,
          error: "TikTok short links are not supported. Open the link and paste the full tiktok.com/@user/video/{id} URL.",
        };
      }
      const canonical = await expandTikTokShortLink(u);
      if (canonical) {
        tkUrl = new URL(canonical);
        tkRaw = canonical;
      }
    }
    return { ok: true, resolved: await resolveTikTok(tkUrl, tkRaw) };
  }
  // instagram
  if (!extractInstagramShortcode(u)) {
    return { ok: false, error: "Not a valid Instagram post/reel URL (expected /p/, /reel/, or /tv/)." };
  }
  return { ok: true, resolved: await resolveInstagram(u, rawStr) };
}
