// Run with node scripts/photo-attribution-check.mjs. All upstream and DB calls are isolated.
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
const client = load("lib/clientHeroMedia", { "@/lib/placePhoto": contract });
const dbSelection = load("lib/db/heroMediaSelections", { "drizzle-orm": {}, "./index": {}, "./schema": {} });
const id = "fixture-place";
const key = "fixture-header-only";
const logo = "https://logo.example/fallback";
const image = (ref) => "https://images.example/" + ref;
const source = (ref) => "https://www.google.com/maps/photo/" + ref;
const authors = [
  { displayName: "A", uri: "//maps.google.com/author/A", photoUri: "//images.example/avatar" },
  { displayName: "B", uri: "https://maps.google.com/author/B" },
  { displayName: "C" },
];

function entry(ref, authorAttributions = []) {
  return {
    name: `places/${id}/photos/${ref}`, googleMapsUri: source(ref), authorAttributions,
    widthPx: 1200, heightPx: 900,
  };
}

function expected(ref, attributions = []) {
  return { sourceProvider: "google_places", googleMapsUri: source(ref), photoUri: image(ref), attributions };
}

const credits = [
  { displayName: "A", uri: "https://maps.google.com/author/A", photoUri: "https://images.example/avatar" },
  { displayName: "B", uri: "https://maps.google.com/author/B" },
  { displayName: "C" },
];

function plain(value) { return JSON.parse(JSON.stringify(value)); }

function fixture(photos, { media, details } = {}) {
  const calls = [];
  const places = load("lib/places", { "server-only": {}, "@/lib/placePhoto": contract }, {
    process: { env: { GOOGLE_MAPS_API_KEY: key } },
    async fetch(href, options) {
      const url = new URL(href);
      calls.push({ url, options });
      if (url.pathname === "/v1/places/" + id) return details ? details() : Response.json({ photos });
      const ref = url.pathname.split("/").at(-2);
      return media ? media(ref) : Response.json({ photoUri: image(ref) });
    },
  });
  const hero = load("lib/heroMedia", {
    "@/lib/places": places, "@/lib/logos": { logoUrl: (domain) => domain ? logo : null },
  });
  return { places, hero, calls };
}

test("default, ordinal and admin requests bind the right media resource, fields and credits", async () => {
  const { places, calls } = fixture([entry("one"), entry("two", authors)]);
  const first = await places.getPlacePhoto(id);
  assert.deepEqual(plain(first.photo), expected("one"));
  const second = await places.getPlacePhotoByOrdinal(id, 2);
  assert.deepEqual(plain(second.photo), expected("two", credits));
  const gallery = await places.getPlacePhotoCandidates(id);
  assert.deepEqual(plain(gallery.candidates.map(c => [c.ordinal, c.photoUri, c.googleMapsUri, c.attributions])), [
    [1, image("one"), source("one"), []], [2, image("two"), source("two"), credits],
  ]);
  const masks = calls.filter(c => !c.url.pathname.endsWith("/media")).map(c =>
    c.options.headers["X-Goog-FieldMask"].split(",").sort());
  const fields = ["photos.authorAttributions", "photos.googleMapsUri", "photos.name"];
  assert.deepEqual(masks, [fields, fields, [...fields, "photos.heightPx", "photos.widthPx"].sort()]);
  assert.deepEqual(calls.filter(c => c.url.pathname.endsWith("/media")).map(c => c.url.pathname),
    ["one", "two", "one", "two"].map(ref => `/v1/places/${id}/photos/${ref}/media`));
  for (const { url, options } of calls) {
    assert.equal(url.origin, "https://places.googleapis.com");
    assert.equal(url.href.includes(key), false);
    assert.equal(options.headers["X-Goog-Api-Key"], key);
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    if (url.pathname.endsWith("/media")) assert.equal(url.searchParams.get("skipHttpRedirect"), "true");
  }
  assert.equal(JSON.stringify([first, second, gallery]).includes(key), false);
});

test("missing or malformed author data cannot erase a required credit", async () => {
  for (const bad of [undefined, null, {}, "", [null], [authors[0], {}], [{ displayName: "  " }],
    [{ displayName: 3 }], [{ displayName: "A", uri: null }], [{ displayName: "A", photoUri: "http://images.example/A" }]]) {
    const { places, calls } = fixture([{ ...entry("one"), authorAttributions: bad }]);
    assert.deepEqual(plain(await places.getPlacePhoto(id)), { photo: null, status: "invalid-photo-attributions" });
    assert.equal(calls.length, 1);
  }
});

