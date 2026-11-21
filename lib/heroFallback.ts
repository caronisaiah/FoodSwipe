/**
 * What fills a photo-led hero before its photograph is on screen.
 *
 * - "none"     the photograph is displayed.
 * - "neutral"  a stable neutral surface: the lookup or the image is still on its way. A photograph that is merely
 *              slow never becomes a logo, because a logo that is replaced a moment later reads as a flash.
 * - "logo"     there is no photograph to wait for (none exists, or it really failed) and the restaurant has a logo.
 * - "unavailable" the same, with no logo: the honest "photo unavailable" surface.
 */
export type HeroFallback = "none" | "neutral" | "logo" | "unavailable";

export function heroFallbackKind(input: {
  /** The photo lookup has answered. */
  resolved: boolean;
  /** A photograph exists and has not failed (it may still be loading). */
  photoPending: boolean;
  /** That photograph has loaded and is displayed. */
  displayed: boolean;
  hasLogo: boolean;
}): HeroFallback {
  if (input.displayed) return "none";
  if (!input.resolved || input.photoPending) return "neutral";
  return input.hasLogo ? "logo" : "unavailable";
}
