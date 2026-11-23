// Admin Hardening B — pure checks (no database): taxonomy, allow-lists, credential attribution, request
// correlation, reason handling, video correction validation, publication checks, and a static guard that
// no application code mutates an audited table without going through the audited helpers.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createSandbox } from "./lib/ts-sandbox.mjs";
import { root } from "./lib/pg-harness.mjs";

let checks = 0;
const norm = (v) => (v === undefined ? "__undefined__" : JSON.parse(JSON.stringify(v)));
const eq = (a, b, m) => { assert.deepEqual(norm(a), norm(b), m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

const env = { FOODSWIPE_ADMIN_SECRET: "synthetic-publish-secret-0123456789", FOODSWIPE_ADMIN_DRAFT_SECRET: "synthetic-draft-secret-abcdefghij" };
const sb = createSandbox({ root, env, overrides: { "lib/db/index.ts": { getDb: () => null, isDbConfigured: () => false } } });
const audit = sb.load("lib/adminAudit.ts");
const auth = sb.load("lib/adminAuth.ts");
const videoValidation = sb.load("lib/adminVideoValidation.ts");
const checksLib = sb.load("lib/publicationChecks.ts");
const reasonField = sb.load("lib/adminReasonField.ts");

// ---- taxonomy ----
eq(new Set(audit.AUDIT_ACTIONS).size, audit.AUDIT_ACTIONS.length, "actions are unique");
for (const action of audit.AUDIT_ACTIONS) {
  const [resource, verb] = action.split(".");
  ok(audit.AUDIT_RESOURCE_TYPES.includes(resource) && /^[a-z_]+$/.test(verb), `${action} is <resource>.<verb>`);
  ok(audit.AUDIT_CATEGORIES.includes(audit.auditCategory(action)), `${action} has a category`);
}
eq(audit.auditCategory("restaurant.promoted"), "publication", "promotion is publication");
eq(audit.auditCategory("restaurant_candidate.approved"), "approval", "approval is approval");
eq(audit.auditCategory("restaurant_video.restored"), "recovery", "restore is recovery");
eq(audit.auditCategory("nope"), null, "unknown action has no category");

// ---- allow-lists: nothing credential-like, nothing large, nothing from provider payloads ----
const FORBIDDEN = /secret|token|password|authorization|api_?key|credential|resolver|suggested|raw|evidence|cleaned_text|photo_?uri|photo_name/i;
for (const [kind, fields] of Object.entries(audit.AUDIT_FIELDS)) {
  eq(new Set(fields).size, fields.length, `${kind} fields are unique`);
  for (const f of fields) ok(/^[a-z_]+$/.test(f) && !FORBIDDEN.test(f), `${kind}.${f} is a plain, non-sensitive column name`);
}

// ---- credential attribution (non-secret identity from which secret matched) ----
const req = (secret) => new Request("https://x.test", { headers: secret ? { "x-foodswipe-admin-secret": secret } : {} });
eq(auth.authenticateAdmin(req(env.FOODSWIPE_ADMIN_SECRET)).actor, { identity: "publish-credential", scope: "publish", assurance: "shared-credential" }, "default publish identity");
eq(auth.authenticateAdmin(req(env.FOODSWIPE_ADMIN_DRAFT_SECRET)).actor, { identity: "draft-credential", scope: "draft", assurance: "shared-credential" }, "default draft identity");
env.FOODSWIPE_ADMIN_PUBLISH_LABEL = "caron";
env.FOODSWIPE_ADMIN_DRAFT_LABEL = "ingest-agent-1";
eq([auth.authenticateAdmin(req(env.FOODSWIPE_ADMIN_SECRET)).actor.identity, auth.authenticateAdmin(req(env.FOODSWIPE_ADMIN_DRAFT_SECRET)).actor.identity], ["caron", "ingest-agent-1"], "operator labels are honoured");
for (const bad of ["has space", "<script>", "a".repeat(41), "-leading", "x;drop table", ""]) {
  env.FOODSWIPE_ADMIN_DRAFT_LABEL = bad;
  eq(auth.authenticateAdmin(req(env.FOODSWIPE_ADMIN_DRAFT_SECRET)).actor.identity, "draft-credential", `invalid label ${JSON.stringify(bad).slice(0, 20)} falls back to the default`);
}
env.FOODSWIPE_ADMIN_DRAFT_LABEL = env.FOODSWIPE_ADMIN_DRAFT_SECRET; // a secret mistakenly used as a label must still be a "label": it is shown, so it must not look like one
ok(!JSON.stringify(auth.authenticateAdmin(req(env.FOODSWIPE_ADMIN_SECRET))).includes(env.FOODSWIPE_ADMIN_SECRET), "the publish credential never appears in its own auth result");
delete env.FOODSWIPE_ADMIN_DRAFT_LABEL;
eq(auth.authenticateAdmin(req("wrong")).ok, false, "unknown credential has no actor");
eq(auth.authenticateAdmin(req()).ok, false, "no credential has no actor");

// ---- request correlation ----
const withId = (v) => new Request("https://x.test", { headers: v === null ? {} : { "x-request-id": v } });
eq(audit.newRequestId(withId("trace-abc-12345")), "trace-abc-12345", "well-formed caller id is used");
for (const bad of ["short", "has space in it!!", "x".repeat(65), "<script>alert(1)</script>"]) ok(audit.newRequestId(withId(bad)) !== bad, `malformed request id ${JSON.stringify(bad).slice(0, 18)} is replaced`);
ok(/^[0-9a-f-]{36}$/.test(audit.newRequestId(withId(null))), "a fresh uuid is generated when none is supplied");
ok(audit.newRequestId(withId(null)) !== audit.newRequestId(withId(null)), "generated ids differ");

// ---- reasons ----
eq(audit.cleanReason(undefined), { ok: true, reason: null }, "no reason");
eq(audit.cleanReason("  checked  "), { ok: true, reason: "checked" }, "reason trimmed");
eq(audit.cleanReason("   "), { ok: true, reason: null }, "blank reason is none");
ok(!audit.cleanReason(5).ok && !audit.cleanReason("x".repeat(1001)).ok, "non-string and over-long reasons refused");
ok(!audit.cleanReason(`pasted ${env.FOODSWIPE_ADMIN_SECRET} by mistake`).ok, "a reason containing the publication credential is refused");
ok(!audit.cleanReason(`pasted ${env.FOODSWIPE_ADMIN_DRAFT_SECRET} by mistake`).ok, "a reason containing the draft credential is refused");
eq(audit.cleanReason("a\u0000b\u0007c\u001fd").reason, "abcd", "NUL and control characters are stripped from a reason (PostgreSQL rejects NUL)");
eq(audit.cleanReason("line one\n\tline two").reason, "line one\n\tline two", "newlines and tabs are kept");
eq(audit.cleanReason("\u0000\u0001").reason, null, "a reason that is only control characters is none");
eq(audit.containsConfiguredSecret(`x ${env.FOODSWIPE_ADMIN_SECRET} y`), true, "configured credential detected");
eq(audit.containsConfiguredSecret("nothing secret here"), false, "ordinary text passes");
const split = audit.splitAuditReason({ name: "x", auditReason: "why" });
eq([split.ok, split.body, split.reason], [true, { name: "x" }, "why"], "auditReason is removed from the body before strict validation");
eq(audit.splitAuditReason({ name: "x" }).reason, null, "body without a reason is untouched");
eq(audit.splitAuditReason([1]).ok, true, "non-object bodies pass through to their own validator");

// ---- video correction validation ----
const vv = (b) => videoValidation.validateVideoCorrection(b);
eq(vv({ creatorHandle: "@jyu.eats", creatorDisplayName: " Jyu ", attributionText: "TikTok post" }).value, { creatorHandle: "@jyu.eats", creatorDisplayName: "Jyu", attributionText: "TikTok post" }, "valid correction is trimmed");
eq(vv({ creatorDisplayName: null }).value, { creatorDisplayName: null }, "display name may be cleared");
eq(vv({ creatorDisplayName: "" }).value, { creatorDisplayName: null }, "blank display name clears it");
for (const [bad, code] of [[{ creatorHandle: "jyu" }, "invalid_handle"], [{ creatorHandle: "@" }, "invalid_handle"], [{ creatorHandle: null }, "invalid_handle"],
  [{ attributionText: "" }, "empty_value"], [{ attributionText: null }, "empty_value"], [{ attributionText: "x".repeat(301) }, "too_long"],
  [{ sourceUrl: "https://a.test" }, "unknown_field"], [{ legalDisplayStatus: "embeddable" }, "unknown_field"], [{ embedUrl: "https://a.test" }, "unknown_field"],
  [{ platform: "TikTok" }, "unknown_field"], [{ caption: "c" }, "unknown_field"], [{ status: "active" }, "unknown_field"], [{ restaurantSlug: "x" }, "unknown_field"],
  [{}, "empty_patch"], [{ auditReason: "only a reason" }, "empty_patch"], [[], "invalid_body"], [null, "invalid_body"]]) {
  const r = vv(bad);
  ok(!r.ok && r.errors.some((e) => e.code === code), `correction ${JSON.stringify(bad)?.slice(0, 40)} -> ${code}`);
}
ok(vv({ sourceUrl: "https://a.test" }).errors[0].message.includes("cannot be changed"), "immutable fields are refused by name with an explanation");

// ---- publication checks ----
const cand = (o = {}) => ({ id: "c1", name: "Semma", address: "60 Greenwich Ave, New York, NY", market: "nyc", lat: 40.7306, lng: -73.9866, googlePlaceId: "ChIJsemma0123456789abcdef", source: "google_places", ...o });
const codes = (list) => list.map((c) => `${c.severity}:${c.code}`).sort();
eq(codes(checksLib.evaluatePublicationChecks(cand(), [])), [], "a clean Google-sourced candidate has no checks");
eq(codes(checksLib.evaluatePublicationChecks(cand({ source: "manual" }), [])), ["info:place_identity_unverified"], "a hand-typed Place ID is informational only");
eq(codes(checksLib.evaluatePublicationChecks(cand({ googlePlaceId: null }), [])), ["warning:missing_place_identity"], "no Place ID is a warning");
eq(codes(checksLib.evaluatePublicationChecks(cand({ googlePlaceId: "bad id!" }), [])), ["warning:malformed_place_identity"], "a malformed Place ID is a warning");
eq(codes(checksLib.evaluatePublicationChecks(cand({ lat: 38.9072, lng: -77.0369 }), [])), ["warning:coordinates_outside_market"], "a DC pin on an NYC candidate is a warning");
ok(checksLib.evaluatePublicationChecks(cand({ lat: 38.9072, lng: -77.0369 }), [])[0].message.includes("DC"), "…and names the market the pin is actually near");
eq(codes(checksLib.evaluatePublicationChecks(cand({ lat: 40.65, lng: -73.95 }), [])), [], "another borough is fine");
eq(codes(checksLib.evaluatePublicationChecks(cand({ lat: 41.8, lng: -87.6 }), [])), ["warning:coordinates_outside_market"], "a pin nowhere near any market is a warning");
const rec = (o) => ({ kind: "published", id: "p1", name: "Semma", address: "60 Greenwich Ave, New York, NY", market: "nyc", status: "published", slug: "semma", googlePlaceId: "other", ...o });
eq(codes(checksLib.evaluatePublicationChecks(cand(), [rec()])), ["warning:possible_duplicate"], "same address and name is a likely duplicate");
eq(codes(checksLib.evaluatePublicationChecks(cand(), [rec({ address: "12 Other St, New York, NY" })])), ["info:same_name_other_location"], "same name at another address is only informational (a branch)");
eq(codes(checksLib.evaluatePublicationChecks(cand({ name: "Dhamaka" }), [rec({ name: "Essex Fish Stall" })])), ["info:same_address_different_name"], "a different restaurant in the same building (food hall) is informational");
eq(codes(checksLib.evaluatePublicationChecks(cand(), [rec({ market: "dc" })])), [], "records in another market are not compared");
eq(codes(checksLib.evaluatePublicationChecks(cand(), [rec({ id: "c1" })])), [], "a record is never flagged against itself");
// overrides
const warn = checksLib.evaluatePublicationChecks(cand({ googlePlaceId: null, lat: 38.9, lng: -77 }), []);
eq(checksLib.unresolvedWarnings(warn, null).length, 2, "no override: every warning unresolved");
eq(checksLib.unresolvedWarnings(warn, { acknowledged: ["missing_place_identity", "coordinates_outside_market"], reason: "Verified on site by phone" }).length, 0, "all acknowledged with a reason: resolved");
eq(checksLib.unresolvedWarnings(warn, { acknowledged: ["missing_place_identity"], reason: "Verified on site by phone" }).map((c) => c.code), ["coordinates_outside_market"], "partial acknowledgement");
eq(checksLib.unresolvedWarnings(warn, { acknowledged: ["missing_place_identity", "coordinates_outside_market"], reason: "ok" }).length, 2, "an acknowledgement without a real reason resolves nothing");
eq(checksLib.unresolvedWarnings(checksLib.evaluatePublicationChecks(cand({ source: "manual" }), []), null), [], "info notes never block");
ok(!checksLib.parsePublicationOverride({ acknowledge: [], reason: "long enough reason" }).ok, "empty acknowledge list refused");
ok(!checksLib.parsePublicationOverride({ acknowledge: ["a"], reason: "short" }).ok, "short reason refused");
ok(!checksLib.parsePublicationOverride("yes").ok, "non-object override refused");
eq(checksLib.parsePublicationOverride(undefined), { ok: true, override: null }, "no override is fine");
eq(checksLib.parsePublicationOverride({ acknowledge: ["a", "a", "b"], reason: " a proper reason " }).override, { acknowledged: ["a", "b"], reason: "a proper reason" }, "override is normalised");

// ---- REGRESSION: a reason typed for one action must never be recorded on the next (Hide -> Restore) ----
{
  const { reasonReducer: step, reasonForRequest: send, REASON_MAX_LENGTH } = reasonField;
  let box = "";
  box = step(box, { type: "edited", value: "  Wrong restaurant  " });
  eq(send(box), "Wrong restaurant", "the reason sent is exactly what was typed, trimmed");
  eq(send(step("", { type: "edited", value: "   " })), undefined, "a blank reason sends no reason (nothing is invented)");
  eq(send(""), undefined, "an empty box sends no reason");
  eq(step(box, { type: "action-failed" }), box, "a failed action keeps the text so the person can retry");
  eq(step(box, { type: "action-succeeded" }), "", "a completed action clears the reason");
  eq(step(box, { type: "collapsed" }), "", "collapsing the row clears the reason");
  eq(step(box, { type: "record-changed" }), "", "a changed record clears the reason");
  eq(step("", { type: "edited", value: "x".repeat(REASON_MAX_LENGTH + 50) }).length, REASON_MAX_LENGTH, "the box never holds more than the server accepts");
  // The scenario from release QA: type a reason, Hide succeeds, then Restore with nothing typed.
  let state = step("", { type: "edited", value: "Hidden for QA" });
  const hideRequest = send(state);
  state = step(state, { type: "action-succeeded" });
  const restoreRequest = send(state);
  eq([hideRequest, restoreRequest], ["Hidden for QA", undefined], "Hide records its reason; the following Restore records none");
  // Static guard on the screen itself: it must use the lifecycle, not a plain sticky state.
  const screen = readFileSync(join(root, "components/AdminPublishedVideos.tsx"), "utf8");
  ok(/useReducer\(reasonReducer, ""\)/.test(screen) && !/setReason\b/.test(screen), "the video screen keeps its reason in the reducer, not in sticky state");
  ok(/auditReason = reasonForRequest\(reason\)/.test(screen) && !/auditReason:\s*reason\b/.test(screen), "requests send only reasonForRequest(reason)");
  const callBody = screen.slice(screen.indexOf("async function call("), screen.indexOf("const auditReason"));
  ok(callBody.indexOf('dispatchReason({ type: "action-succeeded" })') > -1 && callBody.indexOf('dispatchReason({ type: "action-succeeded" })') < callBody.indexOf("ok(data)"), "a successful save, hide or restore clears the reason before the row updates");
  ok(!/dispatchReason\(\{ type: "action-succeeded" \}\)[\s\S]*?catch/.test(callBody.slice(callBody.indexOf("catch"))), "a failure path never clears the reason");
  ok(/dispatchReason\(\{ type: "collapsed" \}\)/.test(screen), "collapsing a row clears its reason");
  ok(/key=\{`\$\{v\.id\}-\$\{v\.updatedAt\}-\$\{v\.status\}`\}/.test(screen), "a status change (hide/restore) remounts the row, so no field state survives it");
}

// ---- static guard: audited tables are only written through the audited helpers ----
const AUDITED_TABLES = ["candidateRestaurants", "restaurants", "videoCandidates", "restaurantVideos", "restaurantHeroMediaSelections", "adminEvents"];
const sources = [];
const walk = (dir) => { for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
  const p = join(dir, e.name);
  if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(e.name)) sources.push(p);
} };
for (const dir of ["lib", "app", "components"]) walk(dir);
const bypass = [];
for (const file of sources) {
  if (file === "lib/db/audit.ts") continue;
  const text = readFileSync(join(root, file), "utf8");
  for (const t of AUDITED_TABLES) {
    if (new RegExp(`\\.(insert|update|delete)\\(\\s*${t}\\s*\\)`).test(text)) bypass.push(`${file}: direct write to ${t}`);
  }
  if (file !== "lib/db/audit.ts" && /(insert into|update|delete from)\s+\$\{(candidateRestaurants|restaurants|videoCandidates|restaurantVideos|restaurantHeroMediaSelections)\}/i.test(text) && !/auditSql\.eventInsert/.test(text)) {
    bypass.push(`${file}: raw write SQL without an audit event`);
  }
  if (/admin_events/.test(text) && !["lib/db/audit.ts", "lib/db/auditEvents.ts", "lib/db/schema.ts"].includes(file) && /\.(update|delete)\(\s*adminEvents|delete from "?admin_events|update "?admin_events|truncate/i.test(text)) bypass.push(`${file}: touches admin_events`);
}
eq(bypass, [], "no application code writes an audited table outside lib/db/audit.ts helpers");
ok(!sources.some((f) => /\.(update|delete)\(\s*adminEvents/.test(readFileSync(join(root, f), "utf8"))), "nothing updates or deletes audit events");

console.log(`admin-audit-unit-check: ${checks} checks passed.`);
