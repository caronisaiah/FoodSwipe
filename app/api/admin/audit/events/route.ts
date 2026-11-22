import { adminError, adminJson } from "@/lib/adminApi";
import { guardAdmin } from "@/lib/adminGuard";
import { AUDIT_ACTIONS, AUDIT_RESOURCE_TYPES, isAuditAction, isAuditResourceType } from "@/lib/adminAudit";
import { auditLogIsAppendOnly, listAdminEvents } from "@/lib/db/auditEvents";

/*
  GET /api/admin/audit/events  (INTERNAL, PUBLICATION credential only, read-only)

  The audit history. The draft credential is refused (403): draft agents prepare records, and the log of who
  changed what, with before/after values, is an administrator's record. There is no write, edit or delete
  route for events anywhere.

  Filters (all optional, combined with AND):
    resourceId    a restaurant candidate / published restaurant / video candidate / published video id.
                  Matches events ABOUT that record and events RELATED to it (e.g. a promotion shows up
                  under both the new restaurant and its source candidate).
    resourceType  restaurant_candidate | restaurant | video_candidate | restaurant_video
    action        one taxonomy action, e.g. restaurant_video.restored
    actor         a credential label, e.g. publish-credential
    requestId     every event written by one request
    days          only the last N days (1-365)  — "recent activity"
    before        cursor from the previous page's nextBefore
    limit         1-100 (default 50)
  Newest first. 200 -> { events, nextBefore, integrity, requester }.

  What the events mean: `actorIdentity` names the shared credential that authenticated the request. It is
  not a verified person. `actorAssurance` says so on every event.
*/
export async function GET(req: Request): Promise<Response> {
  const auth = guardAdmin(req, "publish");
  if (!auth.ok) return auth.response;

  const params = new URL(req.url).searchParams;
  const resourceType = params.get("resourceType") ?? undefined;
  if (resourceType && !isAuditResourceType(resourceType)) {
    return adminError(422, "invalid_resource_type", `resourceType must be one of: ${AUDIT_RESOURCE_TYPES.join(", ")}.`, { field: "resourceType" });
  }
  const action = params.get("action") ?? undefined;
  if (action && !isAuditAction(action)) {
    return adminError(422, "invalid_action", `action must be one of: ${AUDIT_ACTIONS.join(", ")}.`, { field: "action" });
  }
  const limitParam = params.get("limit");
  const limit = limitParam === null ? 50 : Number(limitParam);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return adminError(422, "invalid_limit", "limit must be an integer from 1 to 100.", { field: "limit" });
  }
  const beforeParam = params.get("before");
  const before = beforeParam === null ? undefined : Number(beforeParam);
  if (before !== undefined && (!Number.isInteger(before) || before < 1)) {
    return adminError(422, "invalid_cursor", "before must be a positive integer (the nextBefore of a previous page).", { field: "before" });
  }
  const daysParam = params.get("days");
  let since: string | undefined;
  if (daysParam !== null) {
    const days = Number(daysParam);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return adminError(422, "invalid_days", "days must be an integer from 1 to 365.", { field: "days" });
    }
    since = new Date(Date.now() - days * 86_400_000).toISOString();
  }
  const text = (name: string, max = 200) => {
    const v = params.get(name)?.trim();
    return v && v.length <= max ? v : undefined;
  };

  try {
    const [page, appendOnly] = await Promise.all([
      listAdminEvents({ resourceId: text("resourceId"), resourceType, action, actor: text("actor", 60), requestId: text("requestId", 80), since, before, limit }),
      auditLogIsAppendOnly().catch(() => false),
    ]);
    return adminJson({
      events: page.events,
      nextBefore: page.nextBefore,
      integrity: { appendOnlyTriggersPresent: appendOnly },
      requester: { identity: auth.actor.identity, scope: auth.actor.scope, assurance: auth.actor.assurance },
    });
  } catch {
    return adminError(500, "audit_read_failed", "Could not read the audit history.", { retryable: true });
  }
}
