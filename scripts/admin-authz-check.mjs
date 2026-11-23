// Authorization matrix for EVERY internal admin route, plus unit checks of the credential logic.
// Synthetic credentials only. No network, database, browser or real secrets.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createSandbox, trapModule } from "./lib/ts-sandbox.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLISH = "synthetic-publish-secret-0123456789";
const DRAFT = "synthetic-draft-secret-abcdefghij";
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const norm = (v) => (v === undefined ? "__undefined__" : JSON.parse(JSON.stringify(v)));
const eq = (a, b, msg) => { assert.deepEqual(norm(a), norm(b), msg); checks++; }; // JSON-normalized: objects from the vm have another realm

// ---- the policy: required scope per route and method. A new admin route MUST be added here. ----
const POLICY = {
  "app/api/admin/restaurants/[slug]/collect-website-evidence/route.ts": { POST: "draft" },
  "app/api/admin/restaurants/[slug]/discovery/candidates/route.ts": { POST: "draft" },
  "app/api/admin/restaurants/[slug]/discovery/queries/route.ts": { GET: "draft" },
  "app/api/admin/restaurants/[slug]/discovery/search/route.ts": { POST: "draft" },
  "app/api/admin/restaurants/[slug]/suggest-tags/route.ts": { GET: "draft" },
  "app/api/admin/restaurants/[slug]/videos/route.ts": { POST: "publish" }, // direct attach to a live profile
  "app/api/admin/restaurants/candidates/[id]/collect-website-evidence/route.ts": { POST: "draft" },
  "app/api/admin/restaurants/candidates/[id]/hero-media-selection/route.ts": { GET: "draft", PUT: "publish", DELETE: "publish" },
  "app/api/admin/restaurants/candidates/[id]/photo-candidates/route.ts": { GET: "draft" },
  "app/api/admin/restaurants/candidates/[id]/photo/route.ts": { GET: "draft" },
  "app/api/admin/restaurants/candidates/[id]/review/route.ts": { GET: "draft" },
  "app/api/admin/restaurants/candidates/[id]/promote/route.ts": { POST: "publish" },
  "app/api/admin/restaurants/candidates/[id]/route.ts": { PATCH: "draft" }, // status/approved-edit rules checked in the API suite
  "app/api/admin/restaurants/candidates/[id]/suggest-tags/route.ts": { GET: "draft" },
  "app/api/admin/restaurants/candidates/import/google/route.ts": { POST: "draft" },
  "app/api/admin/restaurants/candidates/route.ts": { GET: "draft", POST: "draft" },
  "app/api/admin/restaurants/lookup/route.ts": { GET: "draft" },
  "app/api/admin/restaurants/published/[id]/hide/route.ts": { POST: "publish" },
  "app/api/admin/restaurants/published/[id]/route.ts": { PATCH: "publish" },
  "app/api/admin/restaurants/published/route.ts": { GET: "draft" },
  "app/api/admin/audit/events/route.ts": { GET: "publish" }, // audit history: administrators only
  "app/api/admin/videos/[id]/restore/route.ts": { POST: "publish" },
  "app/api/admin/videos/[id]/route.ts": { GET: "publish", PATCH: "publish", DELETE: "publish" },
  "app/api/admin/videos/candidates/[id]/attach/route.ts": { POST: "publish" },
  "app/api/admin/videos/candidates/[id]/route.ts": { PATCH: "draft" }, // approve/reject/edit-approved rules checked in the API suite
  "app/api/admin/videos/candidates/route.ts": { GET: "draft", POST: "draft" },
  "app/api/admin/videos/route.ts": { GET: "publish", POST: "publish" },
  "app/api/resolve/youtube/route.ts": { POST: "draft" },
};

function findRoutes(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...findRoutes(p));
    else if (name === "route.ts") out.push(relative(root, p));
  }
  return out;
}
const found = [...findRoutes(join(root, "app/api/admin")), ...findRoutes(join(root, "app/api/resolve"))].sort();
eq(found, Object.keys(POLICY).sort(), "every admin/resolver route file is covered by the authorization policy");

