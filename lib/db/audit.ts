import { getTableColumns, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { getDb } from "./index";
import { adminEvents } from "./schema";
import { AUDIT_VALUE_CLIP_LENGTH, containsConfiguredSecret, type AuditAction, type AuditContext, type AuditResourceType } from "@/lib/adminAudit";

/**
 * Atomic audited writes.
 *
 * The production driver (Neon HTTP) has no interactive transactions, but ONE SQL statement is atomic. So
 * every consequential admin mutation is a single statement built from data-modifying CTEs:
 *
 *   with prev as (select ... for update),          -- the row as it was (updates only)
 *        cur  as (update|insert ... returning *),  -- the change itself
 *        ev   as (insert into admin_events ... select ... from cur)   -- the audit event
 *   select to_jsonb(cur) ...
 *
 * Either the change AND its event are committed, or neither is: an audit failure (constraint, trigger,
 * lost connection) aborts the whole statement, so a mutation can never succeed silently without its
 * event, and an event can never describe a change that did not happen. Nothing here swallows errors.
 *
 * The event is written only when something meaningful changed: the diff is computed INSIDE the statement
 * from the real before/after rows (not from a client-supplied or earlier-read copy), so a no-op edit, a
 * repeated request or a lost race writes no event, and the recorded "from" values are the true previous
 * values even under concurrency.
 *
 * Only allow-listed columns (lib/adminAudit AUDIT_FIELDS) are diffed, so a column that is not listed can
 * never leak into the log. Values over 400 characters are clipped.
 */

type Db = NonNullable<ReturnType<typeof getDb>>;
type Row = Record<string, unknown>;

/** Run a raw statement on the live (or, in tests, the isolated) database. */
export async function executeRows(query: SQL): Promise<Row[]> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL not configured");
  const result = await (db as Db).execute(query);
  return (result as unknown as { rows: Row[] }).rows;
}

export interface ActionRule {
  /** snake_case column that changed */
  field: string;
  /** when set, the rule applies only if the NEW value equals this */
  to?: string;
  action: AuditAction;
}

export interface AuditSpec {
  ctx: AuditContext;
  resourceType: AuditResourceType;
  /** Column of the changed row that holds the resource id. Default "id". */
  resourceIdColumn?: string;
  /** Allow-listed snake_case columns to diff. */
  fields: readonly string[];
  /** Action when no rule matches. */
  action: AuditAction;
  /** First matching rule wins; evaluated against the in-statement diff. */
  rules?: ActionRule[];
  related?: { type: AuditResourceType; id: SQL };
  details?: Record<string, unknown>;
}

/** Bound `details` to what the table constraint allows, never failing the write over a long note. */
function detailsJson(ctx: AuditContext, extra?: Record<string, unknown>): string {
  const merged = { ...(ctx.details ?? {}), ...(extra ?? {}) };
  const text = JSON.stringify(merged);
  return text.length <= 3500 ? text : JSON.stringify({ _truncated: true });
}

function actionExpr(spec: AuditSpec): SQL {
  const rules = spec.rules ?? [];
  if (rules.length === 0) return sql`${spec.action}::text`;
  const whens = rules.map((r) =>
    r.to === undefined
      ? sql`when jsonb_exists(x.d, ${r.field}::text) then ${r.action}::text`
      : sql`when jsonb_exists(x.d, ${r.field}::text) and (x.d -> ${r.field}::text) ->> 'to' = ${r.to}::text then ${r.action}::text`,
  );
  return sql`case ${sql.join(whens, sql` `)} else ${spec.action}::text end`;
}

/**
 * The `insert into admin_events ... select ...` body of the `ev` CTE.
 *   prev: "none" (creation), "required" (update: needs a before row) or "optional" (before row may be absent)
 * `requireChange` suppresses the event when the diff is empty.
 */
