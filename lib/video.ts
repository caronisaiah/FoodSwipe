import type {
  LegalDisplayStatus,
  MatchConfidence,
  Platform,
  Video,
  VideoSourceType,
} from "./types";

/**
 * Single source of truth for legal-safe, honest video behavior.
 *
 * Pure (no React) so it can be shared by the display layer, the ranking, the
 * localStorage normalizer, and the admin tool — the rules are ENFORCED here,
 * not merely described in comments elsewhere.
 */

// ---- Controlled vocabularies ----
export const PLATFORMS: readonly Platform[] = [
  "TikTok",
  "Instagram",
  "YouTube",
  "Web",
];
export const SOURCE_TYPES: readonly VideoSourceType[] = [
  "real-post",
  "creator-profile",
  "placeholder",
  "manual-seed",
];
export const MATCH_CONFIDENCES: readonly MatchConfidence[] = [
  "high",
  "medium",
  "low",
  "manual",
];
export const LEGAL_STATUSES: readonly LegalDisplayStatus[] = [
  "embeddable",
  "source-link-only",
  "placeholder-only",
  "unavailable",
];

function inSet<T extends string>(set: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (set as readonly string[]).includes(v);
}

/** Runtime-safe non-empty-string check (accepts unknown). */
export function hasUrl(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// ---- Embed allowlist ----
// For v1 we only iframe trusted YouTube hosts; anything else degrades to a
// preview/source-link rather than embedding an arbitrary admin-provided URL.
const EMBED_ALLOWED_HOSTS = new Set<string>([
  "www.youtube.com",
  "youtube.com",
  "www.youtube-nocookie.com",
]);

export function isEmbedUrlAllowed(url: unknown): url is string {
  if (!hasUrl(url)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && EMBED_ALLOWED_HOSTS.has(parsed.hostname);
}

// ---- Display gating (what VideoEmbed will actually render) ----

/** Placeholder / unavailable content is NEVER externally linkable, full stop. */
function isExternallyBlocked(
  sourceType: VideoSourceType,
  legalDisplayStatus: LegalDisplayStatus,
): boolean {
  return (
    sourceType === "placeholder" ||
    legalDisplayStatus === "placeholder-only" ||
    legalDisplayStatus === "unavailable"
  );
}

export function videoCanEmbed(video: Video): boolean {
  return (
    !isExternallyBlocked(video.sourceType, video.legalDisplayStatus) &&
    video.legalDisplayStatus === "embeddable" &&
    isEmbedUrlAllowed(video.embedUrl)
  );
}

/** The external "view source/original" URL, or undefined if none is allowed. */
export function videoSourceHref(video: Video): string | undefined {
  if (isExternallyBlocked(video.sourceType, video.legalDisplayStatus)) return undefined;
  const allowsLink =
    video.legalDisplayStatus === "embeddable" ||
    video.legalDisplayStatus === "source-link-only";
  return allowsLink && hasUrl(video.sourceUrl) ? video.sourceUrl.trim() : undefined;
}

/** True when the clip surfaces a real affordance — an embed or external link. */
export function videoHasSource(video: Video): boolean {
  return videoCanEmbed(video) || videoSourceHref(video) !== undefined;
}

/** "View original" is reserved for a genuine real post that truly links out. */
export function showsViewOriginal(video: Video): boolean {
  return (
    video.sourceType === "real-post" &&
    video.isRealSource === true &&
    videoSourceHref(video) !== undefined
  );
}

export function sourceLinkLabel(video: Video): string {
  return showsViewOriginal(video) ? "View original" : "View source";
}

// ---- Normalization / invariant enforcement ----

function optionalString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

/**
 * Enforce the legal-safe invariants on an already-typed Video. Pure +
 * idempotent — safe to run on trusted seed data or admin input. After this:
 *  - embedUrl only survives if it's on the embed allowlist;
 *  - "embeddable" without a valid embed downgrades (source-link-only / placeholder-only);
 *  - a `placeholder` source can't be linkable;
 *  - placeholder-only / unavailable carry NO external URLs;
 *  - isRealSource is true only for a real-post that actually has a source URL.
 */
export function enforceVideoInvariants(video: Video): Video {
  const sourceType = video.sourceType;
  let legalDisplayStatus = video.legalDisplayStatus;

  const trimmedEmbed =
    typeof video.embedUrl === "string" ? video.embedUrl.trim() : undefined;
  const embedAllowed = isEmbedUrlAllowed(trimmedEmbed) ? trimmedEmbed : undefined;
  let sourceUrl = hasUrl(video.sourceUrl) ? video.sourceUrl.trim() : undefined;

  // embeddable but no allowlisted embed -> fall back to a link or a placeholder
  if (legalDisplayStatus === "embeddable" && !embedAllowed) {
    legalDisplayStatus = sourceUrl ? "source-link-only" : "placeholder-only";
  }
  // a placeholder source is never embeddable / linkable
  if (sourceType === "placeholder" && legalDisplayStatus !== "unavailable") {
    legalDisplayStatus = "placeholder-only";
  }
  // placeholder-only / unavailable hold no outbound URLs at all
  const blocked =
    legalDisplayStatus === "placeholder-only" ||
    legalDisplayStatus === "unavailable";
  const finalEmbed = blocked ? undefined : embedAllowed;
  if (blocked) sourceUrl = undefined;

  const isRealSource = sourceType === "real-post" && sourceUrl !== undefined;

  // A non-linkable clip must not carry a "real post" credit (a stale/tampered
  // row could say "Original post by @chef"). Neutralize attribution when the
  // status is blocked. (source-link-only / embeddable keep their honest credit,
  // including legit creator-profile sources, which are intentionally !isRealSource.)
  const attributionText = blocked
    ? legalDisplayStatus === "unavailable"
      ? `${video.platform} source unavailable`
      : `Illustrative ${video.platform} preview`
    : video.attributionText;

  return {
    ...video,
    embedUrl: finalEmbed,
    sourceUrl,
    legalDisplayStatus,
    isRealSource,
    attributionText,
  };
}

/**
 * Validate + clean an UNTRUSTED value (localStorage, admin input) into a
 * legal-safe Video, or null if it can't be salvaged. Enum fields are coerced to
 * safe defaults, optional strings are kept only when actually non-empty strings,
 * then `enforceVideoInvariants` guarantees the honesty rules hold.
 */
export function normalizeVideo(raw: unknown): Video | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  // id is the one field we can't invent — without it there's nothing to key on.
  if (typeof r.id !== "string" || r.id.trim() === "") return null;

  const platform: Platform = inSet(PLATFORMS, r.platform) ? r.platform : "Web";
  const sourceType: VideoSourceType = inSet(SOURCE_TYPES, r.sourceType)
    ? r.sourceType
    : "placeholder";
  const matchConfidence: MatchConfidence = inSet(MATCH_CONFIDENCES, r.matchConfidence)
    ? r.matchConfidence
    : "manual";
  const legalDisplayStatus: LegalDisplayStatus = inSet(LEGAL_STATUSES, r.legalDisplayStatus)
    ? r.legalDisplayStatus
    : "placeholder-only";

  const draft: Video = {
    id: r.id.trim(),
    platform,
    sourceUrl: optionalString(r.sourceUrl),
    embedUrl: optionalString(r.embedUrl),
    creatorHandle: optionalString(r.creatorHandle) ?? "@unknown",
    creatorDisplayName: optionalString(r.creatorDisplayName),
    caption: typeof r.caption === "string" ? r.caption : "",
    thumbnailUrl: optionalString(r.thumbnailUrl),
    attributionText: optionalString(r.attributionText) ?? `${platform} preview`,
    publishedAt: optionalString(r.publishedAt),
    discoveredAt: optionalString(r.discoveredAt),
    isRealSource: false, // recomputed below
    sourceType,
    matchConfidence,
    legalDisplayStatus,
  };

  return enforceVideoInvariants(draft);
}