// ---- build a sandbox where every database/network helper is a trap ----
const calls = [];
const env = {};
function makeSandbox() {
  const overrides = {
    "lib/db/index.ts": { isDbConfigured: () => true, getDb: () => null },
  };
  for (const f of readdirSync(join(root, "lib/db"))) {
    if (f.endsWith(".ts") && f !== "index.ts" && f !== "schema.ts") overrides[`lib/db/${f}`] = trapModule(`db/${f}`, calls);
  }
  for (const f of ["lib/places.ts", "lib/socialVideo.ts", "lib/websiteEvidence.ts", "lib/aiClient.ts", "lib/aiTagSuggester.ts", "lib/youtube.ts", "lib/discovery/searchProvider.ts"]) {
    overrides[f] = trapModule(f, calls);
  }
  return createSandbox({ root, overrides, env });
}

const VERBS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const sandbox = makeSandbox();
function request(method, secret, body) {
  const headers = { "content-type": "application/json" };
  if (secret !== undefined) headers["x-foodswipe-admin-secret"] = secret;
  return new Request("https://example.test/api/admin/x", { method, headers, body: ["GET", "DELETE"].includes(method) ? undefined : JSON.stringify(body ?? {}) });
}
const params = { params: Promise.resolve({ id: "id-1", slug: "slug-1" }) };
async function call(route, method, secret, body) {
  calls.length = 0;
  let res;
  try {
    res = await route[method](request(method, secret, body), params);
  } catch (error) {
    // The trap threw because the guard PASSED and the handler reached a database/network helper
    // (Next.js would answer 500). A denied request must never get here.
    return { status: 599, json: { thrown: String(error.message) }, reached: [...calls] };
  }
  let json = null;
  try { json = await res.clone().json(); } catch { /* non-JSON */ }
  return { status: res.status, json, reached: [...calls] };
}

for (const [file, methods] of Object.entries(POLICY)) {
  const route = sandbox.load(file);
  eq(VERBS.filter((v) => typeof route[v] === "function").sort(), Object.keys(methods).sort(), `${file}: exported methods match the policy`);
  for (const [method, scope] of Object.entries(methods)) {
    const label = `${method} ${file.replace("app/api/", "").replace("/route.ts", "")}`;
    Object.assign(env, { FOODSWIPE_ADMIN_SECRET: PUBLISH, FOODSWIPE_ADMIN_DRAFT_SECRET: DRAFT });

    // 1. no credential, 2. wrong credential, 3. credential of a different length: always 401, nothing touched.
    for (const bad of [undefined, "", "wrong", PUBLISH + "x", DRAFT.slice(0, -1)]) {
      const r = await call(route, method, bad);
      eq(r.status, 401, `${label}: ${JSON.stringify(bad)} -> 401`);
      eq(r.json?.code, "unauthorized", `${label}: structured 401`);
      eq(r.reached, [], `${label}: 401 reached no database/network helper`);
    }
    // 4. draft credential
    const d = await call(route, method, DRAFT);
    if (scope === "publish") {
      eq(d.status, 403, `${label}: draft credential is DENIED`);
      eq(d.json?.code, "insufficient_scope", `${label}: structured 403`);
      eq(d.json?.requiredScope, "publish", `${label}: names the required scope`);
      eq(d.reached, [], `${label}: denial happened before ANY database/network call`);
      ok(!JSON.stringify(d.json).includes(DRAFT) && !JSON.stringify(d.json).includes(PUBLISH), `${label}: response does not echo a secret`);
    } else {
      ok(![401, 403].includes(d.status) || d.json?.code === "draft_cannot_edit_approved", `${label}: draft credential passes the guard (got ${d.status})`);
    }
    // 5. publication credential keeps access to everything
    const p = await call(route, method, PUBLISH);
    ok(![401, 403].includes(p.status), `${label}: publication credential passes the guard (got ${p.status})`);
    // 6. admin disabled
    const saved = env.FOODSWIPE_ADMIN_SECRET;
    delete env.FOODSWIPE_ADMIN_SECRET;
    const off = await call(route, method, PUBLISH);
    eq(off.status, 503, `${label}: admin routes are disabled without the publish secret`);
    eq(off.reached, [], `${label}: disabled routes touch nothing`);
    env.FOODSWIPE_ADMIN_SECRET = saved;
    // 7. draft secret configured but INVALID credential presented -> never falls back to publish
    env.FOODSWIPE_ADMIN_DRAFT_SECRET = "a-different-draft-secret-value-123";
    const stale = await call(route, method, DRAFT);
    eq(stale.status, 401, `${label}: a rotated/invalid draft credential is rejected, not downgraded or upgraded`);
    env.FOODSWIPE_ADMIN_DRAFT_SECRET = DRAFT;
  }
}