function eventInsert(spec: AuditSpec, prev: "none" | "required" | "optional", requireChange: boolean): SQL {
  const fieldsJson = JSON.stringify(spec.fields);
  const from = prev === "required" ? sql`prev cross join cur` : prev === "optional" ? sql`cur left join prev on true` : sql`cur`;
  const prevJson = prev === "none" ? sql`'{}'::jsonb` : sql`coalesce(to_jsonb(prev), '{}'::jsonb)`;
  const idCol = sql.identifier(spec.resourceIdColumn ?? "id");
  const relType = spec.related ? sql`${spec.related.type}::text` : sql`null::text`;
  const relId = spec.related ? sql`(${spec.related.id})::text` : sql`null::text`;
  const diff = sql`select coalesce(jsonb_object_agg(f.key, jsonb_build_object(
        'from', ${clipValue(sql`r.p -> f.key`)}, 'to', ${clipValue(sql`r.c -> f.key`)})), '{}'::jsonb) as d
      from (select ${prevJson} as p, to_jsonb(cur) as c) r, jsonb_array_elements_text(${fieldsJson}::jsonb) as f(key)
      where coalesce(r.p -> f.key, 'null'::jsonb) is distinct from coalesce(r.c -> f.key, 'null'::jsonb)`;
  return sql`insert into ${adminEvents} (
      id, action, resource_type, resource_id, related_resource_type, related_resource_id,
      actor_identity, auth_scope, actor_assurance, request_id, changes, details, reason
    )
    select gen_random_uuid()::text, ${actionExpr(spec)}, ${spec.resourceType}::text, cur.${idCol}::text, ${relType}, ${relId},
      ${spec.ctx.actor.identity}::text, ${spec.ctx.actor.scope}::text, ${spec.ctx.actor.assurance}::text, ${spec.ctx.requestId}::text,
      x.d, ${detailsJson(spec.ctx, spec.details)}::jsonb, ${spec.ctx.reason ?? null}::text
    from ${from}
    cross join lateral (${diff}) x
    ${requireChange ? sql`where x.d <> '{}'::jsonb` : sql``}
    returning id`;
}

/** Inline clip of a jsonb expression: long values become { _clipped, length, preview }. */
function clipValue(expr: SQL): SQL {
  return sql`(case
    when (${expr}) is null then 'null'::jsonb
    when length((${expr})::text) > ${sql.raw(String(AUDIT_VALUE_CLIP_LENGTH))} then jsonb_build_object('_clipped', true, 'length', length((${expr})::text), 'preview', left((${expr})::text, 120))
    else (${expr}) end)`;
}

/** Decode a `to_jsonb(row)` result back into the Drizzle row shape (camelCase keys, Date timestamps). */
export function decodeRow<T extends PgTable>(table: T, raw: unknown): T["$inferSelect"] {
  const obj = (typeof raw === "string" ? JSON.parse(raw) : raw) as Row;
  const out: Row = {};
  for (const [key, col] of Object.entries(getTableColumns(table))) {
    const value = obj[col.name];
    out[key] = value === undefined || value === null ? null : col.dataType === "date" ? new Date(value as string) : value;
  }
  return out as T["$inferSelect"];
}

/**
 * Defence in depth: refuse to write (or to record in the audit log) anything that contains a configured
 * admin credential verbatim, whichever field it was pasted into. Throws before any SQL runs.
 */
function refuseCredentials(label: string, payload: unknown): void {
  if (containsConfiguredSecret(JSON.stringify(payload) ?? "")) {
    throw new Error(`Refusing to write ${label}: it contains a configured admin credential.`);
  }
}

export interface AuditedResult<T extends PgTable> {
  row: T["$inferSelect"];
  /** Id of the audit event written in the same statement, or null when nothing meaningful changed. */
  eventId: string | null;
  /** False when an update found the row already holding every requested value (nothing was written). */
  changed: boolean;
}

