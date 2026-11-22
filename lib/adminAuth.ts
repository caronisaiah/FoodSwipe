import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Admin credentials for the internal routes.
 *
 * NOT a user-account system. Two shared secrets, sent as the `x-foodswipe-admin-secret` header:
 *
 *  - `FOODSWIPE_ADMIN_SECRET`        -> scope "publish": the human administrator. Unchanged, so
 *                                       existing operators keep full access.
 *  - `FOODSWIPE_ADMIN_DRAFT_SECRET`  -> scope "draft": for ingestion agents. Can read records and
 *                                       prepare drafts (import/create/edit candidates and video
 *                                       candidates). It can never approve, promote, attach, hide,
 *                                       edit published records or touch live videos.
 *
 * Rules that must hold:
 *  - A credential that matches neither secret is rejected. There is NO fallback from an invalid
 *    draft credential to the publish credential, and no scope is ever inferred.
 *  - The draft secret is ignored (draft access stays disabled) when it is unset, shorter than
 *    MIN_DRAFT_SECRET_LENGTH, or identical to the publish secret, because an identical value
 *    would silently make the "draft" credential all-powerful.
 *  - Comparison is constant time: both inputs are hashed to a fixed length with SHA-256 and
 *    compared with timingSafeEqual, and both secrets are always compared (no short circuit).
 *  - Secret values are never logged or returned.
 */
export const ADMIN_SECRET_HEADER = "x-foodswipe-admin-secret";
export const MIN_DRAFT_SECRET_LENGTH = 16;

export type AdminScope = "draft" | "publish";

export type AdminAuthResult =
  | { ok: true; scope: AdminScope }
  | { ok: false; reason: "not-configured" | "unauthorized" };

/** Admin routes are enabled only when the publish secret exists (draft access never enables them alone). */
export function isAdminConfigured(): boolean {
  return Boolean(process.env.FOODSWIPE_ADMIN_SECRET);
}

/** The usable draft secret, or undefined when it is unset, too short or equal to the publish secret. */
export function getDraftSecret(): string | undefined {
  const draft = process.env.FOODSWIPE_ADMIN_DRAFT_SECRET;
  const publish = process.env.FOODSWIPE_ADMIN_SECRET;
  if (!draft || draft.length < MIN_DRAFT_SECRET_LENGTH) return undefined;
  if (publish && draft === publish) return undefined;
  return draft;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Constant-time equality of two strings of any length. */
export function secretsMatch(provided: string, expected: string): boolean {
  return timingSafeEqual(digest(provided), digest(expected));
}

export function authenticateAdmin(req: Request): AdminAuthResult {
  const publish = process.env.FOODSWIPE_ADMIN_SECRET;
  if (!publish) return { ok: false, reason: "not-configured" };
  const provided = req.headers.get(ADMIN_SECRET_HEADER) ?? "";
  const draft = getDraftSecret();
  // Evaluate both comparisons before branching so timing does not reveal which one matched.
  const isPublish = secretsMatch(provided, publish);
  const isDraft = draft ? secretsMatch(provided, draft) : false;
  if (provided.length === 0) return { ok: false, reason: "unauthorized" };
  if (isPublish) return { ok: true, scope: "publish" };
  if (isDraft) return { ok: true, scope: "draft" };
  return { ok: false, reason: "unauthorized" };
}

/**
 * Backward-compatible check: true ONLY for the publish credential. Kept so any caller that was
 * not migrated fails closed for draft credentials instead of granting them access.
 */
export function hasValidAdminSecret(req: Request): boolean {
  const result = authenticateAdmin(req);
  return result.ok && result.scope === "publish";
}
