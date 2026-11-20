// Run with node scripts/photo-gallery-check.mjs. No network, database or browser.
//
// Phase 13B: the opt-in gallery contract of GET /api/restaurants/[id]/photo.
// Covers hero-first order, duplicate and malformed photos, media failures, zero/one/two
// photo places, source-link and credit pairing, backward compatibility of the default
// response, publication rules and the number of upstream requests.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";

const ts = createRequire(import.meta.url)("typescript");
const compiled = new Map();
function load(path, dependencies = {}, globals = {}) {
  if (!compiled.has(path)) {
    const source = readFileSync(new URL("../" + path + ".ts", import.meta.url), "utf8");
    compiled.set(path, ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText);
  }
  const exports = {};
  runInNewContext(compiled.get(path), {
    URL, Response, exports, ...globals,
    require(name) {
      assert(Object.hasOwn(dependencies, name), "Unexpected dependency " + name);
      return dependencies[name];
    },
  }, { filename: path });
  return exports;
}

const contract = load("lib/placePhoto");
const id = "fixture-place";
const key = "fixture-api-key";
const logo = "https://logo.example/fallback";
const image = (ref) => "https://images.example/" + ref;
const source = (ref) => "https://www.google.com/maps/photo/" + ref;
const plain = (value) => JSON.parse(JSON.stringify(value));

/** A Details entry whose single author is named after the photo, so a mismatch is visible. */
function entry(ref, extra = {}) {
  return {
    name: `places/${id}/photos/${ref}`,
    googleMapsUri: source(ref),
    authorAttributions: [{ displayName: "Author " + ref, uri: "https://maps.google.com/author/" + ref }],
    widthPx: 1200, heightPx: 900,
    ...extra,
  };
}
/**
 * The route over the real places and heroMedia modules, with fetch, the database and
 * the content mode replaced. `calls` records every request that would leave the server.
 */
function fixture(photos, { selection = null, media, details, restaurants } = {}) {
  const calls = { details: 0, media: [], selections: 0, lookups: [] };
  const places = load("lib/places", { "server-only": {}, "@/lib/placePhoto": contract }, {
    process: { env: { GOOGLE_MAPS_API_KEY: key } },
    async fetch(href) {
      const url = new URL(href);
      if (url.pathname === "/v1/places/" + id) {
        calls.details++;
        return details ? details() : Response.json({ photos });
      }
      const ref = url.pathname.split("/").at(-2);
      calls.media.push(ref);
      return media ? media(ref) : Response.json({ photoUri: image(ref) });
    },
  });
  const hero = load("lib/heroMedia", {
    "@/lib/places": places, "@/lib/logos": { logoUrl: (domain) => domain ? logo : null },
  });
  const published = restaurants ?? { public: { googlePlaceId: id, websiteDomain: "example.com" } };
  const route = load("app/api/restaurants/[id]/photo/route", {
    "@/lib/db/restaurants": {
      async getAppRestaurantById(slug) { calls.lookups.push(slug); return published[slug] ?? null; },
    },
    "@/lib/db/heroMediaSelections": {
      async getApprovedHeroSelectionForRestaurantSlug() { calls.selections++; return selection; },
    },
    "@/lib/contentMode": { shouldIncludeSeedRestaurants: () => false },
    "@/lib/heroMedia": hero,
  });
  const get = (slug = "public", query = "") => route.GET(
    new Request("https://app.example/api/restaurants/" + slug + "/photo" + query),
    { params: Promise.resolve({ id: slug }) },
  );
  return { places, hero, route, calls, get };
}

const refs = (body) => body.photos.map((p) => p.googleMapsUri.split("/").at(-1));
const approved = (ordinal, sourcePlaceId = id) => ({ sourcePlaceId, selectedPhotoOrdinal: ordinal });

test("the approved hero is first, then the next distinct photos in Google's order", async () => {
  const { get, calls } = fixture(["a", "b", "c", "d", "e"].map((r) => entry(r)), { selection: approved(4) });
  const res = await get("public", "?gallery=1");
  const body = await res.json();
  assert.deepEqual(refs(body), ["d", "a", "b"]);
  assert.equal(body.includesHero, true);
  assert.equal(body.heroSkipped, false);
  assert.equal(body.heroSourceUri, source("d"));
  assert.equal(body.galleryCount, 3);
  assert.equal(body.status, "ok");
  assert.equal(calls.details, 1);
  assert.deepEqual(calls.media, ["d", "a", "b"]);
});

