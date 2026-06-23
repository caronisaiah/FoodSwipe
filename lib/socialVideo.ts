import type { LegalDisplayStatus } from "@/lib/types";
import { extractYouTubeId, fetchYouTubeMetadata, resolveYouTubeUrl } from "@/lib/youtube";

/**
 * Server-only social-video URL resolver for the intake/review queue (Phase 1).
 *
 * Detects platform, normalizes the URL (the dedupe key), extracts a platform
 * video id where possible, and resolves PUBLIC, OFFICIAL metadata only:
 *   - TikTok    — official public oEmbed (no key). source-link-only.
 *   - YouTube   — reuse lib/youtube (canonical + nocookie embed; optional Data API). embeddable.
 *   - Instagram — official oEmbed via INSTAGRAM_OEMBED_TOKEN if configured; otherwise
 *                 a clean source-link-only candidate (resolverStatus explains why). Never fails.
 *
 * Hard rules: NO scraping, NO unofficial downloaders, NO media bytes stored.
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

const TIKTOK_HOSTS = new Set(["www.tiktok.com", "tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"]);
const INSTAGRAM_HOSTS = new Set(["www.instagram.com", "instagram.com", "m.instagram.com"]);
const YOUTUBE_HOSTS = new Set([
  "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com",
  "youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com",
]);

function parseUrl(raw: unknown): URL | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

/** Detect the platform from a URL host, or null if unsupported. */
export function detectPlatform(raw: unknown): SocialPlatform | null {
  const u = parseUrl(raw);
  if (!u) return null;
  const host = u.hostname.toLowerCase();
  if (TIKTOK_HOSTS.has(host)) return "tiktok";
  if (INSTAGRAM_HOSTS.has(host)) return "instagram";
  if (YOUTUBE_HOSTS.has(host)) return "youtube";
  return null;
}

/** TikTok video id from a canonical /@user/video/{id} URL (short links → null). */
export function extractTikTokId(raw: unknown): string | null {
  const u = parseUrl(raw);
  if (!u) return null;
  const m = u.pathname.match(/\/video\/(\d{6,25})/);
  return m ? m[1] : null;
}

