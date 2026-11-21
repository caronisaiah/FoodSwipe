/** Where a person came from when they opened a profile. A bounded set of words, never a URL. */
export type ProfileOrigin = "map" | "saved" | "feed";

export const PROFILE_ORIGINS: Record<ProfileOrigin, { label: string; href: string }> = {
  map: { label: "Map", href: "/map" },
  saved: { label: "Saved", href: "/saved" },
  feed: { label: "Swipe", href: "/feed" },
};

/** The `?from=` value if it is one of the known words; anything else (a URL, another word) is ignored. */
export function parseProfileOrigin(value: unknown): ProfileOrigin | null {
  return typeof value === "string" && Object.hasOwn(PROFILE_ORIGINS, value) ? (value as ProfileOrigin) : null;
}
