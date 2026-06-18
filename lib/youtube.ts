import type { Video } from "./types";
import { normalizeVideo } from "./video";

/**
 * YouTube URL resolver + optional metadata enrichment.
 *
 * The URL parsing (extractYouTubeId / resolveYouTubeUrl / buildYouTubeVideo) is
 * pure and works with no API key. If `YOUTUBE_API_KEY` is set, the route can
 * additionally call the official Data API `videos.list` for that exact id to
 * prefill the title/channel/thumbnail/publishedAt (v1.3). Enrichment is
 * best-effort: a missing key or a failed request falls back to generic metadata.
 *
 * We never download/store/rehost video — only build canonical + privacy-enhanced
 * embed URLs (and store the official thumbnail URL by reference), then run
 * everything through `normalizeVideo`. No scraping, no search/discovery.
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

const clean = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;

/* ---- Optional metadata enrichment (YouTube Data API, v1.3) ---- */

export type MetadataStatus =
  | "enriched"
  | "missing-api-key"
  | "not-found"
  | "failed";

export interface YouTubeMetadata {
  title?: string;
  channelTitle?: string;
  thumbnailUrl?: string;
  publishedAt?: string;
}

/** Pick the best available thumbnail URL from a snippet.thumbnails object. */
function pickThumbnail(thumbnails: unknown): string | undefined {
  if (!thumbnails || typeof thumbnails !== "object") return undefined;
  const t = thumbnails as Record<string, { url?: unknown } | undefined>;
  for (const size of ["maxres", "standard", "high", "medium", "default"]) {
    const url = t[size]?.url;
    if (typeof url === "string" && url.trim() !== "") return url.trim();
  }
  return undefined;
}

/**
 * Fetch official metadata for a video id via the Data API `videos.list`
 * (part=snippet). Optional + best-effort: returns a status so the caller can
 * fall back. Requires `YOUTUBE_API_KEY` (read from env, never logged). Never
 * throws — network/parse failures resolve to `{ status: "failed" }`.
 */
export async function fetchYouTubeMetadata(
  videoId: string,
): Promise<{ status: MetadataStatus; metadata?: YouTubeMetadata }> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return { status: "missing-api-key" };
  if (!YOUTUBE_ID_RE.test(videoId)) return { status: "not-found" };

  try {
    const endpoint = new URL("https://www.googleapis.com/youtube/v3/videos");
    endpoint.searchParams.set("part", "snippet");
    endpoint.searchParams.set("id", videoId);
    endpoint.searchParams.set("key", key);

    const res = await fetch(endpoint, { headers: { accept: "application/json" } });
    if (!res.ok) return { status: "failed" };

    const data = (await res.json()) as {
      items?: { snippet?: Record<string, unknown> }[];
    };
    const snippet = data.items?.[0]?.snippet;
    if (!snippet) return { status: "not-found" };

    return {
      status: "enriched",
      metadata: {
        title: clean(snippet.title),
        channelTitle: clean(snippet.channelTitle),
        thumbnailUrl: pickThumbnail(snippet.thumbnails),
        publishedAt: clean(snippet.publishedAt),
      },
    };
  } catch {
    return { status: "failed" };
  }
}

export interface YouTubeBuildInput {
  url: string;
  creatorHandle?: string;
  creatorDisplayName?: string;
  caption?: string;
  /** Optional official metadata (from fetchYouTubeMetadata) to prefill from. */
  metadata?: YouTubeMetadata;
}

/**
 * Build a normalized, legal-safe Video from a YouTube URL, optional admin-typed
 * fields, and optional official metadata. Precedence is conservative:
 * admin-typed value > official metadata > honest generic fallback. We never
 * invent metadata — without a key/match, caption/creator stay generic.
 */
export function buildYouTubeVideo(input: YouTubeBuildInput): Video | null {
  const resolved = resolveYouTubeUrl(input.url);
  if (!resolved) return null;

  const meta = input.metadata;
  const channel = clean(meta?.channelTitle);
  const caption =
    clean(input.caption) ?? clean(meta?.title) ?? "YouTube food-review video";
  const displayName = clean(input.creatorDisplayName) ?? channel;
  const handle = clean(input.creatorHandle) ?? channel ?? "Unknown creator";
  const thumbnailUrl = clean(meta?.thumbnailUrl);
  const publishedAt = clean(meta?.publishedAt);

  const knownCreator =
    displayName ?? (handle !== "Unknown creator" ? handle : undefined);
  const attributionText = channel
    ? `YouTube video by ${channel}`
    : knownCreator
      ? `Original post by ${knownCreator} on YouTube`
      : "YouTube video — creator not verified";

  // normalizeVideo re-validates everything (embed allowlist, real-source rule,
  // enum coercion) so the resolver can't bypass the legal-safe invariants.
  return normalizeVideo({
    id: `youtube-${resolved.videoId}`,
    platform: "YouTube",
    sourceUrl: resolved.sourceUrl,
    embedUrl: resolved.embedUrl,
    creatorHandle: handle,
    creatorDisplayName: displayName,
    caption,
    thumbnailUrl,
    attributionText,
    publishedAt,
    discoveredAt: new Date().toISOString().slice(0, 10),
    isRealSource: true,
    sourceType: "real-post",
    matchConfidence: "manual",
    legalDisplayStatus: "embeddable",
  });
}