test("strict HTTPS parsing applies to source, author and image fields", async () => {
  const unsafe = ["http://insecure.example", "javascript:alert(1)", "data:text/plain,a", "/relative",
    "https:bare.example", "https:///bad.example", "https://", "https://a b.example",
    "https://name:password@host.example", "https://host.example\\other", "https://x.example/\ty",
    "https://x.example/a?X-Goog-Api-Key=fixture", "https://x.example/?key=fixture"];
  for (const uri of unsafe) {
    assert.equal(contract.safeHttpsUrl(uri), undefined);
    assert.equal(contract.safeHttpsUrl(uri, true), undefined);
    assert.equal(contract.normalizePlacePhoto({ ...expected("one"), photoUri: uri }), null);
    assert.equal(contract.normalizePlacePhoto({ ...expected("one"), googleMapsUri: uri }), null);
    assert.equal(contract.normalizePlacePhoto(expected("one", [{ displayName: "A", uri }])), null);
  }
  for (const bad of [undefined, null, "", "//maps.google.com/source", ...unsafe]) {
    const { places, calls } = fixture([{ ...entry("one", authors), googleMapsUri: bad }]);
    assert.deepEqual(plain(await places.getPlacePhoto(id)), { photo: null, status: "missing-photo-source" });
    assert.equal(calls.length, 1);
  }
  const { places } = fixture([entry("one")], { media: () => Response.json({ photoUri: unsafe[0] }) });
  assert.deepEqual(plain(await places.getPlacePhoto(id)), { photo: null, status: "photo-media-failed" });
});

test("malformed slots stay in place, selection cannot move to an adjacent or different place's photo", async () => {
  const { places, calls } = fixture([null, {}, { ...entry("wrong"), name: "places/other/photos/wrong" },
    { ...entry("bad"), googleMapsUri: null }, entry("five", authors), { ...entry("bad"), authorAttributions: null }]);
  const gallery = await places.getPlacePhotoCandidates(id);
  assert.deepEqual(plain(gallery.candidates.map(c => [c.ordinal, c.status, c.photoUri])), [
    [1, "invalid-photo-ordinal", null], [2, "invalid-photo-ordinal", null], [3, "invalid-photo-ordinal", null],
    [4, "missing-photo-source", null], [5, "ok", image("five")], [6, "invalid-photo-attributions", null],
  ]);
  assert.equal(gallery.resolvedCount, 1);
  assert.equal(gallery.failedCount, 5);
  assert.equal(calls.filter(c => c.url.pathname.endsWith("/media")).length, 1);
  for (const ordinal of [1, 2, 3, 4, 6, 7, 0, 11, 1.5, undefined]) {
    assert.equal((await places.getPlacePhotoByOrdinal(id, ordinal)).photo, null);
  }
  assert.deepEqual(plain((await places.getPlacePhotoByOrdinal(id, 5)).photo), expected("five", credits));
  assert.equal((await places.getPlacePhotoCandidates(id, 2)).candidates.length, 2);
});

test("public fallback carries the actual default photo's source and credits or uses logo/placeholder", async () => {
  const selectedHero = { sourcePlaceId: id, selectedPhotoOrdinal: 2 };
  const { hero } = fixture([entry("first", authors), { ...entry("second"), googleMapsUri: undefined }]);
  for (const selection of [selectedHero, { ...selectedHero, selectedPhotoOrdinal: 9 },
    { ...selectedHero, sourcePlaceId: "old-place" }]) {
    const fallback = await hero.resolveHeroMediaWithSelection({ googlePlaceId: id, selectedHero: selection });
    assert.equal(fallback.tier, "photo");
    assert.deepEqual(plain(fallback.photo), expected("first", credits));
  }
  const failed = fixture([{ ...entry("none"), googleMapsUri: null }]);
  for (const websiteDomain of ["example.com", null]) {
    const result = await failed.hero.resolveHeroMediaWithSelection({ googlePlaceId: id, websiteDomain, selectedHero });
    assert.equal(result.tier, websiteDomain ? "logo" : "placeholder");
    assert.equal(result.photo, null);
    assert.equal(result.photoStatus, "missing-photo-source");
    assert.equal(client.heroMediaImageUrl(client.normalizeClientHeroMedia(id, result)), websiteDomain ? logo : null);
  }
});

test("a selected media outage keeps the gallery slot and falls back with the first photo's own credits", async () => {
  const { places, hero } = fixture([entry("one"), entry("two", authors)], {
    media: ref => ref === "two" ? new Response(null, { status: 503 }) : Response.json({ photoUri: image(ref) }),
  });
  const gallery = await places.getPlacePhotoCandidates(id);
  const failed = gallery.candidates[1];
  assert.equal(failed.ordinal, 2);
  assert.equal(failed.status, "photo-media-failed");
  assert.equal(failed.photoUri, null);
  assert.equal(failed.googleMapsUri, source("two"));
  assert.deepEqual(plain(failed.attributions), credits);
  const result = await hero.resolveHeroMediaWithSelection({ googlePlaceId: id,
    selectedHero: { sourcePlaceId: id, selectedPhotoOrdinal: 2 } });
  assert.deepEqual(plain(result.photo), expected("one"));
});