// ---- credential logic ----
const auth = createSandbox({ root, env }).load("lib/adminAuth.ts");
const req = (s) => new Request("https://x.test", { headers: s === undefined ? {} : { "x-foodswipe-admin-secret": s } });
Object.assign(env, { FOODSWIPE_ADMIN_SECRET: PUBLISH, FOODSWIPE_ADMIN_DRAFT_SECRET: DRAFT });
eq(auth.authenticateAdmin(req(PUBLISH)), { ok: true, scope: "publish", actor: { identity: "publish-credential", scope: "publish", assurance: "shared-credential" } }, "publish credential -> non-secret credential identity");
eq(auth.authenticateAdmin(req(DRAFT)), { ok: true, scope: "draft", actor: { identity: "draft-credential", scope: "draft", assurance: "shared-credential" } }, "draft credential -> non-secret credential identity");
eq(auth.authenticateAdmin(req("nope")), { ok: false, reason: "unauthorized" });
eq(auth.hasValidAdminSecret(req(DRAFT)), false, "legacy helper never accepts the draft credential");
eq(auth.hasValidAdminSecret(req(PUBLISH)), true);
// draft secret ignored when too short, equal to the publish secret, or unset
env.FOODSWIPE_ADMIN_DRAFT_SECRET = "short";
eq(auth.authenticateAdmin(req("short")), { ok: false, reason: "unauthorized" }, "a short draft secret is ignored");
env.FOODSWIPE_ADMIN_DRAFT_SECRET = PUBLISH;
eq(auth.authenticateAdmin(req(PUBLISH)).scope, "publish", "identical secrets stay publish, never become a powerful 'draft'");
eq(auth.getDraftSecret(), undefined, "an identical draft secret is disabled");
delete env.FOODSWIPE_ADMIN_DRAFT_SECRET;
eq(auth.authenticateAdmin(req(DRAFT)), { ok: false, reason: "unauthorized" }, "no draft secret configured -> draft credential unusable");
delete env.FOODSWIPE_ADMIN_SECRET;
eq(auth.authenticateAdmin(req(PUBLISH)), { ok: false, reason: "not-configured" });
// constant-time comparison is used and secrets never reach the console
const authSrc = readFileSync(join(root, "lib/adminAuth.ts"), "utf8");
ok(/timingSafeEqual\(/.test(authSrc) && /createHash\("sha256"\)/.test(authSrc), "uses timingSafeEqual over fixed-length SHA-256 digests");
ok(!/console\./.test(authSrc) && !/console\./.test(readFileSync(join(root, "lib/adminGuard.ts"), "utf8")), "auth modules never log");
for (const [a, b] of [["", "x"], ["abc", "abcd"], [PUBLISH, PUBLISH.toUpperCase()], ["é", "e"]]) eq(auth.secretsMatch(a, b), false);
eq(auth.secretsMatch(PUBLISH, PUBLISH), true);
// no route still imports the legacy two-step guard or reads the secret header directly
for (const file of found) {
  const src = readFileSync(join(root, file), "utf8");
  ok(!/hasValidAdminSecret|isAdminConfigured/.test(src), `${file}: uses guardAdmin only`);
  ok(/guardAdmin\(/.test(src), `${file}: calls guardAdmin`);
}
console.log(`Admin authorization checks passed (${checks} assertions across ${found.length} routes; synthetic credentials, no network or database).`);
