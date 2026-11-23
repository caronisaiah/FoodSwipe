import { and, desc, eq, gte, lt, or, sql, type SQL } from "drizzle-orm";
import { auditCategory, isAuditAction, isAuditResourceType, type AdminEventView } from "@/lib/adminAudit";
import { getDb, isDbConfigured } from "./index";
import { adminEvents, type AdminEventRow } from "./schema";

export { isDbConfigured };

/**
 * READ-ONLY access to the audit log. There is deliberately no function here (or anywhere in the app) that
 * updates or deletes an event; the database also rejects it (migration 0013 triggers).
 */

export interface AuditEventFilters {
  /** Matches the primary resource id, the related resource id, or a video candidate id in `details`. */
  resourceId?: string;
  resourceType?: string;
  action?: string;
  actor?: string;
  requestId?: string;
  /** ISO timestamp: only events at or after it. */
  since?: string;
  /** Cursor: only events with seq strictly below it (newest-first paging). */
  before?: number;
  limit?: number;
}

const SENSITIVE_KEY = /secret|token|password|passwd|authorization|api[-_]?key|credential/i;

/** Defence in depth: nothing is ever written under such a key, but never return one if it somehow exists. */
function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function rowToView(row: AdminEventRow): AdminEventView {
  return {
    id: row.id,
    seq: Number(row.seq),
    occurredAt: row.occurredAt.toISOString(),
    action: row.action,
    category: auditCategory(row.action),
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    relatedResourceType: row.relatedResourceType ?? null,
    relatedResourceId: row.relatedResourceId ?? null,
    actorIdentity: row.actorIdentity,
    authScope: row.authScope,
    actorAssurance: row.actorAssurance,
    requestId: row.requestId,
    changes: redact(row.changes ?? {}) as AdminEventView["changes"],
    details: redact(row.details ?? {}) as Record<string, unknown>,
    reason: row.reason ?? null,
  };
}

export interface AuditEventPage {
  events: AdminEventView[];
  /** Pass as `before` to fetch the next (older) page; null when there are no more. */
  nextBefore: number | null;
}

export async function listAdminEvents(filters: AuditEventFilters = {}): Promise<AuditEventPage> {
  const db = getDb();
  if (!db) return { events: [], nextBefore: null };
  const limit = Math.min(Math.max(Math.trunc(filters.limit ?? 50), 1), 100);
  const conds: (SQL | undefined)[] = [];
  if (filters.resourceId) {
    conds.push(or(
      eq(adminEvents.resourceId, filters.resourceId),
      eq(adminEvents.relatedResourceId, filters.resourceId),
      sql`${adminEvents.details} ->> 'videoCandidateId' = ${filters.resourceId}`,
    ));
  }
  if (filters.resourceType && isAuditResourceType(filters.resourceType)) conds.push(eq(adminEvents.resourceType, filters.resourceType));
  if (filters.action && isAuditAction(filters.action)) conds.push(eq(adminEvents.action, filters.action));
  if (filters.actor) conds.push(eq(adminEvents.actorIdentity, filters.actor));
  if (filters.requestId) conds.push(eq(adminEvents.requestId, filters.requestId));
  if (filters.since) conds.push(gte(adminEvents.occurredAt, new Date(filters.since)));
  if (typeof filters.before === "number") conds.push(lt(adminEvents.seq, filters.before));
  const rows = await db
    .select()
    .from(adminEvents)
    .where(and(...conds))
    .orderBy(desc(adminEvents.seq))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return {
    events: page.map(rowToView),
    nextBefore: rows.length > limit ? Number(page[page.length - 1].seq) : null,
  };
}

/** True when the append-only triggers from migration 0013 are present on admin_events. */
export async function auditLogIsAppendOnly(): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  const result = await db.execute(sql`
    select count(*)::int as n from pg_trigger
    where tgrelid = 'admin_events'::regclass and not tgisinternal and tgname like 'admin_events_no_%'`);
  const rows = (result as unknown as { rows: { n: number }[] }).rows;
  return Number(rows[0]?.n ?? 0) >= 2;
}