/**
 * UPDATE the rows matching `where` and record ONE event if (and only if) an allow-listed field actually
 * changes. Returns null when no row matched.
 *
 * A genuine no-op (every value in `set` already equals the stored value) does NOT touch the row: the UPDATE
 * is guarded by "some value differs", so `updated_at` is not bumped and no event is written. The unchanged
 * row is returned with `changed: false`.
 *
 * Every column in `set` (other than updated_at) must be on the audit allow-list; otherwise a change could
 * be written without being recorded, so this throws before any SQL runs.
 */
export async function auditedUpdate<T extends PgTable>(args: {
  table: T;
  where: SQL;
  set: Partial<T["$inferInsert"]>;
  audit: AuditSpec;
}): Promise<AuditedResult<T> | null> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL not configured");
  const { table, where, set, audit } = args;
  refuseCredentials("an update", [set, audit.ctx.reason, audit.ctx.details, audit.details]);
  const columns = getTableColumns(table) as Record<string, PgColumn>;
  const differs: SQL[] = [];
  for (const [prop, value] of Object.entries(set as Record<string, unknown>)) {
    if (prop === "updatedAt" || value === undefined) continue;
    const column = columns[prop];
    if (!column || !audit.fields.includes(column.name)) {
      throw new Error(`Refusing an unaudited write to ${String(prop)}: it is not on the audit allow-list.`);
    }
    differs.push(sql`${column} is distinct from ${sql.param(value, column)}`);
  }
  const somethingChanges = differs.length ? sql` and (${sql.join(differs, sql` or `)})` : sql``;
  // `prev` locks and reads the rows to change; the UPDATE is restricted to the rows `prev` returned, which
  // forces `prev` to run first. So `prev` is the true latest committed "before" image even when a
  // concurrent edit raced us, and it is never skipped as "already updated by this statement".
  const key = columns.id;
  const update = (db as Db).update(table).set(set as never)
    .where(sql`${where} and ${key} in (select ${sql.identifier(key.name)} from prev)${somethingChanges}`).returning();
  const rows = await executeRows(sql`
    with prev as (select * from ${table} where ${where} for update),
    cur as ${update},
    ev as (${eventInsert(audit, "required", true)})
    select to_jsonb(cur) as row, (select id from ev limit 1) as event_id, true as changed from cur
    union all
    select to_jsonb(prev), null, false from prev where not exists (select 1 from cur)`);
  const first = rows[0];
  if (!first) return null;
  return { row: decodeRow(table, first.row), eventId: (first.event_id as string | null) ?? null, changed: first.changed === true };
}

/** INSERT one row and record its creation event in the same statement. */
export async function auditedInsert<T extends PgTable>(args: {
  table: T;
  values: T["$inferInsert"];
  audit: AuditSpec;
}): Promise<AuditedResult<T>> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL not configured");
  const { table, values, audit } = args;
  refuseCredentials("an insert", [values, audit.ctx.reason, audit.ctx.details, audit.details]);
  const insert = (db as Db).insert(table).values(values as never).returning();
  const rows = await executeRows(sql`
    with cur as ${insert},
    ev as (${eventInsert(audit, "none", false)})
    select to_jsonb(cur) as row, (select id from ev limit 1) as event_id from cur`);
  const first = rows[0];
  if (!first) throw new Error("Audited insert returned no row.");
  return { row: decodeRow(table, first.row), eventId: (first.event_id as string | null) ?? null, changed: true };
}

/** Exposed for statements that compose their own data CTEs (attach, hero upsert/clone). */
export const auditSql = { eventInsert };

/**
 * A published video's related resource is the restaurant it belongs to. `restaurant_videos.restaurant_id`
 * holds the restaurant's public slug, so the stable id is looked up inside the statement.
 */
export const VIDEO_RESTAURANT_RELATED = {
  type: "restaurant" as const,
  id: sql`(select r.id from restaurants r where r.slug = cur.restaurant_id)`,
};
