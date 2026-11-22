# Admin audit log

Admin Hardening B. A persistent, append-only record of consequential admin changes.

## What is recorded
One row in `admin_events` per **meaningful, successful** change: event id, database timestamp, action, resource type and **stable** resource id, an optional related resource (e.g. a promotion lists its source candidate), the credential identity and scope, `actorAssurance`, a request correlation id, allow-listed changed fields as `{field: {from, to}}`, a small `details` object, and an optional human `reason`. A rejected request, a rolled-back statement, a repeated request and an edit that changes nothing write **no** event, and a genuine no-op update does not touch the row either (`updated_at` is not bumped).

Never recorded: credential values, auth headers, environment values, raw request bodies, provider/resolver payloads, anything not on the allow-list in `lib/adminAudit.ts` (`AUDIT_FIELDS`). Values over 400 characters are clipped to `{_clipped, length, preview(120)}` (so an event with every allow-listed field changed stays far below the database's 24 KB bound, which rejects anything larger). Free-text `auditReason` is limited to 1000 characters, stripped of control characters, and refused if it contains a configured admin credential; the same credential check is applied to every audited write's values, reason and details (the write is refused, not logged). Anything else a person types into a note is stored as typed: do not paste secrets or personal data into notes.

## Action taxonomy (`<resource>.<verb>`)
| Category | Actions |
|---|---|
| draft modification | `restaurant_candidate.created / updated / market_changed / status_changed / hero_cleared`, `video_candidate.created / updated / status_changed` |
| approval | `restaurant_candidate.approved / rejected / hero_selected`, `video_candidate.approved / rejected` |
| publication | `restaurant.promoted`, `restaurant.hero_inherited`, `restaurant_video.attached`, `restaurant_video.added_direct` |
| edit | `restaurant.updated`, `restaurant_video.updated` |
| removal | `restaurant.hidden`, `restaurant_video.hidden` |
| recovery | `restaurant.restored`, `restaurant_video.restored` |

A request that changes several fields writes **one** event carrying every changed field; the action is chosen from the real diff (approve/reject beats market change beats status change beats plain edit).

## Atomicity
The Neon HTTP driver has no interactive transactions, so each mutation is **one SQL statement** built from data-modifying CTEs (`lib/db/audit.ts`): `prev` (rows locked and read), the change (`update`/`insert ... returning`), and `ev` (`insert into admin_events ... select ... from <changed row>`). A statement is atomic: if the event cannot be written (constraint, trigger, connection), the change does not happen and the caller gets an error. Nothing is best-effort or swallowed. The diff is computed inside the statement from the true before/after rows, so recorded "from" values are exact and no-ops write nothing. Promotion, attach and hero selection are single multi-table statements, so e.g. the live video, the candidate's `attached` status and the event commit together.

**The three-step direct-add is NOT atomic as a whole.** `POST /api/admin/restaurants/[slug]/videos` runs create, approve and attach as three separate statements; each is individually atomic with its own event, and all share one request id (`details.via = "direct_add"`). Tested on PostgreSQL by failing each step in turn: a failure at attach leaves an **approved, unattached** candidate (events: created, approved); at approve, a `needs_review` candidate (event: created); at create, nothing. The response is a 500, retrying the same URL is refused as a duplicate, and an approved leftover is completed with the normal attach route (which writes its own `restaurant_video.attached` event). The log always describes exactly what happened; it never shows an attach that did not occur.

## Reading it
`GET /api/admin/audit/events` (publication credential only; a draft credential gets 403 and no data). Filters: `resourceId` (matches the record, records related to it, and a video candidate id in `details`), `resourceType`, `action`, `actor`, `requestId`, `days` (recent activity), `before` (cursor), `limit`. Screen: `/admin/audit` (deep link `?resource=<id>`). There is no write, edit or delete route; the database rejects `UPDATE`, `DELETE` and `TRUNCATE` on the table.

## What the guarantees do and do not cover
- **Proves:** a request carrying credential X changed record R from A to B at time T, and that the change and the record of it were committed together.
- **Does not prove:** which person (or which agent, when several share the draft secret) made the request, or that a human reviewed content. An `approved` event means "the publication credential approved this". Treat it as accountability for the credential holder.
- **Tamper resistance:** the application role cannot edit or delete events (triggers). A database owner/superuser, or anyone with DDL rights, can drop the triggers or the table; Neon project access should be treated as the trust boundary. External log shipping would close that gap.
- Writes made **outside the app** (SQL editor, `scripts/admin-video-association-mapping.mjs --apply`, `scripts/stage-nyc-map-approvals.sql`) bypass the log.
- No history before migration 0013 exists and none is invented: events are never backfilled.

## Publication-readiness checks
At promotion (`lib/publicationChecks.ts`, read-only). A *warning* needs `override: {acknowledge: [codes], reason}` (reason ≥ 10 chars) in the promote request; both are stored on the `restaurant.promoted` event. Warnings: `coordinates_outside_market` (pin > 60 miles from its market centre; names the nearer market if any), `missing_place_identity`, `malformed_place_identity`, `possible_duplicate`. Informational only: `place_identity_unverified`, `same_name_other_location`, `same_address_different_name`. Nothing is rejected or merged automatically; chains and food halls are expected. Invalid coordinates (non-finite, out of range, 0,0) and missing required fields still block outright.

## Published video corrections and recovery
`PATCH /api/admin/videos/[id]` changes only `creatorHandle`, `creatorDisplayName`, `attributionText`. Source URL, platform, embed URL, caption, legal display status and the restaurant are refused by name. `DELETE` hides (soft), `POST /api/admin/videos/[id]/restore` restores; both idempotent. Screen: `/admin/videos/published`.

## Migration 0013
File: `drizzle/0013_admin_events.sql` (+ journal entry and snapshot). Creates `admin_events` (constraints, 5 indexes) and the append-only trigger function and triggers. It touches no existing table and writes no rows.

**Apply** with the whole file, in one transaction: `psql "$DATABASE_URL" -1 -f drizzle/0013_admin_events.sql` (or run it in the Neon SQL editor as one script). Do **not** rely on `drizzle-kit push`: it would create the table but not the triggers. Verify afterwards: `select count(*) from pg_trigger where tgrelid = 'admin_events'::regclass and not tgisinternal;` returns 2 (the audit screen also shows "Append-only protection active").
**Order:** apply the migration **before** deploying this code. Until the table exists every audited mutation fails closed (500) rather than succeeding unaudited.
**Roll back** (only if no events must be kept; this destroys the audit history):
```sql
BEGIN;
DROP TABLE admin_events;            -- drops its triggers and indexes
DROP FUNCTION admin_events_reject_change();
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);  -- only if the migrator recorded 0013 (it is the latest row)
COMMIT;
```
Rolling the **code** back without dropping the table is safe: older code never touches `admin_events`.

## Tests
`npm run test:admin-audit` (pure checks + PostgreSQL integration on PGlite, an in-process real PostgreSQL; no network, no production). `npm run test:admin-authz` covers the route/credential matrix including the new routes.
