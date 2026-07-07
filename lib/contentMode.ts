export const CONTENT_MODES = ["demo", "mixed", "production"] as const;
export type ContentMode = (typeof CONTENT_MODES)[number];

const DEFAULT_CONTENT_MODE: ContentMode = "mixed";
const FAIL_CLOSED_CONTENT_MODE: ContentMode = "production";

let warnedInvalidMode = false;

export function normalizeContentMode(value: unknown): ContentMode | null {
  if (typeof value !== "string") return null;
  const mode = value.trim().toLowerCase();
  return (CONTENT_MODES as readonly string[]).includes(mode)
    ? (mode as ContentMode)
    : null;
}

export function getContentMode(raw = process.env.FOODSWIPE_CONTENT_MODE): ContentMode {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return DEFAULT_CONTENT_MODE;
  }

  const mode = normalizeContentMode(raw);
  if (mode) return mode;

  if (!warnedInvalidMode) {
    warnedInvalidMode = true;
    console.warn(
      `Invalid FOODSWIPE_CONTENT_MODE="${raw}". Falling back to ${FAIL_CLOSED_CONTENT_MODE}.`,
    );
  }
  return FAIL_CLOSED_CONTENT_MODE;
}

export function isProductionContentMode(mode = getContentMode()): boolean {
  return mode === "production";
}

export function shouldIncludeSeedRestaurants(mode = getContentMode()): boolean {
  return !isProductionContentMode(mode);
}
