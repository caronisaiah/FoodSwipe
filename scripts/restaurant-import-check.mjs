import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const ts = require("typescript");
const secret = "synthetic-import-test-secret";
const context = { query: "pizza in Brooklyn", maxResults: 10, market: "nyc" };
const fixtures = [..."ABCDEFGHIJ"].map((placeId) => ({
  placeId, displayName: `Pizza ${placeId}`, formattedAddress: `${placeId} Brooklyn, NY`,
  lat: 40.7, lng: -73.9, websiteUri: "https://www.example.test/menu",
  googlePriceLevel: "PRICE_LEVEL_MODERATE", primaryType: "pizza_restaurant",
  types: ["pizza_restaurant", "restaurant"], rating: 4.5, userRatingCount: 500,
}));

// Execute the actual route and pure helpers with synthetic auth/Google/DB only.
// No .env loading, fetch, real credentials or database clients are available.
function harness() {
  const state = { results: fixtures, candidates: new Map(), restaurants: new Map(),
    writes: [], sources: [], jobs: [], searches: [], failures: new Set(), races: new Set(),
    nullInserts: new Set(), failSource: false, failAudit: false, failSnapshot: false,
    authorized: true, configured: true, dbAvailable: true, googleStatus: "ok" };
  const cache = new Map();
  const db = {
    isDbConfigured: () => state.dbAvailable,
    slugify: (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    getExistingCandidatePlaceStatuses: async () => {
      if (state.failSnapshot) throw new Error("sensitive DB failure");
      return new Map([...state.candidates].map(([id, row]) => [id, row.status]));
    },
    getExistingRestaurantPlaceStatusesForImport: async () => new Map(state.restaurants),
    getExistingCandidateSlugs: async () => new Set([...state.candidates.values()].map((row) => row.slug)),
    getCandidateByGooglePlaceId: async (id) => state.candidates.get(id) ?? null,
    insertCandidateRestaurant: async (input) => {
      const id = input.googlePlaceId;
      if (state.races.has(id)) {
        state.candidates.set(id, { id: `race-${id}`, status: "rejected", slug: `race-${id}` });
        throw new Error("synthetic unique constraint race");
      }
      if (state.failures.has(id)) throw new Error("sensitive database details");
      if (state.nullInserts.has(id)) return null;
      if (state.candidates.has(id)) throw new Error("synthetic unique constraint");
      const row = { ...input, id: `candidate-${id}` };
      state.writes.push(row);
      state.candidates.set(id, row);
      return row;
    },
    addRestaurantSource: async (id, input) => {
      if (state.failSource) throw new Error("synthetic provenance failure");
      state.sources.push({ id, ...input });
    },
    createIngestionJob: async (input) => {
      if (state.failAudit) throw new Error("synthetic audit failure");
      state.jobs.push(input);
    },
  };
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative).exports;
    const compiledModule = { exports: {} };
    cache.set(relative, compiledModule);
    const output = ts.transpileModule(readFileSync(resolve(root, relative), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
        esModuleInterop: true },
    }).outputText;
    function localRequire(name) {
      if (name === "server-only") return {};
      if (name === "node:crypto") return require(name);
      if (relative === "lib/db/candidates.ts") {
        if (name === "drizzle-orm") return {};
        if (name === "./schema") return { restaurants: "synthetic-restaurant-table" };
        if (name === "./index") return { isDbConfigured: () => state.dbAvailable, getDb: () => state.dbAvailable ? {
          select: () => ({ from: async (table) => {
            assert.equal(table, "synthetic-restaurant-table");
            return [...state.restaurants].map(([googlePlaceId, status]) => ({ googlePlaceId, status }));
          } }),
        } : null };
      }
      if (name === "@/lib/adminAuth") return {
        isAdminConfigured: () => state.configured,
        hasValidAdminSecret: () => state.authorized,
      };
      if (name === "@/lib/db/candidates") return db;
      if (name === "@/lib/places") return { searchPlacesText: async (query, maxResults) => {
        state.searches.push({ query, maxResults });
        return { status: state.googleStatus, results: state.results };
      } };
      const allowed = ["markets", "restaurantImportPreview", "reviewLikelihood", "candidateTagger", "seed/restaurants", "video"];
      if (allowed.some((path) => name === `@/lib/${path}`)) return load(`${name.slice(2)}.ts`);
      throw new Error(`Unexpected isolated dependency: ${relative}: ${name}`);
    }
    runInNewContext(output, { module: compiledModule, exports: compiledModule.exports,
      require: localRequire, process: { env: { FOODSWIPE_ADMIN_SECRET: secret, GOOGLE_MAPS_API_KEY: "synthetic" } },
      console: { info() {} }, Request, Response, URL, Date, Buffer }, { filename: relative });
    return compiledModule.exports;
  }
  const route = load("app/api/admin/restaurants/candidates/import/google/route.ts");
  return { state, load, request: async (body) => {
    const res = await route.POST(new Request("https://example.test/api/admin/restaurants/candidates/import/google", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }));
    return { status: res.status, body: await res.json() };
  } };
}