test("every photo keeps its own source link, image and credits", async () => {
  const { get } = fixture([
    entry("a", { authorAttributions: [{ displayName: "Ann" }, { displayName: "Bo", uri: "https://maps.google.com/u/bo" }] }),
    entry("b", { authorAttributions: [{ displayName: "Cy", photoUri: "//images.example/cy" }] }),
    entry("c", { authorAttributions: [] }),
  ]);
  const { photos } = await (await get("public", "?gallery=1")).json();
  assert.deepEqual(photos, [
    { sourceProvider: "google_places", googleMapsUri: source("a"), photoUri: image("a"),
      attributions: [{ displayName: "Ann" }, { displayName: "Bo", uri: "https://maps.google.com/u/bo" }] },
    { sourceProvider: "google_places", googleMapsUri: source("b"), photoUri: image("b"),
      attributions: [{ displayName: "Cy", photoUri: "https://images.example/cy" }] },
    { sourceProvider: "google_places", googleMapsUri: source("c"), photoUri: image("c"), attributions: [] },
  ]);
  for (const photo of photos) assert.notEqual(contract.normalizePlacePhoto(photo), null);
});

test("an unusable approved hero is replaced by the first usable photo; a selection for another place is ignored", async () => {
  const photos = [entry("bad", { googleMapsUri: null }), entry("b"), entry("c")];
  for (const selection of [approved(1), approved(9), approved(2, "another-place"), null]) {
    const { get } = fixture(photos, { selection });
    const body = await (await get("public", "?gallery=1")).json();
    assert.deepEqual(refs(body), ["b", "c"]);
    assert.equal(body.includesHero, true);
  }
  // A selection for a different place must not pick an ordinal in this place's list.
  const { get } = fixture(["a", "b", "c"].map((r) => entry(r)), { selection: approved(3, "another-place") });
  assert.deepEqual(refs(await (await get("public", "?gallery=1")).json()), ["a", "b", "c"]);
});

test("duplicate photographs are removed by resource identity and by source link", async () => {
  const photos = [
    entry("a"),
    entry("a"),                                           // same resource repeated
    entry("alias", { googleMapsUri: source("a") }),       // another resource, same Maps link
    entry("b"),
    entry("b", { googleMapsUri: source("b-other") }),     // same resource, different link
    entry("c"),
  ];
  const { get, calls } = fixture(photos);
  const body = await (await get("public", "?gallery=1")).json();
  assert.deepEqual(refs(body), ["a", "b", "c"]);
  assert.equal(new Set(body.photos.map((p) => p.photoUri)).size, 3);
  assert.deepEqual(calls.media, ["a", "b", "c"]);
});

test("never more than three photos and never more than three media requests", async () => {
  const many = Array.from({ length: 10 }, (_, i) => entry("p" + i));
  const { get, calls } = fixture(many, { selection: approved(10) });
  const body = await (await get("public", "?gallery=1")).json();
  assert.equal(body.photos.length, 3);
  assert.equal(body.galleryCount, 3);
  assert.deepEqual(refs(body), ["p9", "p0", "p1"]);
  assert.equal(calls.details, 1);
  assert.equal(calls.media.length, 3);
  // Entries beyond Google's first ten are never considered.
  const late = fixture([...Array.from({ length: 10 }, () => null), entry("eleventh")]);
  const lateBody = await (await late.get("public", "?gallery=1")).json();
  assert.deepEqual([lateBody.photos, lateBody.status, lateBody.galleryCount], [[], "no-photos", 0]);
  assert.equal(late.calls.media.length, 0);
});

test("malformed provider data is rejected before any media request", async () => {
  const bad = [
    null, {}, "text", { ...entry("x"), name: "places/other-place/photos/x" },
    { ...entry("x"), name: `places/${id}/photos/..` }, { ...entry("x"), name: `places/${id}/photos` },
    entry("x", { googleMapsUri: "http://insecure.example/x" }),
    entry("x", { googleMapsUri: "https://x.example/?key=secret" }),
    entry("x", { authorAttributions: null }),
    entry("x", { authorAttributions: [{ displayName: " " }] }),
    entry("x", { authorAttributions: [{ displayName: "A", uri: "javascript:alert(1)" }] }),
    entry("x", { authorAttributions: [{ displayName: "A", photoUri: "http://images.example/a" }] }),
  ];
  // Google never returns more than ten photos; keep the good one inside that window.
  const { get, calls } = fixture([...bad.slice(0, 9), entry("good"), ...bad.slice(9)]);
  const body = await (await get("public", "?gallery=1")).json();
  assert.deepEqual(refs(body), ["good"]);
  assert.equal(body.galleryCount, 1);
  assert.deepEqual(calls.media, ["good"]);
  assert.equal(JSON.stringify(body).includes(key), false);

  const none = fixture(bad);
  const noneBody = await (await none.get("public", "?gallery=1")).json();
  assert.deepEqual([noneBody.photos, noneBody.galleryCount, noneBody.heroSourceUri, noneBody.includesHero], [[], 0, null, false]);
  assert.equal(none.calls.media.length, 0);
});

