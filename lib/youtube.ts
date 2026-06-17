import type { Video } from "./types";
import { normalizeVideo } from "./video";

/**
 * v1.1 YouTube URL resolver — the smallest real-media ingestion slice.
 *
 * Pure + dependency-free. Turns a pasted YouTube URL into a legal-safe,
 * embeddable Video reference. We do NOT call the YouTube Data API (no key) and
 * we never download/store/rehost video — only build canonical + privacy-enhanced
 * embed URLs and run them through the existing `normalizeVideo` enforcement.
 */

// Hosts we accept as INPUT (broader than the embed allowlist in lib/video).
const YOUTUBE_HOSTS = new Set<string>([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

// A YouTube video id is exactly 11 url-safe base64 chars.
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * Extract a valid 11-char YouTube video id from a raw URL string, or null.
 * Handles watch?v=, youtu.be/ID, /shorts/ID, /embed/ID, /v/ID, /live/ID and
 * ignores extra query params. Rejects non-YouTube hosts and malformed URLs.
 */
export function extractYouTubeId(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null; // malformed / not a URL
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) return null;

  const segments = url.pathname.split("/").filter(Boolean);

  let id: string | null = null;
  if (host === "youtu.be") {
    // https://youtu.be/VIDEO_ID
    id = segments[0] ?? null;
  } else if (segments[0] === "watch" || url.pathname === "/watch") {
    // https://www.youtube.com/watch?v=VIDEO_ID
    id = url.searchParams.get("v");
  } else if (
    segments[0] === "shorts" ||
    segments[0] === "embed" ||
    segments[0] === "v" ||
    segments[0] === "live"
  ) {
    // /shorts/ID, /embed/ID, /v/ID, /live/ID
    id = segments[1] ?? null;
  } else {
    // last resort: some share URLs still carry ?v=
    id = url.searchParams.get("v");
  }

  if (!id) return null;
  return YOUTUBE_ID_RE.test(id) ? id : null;
}

export interface YouTubeResolution {
  videoId: string;
  /** Canonical watch URL — used for the "View original" link. */
  sourceUrl: string;
  /** Privacy-enhanced embed URL — the only thing we iframe. */
  embedUrl: string;
}

/** Resolve a raw URL to canonical + embed URLs, or null if it's not YouTube. */
export function resolveYouTubeUrl(raw: unknown): YouTubeResolution | null {
  const videoId = extractYouTubeId(raw);
  if (!videoId) return null;
  return {
    videoId,
    sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
    embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
  };
}

export interface YouTubeBuildInput {
  url: string;
  creatorHandle?: string;
  creatorDisplayName?: string;
  caption?: string;
}

const clean = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;

/**
 * Build a normalized, legal-safe Video from a YouTube URL + optional creator
 * info. Returns null for non-YouTube / invalid URLs. We do NOT invent creator
 * or title metadata — unknown creator falls back to "Unknown creator" and the
 * caption to a generic, honest default.
 */
export function buildYouTubeVideo(input: YouTubeBuildInput): Video | null {
  const resolved = resolveYouTubeUrl(input.url);
  if (!resolved) return null;

  const handle = clean(input.creatorHandle);
  const displayName = clean(input.creatorDisplayName);
  const caption = clean(input.caption) ?? "YouTube food-review video";
  const knownCreator = displayName ?? handle;
  const attributionText = knownCreator
    ? `Original post by ${knownCreator} on YouTube`
    : "YouTube video — creator not verified";

  // normalizeVideo re-validates everything (embed allowlist, real-source rule,
  // enum coercion) so the resolver can't bypass the legal-safe invariants.
  return normalizeVideo({
    id: `youtube-${resolved.videoId}`,
    platform: "YouTube",
    sourceUrl: resolved.sourceUrl,
    embedUrl: resolved.embedUrl,
    creatorHandle: handle ?? "Unknown creator",
    creatorDisplayName: displayName,
    caption,
    attributionText,
    discoveredAt: new Date().toISOString().slice(0, 10),
    isRealSource: true,
    sourceType: "real-post",
    matchConfidence: "manual",
    legalDisplayStatus: "embeddable",
  });
}
