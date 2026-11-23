/**
 * Shared response helpers for the internal admin API.
 *
 * Error shape (backward compatible with the existing UI, which reads `error` as a string):
 *   { error: string, code: string, field?: string, errors?: FieldError[], retryable?: boolean, ... }
 * Every admin response is `Cache-Control: no-store`. Messages never contain secrets, SQL or stack
 * traces.
 */
export interface FieldError {
  field: string;
  code: string;
  message: string;
}

const HEADERS = { "Cache-Control": "no-store" } as const;

export function adminJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: HEADERS });
}

export function adminError(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  return Response.json({ error: message, code, ...extra }, { status, headers: HEADERS });
}

/** 422 with one entry per invalid field. `error` summarizes the first problem for simple callers. */
export function validationError(errors: FieldError[]): Response {
  const first = errors[0];
  const more = errors.length > 1 ? ` (+${errors.length - 1} more)` : "";
  return adminError(422, "validation_failed", `${first.field}: ${first.message}${more}`, {
    field: first.field,
    errors,
  });
}

/**
 * Absolute URL of the unified review workspace for one restaurant candidate, by its stable id. This is where a
 * candidate's admin links point: identity, details, photos, video leads, readiness and history on one page.
 */
export function candidateReviewUrl(req: Request, candidateId: string): string {
  return new URL(`/admin/restaurants/candidates/${encodeURIComponent(candidateId)}`, new URL(req.url).origin).toString();
}

/**
 * The review page of the restaurant a video lead belongs to, or null. Uses the lead's stable id link when it has one;
 * a lead linked only by a typed slug falls back to the single draft that slug identifies (shown as a proposal, never
 * written), so a reviewer can always get from a lead to its restaurant.
 */
export function reviewUrlFor(
  req: Request,
  candidateRestaurantId: string | null,
  association: { proposedCandidate: { id: string } | null; candidate: { id: string } | null } | null | undefined,
): string | null {
  const id = candidateRestaurantId ?? association?.candidate?.id ?? association?.proposedCandidate?.id ?? null;
  return id ? candidateReviewUrl(req, id) : null;
}

/** Absolute admin URL for a record, using the request's own origin. */
export function adminUrl(req: Request, path: string, params: Record<string, string> = {}): string {
  const url = new URL(path, new URL(req.url).origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}