test("a missing, expired or malformed photo resource is dropped, not replaced", async () => {
  const photos = ["a", "b", "c", "d"].map((r) => entry(r));
  // An extra's media fails: two photos come back, and no fourth photo is requested.
  const extra = fixture(photos, { media: (ref) => ref === "b" ? new Response(null, { status: 404 }) : Response.json({ photoUri: image(ref) }) });
  const extraBody = await (await extra.get("public", "?gallery=1")).json();
  assert.deepEqual(refs(extraBody), ["a", "c"]);
  assert.equal(extraBody.status, "ok");
  assert.equal(extra.calls.media.length, 3);

  // The hero's media fails: the extras still come back and the response says the hero is missing.
  const heroFail = fixture(photos, { media: (ref) => ref === "a" ? new Response(null, { status: 404 }) : Response.json({ photoUri: image(ref) }) });
  const heroBody = await (await heroFail.get("public", "?gallery=1")).json();
  assert.deepEqual(refs(heroBody), ["b", "c"]);
  // A real media failure: not included, and not skipped on purpose.
  assert.deepEqual([heroBody.includesHero, heroBody.heroSkipped], [false, false]);
  assert.equal(heroBody.heroSourceUri, source("a"));

  // A media answer without a safe URL is a failure, never a photo.
  const unsafe = fixture(photos, { media: () => Response.json({ photoUri: "http://images.example/x" }) });
  const unsafeBody = await (await unsafe.get("public", "?gallery=1")).json();
  assert.deepEqual([unsafeBody.photos, unsafeBody.status, unsafeBody.galleryCount], [[], "photo-media-failed", 3]);

  // Only a safe diagnostic leaves the server.
  const denied = fixture(photos, { media: () => Response.json({ error: { message: key, status: "PERMISSION_DENIED" } }, { status: 403 }) });
  const deniedBody = await (await denied.get("public", "?gallery=1")).json();
  assert.deepEqual([deniedBody.status, deniedBody.httpStatus, deniedBody.googleStatus], ["photo-media-failed", 403, "PERMISSION_DENIED"]);
  assert.equal(JSON.stringify(deniedBody).includes(key), false);
});

test("zero, one and two photo restaurants", async () => {
  for (const [list, count, status] of [[[], 0, "no-photos"], [[entry("a")], 1, "ok"], [[entry("a"), entry("b")], 2, "ok"]]) {
    const { get, calls } = fixture(list);
    const body = await (await get("public", "?gallery=1")).json();
    assert.equal(body.photos.length, count);
    assert.equal(body.galleryCount, count);
    assert.equal(body.status, status);
    assert.equal(calls.media.length, count);
    const plainBody = await (await fixture(list).get("public")).json();
    assert.equal(plainBody.galleryCount, count);
  }
  // Only rejected entries: the reason for the first rejection is reported.
  const rejected = fixture([entry("a", { googleMapsUri: null })]);
  assert.equal((await (await rejected.get("public", "?gallery=1")).json()).status, "missing-photo-source");
});

test("skipHero leaves the hero out, never requests it, and names it by its source link", async () => {
  const { get, calls } = fixture(["a", "b", "c", "d"].map((r) => entry(r)), { selection: approved(3) });
  const body = await (await get("public", "?gallery=1&skipHero=1")).json();
  assert.deepEqual(refs(body), ["a", "b"]);
  // Intentional omission: not included, skipped on purpose, and nothing failed.
  assert.deepEqual([body.includesHero, body.heroSkipped, body.status], [false, true, "ok"]);
  assert.equal(body.heroSourceUri, source("c"));
  assert.equal(body.galleryCount, 3);
  assert.deepEqual(calls.media, ["a", "b"]);
  assert.equal(calls.media.includes("c"), false);

  const single = fixture([entry("only")]);
  const singleBody = await (await single.get("public", "?gallery=1&skipHero=1")).json();
  assert.deepEqual([singleBody.photos, singleBody.status, singleBody.heroSourceUri], [[], "ok", source("only")]);
  assert.deepEqual([singleBody.includesHero, singleBody.heroSkipped], [false, true]);
  // With the hero skipped and every extra failing, the failure is reported but the omission still is not one.
  const extrasDown = fixture(["a", "b", "c"].map((r) => entry(r)), { media: () => new Response(null, { status: 503 }) });
  const extrasBody = await (await extrasDown.get("public", "?gallery=1&skipHero=1")).json();
  assert.deepEqual([extrasBody.photos, extrasBody.status, extrasBody.heroSkipped, extrasBody.includesHero], [[], "photo-media-failed", true, false]);
  assert.equal(extrasDown.calls.media.length, 2);
  assert.deepEqual([single.calls.details, single.calls.media.length], [1, 0]);
});

