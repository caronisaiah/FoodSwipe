import { detectPlatform } from "@/lib/socialVideo";
import type { DiscoveryPlatform } from "./queryGenerator";
import type { RawSearchResult, SearchProviderName } from "./searchProvider";

/**
 * Normalize raw search results into DiscoveryLead shapes (server-only). Pure:
 * detects the platform from the URL and shapes the lead; NON-social URLs are
 * dropped (Slice 2 focuses on TikTok/Instagram/YouTube leads). Resolver fields
 * are left "not-run" — the route fills them by calling resolveSocialVideo.
 * No media is parsed; no thumbnails are downloaded.
 */

export type DetectedPlatform = "tiktok" | "instagram" | "youtube";
export type LeadResolverStatus = "not-run" | "resolved" | "failed" | "source-link-only";

export interface DiscoveryLead {
  key: string;
  title: string;
  url: string;
  snippet: string;
  provider: SearchProviderName;
  rank: number;
  query: string;
  platformTarget: DiscoveryPlatform | null;
  detectedPlatform: DetectedPlatform | null;
  resolverStatus: LeadResolverStatus;
  resolverError?: string;
  canonicalUrl?: string | null;
  normalizedSourceUrl?: string | null;
  platformVideoId?: string | null;
  embedUrl?: string | null;
  legalDisplayStatus?: string | null;
  matchConfidence?: number;
  matchReasons?: string[];
  warnings?: string[];
}

/** Derive the intended platform from a query's `site:` filter (or web). */
export function platformTargetFromQuery(query: string): DiscoveryPlatform | null {
  const s = query.toLowerCase();
  if (s.includes("site:tiktok.com")) return "tiktok";
  if (s.includes("site:instagram.com")) return "instagram";
  if (s.includes("site:youtube.com") || s.includes("youtu.be")) return "youtube";
  if (s.includes("site:")) return null; // some other site filter
  return "web";
}

/** Map detectPlatform's broader Platform union to our lead platform (or null). */
function toDetected(p: ReturnType<typeof detectPlatform>): DetectedPlatform | null {
  return p === "tiktok" || p === "instagram" || p === "youtube" ? p : null;
}

/** One raw result → a social DiscoveryLead, or null if the URL isn't social. */
export function normalizeLead(
  raw: RawSearchResult,
  platformTarget: DiscoveryPlatform | null,
): DiscoveryLead | null {
  const detected = toDetected(detectPlatform(raw.url));
  if (!detected) return null; // drop non-social URLs
  return {
    key: `${detected}:${raw.url}`,
    title: raw.title,
    url: raw.url,
    snippet: raw.description,
    provider: raw.provider,
    rank: raw.rank,
    query: raw.query,
    platformTarget,
    detectedPlatform: detected,
    resolverStatus: "not-run",
    canonicalUrl: null,
    normalizedSourceUrl: null,
    platformVideoId: null,
    embedUrl: null,
    legalDisplayStatus: null,
  };
}

/** Stable key for de-duplication before the resolver runs (host+path, no query). */
export function simpleUrlKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "").toLowerCase()}`;
  } catch {
    return url.trim().toLowerCase();
  }
}