let checks = 0;
function equal(actual, expected) {
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));
  checks++;
}
async function preview(h, ctx = context) {
  const res = await h.request(ctx);
  equal(res.status, 200);
  equal(res.body.dryRun, true);
  equal(h.state.writes.length, 0);
  equal(h.state.sources.length, 0);
  equal(h.state.jobs.length, 0);
  return res.body;
}
const writeBody = (p, ids, ctx = context) => ({ ...ctx, dryRun: false, previewToken: p.previewToken, selectedPlaceIds: ids });
const ids = (rows) => rows.map((row) => row.googlePlaceId).sort();
function counts(res, imported, skipped, failed) {
  equal([res.body.imported, res.body.skippedDuplicates, res.body.failed], [imported, skipped, failed]);
  equal(res.body.requested, imported + skipped + failed);
  equal(res.body.outcomes.length, res.body.requested);
  equal(new Set(res.body.outcomes.map((row) => row.googlePlaceId)).size, res.body.requested);
}

// The actual published-table read helper includes hidden rows and ignores null IDs.
{
  const h = harness();
  h.state.restaurants.set("published-ID", "published");
  h.state.restaurants.set("hidden-ID", "hidden");
  h.state.restaurants.set(null, "published");
  const helper = h.load("lib/db/candidates.ts");
  equal([...await helper.getExistingRestaurantPlaceStatusesForImport()],
    [["published-ID", "published"], ["hidden-ID", "hidden"]]);
  h.state.dbAvailable = false;
  equal([...await helper.getExistingRestaurantPlaceStatusesForImport()], []);
}

// One, exactly four, all, and duplicate IDs use one server write path.
for (const selected of [["A"], ["A", "D", "F", "J"], [..."ABCDEFGHIJ"], ["A", "A"]]) {
  const h = harness();
  const p = await preview(h);
  const res = await h.request(writeBody(p, selected));
  equal(res.status, 201);
  counts(res, new Set(selected).size, 0, 0);
  equal(ids(h.state.writes), [...new Set(selected)].sort());
  equal(h.state.sources.length, new Set(selected).size);
  equal(h.state.jobs.length, 1);
  for (const row of h.state.writes) {
    equal([row.market, row.status, row.source], ["nyc", "needs_review", "google_places"]);
    equal(row.websiteDomain, "example.test");
    equal(row.priceLevel, 2);
    equal(row.cuisineTags, ["pizza"]);
    equal(row.suggestedTags.cuisineTags, row.cuisineTags);
    equal(typeof row.reviewLikelihoodScore, "number");
    equal(row.sourceExpiresAt.getTime() - row.sourceFetchedAt.getTime(), 30 * 86400000);
  }
  const retry = await h.request(writeBody(p, selected));
  counts(retry, 0, new Set(selected).size, 0);
  equal(h.state.writes.length, new Set(selected).size);
}

// Overlapping requests rely on existing authoritative candidate uniqueness.
{
  const h = harness();
  const p = await preview(h);
  const responses = await Promise.all([h.request(writeBody(p, ["A"])), h.request(writeBody(p, ["A"]))]);
  equal(responses.reduce((sum, res) => sum + res.body.imported, 0), 1);
  equal(responses.reduce((sum, res) => sum + res.body.skippedDuplicates, 0), 1);
  equal(h.state.writes.length, 1);
}

// Arbitrary browser fields are ignored; omitted market still defaults to DC.
{
  const h = harness();
  const ctx = { query: context.query, maxResults: 10 };
  const p = await preview(h, ctx);
  const res = await h.request({ ...writeBody(p, ["A"], ctx), name: "Forged name", source: "manual",
    candidates: [{ googlePlaceId: "outside-preview", name: "Forged row" }], status: "published" });
  counts(res, 1, 0, 0);
  equal([h.state.writes[0].name, h.state.writes[0].source, h.state.writes[0].status, h.state.writes[0].market],
    ["Pizza A", "google_places", "needs_review", "dc"]);
  equal(ids(h.state.writes), ["A"]);
}

