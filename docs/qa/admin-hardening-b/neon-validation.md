# Neon-branch validation (release readiness)

Run on a disposable, copy-on-write Neon branch of the production project, created with the owner's approval for this purpose and deleted afterwards. Production was never read or written. Connection strings, role names, endpoint hosts and project or branch identifiers are intentionally left out of this file.

## What was run
- Migration 0013 applied in one transaction (through a transaction-wrapped API call; neither psql nor the SQL Editor was used). Result: 2 append-only triggers, 0 events backfilled.
- Fingerprints (row count and md5 of all rows) of candidate restaurants, video candidates, restaurants, restaurant videos, the three Phase 16 restaurant drafts and the eight Phase 16 video leads were identical before the migration, after it, and after all tests.
- Column counts of all 10 tables in the live copy match the 0013 schema snapshot.
- Real Neon HTTP driver (`@neondatabase/serverless` 1.1.0) on PostgreSQL 18.7, running the app's real modules and route handlers: **108 of 108 checks**. Covers validation (market, coordinates, cuisine tags, duplicate Place ID), approval, promotion with a changed slug, video association by stable candidate id following the changed slug, cross-market refusal, attribution edit, hide, restore, no-op edits not bumping `updated_at`, an audit event per consequential action, and rollback of every mutation type when the audit write fails.
- Concurrency over separate HTTP connections: 12 identical edits gave one event; 15 distinct edits gave a linearizable event chain; 6 concurrent promotions gave one restaurant and one event; 6 concurrent attaches gave one video and one event; 6 identical video submissions gave one row; hide/restore races stayed consistent; a retried request id wrote no duplicate.
- Three-step direct-add under partial failure: create fails, nothing persists; approve fails, a needs_review candidate persists; attach fails, an approved but unattached candidate persists and the normal attach route finishes it. Not atomic as a whole.
- Authorization over real HTTP against the built app (`next start`): **241 of 241** across all 30 admin route/method pairs, on one instance with a draft credential configured and one without. No credential in any response, audit payload or server log.
- Non-destructive rollback behaviour: with the audit table renamed away, admin writes failed closed (500, nothing written) and public pages stayed up. This is why renaming is not part of the normal rollback.
- Browser: the audit screen refused the draft credential and showed Neon-backed history for the publish credential; Hide and Restore worked from the UI and wrote events. This is also where the stale-reason issue was found (fixed in the corrections commit).

## Not covered
Google Places import and photo flows against real Google; the deployed Vercel environment (authorization and audit smoke tests belong to the production release).
