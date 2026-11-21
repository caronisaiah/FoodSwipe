import type { Video } from "./types";

/**
 * Pure helpers behind Creator Reviews v2. No React, no network.
 *
 * What may be embedded or linked is still decided only by lib/video
 * (videoCanEmbed / videoSourceHref). This module decides how an allowed review is *shaped*
 * and how the provider's own signals are read. It never builds a new embed URL, only
 * adds the documented YouTube IFrame API parameters to an already-allowlisted one.
 */

/** Reserved frame shape. The frame exists before any provider iframe does. */
export type ReviewFrame = "portrait" | "landscape" | "post";

/**
 * TikTok's player and Reels are portrait; YouTube is 16:9 unless the source is a Short;
 * an Instagram embed is a card whose height depends on the post.
 */
export function reviewFrame(video: Pick<Video, "platform" | "sourceUrl" | "embedUrl">): ReviewFrame {
  if (video.platform === "TikTok") return "portrait";
  if (video.platform === "Instagram") return "post";
  if (video.platform === "YouTube") {
    return /\/shorts\//.test(video.sourceUrl ?? "") ? "portrait" : "landscape";
  }
  return "landscape";
}

/**
 * A note for a clip that is not an ordinary published review: "Local clip" for one saved only in this browser
 * by the internal tool, "Demo clip" for an attached clip that is not a real source post. A real, attached post
 * (what the admin tool publishes) carries no label.
 */
export function reviewOriginLabel(
  origin: "seed" | "shared" | "local",
  video: Pick<Video, "sourceType" | "isRealSource">,
): string | undefined {
  if (origin === "local") return "Local clip";
  if (origin === "shared" && !(video.sourceType === "real-post" && video.isRealSource)) return "Demo clip";
  return undefined;
}

/** A TikTok-style post link carries its creator: https://www.tiktok.com/@name/video/123. */
export function handleFromUrl(href: string | undefined): string | null {
  if (!href) return null;
  try {
    return new URL(href).pathname.match(/^\/(@[\w.-]+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * The creator to credit, or null when none is recorded. A stored "@unknown" is a placeholder,
 * not a name: fall back to the handle in the original link, then the display name.
 */
export function reviewCreatorName(
  video: Pick<Video, "creatorHandle" | "creatorDisplayName" | "sourceUrl">,
  sourceHref?: string,
): string | null {
  const stored = video.creatorHandle?.trim();
  if (stored && stored !== "@unknown") return stored;
  return handleFromUrl(sourceHref ?? video.sourceUrl) ?? video.creatorDisplayName?.trim() ?? null;
}

/** Accessible name for a review: the creator when known, otherwise just the platform. */
export function reviewTitle(name: string | null, platform: string): string {
  return name ? `${platform} review by ${name}` : `${platform} review`;
}

/** Instagram reports its own content height; clamp it so a bad value cannot break the layout. */
export const INSTAGRAM_MIN_HEIGHT = 420;
export const INSTAGRAM_MAX_HEIGHT = 900;
export function clampInstagramHeight(height: number): number {
  return Math.min(Math.max(Math.round(height), INSTAGRAM_MIN_HEIGHT), INSTAGRAM_MAX_HEIGHT);
}

/**
 * The URL we hand the iframe. TikTok and Instagram URLs pass through untouched. YouTube gets the
 * documented IFrame API parameters so the player can report errors (enablejsapi needs `origin`),
 * and playsinline so iOS does not force fullscreen. There is no autoplay parameter anywhere.
 */
export function reviewEmbedSrc(embedUrl: string, siteOrigin: string | null): string {
  let url: URL;
  try {
    url = new URL(embedUrl);
  } catch {
    return embedUrl;
  }
  if (url.hostname.endsWith("youtube.com") || url.hostname.endsWith("youtube-nocookie.com")) {
    url.searchParams.set("playsinline", "1");
    url.searchParams.set("rel", "0");
    if (siteOrigin) {
      url.searchParams.set("enablejsapi", "1");
      url.searchParams.set("origin", siteOrigin);
    }
  }
  return url.toString();
}

export type ProviderSignal =
  | { kind: "error"; detail: string }
  | { kind: "measure"; height: number }
  | null;

const TIKTOK_ORIGIN = "https://www.tiktok.com";
const INSTAGRAM_ORIGIN = "https://www.instagram.com";
const YOUTUBE_ORIGINS = new Set(["https://www.youtube-nocookie.com", "https://www.youtube.com"]);

function parseJson(data: unknown): Record<string, unknown> | null {
  if (data && typeof data === "object") return data as Record<string, unknown>;
  if (typeof data !== "string" || !data.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(data);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Read one postMessage from a provider iframe. The caller has already matched the message to
 * the iframe's own window; this checks the origin and shape. Everything here is untrusted data.
 *  - TikTok:    `onPlayerError` / `onError` (documented error events; observed on a bad post).
 *               A healthy player sends no ready message, so none is expected.
 *  - YouTube:   `onError` (documented IFrame API; needs the `listening` handshake).
 *  - Instagram: `MEASURE { height }`, which the /embed page sends to size itself. Undocumented,
 *               so it only refines an already-reserved frame and never gates display.
 */
export function parseProviderSignal(platform: Video["platform"], origin: string, data: unknown): ProviderSignal {
  const message = parseJson(data);
  if (!message) return null;
  if (platform === "TikTok" && origin === TIKTOK_ORIGIN) {
    if (message["x-tiktok-player"] !== true) return null;
    if (message.type === "onPlayerError" || message.type === "onError") {
      return { kind: "error", detail: String(message.type) };
    }
    return null;
  }
  if (platform === "YouTube" && YOUTUBE_ORIGINS.has(origin)) {
    if (message.event === "onError") return { kind: "error", detail: `youtube-${String(message.info ?? "unknown")}` };
    return null;
  }
  if (platform === "Instagram" && origin === INSTAGRAM_ORIGIN) {
    const details = message.details as { height?: unknown } | undefined;
    if (message.type === "MEASURE" && typeof details?.height === "number" && Number.isFinite(details.height)) {
      return { kind: "measure", height: clampInstagramHeight(details.height) };
    }
  }
  return null;
}

/** The handshake YouTube needs before it will send events to the embedding page. */
export const YOUTUBE_LISTENING_MESSAGE = JSON.stringify({ event: "listening", id: 1, channel: "widget" });