test("extra Google requests happen only for an explicit gallery request", async () => {
  const photos = ["a", "b", "c", "d"].map((r) => entry(r));
  const plainRun = fixture(photos);
  const body = await (await plainRun.get("public")).json();
  assert.deepEqual([plainRun.calls.details, plainRun.calls.media], [1, ["a"]]);
  assert.equal(body.galleryCount, 3);        // counted from the Details response already in hand
  assert.equal("photos" in body, false);
  for (const query of ["?gallery=0", "?gallery=true", "?gallery=", "?skipHero=1", "?other=1"]) {
    const run = fixture(photos);
    const answer = await (await run.get("public", query)).json();
    assert.equal("photos" in answer, false, query);
    assert.deepEqual([run.calls.details, run.calls.media.length], [1, 1], query);
  }
  const gallery = fixture(photos);
  await gallery.get("public", "?gallery=1");
  assert.deepEqual([gallery.calls.details, gallery.calls.media.length], [1, 3]);
});

test("the default response keeps its established shape and gains only galleryCount", async () => {
  const { get } = fixture([entry("a", { authorAttributions: [{ displayName: "Ann" }] }), entry("b")]);
  const res = await get("public");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    photo: { sourceProvider: "google_places", googleMapsUri: source("a"), photoUri: image("a"), attributions: [{ displayName: "Ann" }] },
    status: "ok", logoUrl: logo, galleryCount: 2,
  });
  // The old client contract still reads it.
  const client = load("lib/clientHeroMedia", { "@/lib/placePhoto": contract });
  const media = client.normalizeClientHeroMedia("public", await (await get("public")).json());
  assert.equal(client.heroMediaImageUrl(media), image("a"));
  // Without usable photos the logo is still offered.
  const bare = await (await fixture([]).get("public")).json();
  assert.deepEqual(plain(bare), { photo: null, status: "no-photos", logoUrl: logo, galleryCount: 0 });
});

test("only published restaurants are served, always uncacheable, and nothing is written", async () => {
  const state = fixture(["a", "b"].map((r) => entry(r)), { restaurants: { public: { googlePlaceId: id } } });
  for (const query of ["", "?gallery=1", "?gallery=1&skipHero=1"]) {
    for (const slug of ["nowhere", "hidden"]) {
      const res = await state.get(slug, query);
      assert.equal(res.status, 404);
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.deepEqual(await res.json(), { error: "Unknown restaurant." });
    }
    const found = await state.get("public", query);
    assert.equal(found.status, 200);
    assert.equal(found.headers.get("cache-control"), "no-store");
  }
  // Unknown and hidden restaurants never reach Google or the hero-selection lookup.
  assert.equal(state.calls.selections, 3);
  assert.equal(state.calls.details, 3);

  const outage = fixture(["a"].map((r) => entry(r)), { details: () => { throw new Error("socket closed " + key); } });
  const failed = await outage.get("public", "?gallery=1");
  assert.deepEqual([failed.status, failed.headers.get("cache-control")], [200, "no-store"]);
  assert.deepEqual((await failed.json()).status, "error");
  const down = fixture(["a"].map((r) => entry(r)), { restaurants: new Proxy({}, { get() { throw new Error("database unavailable"); } }) });
  const unavailable = await down.get("public", "?gallery=1");
  assert.deepEqual([unavailable.status, unavailable.headers.get("cache-control")], [503, "no-store"]);
  assert.deepEqual(await unavailable.json(), { error: "Photo temporarily unavailable." });
});

test("places without a key, Place ID or reachable Details report a safe status and make no media request", async () => {
  const none = fixture([entry("a")], { restaurants: { public: {} } });
  assert.equal((await (await none.get("public", "?gallery=1")).json()).status, "missing-google-place-id");
  assert.deepEqual([none.calls.details, none.calls.media.length], [0, 0]);
  const down = fixture([entry("a")], { details: () => Response.json({ error: { message: key, status: "UNAVAILABLE" } }, { status: 503 }) });
  const body = await (await down.get("public", "?gallery=1")).json();
  assert.deepEqual([body.status, body.httpStatus, body.googleStatus, body.photos], ["place-details-failed", 503, "UNAVAILABLE", []]);
  assert.equal(JSON.stringify(body).includes(key), false);
  assert.equal(down.calls.media.length, 0);
});
