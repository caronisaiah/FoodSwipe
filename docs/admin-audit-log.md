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

## Migration 0013 and release sequence
File: `drizzle/0013_admin_events.sql` (+ journal entry and snapshot). Creates `admin_events` (constraints, 5 indexes) and the append-only trigger function and triggers. It touches no existing table and writes no rows. Production's schema is not managed by the drizzle migrator (there is no `drizzle.__drizzle_migrations` table there), and `next build` runs no migrations, so the file must be applied by hand.

### Release order: migration first, code second
1. **Back up** (a Neon branch of production taken immediately before; the plan's point-in-time window is short).
2. **Apply the migration as ONE transaction.** The entire script must run as a single transaction that either commits completely or not at all. It must **never** run as independently committed statements: a failure part-way would leave a half-built table without its append-only triggers. Do **not** use `drizzle-kit push` (it would create the table but not the triggers).
   - **Preferred: psql.** Take the connection string from your password manager or environment (never paste it into chat or commit it) and run:
     ```bash
     psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 --single-transaction -f drizzle/0013_admin_events.sql
     ```
     `--single-transaction` wraps the whole file in `BEGIN` / `COMMIT`, and `ON_ERROR_STOP=1` stops at the first error so nothing is committed. The `--> statement-breakpoint` markers in the file are ordinary SQL comments.
   - **Neon SQL Editor: UNVERIFIED, use psql instead.** Atomic execution of a pasted script through the SQL Editor has not been verified (the editor may submit or split statements on its own). If you must use it, wrap the script explicitly, with `BEGIN;` as the first line, the **entire** file unchanged, and `COMMIT;` as the last line:
     ```sql
     BEGIN;
     -- paste the complete contents of drizzle/0013_admin_events.sql here
     COMMIT;
     ```
     If any statement errors, do not continue: PostgreSQL rolls an errored transaction back at `COMMIT`. Whatever the outcome, run the verification in step 3 and treat any missing table, function or trigger (or a table without both triggers) as a failed migration (recovery B below).
   - What was validated: on a disposable database the exact file was applied and verified inside one transaction using a transaction-wrapped call, and the PostgreSQL tests show that a migration failing part-way leaves nothing behind. psql itself was not run in that validation environment.
3. **Verify**: `select count(*) from pg_trigger where tgrelid = 'admin_events'::regclass and not tgisinternal;` returns 2, and `select count(*) from admin_events;` returns 0.
4. **Only then deploy the code.**

**What happens if the new code runs without migration 0013.** Every audited admin write (create, edit, approve, promote, attach, hide, restore, direct add, hero selection) fails closed: the request returns a 500, **nothing is changed** and nothing succeeds unaudited. Public pages and read endpoints are unaffected, and the audit-history screen reports an error. No data is damaged, so the fix is simply to apply the migration (or roll the code back, below). The migration is not re-runnable once the table exists (`CREATE TABLE` would fail), so check `select to_regclass('admin_events');` first when in doubt.

### Three different recoveries (do not mix them up)

**A. Rolling back the application code (the normal production rollback).**
Redeploy the previous build (or revert the merge). **Leave migration 0013 applied.** The table, every existing event, the indexes and both triggers stay exactly as they are, so the audit history is preserved and still tamper-protected. Older code never reads or writes `admin_events`, so it runs correctly against a database that has the table. Do not `DROP` the table and do not rename it: dropping destroys the history, and renaming it makes the new code fail closed on every admin write if it is redeployed later (and leaves an untracked table behind). Note for the incident record: while the older code runs, admin changes are **not** audited, so the log has a gap for that period; the log resumes when the audited code is deployed again.

**B. Recovering from a failed migration.**
Applied as one transaction (step 2), a failure leaves nothing behind (no table, no function, no triggers; verified by failing 0013 part-way and re-applying). Fix the cause and run the whole file again. Only if it was applied as independently committed statements (for example through the SQL Editor without the explicit `BEGIN;` / `COMMIT;` wrapper working as intended) and stopped part-way can partial objects exist. That is safe to clean up **only while the table is empty** (run as the database owner), because nothing can have been audited yet. This guard refuses to run once any event exists:
```sql
BEGIN;
DO $$ BEGIN
  IF to_regclass('admin_events') IS NOT NULL AND (SELECT count(*) FROM admin_events) > 0 THEN
    RAISE EXCEPTION 'admin_events already holds events: do not drop it. Use the code rollback (A) instead.';
  END IF;
END $$;
DROP TABLE IF EXISTS admin_events;
DROP FUNCTION IF EXISTS admin_events_reject_change();
COMMIT;
```
then re-run the complete migration file. This is a recovery for an incomplete migration. It is never a production rollback once events exist.

**C. Recovering from a deployed application defect.**
- *Defect in application behaviour, data not damaged:* roll the code back (A) or ship a forward fix. Keep `admin_events`.
- *Bad data written through the admin screens or API:* correct it with the audited recovery actions (restore a hidden video, edit or hide the restaurant, correct attribution). Each correction is its own event, and the history (`from`/`to` values) shows exactly what to undo. Never edit or delete events: the triggers refuse it, and the log must show both the mistake and the fix.
- *Defect in auditing itself (events wrong or audited writes failing):* roll the code back (A) rather than disabling triggers or touching the table. Events already written stay immutable; describe the faulty period in the incident record.
- *Restoring the whole database to an earlier point:* a last resort. It rewinds `admin_events` along with everything else, losing every event after the restore point. Export first (`COPY (SELECT * FROM admin_events ORDER BY seq) TO ...`) so the history can be kept alongside the restored data.

## Tests
`npm run test:admin-audit` (pure checks + PostgreSQL integration on PGlite, an in-process real PostgreSQL; no network, no production). `npm run test:admin-authz` covers the route/credential matrix including the new routes.