/** Instagram shortcode from /p/{code}/, /reel/{code}/, /reels/{code}/, /tv/{code}/. */
export function extractInstagramShortcode(raw: unknown): string | null {
  const u = parseUrl(raw);
  if (!u) return null;
  const m = u.pathname.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

/** Validate an https image URL for storage-by-reference (no CSS-breaking chars). */
function safeImageUrl(v: unknown): string | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  const s = v.trim();
  if (/[\s"'()\\<>]/.test(s)) return null;
  try {
    return new URL(s).protocol === "https:" ? s : null;
  } catch {
    return null;
  }
}

function clean(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** Canonical, query-stripped URL used as the dedupe key. */
function normalizeUrl(platform: SocialPlatform, u: URL, videoId: string | null, shortcode: string | null): string {
  const host = u.hostname.toLowerCase().replace(/^m\./, "www.");
  if (platform === "youtube" && videoId) {
    return `https://www.youtube.com/watch?v=${videoId}`;
  }
  if (platform === "tiktok") {
    const userMatch = u.pathname.match(/\/@([^/]+)\/video\/\d+/);
    if (userMatch && videoId) return `https://www.tiktok.com/@${userMatch[1].toLowerCase()}/video/${videoId}`;
    // Short link (vm./vt.) or unusual path: strip query/hash, lowercase the HOST
    // only — short codes (e.g. /ZMabc123) are case-sensitive, so keep the path as-is.
    return `https://${host}${u.pathname.replace(/\/+$/, "")}`;
  }
  if (platform === "instagram" && shortcode) {
    const kind = /\/reels?\//.test(u.pathname) ? "reel" : /\/tv\//.test(u.pathname) ? "tv" : "p";
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
  const base: ResolvedSocialVideo = {
    platform: "tiktok",
    sourceUrl: raw,
    normalizedSourceUrl,
    platformVideoId: videoId,
    creatorHandle: null,
    creatorName: null,
    caption: null,
    thumbnailUrl: null,
    embedUrl: null, // not in our embed allowlist — link out, never iframe
    attributionText: "TikTok post",
    publishedAt: null,
    sourceFetchedAt: null,
    legalDisplayStatus: "source-link-only",
    resolverStatus: "source-link-only",
    resolverError: null,
  };
  try {
    const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(raw)}`, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      return { ...base, resolverStatus: "error", resolverError: `TikTok oEmbed HTTP ${res.status}` };
    }
    const data = (await res.json()) as TikTokOEmbed;
    const authorUrl = clean(data.author_url);
    const handleFromUrl = authorUrl?.match(/@([A-Za-z0-9._]+)/)?.[1];
    const creatorName = clean(data.author_name);
    return {
      ...base,
      creatorName,
      creatorHandle: handleFromUrl ? `@${handleFromUrl}` : null,
      caption: clean(data.title),
      thumbnailUrl: safeImageUrl(data.thumbnail_url),
      attributionText: creatorName ? `TikTok post by ${creatorName}` : "TikTok post",
      sourceFetchedAt: new Date().toISOString(),
      resolverStatus: "resolved",
    };
  } catch {
    return { ...base, resolverStatus: "error", resolverError: "TikTok oEmbed request failed" };
  }
}

interface IgOEmbed {
  title?: unknown;
  author_name?: unknown;
  thumbnail_url?: unknown;
}

async function resolveInstagram(u: URL, raw: string): Promise<ResolvedSocialVideo> {
  const shortcode = extractInstagramShortcode(u);
  const normalizedSourceUrl = normalizeUrl("instagram", u, null, shortcode);
  const base: ResolvedSocialVideo = {
    platform: "instagram",
    sourceUrl: raw,
    normalizedSourceUrl,
    platformVideoId: shortcode,
    creatorHandle: null,
    creatorName: null,
    caption: null,
    thumbnailUrl: null,
    embedUrl: null, // not embedded in Phase 1 — link out
    attributionText: "Instagram post",
    publishedAt: null,
    sourceFetchedAt: null,
    legalDisplayStatus: "source-link-only",
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
  try {
    const endpoint = new URL("https://graph.facebook.com/v19.0/instagram_oembed");
    endpoint.searchParams.set("url", raw);
    endpoint.searchParams.set("omitscript", "true");
    endpoint.searchParams.set("access_token", token.trim());
    const res = await fetch(endpoint, { headers: { accept: "application/json" }, cache: "no-store" });
    if (!res.ok) {
      return { ...base, resolverStatus: "error", resolverError: `Instagram oEmbed HTTP ${res.status}` };
    }
    const data = (await res.json()) as IgOEmbed;
    const creatorName = clean(data.author_name);
    return {
      ...base,
      creatorName,
      creatorHandle: creatorName ? `@${creatorName}` : null,
      caption: clean(data.title),
      thumbnailUrl: safeImageUrl(data.thumbnail_url),
      attributionText: creatorName ? `Instagram post by ${creatorName}` : "Instagram post",
      sourceFetchedAt: new Date().toISOString(),
      resolverStatus: "resolved",
    };
  } catch {
    return { ...base, resolverStatus: "error", resolverError: "Instagram oEmbed request failed" };
  }
}

async function resolveYouTube(raw: string): Promise<ResolvedSocialVideo> {
  const resolved = resolveYouTubeUrl(raw)!; // caller guarantees a valid id
  const { status, metadata } = await fetchYouTubeMetadata(resolved.videoId);
  const creatorName = clean(metadata?.channelTitle);
  return {
    platform: "youtube",
    sourceUrl: resolved.sourceUrl,
    normalizedSourceUrl: resolved.sourceUrl, // already canonical watch URL
    platformVideoId: resolved.videoId,
    creatorHandle: creatorName ? `@${creatorName}` : null,
    creatorName,
    caption: clean(metadata?.title),
    thumbnailUrl: safeImageUrl(metadata?.thumbnailUrl),
    embedUrl: resolved.embedUrl, // nocookie — allowlisted for real embedding
    attributionText: creatorName ? `YouTube video by ${creatorName}` : "YouTube video",
    publishedAt: clean(metadata?.publishedAt),
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

/**
 * Resolve a raw social URL into a review candidate's fields. Never throws; an
 * unsupported/invalid URL returns { ok: false, error }. A supported URL whose
 * metadata can't be fetched still returns ok:true with a source-link-only result.
 */
export async function resolveSocialVideo(raw: unknown): Promise<ResolveResult> {
  const u = parseUrl(raw);
  if (!u) return { ok: false, error: "Not a valid URL." };
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
    return { ok: true, resolved: await resolveTikTok(u, rawStr) };
  }
  // instagram
  if (!extractInstagramShortcode(u)) {
    return { ok: false, error: "Not a valid Instagram post/reel URL (expected /p/, /reel/, or /tv/)." };
  }
  return { ok: true, resolved: await resolveInstagram(u, rawStr) };
}
