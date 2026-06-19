/**
 * Restaurant brand-logo fallback via Logo.dev (a domain-based logo CDN).
 *
 * This powers the MIDDLE tier of the profile hero: when a restaurant has no
 * Google Place Photo but does have a known official `websiteDomain`, the hero
 * shows its brand logo instead of the generic placeholder. Hero priority:
 *   Google Place Photo  ->  brand logo  ->  FoodSwipe placeholder.
 *
 * Legal-safe contract (same as Place Photos): we NEVER download, store, crop, or
 * rehost the logo. We only build a Logo.dev image URL; the browser loads the
 * image DIRECTLY from Logo.dev's CDN.
 *
 * Token: Logo.dev's image endpoint uses a PUBLISHABLE token (`pk_...`) that is
 * meant to appear in image URLs. We read it from `LOGODEV_TOKEN` — a normal
 * (NON-`NEXT_PUBLIC_`) env var — so it isn't inlined into the client JS bundle;
 * this helper runs server-side (called from the profile server component) and
 * the finished URL is passed to the client hero as a prop. The token is still
 * visible inside that image URL in the page, which is expected and acceptable
 * for a publishable logo-CDN token. With no token set, no logo URL is produced
 * and the hero falls back cleanly to the placeholder.
 */

const LOGO_HOST = "https://img.logo.dev";

/** Reduce a stored domain to a bare, validated host (no scheme, path, or www). */
function normalizeDomain(domain: string | undefined | null): string | null {
  if (typeof domain !== "string") return null;
  const host = domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
  // Plain domain only (labels + a TLD); guards against anything URL-breaking.
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
}

/**
 * Build a Logo.dev image URL for a restaurant's official domain, or `null` when
 * there's no token, no domain, or the domain is malformed. The returned URL is
 * loaded directly by the browser (never proxied/rehosted by us).
 */
export function logoUrl(domain: string | undefined | null): string | null {
  const token = process.env.LOGODEV_TOKEN;
  if (typeof token !== "string" || token.trim().length === 0) return null;
  const host = normalizeDomain(domain);
  if (!host) return null;
  const params = new URLSearchParams({
    token: token.trim(),
    size: "240",
    format: "png",
    retina: "true",
  });
  return `${LOGO_HOST}/${host}?${params.toString()}`;
}
