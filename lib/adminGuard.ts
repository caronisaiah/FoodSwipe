import { authenticateAdmin, type AdminActor, type AdminScope } from "@/lib/adminAuth";
import { newRequestId, type AuditContext } from "@/lib/adminAudit";
import { adminError } from "@/lib/adminApi";
import { isDbConfigured } from "@/lib/db";

/**
 * The single authorization checkpoint for every internal admin route.
 *
 * Order matters and is deliberate: configuration -> authentication -> scope -> database. A denied
 * request returns BEFORE any database call or side effect. `required` is the minimum scope: a
 * "publish" credential satisfies both "draft" and "publish"; a "draft" credential satisfies only
 * "draft". A credential that fails authentication is never retried against another scope.
 */
export type GuardResult =
  | { ok: true; scope: AdminScope; actor: AdminActor; requestId: string }
  | { ok: false; response: Response };

export function guardAdmin(
  req: Request,
  required: AdminScope,
  options: { requireDb?: boolean } = {},
): GuardResult {
  const auth = authenticateAdmin(req);
  if (!auth.ok) {
    if (auth.reason === "not-configured") {
      return {
        ok: false,
        response: adminError(503, "admin_disabled", "Admin API is disabled (FOODSWIPE_ADMIN_SECRET not set)."),
      };
    }
    return { ok: false, response: adminError(401, "unauthorized", "Unauthorized.") };
  }
  if (required === "publish" && auth.scope !== "publish") {
    return {
      ok: false,
      response: adminError(
        403,
        "insufficient_scope",
        "This action requires the publication credential; the draft credential cannot perform it.",
        { requiredScope: "publish", credentialScope: auth.scope },
      ),
    };
  }
  if (options.requireDb !== false && !isDbConfigured()) {
    return {
      ok: false,
      response: adminError(503, "database_unavailable", "Database not configured (DATABASE_URL not set)."),
    };
  }
  return { ok: true, scope: auth.scope, actor: auth.actor, requestId: newRequestId(req) };
}

/**
 * The audit context for the mutations of this request. Every audited db function REQUIRES one, so a
 * mutation cannot be written without saying who did it. `reason` is the optional human-supplied note.
 */
export function auditContext(
  auth: Extract<GuardResult, { ok: true }>,
  extra: { reason?: string | null; details?: Record<string, unknown> } = {},
): AuditContext {
  return { actor: auth.actor, requestId: auth.requestId, reason: extra.reason ?? null, details: extra.details };
}