// Missing/empty/out-of-preview IDs, stale context and tampering fail before Google/writes.
{
  const h = harness();
  const p = await preview(h);
  const signing = h.load("lib/restaurantImportPreview.ts");
  const expired = signing.signImportPreview(context, ["A"], secret, Date.now() - signing.IMPORT_PREVIEW_TTL_MS - 1);
  const invalid = [
    [{ ...context, dryRun: false }, 400],
    [writeBody(p, []), 400],
    [writeBody(p, Array(21).fill("A")), 400],
    [writeBody(p, [null]), 400],
    [writeBody(p, [" A"]), 400],
    [writeBody(p, ["outside-preview"]), 400],
    [{ ...writeBody(p, ["A"]), previewToken: undefined }, 409],
    [{ ...writeBody(p, ["A"]), previewToken: "bad.signature" }, 409],
    [{ ...writeBody(p, ["A"]), previewToken: `${p.previewToken}x` }, 409],
    [{ ...writeBody(p, ["A"]), previewToken: expired }, 409],
    [writeBody(p, ["A"], { ...context, market: "dc" }), 409],
    [writeBody(p, ["A"], { ...context, query: "different search" }), 409],
    [writeBody(p, ["A"], { ...context, maxResults: 4 }), 409],
  ];
  for (const [body, status] of invalid) equal((await h.request(body)).status, status);
  equal(h.state.searches.length, 1);
  equal(h.state.writes.length, 0);
  equal(h.state.jobs.length, 0);
  equal((await h.request({ ...context, market: "invalid" })).status, 400);
  h.state.authorized = false;
  equal((await h.request(context)).status, 401);
  h.state.authorized = true;
  h.state.configured = false;
  equal((await h.request(context)).status, 503);
  h.state.configured = true;
  h.state.dbAvailable = false;
  equal((await h.request(context)).status, 503);
}

// Candidate (including rejected), published, hidden and repeated-preview duplicates.
{
  const h = harness();
  h.state.candidates.set("B", { id: "old-B", status: "rejected", slug: "old-b" });
  h.state.restaurants.set("C", "published");
  h.state.restaurants.set("D", "hidden");
  h.state.results = [...fixtures, fixtures[0]];
  const p = await preview(h);
  equal(p.candidates.filter((row) => row.isDuplicate).map((row) => [row.googlePlaceId, row.duplicateOfKind]).sort(),
    [["A", "preview"], ["B", "candidate"], ["C", "restaurant"], ["D", "restaurant"]]);
  for (const id of ["B", "C", "D"]) equal((await h.request(writeBody(p, [id]))).status, 400);
  const eligible = p.candidates.filter((row) => !row.isDuplicate).map((row) => row.googlePlaceId);
  const res = await h.request(writeBody(p, eligible));
  counts(res, 7, 0, 0);
  equal(ids(h.state.writes), [..."AEFGHIJ"]);
  equal(h.state.candidates.get("B").status, "rejected");
}

// New duplicates after preview remain authoritative, even if Google drops the row.
{
  const h = harness();
  const p = await preview(h);
  h.state.candidates.set("A", { id: "old-A", status: "approved", slug: "old-a" });
  h.state.restaurants.set("D", "published");
  h.state.results = fixtures.filter((row) => row.placeId !== "A");
  const res = await h.request(writeBody(p, ["A", "D", "J"]));
  counts(res, 1, 2, 0);
  equal(ids(h.state.writes), ["J"]);
}

// Partial failures continue, return safe row outcomes, and retry only the failed ID.
{
  const h = harness();
  const p = await preview(h);
  h.state.failures.add("F");
  const res = await h.request(writeBody(p, ["A", "D", "F", "J"]));
  counts(res, 3, 0, 1);
  equal(ids(h.state.writes), ["A", "D", "J"]);
  equal(res.body.outcomes.filter((row) => row.status === "failed").map((row) => row.googlePlaceId), ["F"]);
  equal(JSON.stringify(res.body).includes("sensitive"), false);
  equal(h.state.jobs[0].status, "failed");
  h.state.failures.clear();
  counts(await h.request(writeBody(p, ["F"])), 1, 0, 0);
  equal(ids(h.state.writes), ["A", "D", "F", "J"]);
}

// Races, null inserts, Google drift, and best-effort source/audit failures.
{
  const h = harness();
  const p = await preview(h);
  h.state.races.add("A");
  h.state.nullInserts.add("D");
  h.state.results = fixtures.filter((row) => row.placeId !== "F");
  const res = await h.request(writeBody(p, ["A", "D", "F", "J"]));
  counts(res, 1, 1, 2);
  equal(ids(h.state.writes), ["J"]);
  equal(res.body.duplicates[0].reason, "race");
}
{
  const h = harness();
  const p = await preview(h);
  h.state.failSource = true;
  h.state.failAudit = true;
  counts(await h.request(writeBody(p, ["A", "D"])), 2, 0, 0);
  equal(ids(h.state.writes), ["A", "D"]);
}
{
  const h = harness();
  const p = await preview(h, { ...context, market: "dc" });
  counts(await h.request(writeBody(p, ["A"], { ...context, market: "dc" })), 1, 0, 0);
  equal(h.state.writes[0].market, "dc");
}
{
  const h = harness();
  h.state.failSnapshot = true;
  const res = await h.request(context);
  equal(res.status, 500);
  equal(JSON.stringify(res.body).includes("sensitive"), false);
  equal(h.state.writes.length, 0);
}
{
  const h = harness();
  const p = await preview(h);
  h.state.googleStatus = "http-error";
  equal((await h.request(writeBody(p, ["A"]))).status, 502);
  equal(h.state.writes.length, 0);
}

console.log(`Selective import checks passed (${checks} assertions; synthetic fixtures, no network or DB).`);
