export const LEGACY_INTERNAL_IMPORT_REASON_TEXT =
  "Imported candidate; suggested tags are based on Google type/name/query and need human review.";

export const PROMOTED_REASON_TEXT_FALLBACK =
  "A promising spot to explore, with more FoodSwipe notes coming soon.";

function normalizeReasonText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function isInternalImportReasonText(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  return normalizeReasonText(value) === normalizeReasonText(LEGACY_INTERNAL_IMPORT_REASON_TEXT);
}

export function cleanPublicReasonText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || isInternalImportReasonText(text)) return null;
  return text;
}

export function publicReasonTextOrFallback(value: string | null | undefined): string {
  return cleanPublicReasonText(value) ?? PROMOTED_REASON_TEXT_FALLBACK;
}
