// Admin Hardening B — integration tests against REAL PostgreSQL (PGlite: the PostgreSQL engine compiled to
// WebAssembly, in memory, isolated; production and DATABASE_URL are never touched).
//
// What runs: the app's real lib/db modules and real route handlers, with getDb() bound to the isolated
// database, applying the real committed migrations 0000..0013 through drizzle's migrator.
// What does NOT run here: the Neon HTTP driver (network) and concurrent connections (PGlite is a single
// connection). See the report for what that leaves unverified.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { PGlite } from "@electric-sql/pglite";
import { createAppSandbox, createTestDatabase, root } from "./lib/pg-harness.mjs";

let checks = 0;
const norm = (v) => (v === undefined ? "__undefined__" : JSON.parse(JSON.stringify(v)));
const eq = (a, b, m) => { assert.deepEqual(norm(a), norm(b), m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
// Drizzle wraps driver errors: the database message lives on `cause`.
const dbError = (re) => (e) => {
  let text = ""; for (let c = e; c; c = c.cause) text += ` ${c.message}`;
  return re.test(text);
};
const rejects = async (fn, re, m) => { await assert.rejects(fn, re, m); checks++; };

const PUBLISH = "synthetic-publish-secret-0123456789";
const DRAFT = "synthetic-draft-secret-abcdefghij";
const ENV = {
  FOODSWIPE_ADMIN_SECRET: PUBLISH, FOODSWIPE_ADMIN_DRAFT_SECRET: DRAFT,
  FOODSWIPE_ADMIN_PUBLISH_LABEL: "ops-admin", FOODSWIPE_ADMIN_DRAFT_LABEL: "ingest-agent",
};

/* ====================== A. migration safety (own throw-away databases) ====================== */
{
  const tmp = mkdtempSync(join(tmpdir(), "fs-migr-"));
  try {
    // A1: a database as production is TODAY (migrations 0000..0012) with rows, then 0013 applied on top.
    cpSync(join(root, "drizzle"), tmp, { recursive: true });
    const journal = JSON.parse(readFileSync(join(tmp, "meta/_journal.json"), "utf8"));
    ok(journal.entries.at(-1).tag === "0013_admin_events", "0013_admin_events is the latest journal entry");
    const before = { ...journal, entries: journal.entries.filter((e) => e.idx < 13) };
    writeFileSync(join(tmp, "meta/_journal.json"), JSON.stringify(before));
    const client = new PGlite();
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: tmp });
    eq((await client.query("select to_regclass('admin_events') as t")).rows[0].t, null, "admin_events does not exist before 0013");
    await client.exec(`
      insert into candidate_restaurants (id, slug, name, status, market) values
        ('p16-semma', 'semma', 'Semma', 'needs_review', 'nyc'), ('p16-thai-diner', 'thai-diner', 'Thai Diner', 'needs_review', 'nyc'),
        ('p16-dhamaka', 'dhamaka', 'Dhamaka', 'needs_review', 'nyc');
      insert into restaurants (id, slug, name, market, status) values ('r-live', 'live-place', 'Live Place', 'dc', 'published');
      insert into restaurant_videos (id, restaurant_id, platform, creator_handle, caption, attribution_text, source_type, match_confidence, legal_display_status)
        values ('v-live', 'live-place', 'YouTube', '@someone', 'c', 'YouTube post', 'real-post', 'manual', 'embeddable');
      insert into video_candidates (id, status, platform, source_url, normalized_source_url, resolver_status, candidate_restaurant_id)
        values ('p16-v1', 'needs_review', 'tiktok', 'https://www.tiktok.com/@a/video/1', 'https://www.tiktok.com/@a/video/1', 'resolved', 'p16-semma');`);
    const snapshot = async () => JSON.stringify([
      (await client.query("select * from candidate_restaurants order by id")).rows,
      (await client.query("select * from restaurants order by id")).rows,
      (await client.query("select * from restaurant_videos order by id")).rows,
      (await client.query("select * from video_candidates order by id")).rows,
    ]);
    const rowsBefore = await snapshot();
    await migrate(db, { migrationsFolder: join(root, "drizzle") }); // applies only 0013
    eq(await snapshot(), rowsBefore, "applying 0013 leaves every existing row byte-for-byte unchanged");
    eq((await client.query("select count(*)::int as n from admin_events")).rows[0].n, 0, "no events are backfilled: history starts empty, no historical actors are implied");
    eq((await client.query("select count(*)::int as n from candidate_restaurants where status='needs_review'")).rows[0].n, 3, "the three draft restaurants are still needs_review");
    eq((await client.query("select count(*)::int as n from video_candidates where attached_video_id is null and status='needs_review'")).rows[0].n, 1, "video candidates still unattached");

    // A2: payload bound + scope constraints are real CHECKs.
    const insertEvent = (over = {}) => client.query(
      `insert into admin_events (id, action, resource_type, resource_id, actor_identity, auth_scope, request_id, changes)
       values ($1, 'restaurant.updated', 'restaurant', 'r', 'a', $2, 'req-00000000', $3::jsonb)`,
      [over.id ?? crypto.randomUUID(), over.scope ?? "publish", JSON.stringify(over.changes ?? {})]);
    await insertEvent();
    await rejects(() => insertEvent({ scope: "root" }), /admin_events_scope_check/, "an unknown authorization scope is rejected by the database");
    await rejects(() => insertEvent({ changes: { x: "y".repeat(30000) } }), /admin_events_payload_bounded/, "an oversized payload is rejected by the database");
    for (const stmt of ["update admin_events set reason = 'x'", "delete from admin_events", "truncate admin_events"]) {
      await rejects(() => client.query(stmt), /append-only/, `append-only: ${stmt}`);
    }
    await client.close();

    // A3: a migration that fails part-way leaves NO partial schema (drizzle runs the pending set in one transaction).
    const client2 = new PGlite();
    const db2 = drizzle(client2);
    await migrate(db2, { migrationsFolder: tmp }); // up to 0012
    await client2.exec(`create function admin_events_reject_change() returns trigger language plpgsql as $$ begin return null; end $$;`);
    await rejects(() => migrate(db2, { migrationsFolder: join(root, "drizzle") }), /admin_events_reject_change|already exists/, "0013 fails when one of its objects already exists");
    eq((await client2.query("select to_regclass('admin_events') as t")).rows[0].t, null, "failed migration: the admin_events table was rolled back (no partial schema)");
    eq((await client2.query("select count(*)::int as n from pg_trigger where tgname like 'admin_events_no_%'")).rows[0].n, 0, "failed migration: no stray triggers");
    eq((await client2.query("select count(*)::int as n from drizzle.__drizzle_migrations")).rows[0].n, 13, "failed migration: 0013 is not recorded as applied");
    await client2.exec("drop function admin_events_reject_change()");
    await migrate(db2, { migrationsFolder: join(root, "drizzle") });
    eq((await client2.query("select to_regclass('admin_events') as t")).rows[0].t, "admin_events", "after fixing the cause, the same migration applies cleanly");
    await client2.close();

    // A4: the documented rollback works, leaves the rest of the schema intact, and the migration re-applies.
    const client3 = new PGlite();
    const db3 = drizzle(client3);
    await migrate(db3, { migrationsFolder: join(root, "drizzle") });
    await client3.exec(`insert into restaurants (id, slug, name, market, status) values ('r1', 'r1', 'R1', 'dc', 'published')`);
    await client3.exec(`
      BEGIN;
      DROP TABLE admin_events;
      DROP FUNCTION admin_events_reject_change();
      DELETE FROM drizzle.__drizzle_migrations WHERE id = (select max(id) from drizzle.__drizzle_migrations);
      COMMIT;`);
    eq((await client3.query("select to_regclass('admin_events') as t")).rows[0].t, null, "rollback: admin_events is gone");
    eq((await client3.query("select count(*)::int as n from restaurants")).rows[0].n, 1, "rollback: existing data is untouched");
    eq((await client3.query("select count(*)::int as n from pg_proc where proname = 'admin_events_reject_change'")).rows[0].n, 0, "rollback: no stray function");
    await migrate(db3, { migrationsFolder: join(root, "drizzle") });
    eq((await client3.query("select to_regclass('admin_events') as t")).rows[0].t, "admin_events", "rollback: the migration re-applies afterwards");
    await client3.close();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/* ====================== B. data layer on a fully migrated database ====================== */
const { client, db } = await createTestDatabase();
const sb = createAppSandbox(db, { env: ENV });
const candidatesDb = sb.load("lib/db/candidates.ts");
const restaurantsDb = sb.load("lib/db/restaurants.ts");
const videoCandidatesDb = sb.load("lib/db/videoCandidates.ts");
const videosDb = sb.load("lib/db/videos.ts");
const heroDb = sb.load("lib/db/heroMediaSelections.ts");
const identityDb = sb.load("lib/db/identity.ts");
const auditDb = sb.load("lib/db/auditEvents.ts");
const association = sb.load("lib/videoAssociation.ts");
const auditHelpers = sb.load("lib/db/audit.ts");
const schemaMod = sb.load("lib/db/schema.ts");
import { eq as eqOp } from "drizzle-orm";

const ctxFor = (scope, requestId) => ({
  actor: { identity: scope === "publish" ? "ops-admin" : "ingest-agent", scope, assurance: "shared-credential" },
  requestId, reason: null,
});
const DRAFT_CTX = (r = "req-draft-0001") => ctxFor("draft", r);
const PUB_CTX = (r = "req-pub-00001") => ctxFor("publish", r);
const events = async (where = "") => (await client.query(`select * from admin_events ${where} order by seq`)).rows;
const count = async (table, where = "true") => (await client.query(`select count(*)::int as n from ${table} where ${where}`)).rows[0].n;
const one = async (sqlText, params = []) => (await client.query(sqlText, params)).rows[0];
const failAudit = () => client.exec(`
  create or replace function _fail_audit() returns trigger language plpgsql as $$ begin raise exception 'simulated audit failure'; end $$;
  create trigger _fail_audit before insert on admin_events for each row execute function _fail_audit();`);
const healAudit = () => client.exec("drop trigger _fail_audit on admin_events; drop function _fail_audit();");

const NYC = { lat: 40.7306, lng: -73.9866 };
const newCandidate = (over = {}) => ({
  name: "Semma", slug: "semma", market: "nyc", address: "60 Greenwich Ave, New York, NY 10011", priceLevel: 3, ...NYC,
  cuisineTags: ["indian"], vibeTags: ["date night"], googlePlaceId: "ChIJsemma0123456789abcdef", ...over,
});

// ---- empty history is handled ----
eq(await auditDb.listAdminEvents({}), { events: [], nextBefore: null }, "empty audit history returns an empty page");
ok(await auditDb.auditLogIsAppendOnly(), "append-only triggers are detected");

// ---- candidate creation / edit / approve / reject / market change ----
const created = await candidatesDb.insertCandidateRestaurant(newCandidate(), DRAFT_CTX("req-create-001"));
let evs = await events();
eq(evs.length, 1, "creating a candidate writes exactly one event");
eq([evs[0].action, evs[0].resource_type, evs[0].resource_id, evs[0].actor_identity, evs[0].auth_scope, evs[0].actor_assurance, evs[0].request_id],
  ["restaurant_candidate.created", "restaurant_candidate", created.id, "ingest-agent", "draft", "shared-credential", "req-create-001"], "creation event identifies record, actor, scope, assurance, request");
eq(evs[0].changes.name, { from: null, to: "Semma" }, "creation event records the new name");
ok(!("suggested_tags" in evs[0].changes) && !("review_likelihood_score" in evs[0].changes), "non-allow-listed columns never appear");
ok(evs[0].occurred_at instanceof Date, "event is timestamped by the database");

await candidatesDb.updateCandidateRestaurant(created.id, { reasonText: "Dosa and a great room." }, DRAFT_CTX("req-edit-0001"));
evs = await events();
eq(evs.at(-1).action, "restaurant_candidate.updated", "plain edit -> updated");
eq(evs.at(-1).changes.reason_text, { from: null, to: "Dosa and a great room." }, "edit event records before and after");

const countAfterEdit = (await events()).length;
const stamp = async (table, id) => (await one(`select updated_at::text as t from ${table} where id = $1`, [id])).t;
const stampBefore = await stamp("candidate_restaurants", created.id);
await new Promise((r) => setTimeout(r, 15));
const noopResult = await candidatesDb.updateCandidateRestaurant(created.id, { reasonText: "Dosa and a great room.", name: "Semma", cuisineTags: ["indian"], lat: NYC.lat }, DRAFT_CTX("req-noop-0001"));
eq((await events()).length, countAfterEdit, "an edit that changes nothing writes no event (no-op)");
eq(await stamp("candidate_restaurants", created.id), stampBefore, "REGRESSION: a genuine no-op edit does not bump updated_at (text, array and number values compared)");
eq(noopResult.reasonText, "Dosa and a great room.", "…and still returns the current record");
await candidatesDb.updateCandidateRestaurant(created.id, { reasonText: "Dosa and a great room.", cuisineTags: ["indian", "dosa"].slice(0, 1).concat(["asian"]) }, DRAFT_CTX("req-noop-0002"));
ok((await stamp("candidate_restaurants", created.id)) !== stampBefore, "a real change (one value differs among unchanged ones) does bump updated_at");
eq((await events()).length, countAfterEdit + 1, "…and writes exactly one event");
await candidatesDb.updateCandidateRestaurant(created.id, { cuisineTags: ["indian"] }, DRAFT_CTX("req-noop-0003"));
const afterNoopSection = (await events()).length;
eq(await candidatesDb.updateCandidateRestaurant("does-not-exist", { name: "x" }, DRAFT_CTX()), null, "editing a missing candidate returns null");
eq((await events()).length, afterNoopSection, "a missing record writes no event");

await candidatesDb.updateCandidateRestaurant(created.id, { market: "dc" }, DRAFT_CTX("req-market-001"));
eq((await events()).at(-1).action, "restaurant_candidate.market_changed", "market edit -> market_changed");
eq((await events()).at(-1).changes.market, { from: "nyc", to: "dc" }, "market change records from/to");
await candidatesDb.updateCandidateRestaurant(created.id, { market: "nyc" }, DRAFT_CTX("req-market-002"));

await candidatesDb.updateCandidateRestaurant(created.id, { status: "approved", market: "nyc", reviewNotes: "Checked on the map" }, PUB_CTX("req-approve-01"));
eq((await events()).at(-1).action, "restaurant_candidate.approved", "approval wins over other changed fields");
eq([(await events()).at(-1).actor_identity, (await events()).at(-1).auth_scope], ["ops-admin", "publish"], "approval is attributed to the publication credential identity");
await candidatesDb.updateCandidateRestaurant(created.id, { status: "approved" }, PUB_CTX("req-approve-02"));
const approveEvents = await events("where action = 'restaurant_candidate.approved'");
eq(approveEvents.length, 1, "approving an already approved candidate writes no second event (idempotent)");
await candidatesDb.markCandidateRestaurantStatus(created.id, "rejected", "not now", PUB_CTX("req-reject-001"));
eq((await events()).at(-1).action, "restaurant_candidate.rejected", "rejection -> rejected");
await candidatesDb.markCandidateRestaurantStatus(created.id, "needs_review", undefined, PUB_CTX("req-review-001"));
eq((await events()).at(-1).action, "restaurant_candidate.status_changed", "other status moves -> status_changed");
await candidatesDb.markCandidateRestaurantStatus(created.id, "approved", undefined, PUB_CTX("req-approve-03"));

// ---- hero selection (select, re-select, clear) ----
await heroDb.upsertApprovedHeroSelectionForCandidate({ candidateRestaurantId: created.id, sourcePlaceId: "ChIJsemma0123456789abcdef", selectedPhotoOrdinal: 2, reviewerNotes: "front of house" }, PUB_CTX("req-hero-0001"));
await heroDb.upsertApprovedHeroSelectionForCandidate({ candidateRestaurantId: created.id, sourcePlaceId: "ChIJsemma0123456789abcdef", selectedPhotoOrdinal: 3 }, PUB_CTX("req-hero-0002"));
const heroEvents = await events("where action = 'restaurant_candidate.hero_selected'");
eq(heroEvents.length, 2, "each hero selection writes one event");
eq(heroEvents[0].changes.selected_photo_ordinal, { from: null, to: 2 }, "first selection: nothing before");
eq(heroEvents[1].changes.selected_photo_ordinal, { from: 2, to: 3 }, "changing the hero records the previous ordinal");
eq(heroEvents[1].resource_id, created.id, "hero events are filed under the candidate id");
eq(await count("restaurant_hero_media_selections", "approval_state = 'approved'"), 1, "exactly one approved selection remains (unique index respected inside the single statement)");
eq(await count("restaurant_hero_media_selections", "approval_state = 'cleared'"), 1, "the previous selection is retained as cleared");

// ---- promotion: slug collision, ids, hero inheritance, related candidate, readiness checks ----
await client.exec(`insert into restaurants (id, slug, name, market, status) values ('r-other', 'semma', 'Some Other Semma', 'nyc', 'published')`); // taken slug
const promoted = await restaurantsDb.promoteCandidateToRestaurant(created.id, PUB_CTX("req-promote-01"));
ok(promoted.ok, "promotion succeeds: " + JSON.stringify(promoted).slice(0, 200));
eq(promoted.restaurant.slug, "semma-2", "promotion with a taken slug changes the slug to semma-2");
const promoEvents = await events("where action = 'restaurant.promoted'");
eq(promoEvents.length, 1, "promotion writes exactly one restaurant.promoted event");
eq([promoEvents[0].resource_type, promoEvents[0].resource_id, promoEvents[0].related_resource_type, promoEvents[0].related_resource_id],
  ["restaurant", promoted.restaurant.id, "restaurant_candidate", created.id], "promotion event: resource = new restaurant id, related = source candidate id");
eq(promoEvents[0].changes.slug, { from: null, to: "semma-2" }, "promotion event records the final slug");
eq((await events("where action = 'restaurant.hero_inherited'")).length, 1, "the hero selection copy is audited once");
eq(await count("restaurant_hero_media_selections", `target_type = 'restaurant' and restaurant_id = '${promoted.restaurant.id}' and approval_state = 'approved'`), 1, "hero selection cloned to the published restaurant");
eq(promoEvents[0].details.publicationChecks.includes("place_identity_unverified"), true, "informational check recorded in the event details");
const again = await restaurantsDb.promoteCandidateToRestaurant(created.id, PUB_CTX("req-promote-02"));
eq([again.ok, again.code], [false, "already-promoted"], "promoting twice is refused");
eq((await events("where action = 'restaurant.promoted'")).length, 1, "a refused promotion writes no event");
eq((await events("where action = 'restaurant.hero_inherited'")).length, 1, "a repeat promotion does not duplicate the hero event");

// readiness checks: missing place identity + far-away pin + likely duplicate need a documented override
const risky = await candidatesDb.insertCandidateRestaurant(newCandidate({
  name: "Semma", slug: "semma-risky", googlePlaceId: null, lat: 38.9072, lng: -77.0369, // Washington DC pin on an NYC candidate
  address: "60 Greenwich Avenue, New York, NY 10011",
}), DRAFT_CTX("req-risky-001"));
await candidatesDb.updateCandidateRestaurant(risky.id, { status: "approved" }, PUB_CTX("req-risky-002"));
const eventsBeforeBlocked = (await events()).length;
const blocked = await restaurantsDb.promoteCandidateToRestaurant(risky.id, PUB_CTX("req-risky-003"));
eq([blocked.ok, blocked.code], [false, "publication-checks"], "suspicious candidate is not published without an override");
const codes = (r) => [...new Set(r.unresolved.map((c) => c.code))].sort();
eq(codes(blocked), ["coordinates_outside_market", "missing_place_identity", "possible_duplicate"], "unresolved warnings: wrong-market pin, no Place ID, likely duplicate");
eq(await count("restaurants", `source_candidate_id = '${risky.id}'`), 0, "nothing was published");
eq((await events()).length, eventsBeforeBlocked, "a blocked promotion writes no event");
const stillDraft = await one("select status from candidate_restaurants where id = $1", [risky.id]);
eq(stillDraft.status, "approved", "the candidate record is untouched by a blocked promotion");
const partial = await restaurantsDb.promoteCandidateToRestaurant(risky.id, PUB_CTX("req-risky-004"), { acknowledged: ["missing_place_identity"], reason: "Place ID unavailable for this venue" });
eq([partial.ok, codes(partial)], [false, ["coordinates_outside_market", "possible_duplicate"]], "acknowledging only some warnings is not enough");
const tooShort = await restaurantsDb.promoteCandidateToRestaurant(risky.id, PUB_CTX("req-risky-005"), { acknowledged: ["missing_place_identity", "coordinates_outside_market", "possible_duplicate"], reason: "ok" });
eq(tooShort.code, "publication-checks", "an override without a real reason is refused");
const forced = await restaurantsDb.promoteCandidateToRestaurant(risky.id, PUB_CTX("req-risky-006"), {
  acknowledged: ["missing_place_identity", "coordinates_outside_market", "possible_duplicate"], reason: "Verified in person: separate branch, pin corrected later",
});
ok(forced.ok, "a documented override publishes");
const forcedEvent = (await events("where action = 'restaurant.promoted'")).at(-1);
eq(forcedEvent.reason, "Verified in person: separate branch, pin corrected later", "override reason is stored on the event");
eq(forcedEvent.details.override.acknowledged.sort(), ["coordinates_outside_market", "missing_place_identity", "possible_duplicate"], "acknowledged warning codes are stored on the event");

// ---- video association by stable id, attach, correction, hide / restore ----
const vcInput = (over = {}) => ({
  platform: "tiktok", sourceUrl: "https://www.tiktok.com/@jyu.eats/video/7203179655342476590",
  normalizedSourceUrl: "https://www.tiktok.com/@jyu.eats/video/7203179655342476590", platformVideoId: "7203179655342476590",
  candidateRestaurantId: created.id, proposedRestaurantName: "Semma", creatorHandle: "@jyu.eats", creatorName: "jyu.eats",
  caption: "x".repeat(3000), embedUrl: "https://www.tiktok.com/player/v1/7203179655342476590", attributionText: "TikTok post by jyu.eats",
  legalDisplayStatus: "embeddable", resolverStatus: "resolved", resolverError: "provider said: token=SHOULD-NOT-BE-LOGGED", ...over,
});
const vc = await videoCandidatesDb.createVideoCandidate(vcInput(), DRAFT_CTX("req-vc-create-1"));
eq(vc.duplicate, false, "new video candidate");
const vcEvent = (await events("where action = 'video_candidate.created'"))[0];
eq([vcEvent.resource_id, vcEvent.related_resource_id], [vc.candidate.id, created.id], "video candidate event: resource = video candidate, related = restaurant candidate");
eq(vcEvent.changes.caption.to._clipped, true, "a long caption is clipped in the event, never stored in full");
ok(JSON.stringify(vcEvent).length < 4000, "event payload stays small");
ok(!JSON.stringify(await events()).includes("SHOULD-NOT-BE-LOGGED"), "resolver output (resolver_error) is never audited");
const dup = await videoCandidatesDb.createVideoCandidate(vcInput(), DRAFT_CTX("req-vc-create-2"));
eq(dup.duplicate, true, "re-submitting the same video is a duplicate");
eq((await events("where action = 'video_candidate.created'")).length, 1, "a duplicate submission writes no event");

await videoCandidatesDb.patchVideoCandidate(vc.candidate.id, { status: "approved" }, PUB_CTX("req-vc-approve"));
eq((await events()).at(-1).action, "video_candidate.approved", "video approval is audited");
await videoCandidatesDb.patchVideoCandidate(vc.candidate.id, { status: "approved" }, PUB_CTX("req-vc-approve2"));
eq((await events("where action = 'video_candidate.approved'")).length, 1, "re-approving writes nothing");

const attach = await videoCandidatesDb.attachVideoCandidate(vc.candidate.id, "semma-2", PUB_CTX("req-attach-001"));
ok(attach.ok && !attach.alreadyAttached, "attach resolves through the stable candidate id to the CHANGED slug semma-2");
eq((await one("select restaurant_id from restaurant_videos where id = $1", [attach.videoId])).restaurant_id, "semma-2", "the video belongs to semma-2, not to the unrelated restaurant that owns the slug semma");
const attachEvents = await events("where action = 'restaurant_video.attached'");
eq(attachEvents.length, 1, "attach writes exactly ONE event (no duplicate for the candidate status flip)");
eq([attachEvents[0].resource_id, attachEvents[0].related_resource_id, attachEvents[0].details.videoCandidateId, attachEvents[0].details.restaurantSlug],
  [attach.videoId, promoted.restaurant.id, vc.candidate.id, "semma-2"], "attach event: video, stable restaurant id, originating video candidate, slug");
const attachAgain = await videoCandidatesDb.attachVideoCandidate(vc.candidate.id, "semma-2", PUB_CTX("req-attach-002"));
eq([attachAgain.ok, attachAgain.alreadyAttached], [true, true], "attaching again is idempotent");
eq(await count("restaurant_videos", "restaurant_id = 'semma-2'"), 1, "no second live video");
eq((await events("where action = 'restaurant_video.attached'")).length, 1, "idempotent attach writes no event");

// cross-market / conflicting associations are rejected by the real lookups
const nycCandidate = await candidatesDb.insertCandidateRestaurant(newCandidate({ name: "Rasika", slug: "rasika", googlePlaceId: "ChIJrasika0123456789abcdef" }), DRAFT_CTX("req-rasika-01"));
await client.exec(`insert into restaurants (id, slug, name, market, status, source_candidate_id) values ('r-dc', 'rasika-dc', 'Rasika DC', 'dc', 'published', null)`);
const lookups = { candidateById: identityDb.getCandidateRef, publishedBySlug: identityDb.getPublishedRefBySlug };
eq((await association.resolveAssociation({ candidateRestaurantId: nycCandidate.id, restaurantSlug: "rasika-dc" }, lookups)).code, "cross_market_association", "an NYC candidate cannot be linked to a DC restaurant");
eq((await association.resolveAssociation({ candidateRestaurantId: created.id, restaurantSlug: "semma" }, lookups)).code, "association_mismatch", "a slug that was not published from that candidate is a mismatch");
eq((await association.resolveAssociation({ candidateRestaurantId: created.id, restaurantSlug: "semma-2" }, lookups)).ok, true, "candidate id + its real published slug agree");

// correction
const eventsBeforeFix = (await events()).length;
const fixed = await videosDb.updatePublishedVideo(attach.videoId, { creatorHandle: "@jyu.eats.nyc", creatorDisplayName: "Jyu Eats", attributionText: "TikTok post by @jyu.eats.nyc" }, PUB_CTX("req-fix-0001"));
eq([fixed.changed, fixed.video.creatorHandle, fixed.video.creatorDisplayName], [true, "@jyu.eats.nyc", "Jyu Eats"], "attribution corrected");
const fixEvent = (await events()).at(-1);
eq([fixEvent.action, fixEvent.resource_id, fixEvent.related_resource_id, fixEvent.actor_identity], ["restaurant_video.updated", attach.videoId, promoted.restaurant.id, "ops-admin"], "correction event");
eq(fixEvent.changes.creator_handle, { from: "@jyu.eats", to: "@jyu.eats.nyc" }, "correction event keeps the previous handle");
eq(Object.keys(fixEvent.changes).sort(), ["attribution_text", "creator_display_name", "creator_handle"], "only the corrected fields are recorded");
const afterFix = await one("select source_url, embed_url, platform, legal_display_status, caption, restaurant_id, status, source_type from restaurant_videos where id = $1", [attach.videoId]);
eq([afterFix.source_url, afterFix.platform, afterFix.legal_display_status, afterFix.restaurant_id, afterFix.status], [vc.candidate.sourceUrl, "TikTok", "embeddable", "semma-2", "active"], "source identity, legal status and association are untouched by a correction");
const videoStamp = await stamp("restaurant_videos", attach.videoId);
await new Promise((r) => setTimeout(r, 15));
const noopFix = await videosDb.updatePublishedVideo(attach.videoId, { creatorHandle: "@jyu.eats.nyc" }, PUB_CTX("req-fix-0002"));
eq(await stamp("restaurant_videos", attach.videoId), videoStamp, "REGRESSION: a no-op video correction does not bump updated_at");
eq(noopFix.changed, false, "repeating the same correction reports changed:false");
eq((await events()).length, eventsBeforeFix + 1, "…and writes no second event");
eq(await videosDb.updatePublishedVideo("missing-video", { creatorHandle: "@x.y" }, PUB_CTX()), null, "correcting a missing video returns null");

// hide / restore
const hid = await videosDb.hideVideo(attach.videoId, PUB_CTX("req-hide-0001"));
eq(hid, true, "hide");
eq((await events()).at(-1).action, "restaurant_video.hidden", "hide is audited");
eq((await events()).at(-1).changes.status, { from: "active", to: "hidden" }, "hide records status from/to");
eq((await videosDb.getActiveVideos("semma-2")).length, 0, "a hidden video is not served");
const eventsBeforeSecondHide = (await events()).length;
await videosDb.hideVideo(attach.videoId, PUB_CTX("req-hide-0002"));
eq((await events()).length, eventsBeforeSecondHide, "hiding twice writes one event");
const restored = await videosDb.restoreVideo(attach.videoId, PUB_CTX("req-restore-01"));
eq([restored.changed, restored.video.status], [true, "active"], "restore");
eq((await events()).at(-1).action, "restaurant_video.restored", "restore is audited");
eq((await videosDb.getActiveVideos("semma-2")).map((v) => v.creatorHandle), ["@jyu.eats.nyc"], "the restored video is served again with its corrected attribution");
const restoredAgain = await videosDb.restoreVideo(attach.videoId, PUB_CTX("req-restore-02"));
eq(restoredAgain.changed, false, "restoring an active video changes nothing");
eq((await events("where action = 'restaurant_video.restored'")).length, 1, "…and writes no event");
eq(await videosDb.restoreVideo("nope", PUB_CTX()), null, "restoring a missing video returns null");

// published restaurant edit / hide / restore
await restaurantsDb.updatePublishedRestaurant(promoted.restaurant.id, { reasonText: "Updated line", status: "hidden" }, PUB_CTX("req-rest-0001"));
const restStamp = await stamp("restaurants", promoted.restaurant.id);
await new Promise((r) => setTimeout(r, 15));
await restaurantsDb.updatePublishedRestaurant(promoted.restaurant.id, { reasonText: "Updated line", status: "hidden" }, PUB_CTX("req-rest-0001b"));
eq(await stamp("restaurants", promoted.restaurant.id), restStamp, "REGRESSION: re-saving an identical published restaurant does not bump updated_at");
eq((await events()).at(-1).action, "restaurant.hidden", "status -> hidden wins");
await restaurantsDb.updatePublishedRestaurant(promoted.restaurant.id, { status: "published" }, PUB_CTX("req-rest-0002"));
eq((await events()).at(-1).action, "restaurant.restored", "status -> published is a restore");
await restaurantsDb.hidePublishedRestaurant(promoted.restaurant.id, PUB_CTX("req-rest-0003"));
const nHidden = (await events("where action = 'restaurant.hidden'")).length;
await restaurantsDb.hidePublishedRestaurant(promoted.restaurant.id, PUB_CTX("req-rest-0004"));
eq((await events("where action = 'restaurant.hidden'")).length, nHidden, "hiding an already hidden restaurant writes no event");
await restaurantsDb.updatePublishedRestaurant(promoted.restaurant.id, { status: "published" }, PUB_CTX("req-rest-0005"));

// direct insert (seed restaurants)
const direct = await videosDb.insertVideo("le-diplomate", {
  id: "tmp", platform: "YouTube", sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk", creatorHandle: "@chef", caption: "c", attributionText: "YouTube post",
  isRealSource: true, sourceType: "real-post", matchConfidence: "manual", legalDisplayStatus: "source-link-only",
}, PUB_CTX("req-direct-01"));
eq((await events()).at(-1).action, "restaurant_video.added_direct", "direct add is audited");
eq((await events()).at(-1).resource_id, direct.id, "…under the new video id");

// ---- atomicity: when the audit write fails the data change must NOT happen ----
await failAudit();
const snap = async () => JSON.stringify([
  (await client.query("select * from candidate_restaurants order by id")).rows, (await client.query("select * from restaurants order by id")).rows,
  (await client.query("select * from restaurant_videos order by id")).rows, (await client.query("select * from video_candidates order by id")).rows,
  (await client.query("select * from restaurant_hero_media_selections order by id")).rows,
]);
const evCount = (await events()).length;
const rolledBack = async (label, fn) => {
  const before = await snap();
  await assert.rejects(fn, dbError(/simulated audit failure/), label); checks++;
  eq(await snap(), before, `${label}: every table is byte-for-byte unchanged`);
  eq((await events()).length, evCount, `${label}: no event`);
};
await rolledBack("candidate create", () => candidatesDb.insertCandidateRestaurant(newCandidate({ name: "Ghost", slug: "ghost", googlePlaceId: null }), DRAFT_CTX("req-fail-0001")));
await rolledBack("candidate edit", () => candidatesDb.updateCandidateRestaurant(nycCandidate.id, { name: "Renamed" }, DRAFT_CTX("req-fail-0002")));
await rolledBack("candidate approve", () => candidatesDb.updateCandidateRestaurant(nycCandidate.id, { status: "approved" }, PUB_CTX("req-fail-0003")));
await rolledBack("hero select", () => heroDb.upsertApprovedHeroSelectionForCandidate({ candidateRestaurantId: created.id, sourcePlaceId: "ChIJsemma0123456789abcdef", selectedPhotoOrdinal: 5 }, PUB_CTX("req-fail-0004")));
await rolledBack("hero clear", () => heroDb.clearApprovedHeroSelectionForCandidate(created.id, PUB_CTX("req-fail-0005")));
await rolledBack("video correction", () => videosDb.updatePublishedVideo(attach.videoId, { creatorHandle: "@should.not.stick" }, PUB_CTX("req-fail-0006")));
await rolledBack("video hide", () => videosDb.hideVideo(attach.videoId, PUB_CTX("req-fail-0007")));
await rolledBack("restaurant edit", () => restaurantsDb.updatePublishedRestaurant(promoted.restaurant.id, { reasonText: "nope" }, PUB_CTX("req-fail-0008")));
await rolledBack("video candidate create", () => videoCandidatesDb.createVideoCandidate(vcInput({ sourceUrl: "https://www.tiktok.com/@x/video/99", normalizedSourceUrl: "https://www.tiktok.com/@x/video/99", platformVideoId: "99" }), DRAFT_CTX("req-fail-0009")));
// promotion and attach are multi-table statements: the strongest atomicity cases
const readyForPromo = await candidatesDb.insertCandidateRestaurant(newCandidate({ name: "Atomic Place", slug: "atomic-place", googlePlaceId: "ChIJatomic0123456789abcdef", address: "9 Atomic Way, New York, NY 10001" }), DRAFT_CTX("req-ready-01")).catch(() => null);
ok(readyForPromo === null, "(setup) creating while audit is failing is itself refused");
await healAudit();
const atomic = await candidatesDb.insertCandidateRestaurant(newCandidate({ name: "Atomic Place", slug: "atomic-place", googlePlaceId: "ChIJatomic0123456789abcdef", address: "9 Atomic Way, New York, NY 10001" }), DRAFT_CTX("req-ready-02"));
await candidatesDb.updateCandidateRestaurant(atomic.id, { status: "approved" }, PUB_CTX("req-ready-03"));
const atomicVc = await videoCandidatesDb.createVideoCandidate(vcInput({
  candidateRestaurantId: atomic.id, sourceUrl: "https://www.tiktok.com/@y/video/77", normalizedSourceUrl: "https://www.tiktok.com/@y/video/77", platformVideoId: "77", caption: "short",
}), DRAFT_CTX("req-ready-04"));
await videoCandidatesDb.patchVideoCandidate(atomicVc.candidate.id, { status: "approved" }, PUB_CTX("req-ready-05"));
await failAudit();
const evCount2 = (await events()).length;
const failedPromo = await restaurantsDb.promoteCandidateToRestaurant(atomic.id, PUB_CTX("req-fail-0010"));
eq(failedPromo.ok, false, "promotion does not succeed when its audit event cannot be written");
eq(await count("restaurants", `source_candidate_id = '${atomic.id}'`), 0, "…and no restaurant row exists");
eq((await events()).length, evCount2, "…and no event");
await healAudit();
const okPromo = await restaurantsDb.promoteCandidateToRestaurant(atomic.id, PUB_CTX("req-ready-06"));
ok(okPromo.ok, "promotion works once audit is healthy again");
await failAudit();
const preAttach = await snap();
await assert.rejects(() => videoCandidatesDb.attachVideoCandidate(atomicVc.candidate.id, okPromo.restaurant.slug, PUB_CTX("req-fail-0011")), dbError(/simulated audit failure/)); checks++;
eq(await snap(), preAttach, "attach: audit failure leaves the live video table AND the candidate's status untouched");
await healAudit();
ok((await videoCandidatesDb.attachVideoCandidate(atomicVc.candidate.id, okPromo.restaurant.slug, PUB_CTX("req-ready-07"))).ok, "attach works once audit is healthy again");
// a CHECK-violating event aborts the change too (no swallowed audit writes)
const badCtx = { ...PUB_CTX(), requestId: "   " };
await assert.rejects(() => candidatesDb.updateCandidateRestaurant(nycCandidate.id, { name: "Blank request id" }, badCtx), dbError(/admin_events_actor_nonblank|violates check/)); checks++;
eq((await one("select name from candidate_restaurants where id = $1", [nycCandidate.id])).name, "Rasika", "a malformed audit context aborts the edit");

// ---- request correlation: the three steps of one direct-add share one request id ----
const corr = "req-direct-add-01";
const dvc = await videoCandidatesDb.createVideoCandidate(vcInput({
  candidateRestaurantId: atomic.id, sourceUrl: "https://www.tiktok.com/@z/video/55", normalizedSourceUrl: "https://www.tiktok.com/@z/video/55", platformVideoId: "55", caption: "short",
}), { ...PUB_CTX(corr), details: { via: "direct_add" } });
await videoCandidatesDb.patchVideoCandidate(dvc.candidate.id, { status: "approved" }, { ...PUB_CTX(corr), details: { via: "direct_add" } });
await videoCandidatesDb.attachVideoCandidate(dvc.candidate.id, okPromo.restaurant.slug, { ...PUB_CTX(corr), details: { via: "direct_add" } });
eq((await events(`where request_id = '${corr}'`)).map((e) => e.action), ["video_candidate.created", "video_candidate.approved", "restaurant_video.attached"], "direct-add: three events, one request id, in order");
eq((await events(`where request_id = '${corr}'`)).every((e) => e.details.via === "direct_add"), true, "direct-add events say how they came about");

// ---- read API ----
const forVideo = await auditDb.listAdminEvents({ resourceId: attach.videoId });
eq(forVideo.events.map((e) => e.action), ["restaurant_video.restored", "restaurant_video.hidden", "restaurant_video.updated", "restaurant_video.attached"], "history of one video, newest first (restore, hide, correction, attach)");
eq(forVideo.events.map((e) => e.category), ["recovery", "removal", "edit", "publication"], "events are categorised");
const forCandidate = await auditDb.listAdminEvents({ resourceId: created.id, limit: 100 });
ok(forCandidate.events.some((e) => e.action === "restaurant.promoted") && forCandidate.events.some((e) => e.action === "restaurant_candidate.created") && forCandidate.events.some((e) => e.action === "video_candidate.created"),
  "history of a candidate includes its own events AND events related to it (its promotion, its videos)");
const forVideoCandidate = await auditDb.listAdminEvents({ resourceId: vc.candidate.id });
ok(forVideoCandidate.events.some((e) => e.action === "restaurant_video.attached"), "a video candidate's history includes the attach it caused");
const page1 = await auditDb.listAdminEvents({ limit: 5 });
const page2 = await auditDb.listAdminEvents({ limit: 5, before: page1.nextBefore });
eq([page1.events.length, page2.events.length], [5, 5], "paging");
ok(page2.events[0].seq < page1.events.at(-1).seq, "pages do not overlap");
eq((await auditDb.listAdminEvents({ since: new Date(Date.now() + 60000).toISOString() })).events, [], "a window in the future is empty");
ok((await auditDb.listAdminEvents({ since: new Date(Date.now() - 86400000).toISOString() })).events.length > 5, "recent activity window");
eq((await auditDb.listAdminEvents({ actor: "ingest-agent", limit: 100 })).events.every((e) => e.actorIdentity === "ingest-agent" && e.authScope === "draft"), true, "filter by credential identity");
eq((await auditDb.listAdminEvents({ requestId: corr })).events.length, 3, "filter by request id");

// ---- nothing sensitive is ever stored ----
const everything = JSON.stringify(await events());
for (const secret of [PUBLISH, DRAFT, "SHOULD-NOT-BE-LOGGED", "x-foodswipe-admin-secret", "DATABASE_URL"]) ok(!everything.includes(secret), `audit log never contains ${secret.slice(0, 12)}…`);
ok(everything.length / (await events()).length < 2500, "events stay small on average");

/* ====================== C. real route handlers on the isolated database ====================== */
const route = (p) => sb.load(p);
const call = async (handler, url, { method = "GET", secret, body, headers = {}, id, slug } = {}) => {
  const h = { ...(secret ? { "x-foodswipe-admin-secret": secret } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers };
  const res = await handler(new Request(`https://example.test${url}`, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined }), { params: Promise.resolve({ id, slug }) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, headers: res.headers };
};
const candidatesRoute = route("app/api/admin/restaurants/candidates/route.ts");
const candidateRoute = route("app/api/admin/restaurants/candidates/[id]/route.ts");
const promoteRoute = route("app/api/admin/restaurants/candidates/[id]/promote/route.ts");
const videoRoute = route("app/api/admin/videos/[id]/route.ts");
const restoreRoute = route("app/api/admin/videos/[id]/restore/route.ts");
const videosListRoute = route("app/api/admin/videos/route.ts");
const auditRoute = route("app/api/admin/audit/events/route.ts");
const heroRoute = route("app/api/admin/restaurants/candidates/[id]/hero-media-selection/route.ts");
const publishedHide = route("app/api/admin/restaurants/published/[id]/hide/route.ts");

// authorization on the audit API
eq((await call(auditRoute.GET, "/api/admin/audit/events")).status, 401, "audit API: no credential -> 401");
eq((await call(auditRoute.GET, "/api/admin/audit/events", { secret: "wrong-secret-value-000000" })).status, 401, "audit API: wrong credential -> 401");
const draftRead = await call(auditRoute.GET, "/api/admin/audit/events", { secret: DRAFT });
eq([draftRead.status, draftRead.json.code], [403, "insufficient_scope"], "audit API: the DRAFT credential is refused");
ok(!("events" in draftRead.json), "…and receives no event data in the refusal");
const pubRead = await call(auditRoute.GET, "/api/admin/audit/events?limit=3", { secret: PUBLISH });
eq(pubRead.status, 200, "audit API: publication credential reads");
eq([pubRead.json.events.length, pubRead.json.integrity.appendOnlyTriggersPresent, pubRead.json.requester], [3, true, { identity: "ops-admin", scope: "publish", assurance: "shared-credential" }], "response carries events, integrity flag and the requester's own identity");
ok(!pubRead.text.includes(PUBLISH) && !pubRead.text.includes(DRAFT), "audit API response never contains a credential");
eq((await call(auditRoute.GET, "/api/admin/audit/events?limit=0", { secret: PUBLISH })).status, 422, "audit API: bad limit -> 422");
eq((await call(auditRoute.GET, "/api/admin/audit/events?action=nope", { secret: PUBLISH })).status, 422, "audit API: unknown action -> 422");
eq((await call(auditRoute.GET, "/api/admin/audit/events?days=999", { secret: PUBLISH })).status, 422, "audit API: bad days -> 422");
eq((await call(auditRoute.GET, `/api/admin/audit/events?resourceId=${attach.videoId}&resourceType=restaurant_video`, { secret: PUBLISH })).json.events.length, 4, "audit API: filter by resource id and type");
ok(!("PATCH" in auditRoute) && !("DELETE" in auditRoute) && !("PUT" in auditRoute) && !("POST" in auditRoute), "audit route module exports GET only");

// attribution through real routes: the draft agent creates, the publisher approves
const routeCreate = await call(candidatesRoute.POST, "/api/admin/restaurants/candidates", { method: "POST", secret: DRAFT,
  body: { name: "Route Test Cafe", market: "nyc", address: "1 Test St, New York, NY", priceLevel: 2, ...NYC, cuisineTags: ["indian"], vibeTags: ["casual"], auditReason: "Seen on the Eater NYC list" } });
eq(routeCreate.status, 201, "route: draft credential creates a candidate: " + routeCreate.text.slice(0, 120));
const createdEvent = (await events(`where resource_id = '${routeCreate.json.id}'`))[0];
eq([createdEvent.actor_identity, createdEvent.auth_scope, createdEvent.reason], ["ingest-agent", "draft", "Seen on the Eater NYC list"], "route: event attributed to the draft credential, with the supplied reason");
eq((await call(candidateRoute.PATCH, "/api/admin/restaurants/candidates/x", { method: "PATCH", secret: DRAFT, id: routeCreate.json.id, body: { status: "approved" } })).status, 403, "route: draft credential cannot approve");
eq((await events(`where resource_id = '${routeCreate.json.id}'`)).length, 1, "route: the refused approval wrote no event");
const approvedRoute = await call(candidateRoute.PATCH, "/api/admin/restaurants/candidates/x", { method: "PATCH", secret: PUBLISH, id: routeCreate.json.id, body: { status: "approved", auditReason: "Checked address and menu" } });
eq(approvedRoute.status, 200, "route: publication credential approves");
const approvedEvent = (await events(`where resource_id = '${routeCreate.json.id}'`)).at(-1);
eq([approvedEvent.action, approvedEvent.actor_identity, approvedEvent.reason], ["restaurant_candidate.approved", "ops-admin", "Checked address and menu"], "route: approval attributed to the publication credential");
eq((await call(candidatesRoute.POST, "/api/admin/restaurants/candidates", { method: "POST", secret: DRAFT, body: { name: "Leaky", market: "nyc", auditReason: `see ${PUBLISH}` } })).status, 422, "route: a reason containing a configured credential is refused");
eq((await call(candidatesRoute.POST, "/api/admin/restaurants/candidates", { method: "POST", secret: DRAFT, body: { name: "Long", market: "nyc", auditReason: "r".repeat(1001) } })).status, 422, "route: an over-long reason is refused");
eq((await call(candidatesRoute.POST, "/api/admin/restaurants/candidates", { method: "POST", secret: DRAFT, headers: { "x-request-id": "trace-abc-12345" }, body: { name: "Traced", market: "nyc" } })).status, 201, "route: create with a caller request id");
eq((await events("where request_id = 'trace-abc-12345'")).length, 1, "route: a well-formed x-request-id is used as the correlation id");

// promote route: blocked, then override
const promoteBlocked = await call(promoteRoute.POST, "/api/admin/restaurants/candidates/x/promote", { method: "POST", secret: PUBLISH, id: routeCreate.json.id });
eq([promoteBlocked.status, promoteBlocked.json.code], [409, "publication_checks_failed"], "route: promote without a Place ID needs an override");
ok(promoteBlocked.json.unresolved.includes("missing_place_identity") && promoteBlocked.json.howToOverride, "route: the response says what to acknowledge");
eq((await call(promoteRoute.POST, "/api/admin/restaurants/candidates/x/promote", { method: "POST", secret: DRAFT, id: routeCreate.json.id })).status, 403, "route: draft credential cannot promote");
eq((await call(promoteRoute.POST, "/api/admin/restaurants/candidates/x/promote", { method: "POST", secret: PUBLISH, id: routeCreate.json.id, body: { override: { acknowledge: ["missing_place_identity"], reason: "short" } } })).status, 422, "route: a too-short override reason is refused");
const promoteOk = await call(promoteRoute.POST, "/api/admin/restaurants/candidates/x/promote", { method: "POST", secret: PUBLISH, id: routeCreate.json.id, body: { override: { acknowledge: ["missing_place_identity"], reason: "Independent cafe with no Google listing yet" } } });
eq(promoteOk.status, 201, "route: documented override publishes: " + promoteOk.text.slice(0, 160));
eq((await events(`where action = 'restaurant.promoted' and related_resource_id = '${routeCreate.json.id}'`))[0].reason, "Independent cafe with no Google listing yet", "route: override reason recorded");

// video correction / restore / list through routes
const draftFix = await call(videoRoute.PATCH, "/api/admin/videos/x", { method: "PATCH", secret: DRAFT, id: attach.videoId, body: { creatorHandle: "@nope.nope" } });
eq(draftFix.status, 403, "route: draft credential cannot correct a published video");
for (const bad of [{ sourceUrl: "https://evil.example/x" }, { legalDisplayStatus: "embeddable" }, { platform: "YouTube" }, { restaurantSlug: "other" }, { caption: "new" }, { status: "active" }, { creatorHandle: "no-at-sign" }, { attributionText: "" }, {}]) {
  const res = await call(videoRoute.PATCH, "/api/admin/videos/x", { method: "PATCH", secret: PUBLISH, id: attach.videoId, body: bad });
  eq(res.status, 422, `route: correction ${JSON.stringify(bad)} is refused`);
}
const goodFix = await call(videoRoute.PATCH, "/api/admin/videos/x", { method: "PATCH", secret: PUBLISH, id: attach.videoId, body: { attributionText: "TikTok post by @jyu.eats.nyc (Jyu Eats)", auditReason: "Creator renamed their handle" } });
eq([goodFix.status, goodFix.json.changed], [200, true], "route: correction accepted");
eq((await events()).at(-1).reason, "Creator renamed their handle", "route: correction reason recorded");
eq((await call(videoRoute.PATCH, "/api/admin/videos/x", { method: "PATCH", secret: PUBLISH, id: "missing", body: { creatorHandle: "@a.b" } })).status, 404, "route: unknown video -> 404");
await failAudit();
const failedRoute = await call(videoRoute.PATCH, "/api/admin/videos/x", { method: "PATCH", secret: PUBLISH, id: attach.videoId, body: { creatorHandle: "@rolled.back" } });
eq(failedRoute.status, 500, "route: audit failure -> 500, never a silent success");
ok(!failedRoute.text.includes("simulated"), "route: the 500 does not leak the database error");
eq((await one("select creator_handle from restaurant_videos where id = $1", [attach.videoId])).creator_handle, "@jyu.eats.nyc", "route: the correction did not happen");
await healAudit();

eq((await call(videoRoute.DELETE, "/api/admin/videos/x", { method: "DELETE", secret: PUBLISH, id: attach.videoId, body: { auditReason: "Wrong restaurant" } })).status, 200, "route: hide");
const hiddenList = await call(videosListRoute.GET, "/api/admin/videos?status=hidden", { secret: PUBLISH });
eq(hiddenList.json.videos.map((v) => v.id), [attach.videoId], "route: hidden videos can be listed");
eq((await call(videosListRoute.GET, "/api/admin/videos?status=hidden", { secret: DRAFT })).status, 403, "route: draft credential cannot list hidden videos");
eq((await call(restoreRoute.POST, "/api/admin/videos/x/restore", { method: "POST", secret: DRAFT, id: attach.videoId })).status, 403, "route: draft credential cannot restore");
const restoreRes = await call(restoreRoute.POST, "/api/admin/videos/x/restore", { method: "POST", secret: PUBLISH, id: attach.videoId, body: { auditReason: "Hidden by mistake" } });
eq([restoreRes.status, restoreRes.json.changed, restoreRes.json.video.status], [200, true, "active"], "route: restore");
eq((await call(restoreRoute.POST, "/api/admin/videos/x/restore", { method: "POST", secret: PUBLISH, id: attach.videoId })).json.changed, false, "route: restore twice is a no-op");
eq((await call(restoreRoute.POST, "/api/admin/videos/x/restore", { method: "POST", secret: PUBLISH, id: "missing" })).status, 404, "route: restore unknown -> 404");
eq(await count("restaurant_videos", `id = '${attach.videoId}' and status = 'active' and restaurant_id = 'semma-2'`), 1, "route: the restored video keeps its restaurant association");
const restoredEvent = (await events("where action = 'restaurant_video.restored'")).at(-1);
eq([restoredEvent.reason, restoredEvent.actor_identity], ["Hidden by mistake", "ops-admin"], "route: restore event carries reason and actor");
// REGRESSION (release QA): a Restore sent WITHOUT a reason records no reason, never the one given for the earlier Hide.
eq((await call(videoRoute.DELETE, "/api/admin/videos/x", { method: "DELETE", secret: PUBLISH, id: attach.videoId, body: { auditReason: "Hidden for the stale-reason regression" } })).status, 200, "route: hide with a reason");
const restoreNoReason = await call(restoreRoute.POST, "/api/admin/videos/x/restore", { method: "POST", secret: PUBLISH, id: attach.videoId, body: {} });
eq([restoreNoReason.status, restoreNoReason.json.changed], [200, true], "route: restore with an empty body");
const staleCheck = (await events(`where resource_id = '${attach.videoId}' and action in ('restaurant_video.hidden', 'restaurant_video.restored')`)).slice(-2);
eq([staleCheck[0].action, staleCheck[0].reason, staleCheck[1].action, staleCheck[1].reason], ["restaurant_video.hidden", "Hidden for the stale-reason regression", "restaurant_video.restored", null], "REGRESSION: the restore event holds no reason; only the hide holds the one supplied for it");

// hero + hide routes pass context through
eq((await call(publishedHide.POST, "/api/admin/restaurants/published/x/hide", { method: "POST", secret: PUBLISH, id: okPromo.restaurant.id, body: { auditReason: "Closed for renovation" } })).status, 200, "route: hide restaurant");
eq((await events("where action = 'restaurant.hidden'")).at(-1).reason, "Closed for renovation", "route: restaurant hide reason recorded");
void heroRoute; // GET/PUT/DELETE of the hero route call Google (network) and are covered at the db layer above.

// ---- sanitization and size limits ----
{
  const evBefore = (await events()).length;
  const row = await one("select name, review_notes from candidate_restaurants where id = $1", [nycCandidate.id]);
  await assert.rejects(() => candidatesDb.updateCandidateRestaurant(nycCandidate.id, { reviewNotes: `pasted ${PUBLISH} by mistake` }, PUB_CTX("req-san-0001")), /configured admin credential/); checks++;
  await assert.rejects(() => candidatesDb.insertCandidateRestaurant(newCandidate({ name: "Leaky", slug: "leaky", reviewNotes: `x ${DRAFT}`, googlePlaceId: null }), DRAFT_CTX("req-san-0002")), /configured admin credential/); checks++;
  await assert.rejects(() => candidatesDb.updateCandidateRestaurant(nycCandidate.id, { name: "Fine name" }, { ...PUB_CTX("req-san-0003"), reason: `see ${PUBLISH}` }), /configured admin credential/); checks++;
  await assert.rejects(() => candidatesDb.updateCandidateRestaurant(nycCandidate.id, { name: "Fine name" }, { ...PUB_CTX("req-san-0004"), details: { note: DRAFT } }), /configured admin credential/); checks++;
  eq(await one("select name, review_notes from candidate_restaurants where id = $1", [nycCandidate.id]), row, "a refused credential-bearing write changed nothing");
  eq((await events()).length, evBefore, "…and wrote no event");

  // an unaudited column can never be written through the audited helper
  await assert.rejects(() => auditHelpers.auditedUpdate({ table: schemaMod.candidateRestaurants, where: eqOp(schemaMod.candidateRestaurants.id, nycCandidate.id), set: { suggestionConfidence: "high" },
    audit: { ctx: PUB_CTX("req-san-0005"), resourceType: "restaurant_candidate", fields: ["name"], action: "restaurant_candidate.updated" } }), /not on the audit allow-list/); checks++;

  // a reason with NUL / control characters is cleaned, not a 500
  const nul = await call(candidateRoute.PATCH, "/api/admin/restaurants/candidates/x", { method: "PATCH", secret: PUBLISH, id: nycCandidate.id, body: { name: "Rasika NYC", auditReason: "checked\u0000 the menu\u0007" } });
  eq(nul.status, 200, "route: a reason containing NUL/control characters is accepted after cleaning");
  eq((await events()).at(-1).reason, "checked the menu", "…and stored without them");

  // worst-case event size: every allow-listed text field at the clip boundary, changed
  const wide = (c) => c.repeat(399);
  const big = await candidatesDb.insertCandidateRestaurant(newCandidate({ name: wide("a"), slug: "big-one", googlePlaceId: null, address: wide("b"), neighborhood: wide("c"), reasonText: wide("d"), reviewNotes: wide("e"), websiteDomain: wide("f") }), DRAFT_CTX("req-big-0001"));
  await candidatesDb.updateCandidateRestaurant(big.id, { name: wide("A"), address: wide("B"), neighborhood: wide("C"), reasonText: wide("D"), reviewNotes: wide("E"), websiteDomain: wide("F"), dishHighlights: ["x".repeat(399)], cuisineTags: ["asian"] }, PUB_CTX("req-big-0002"));
  const bigEvent = (await events(`where resource_id = '${big.id}'`)).at(-1);
  ok(JSON.stringify(bigEvent.changes).length < 24000 && Object.keys(bigEvent.changes).length >= 8, "a maximal edit still fits the event size bound (values at the clip boundary are kept whole)");
  const huge = await candidatesDb.updateCandidateRestaurant(big.id, { reviewNotes: "z".repeat(4000) }, PUB_CTX("req-big-0003"));
  ok(huge, "a 4000-character note is stored on the record");
  const hugeEvent = (await events(`where resource_id = '${big.id}'`)).at(-1);
  eq([hugeEvent.changes.review_notes.to._clipped, hugeEvent.changes.review_notes.to.length, hugeEvent.changes.review_notes.to.preview.length], [true, 4002, 120], "…but only a clipped summary (length + 120 chars) goes into the audit event");

  // override codes: only server-raised codes are stored
  const odd = await candidatesDb.insertCandidateRestaurant(newCandidate({ name: "Odd Place", slug: "odd-place", googlePlaceId: null, address: "5 Odd Rd, New York, NY 10001" }), DRAFT_CTX("req-odd-0001"));
  await candidatesDb.updateCandidateRestaurant(odd.id, { status: "approved" }, PUB_CTX("req-odd-0002"));
  const oddPromo = await restaurantsDb.promoteCandidateToRestaurant(odd.id, PUB_CTX("req-odd-0003"), { acknowledged: ["missing_place_identity", "<script>alert(1)</script>", "x".repeat(50)], reason: "Verified with the owner by phone" });
  ok(oddPromo.ok, "override with extra client-supplied codes still publishes");
  eq((await events(`where action = 'restaurant.promoted' and resource_id = '${oddPromo.restaurant.id}'`))[0].details.override.acknowledged, ["missing_place_identity"], "only recognised codes are stored in the event");
}

// ---- direct-add (three steps) under partial failure: documented, NOT atomic as a whole ----
{
  const resolved = (id) => ({ ok: true, resolved: {
    platform: "tiktok", sourceUrl: `https://www.tiktok.com/@direct.add/video/${id}`, normalizedSourceUrl: `https://www.tiktok.com/@direct.add/video/${id}`,
    platformVideoId: String(id), creatorHandle: "@direct.add", creatorName: "direct.add", caption: "short", thumbnailUrl: null,
    embedUrl: `https://www.tiktok.com/player/v1/${id}`, attributionText: "TikTok post by direct.add", publishedAt: null, sourceFetchedAt: null,
    legalDisplayStatus: "embeddable", resolverStatus: "resolved", resolverError: null } });
  const sb2 = createAppSandbox(db, { env: ENV, overrides: { "lib/socialVideo.ts": { resolveSocialVideo: async (url) => resolved(url.split("/").pop()) } } });
  const addRoute = sb2.load("app/api/admin/restaurants/[slug]/videos/route.ts");
  const attachRoute = sb2.load("app/api/admin/videos/candidates/[id]/attach/route.ts");
  const failOn = (action) => client.exec(`
    create or replace function _fail_on() returns trigger language plpgsql as $$ begin
      if new.action = '${action}' then raise exception 'simulated failure at ${action}'; end if; return new; end $$;
    create trigger _fail_on before insert on admin_events for each row execute function _fail_on();`);
  const heal = () => client.exec("drop trigger _fail_on on admin_events; drop function _fail_on();");
  await restaurantsDb.updatePublishedRestaurant(okPromo.restaurant.id, { status: "published" }, PUB_CTX("req-republish-01")); // an earlier route test hid it
  const slug = okPromo.restaurant.slug;
  const addVideo = (id) => call(addRoute.POST, `/api/admin/restaurants/${slug}/videos`, { method: "POST", secret: PUBLISH, slug, body: { sourceUrl: `https://www.tiktok.com/@direct.add/video/${id}` } });
  const trail = async (id) => (await events(`where details->>'via' = 'direct_add' and resource_id in (select id from video_candidates where platform_video_id = '${id}' union select 'vc-' || id from video_candidates where platform_video_id = '${id}')`)).map((e) => e.action);
  const candidateRow = (id) => one("select id, status, attached_video_id from video_candidates where platform_video_id = $1", [String(id)]);

  // happy path: three events, ONE request id, a live video
  const happy = await addVideo(31001);
  eq(happy.status, 201, "direct-add: success");
  const happyEvents = await events(`where details->>'via' = 'direct_add' and request_id in (select request_id from admin_events where action = 'restaurant_video.attached' and resource_id = '${happy.json.videoId}')`);
  eq(happyEvents.map((e) => e.action), ["video_candidate.created", "video_candidate.approved", "restaurant_video.attached"], "direct-add: success writes created, approved, attached");
  eq(new Set(happyEvents.map((e) => e.request_id)).size, 1, "direct-add: all three events share one request id");

  // failure at the LAST step (attach): earlier steps stay committed and are honestly recorded
  await failOn("restaurant_video.attached");
  const failAttach = await addVideo(31002);
  eq([failAttach.status, failAttach.json.code], [500, "add_failed"], "direct-add: attach step fails -> 500 add_failed");
  const c2 = await candidateRow(31002);
  eq([c2.status, c2.attached_video_id], ["approved", null], "direct-add partial failure: candidate stays APPROVED and unattached (steps 1-2 committed, step 3 not)");
  eq(await count("restaurant_videos", "id = 'vc-' || " + `'${c2.id}'`), 0, "direct-add partial failure: no live video");
  eq(await trail(31002), ["video_candidate.created", "video_candidate.approved"], "direct-add partial failure: the log shows exactly the two steps that happened, no attached event");
  eq((await addVideo(31002)).status, 409, "direct-add: retrying the same URL is refused as a duplicate (it is in the queue) instead of creating a second record");
  await heal();
  const recovered = await call(attachRoute.POST, "/api/admin/videos/candidates/x/attach", { method: "POST", secret: PUBLISH, id: c2.id, body: { expectedRestaurantSlug: slug } });
  eq(recovered.status, 201, "direct-add recovery: the approved candidate attaches through the normal attach route");
  eq((await events(`where action = 'restaurant_video.attached' and details->>'videoCandidateId' = '${c2.id}'`)).length, 1, "direct-add recovery: completing it through the attach route is audited (one event, different request id)");

  // failure at step 2 (approve): only the candidate exists, still needs_review
  await failOn("video_candidate.approved");
  const failApprove = await addVideo(31003);
  eq(failApprove.status, 500, "direct-add: approve step fails -> 500");
  const c3 = await candidateRow(31003);
  eq([c3.status, c3.attached_video_id], ["needs_review", null], "direct-add partial failure at step 2: candidate stays needs_review");
  eq(await trail(31003), ["video_candidate.created"], "direct-add partial failure at step 2: only the creation is logged");
  await heal();

  // failure at step 1 (create): nothing exists
  await failOn("video_candidate.created");
  eq((await addVideo(31004)).status, 500, "direct-add: create step fails -> 500");
  eq(await count("video_candidates", "platform_video_id = '31004'"), 0, "direct-add partial failure at step 1: nothing created");
  await heal();
}

// ---- draft credential: publication, recovery, history and every other publish-scope action are refused ----
{
  const gate = sb.load("app/api/admin/restaurants/published/[id]/route.ts");
  const attachRoute2 = sb.load("app/api/admin/videos/candidates/[id]/attach/route.ts");
  const before = { events: (await events()).length, data: await snap() };
  const draft = (handler, method, body, id = "x") => call(handler, "/api/admin/x", { method, secret: DRAFT, id, slug: id, body });
  const attempts = [
    ["read audit history", () => draft(auditRoute.GET, "GET")],
    ["promote", () => draft(promoteRoute.POST, "POST", {}, created.id)],
    ["restore video", () => draft(restoreRoute.POST, "POST", {}, attach.videoId)],
    ["correct video", () => draft(videoRoute.PATCH, "PATCH", { creatorHandle: "@nope.nope" }, attach.videoId)],
    ["hide video", () => draft(videoRoute.DELETE, "DELETE", undefined, attach.videoId)],
    ["list hidden videos", () => draft(videosListRoute.GET, "GET")],
    ["edit published restaurant", () => draft(gate.PATCH, "PATCH", { reasonText: "x" }, promoted.restaurant.id)],
    ["hide published restaurant", () => draft(publishedHide.POST, "POST", {}, promoted.restaurant.id)],
    ["attach video", () => draft(attachRoute2.POST, "POST", { expectedRestaurantSlug: "x" }, vc.candidate.id)],
    ["approve a candidate", () => draft(candidateRoute.PATCH, "PATCH", { status: "approved" }, nycCandidate.id)],
  ];
  for (const [label, run] of attempts) {
    const res = await run();
    eq([res.status, res.json?.code], [403, "insufficient_scope"], `draft credential: ${label} -> 403 insufficient_scope`);
    ok(!res.text.includes("events\":[") && !("events" in (res.json ?? {})), `draft credential: ${label} returns no data`);
  }
  eq((await events()).length, before.events, "draft credential: none of those wrote an audit event");
  eq(await snap(), before.data, "draft credential: none of those changed any data");
}

// ---- final accounting ----
const total = (await events()).length;
const dupes = (await client.query("select request_id, action, resource_id, count(*)::int n from admin_events group by 1,2,3 having count(*) > 1 and action not in ('restaurant_candidate.hero_selected')")).rows;
eq(dupes.filter((d) => !["req-edit", "req-pub"].some((p) => d.request_id.startsWith(p))), [], "no request wrote the same action on the same record twice");
console.log(`admin-audit-integration-check: ${checks} checks passed (${total} audit events written on PostgreSQL ${(await one("select version() v")).v.split(" ").slice(0, 2).join(" ")} via PGlite).`);
await client.close();