test("client consumes full photo or uses existing fallback on old or malformed DTOs", () => {
  const dto = expected("two", credits);
  const normalized = client.normalizeClientHeroMedia(id, { photo: dto, logoUrl: logo, status: "ok" });
  assert.deepEqual(plain(normalized.photo), dto);
  assert.equal(client.heroMediaImageUrl(normalized), image("two"));
  for (const bad of [{ photoUri: dto.photoUri, attributions: [] }, { ...dto, sourceProvider: "other" },
    { ...dto, attributions: undefined }, { ...dto, googleMapsUri: null }]) {
    assert.equal(client.heroMediaImageUrl(client.normalizeClientHeroMedia(id, { photo: bad, logoUrl: logo })), logo);
  }
});

test("upstream failures expose only safe diagnostics", async () => {
  const failure = () => Response.json({ error: { message: key, status: "PERMISSION_DENIED" } }, { status: 403 });
  for (const [options, status] of [[{ media: failure }, "photo-media-failed"], [{ details: failure }, "place-details-failed"]]) {
    const { places } = fixture([entry("one")], options);
    const result = await places.getPlacePhoto(id);
    assert.deepEqual(plain(result), { photo: null, status, httpStatus: 403, googleStatus: "PERMISSION_DENIED" });
  }
});

test("public route returns only the published lookup's approved photo, with no-store", async () => {
  const { hero, calls } = fixture([entry("one"), entry("two", authors)]);
  const route = load("app/api/restaurants/[id]/photo/route", {
    "@/lib/db/restaurants": { getAppRestaurantById: (slug) => slug === "public" ? { googlePlaceId: id } : null },
    "@/lib/db/heroMediaSelections": { getApprovedHeroSelectionForRestaurantSlug: () => ({ sourcePlaceId: id, selectedPhotoOrdinal: 2 }) },
    "@/lib/contentMode": { shouldIncludeSeedRestaurants: () => false }, "@/lib/heroMedia": hero,
  });
  const get = (slug) => route.GET(new Request("https://app.example"), { params: Promise.resolve({ id: slug }) });
  assert.equal((await get("hidden")).status, 404);
  assert.equal(calls.length, 0);
  const res = await get("public");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(await res.json(), { photo: expected("two", credits), status: "ok", logoUrl: null, galleryCount: 2 });
});

test("admin preview/approval retains original ordinals and only persists a validated exact selection", async () => {
  const { places, calls } = fixture([null, { ...entry("two"), googleMapsUri: null }, entry("three", authors)]);
  const writes = [];
  const deps = {
    "@/lib/places": places,
    "@/lib/adminAuth": { isAdminConfigured: () => true, hasValidAdminSecret: req => req.headers.get("x-test-auth") === "authorized" },
    "@/lib/db/candidates": { isDbConfigured: () => true, getCandidateRestaurant: () => ({ id: "c", googlePlaceId: id }) },
    "@/lib/db/heroMediaSelections": {
      validHeroPhotoOrdinal: dbSelection.validHeroPhotoOrdinal,
      getApprovedHeroSelectionForCandidate: () => ({ sourcePlaceId: id, selectedPhotoOrdinal: 2 }),
      upsertApprovedHeroSelectionForCandidate: input => { writes.push(plain(input)); return input; },
    },
  };
  const path = "app/api/admin/restaurants/candidates/[id]/";
  const selection = load(path + "hero-media-selection/route", deps);
  const gallery = load(path + "photo-candidates/route", deps);
  const context = { params: Promise.resolve({ id: "c" }) };
  function request({ selectedPhotoOrdinal, sourcePlaceId = id, authorized = true } = {}) {
    return new Request("https://app.example", { method: selectedPhotoOrdinal ? "PUT" : "GET",
      headers: authorized ? { "x-test-auth": "authorized" } : {},
      body: selectedPhotoOrdinal ? JSON.stringify({ sourcePlaceId, selectedPhotoOrdinal }) : undefined });
  }
  for (const route of [gallery.GET, selection.GET, selection.PUT]) {
    assert.equal((await route(request({ authorized: false }), context)).status, 401);
  }
  assert.equal(calls.length, 0);
  const galleryResponse = await gallery.GET(request(), context);
  assert.equal(galleryResponse.headers.get("cache-control"), "no-store");
  assert.equal((await galleryResponse.json()).candidates[2].googleMapsUri, source("three"));
  const preview = await (await selection.GET(request(), context)).json();
  assert.equal(preview.preview.photo, null);
  assert.equal(preview.status, "missing-photo-source");
  for (const [args, status] of [[{ selectedPhotoOrdinal: 3, sourcePlaceId: "wrong" }, 400],
    [{ selectedPhotoOrdinal: 2.9 }, 400], [{ selectedPhotoOrdinal: 1 }, 422], [{ selectedPhotoOrdinal: 2 }, 422]]) {
    assert.equal((await selection.PUT(request(args), context)).status, status);
  }
  assert.equal(writes.length, 0);
  const success = await selection.PUT(request({ selectedPhotoOrdinal: 3 }), context);
  assert.equal(success.status, 200);
  assert.deepEqual((await success.json()).preview.photo, expected("three", credits));
  assert.deepEqual(writes, [{ candidateRestaurantId: "c", sourcePlaceId: id, selectedPhotoOrdinal: 3,
    reviewerNotes: null, selectionReason: "Selected from exact-location Google photo candidates" }]);
});
