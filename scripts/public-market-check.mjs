import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const ts = require("typescript");

// Source-level regression checks with isolated fixtures: no .env, network or DB.
function harness(env, rows = [], dbAvailable = true, policyResponses = {}, initialMarket, requestOrigin = "https://example.test") {
  const cache = new Map();
  const warnings = [];
  const policyRequests = [];
  const locationReads = [];
  const cookieWrites = [];
  let storedMarket = initialMarket;
  let dbReads = 0;
  let failApiRead = false;
  const table = Object.fromEntries(["status", "market", "slug", "createdAt"].map((key) => [key, key]));
  const db = {
    select() {
      dbReads++;
      if (dbAvailable === "error") throw new Error("simulated DB failure");
      let result = rows;
      const query = {
        from: () => query,
        innerJoin: () => query,
        where: (predicate) => { result = result.filter(predicate); return query; },
        orderBy: async () => result,
        limit: async (count) => result.slice(0, count),
        then: (resolve) => resolve(result),
      };
      return query;
    },
  };
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative).exports;
    const compiledModule = { exports: {} };
    cache.set(relative, compiledModule);
    const output = ts.transpileModule(readFileSync(resolve(root, relative), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    function localRequire(name) {
      if (name === "server-only") return {};
      if (name === "next/link") return { default: () => null };
      if (name === "next/headers") return {
        headers: async () => ({ get: (key) => key === "origin" ? requestOrigin : null }),
        cookies: async () => ({
          get: () => storedMarket === undefined ? undefined : { value: storedMarket },
          set: (key, value, options) => {
            cookieWrites.push({ key, options });
            storedMarket = value;
          },
        }),
      };
      if (name === "next/server") return { connection: async () => {} };
      if (name === "react/jsx-runtime") return require(name);
      if (name.startsWith("@/components/")) return { default: () => null };
      if (name === "drizzle-orm") return {
        eq: (key, value) => (row) => row[key] === value,
        and: (...conditions) => (row) => conditions.every((condition) => condition(row)),
        desc: (key) => key,
        asc: (key) => key,
        inArray: (key, values) => (row) => values.includes(row[key]),
      };
      if (relative === "lib/db/restaurants.ts") {
        if (name === "./index") return { getDb: () => dbAvailable ? db : null };
        if (name === "./schema") return { restaurants: table };
        if (["./candidates", "./heroMediaSelections", "@/lib/candidateReadiness"].includes(name)) return {};
      }
      if (relative === "lib/db/restaurantLocations.ts") {
        if (name === "./index") return { getDb: () => dbAvailable ? db : null };
        if (name === "./schema") return {
          restaurants: table,
          restaurantLocations: { restaurantId: "restaurantId", status: "locationStatus" },
        };
        if (name === "./videos") return { getRealVideoCounts: async () => new Map() };
      }
      if (name === "@/lib/db/restaurantLocations") return {
        getApprovedMapLocations: async (market) => {
          locationReads.push(market);
          return market === "nyc" ? [{ slug: "nyc-visible" }] : [];
        },
      };
      if (name.startsWith("@/lib/")) {
        const value = load(`${name.slice(2)}.ts`);
        if (name === "@/lib/db/restaurants" && relative === "app/api/restaurants/route.ts") {
          return { ...value, getAllRestaurants: (...args) => {
            if (failApiRead) throw new Error("simulated API read failure");
            return value.getAllRestaurants(...args);
          } };
        }
        return value;
      }
      throw new Error(`Unexpected isolated dependency: ${relative}: ${name}`);
    }
    runInNewContext(output, {
      module: compiledModule, exports: compiledModule.exports, require: localRequire,
      process: { env }, console: { warn: (message) => warnings.push(message) }, AbortSignal, URL, Response,
      fetch: async (url, options) => {
        policyRequests.push(url);
        assert.equal(options.redirect, "error");
        const fixture = policyResponses[url] ?? [200, "text/html; charset=utf-8"];
        if (fixture === "error" || fixture[0] === 302) throw new Error("simulated unavailable policy page");
        return new Response("", { status: fixture[0], headers: { "content-type": fixture[1] } });
      },
    }, { filename: relative });
    return compiledModule.exports;
  }
  return { load, warnings, policyRequests, cookieWrites, locationReads, dbReads: () => dbReads, failRead: () => { failApiRead = true; } };
}

const rows = [
  { slug: "dc-visible", name: "DC", market: "dc", status: "published" },
  { slug: "nyc-visible", name: "NYC", market: "nyc", status: "published",
    googlePlaceId: "fixture-place-id", address: "fixture street", lat: 40.7, lng: -74,
  },
  { slug: "nyc-hidden", name: "Hidden", market: "nyc", status: "hidden" },
  { slug: "nyc-draft", name: "Draft", market: "nyc", status: "draft" },
];
let checks = 0;
const equal = (actual, expected) => {
  // VM arrays have another prototype; compare their serialized domain values.
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));
  checks++;
};
const ids = (restaurants) => restaurants.map((restaurant) => restaurant.id);
async function request(h, query = "", status = 200) {
  const res = await h.load("app/api/restaurants/route.ts").GET(new Request(`https://example.test/api/restaurants${query}`));
  equal(res.status, status);
  equal(res.headers.get("cache-control"), "no-store");
  return res.json();
}

for (const mode of ["demo", "mixed", "production"]) {
  for (const [configured, allowDC, expectedMarket] of [
    [undefined, undefined, "nyc"], ["", undefined, "nyc"], [" NYC ", undefined, "nyc"],
    [" dc ", "true", "dc"], ["dc", undefined, null], ["unsupported", "true", null],
  ]) {
    const h = harness({
      NODE_ENV: "development",
      FOODSWIPE_CONTENT_MODE: mode,
      FOODSWIPE_DEFAULT_MARKET: configured,
      FOODSWIPE_ENABLE_DC_DISCOVERY: allowDC,
    }, rows);
    const states = h.load("lib/discoveryMarket.ts");
    const seeds = ids(h.load("lib/seed/restaurants.ts").RESTAURANTS);
    const dc = mode === "production" ? ["dc-visible"] : [...seeds, "dc-visible"];
    equal(await states.getDiscoveryMarket(), {
      market: expectedMarket, resetSelection: false, selectableMarkets: allowDC ? ["nyc", "dc"] : ["nyc"],
    });
    const tune = await h.load("app/page.tsx").default();
    const feed = await h.load("app/feed/page.tsx").default();
    equal(tune.props.market, expectedMarket);
    equal(feed.props.children.props.market, expectedMarket);
    if (expectedMarket) {
      const result = await request(h);
      equal(result.market, expectedMarket);
      equal(ids(result.restaurants), expectedMarket === "nyc" ? ["nyc-visible"] : dc);
    } else await request(h, "", 503);

    for (const query of ["?market=garbage", "?market=", "?market=nyc&market=dc"]) await request(h, query, 400);
    if (allowDC) equal(ids((await request(h, "?market=dc")).restaurants), dc);
    else await request(h, "?market=dc", 403);
    equal(ids((await request(h, "?market=nyc")).restaurants), ["nyc-visible"]);

    const reads = h.load("lib/db/restaurants.ts");
    equal((await reads.getAppRestaurantById("dc-visible", { includeSeeds: false })).id, "dc-visible");
    equal(await reads.getAppRestaurantById("nyc-hidden", { includeSeeds: false }), null);
    equal(await reads.getAppRestaurantById(seeds[0], { includeSeeds: false }), null);
    const lookup = await h.load("app/api/restaurants/saved/route.ts").GET(new Request(
      `https://example.test/api/restaurants/saved?id=dc-visible&id=nyc-visible&id=nyc-hidden&id=nyc-draft&id=${seeds[0]}&id=dc-visible`,
    ));
    equal(lookup.status, 200);
    equal(lookup.headers.get("cache-control"), "no-store");
    const { restaurants: savedCards } = await lookup.json();
    equal(Object.keys(savedCards.find((row) => row.id === "nyc-visible")).sort(),
      ["id", "name", "market", "neighborhood", "priceLevel", "cuisineTags", "vibeTags", "videoCount"].sort());
    equal(ids(savedCards).sort(),
      (mode === "production" ? ["dc-visible", "nyc-visible"] : ["dc-visible", "nyc-visible", seeds[0]]).sort());
    h.failRead();
    await request(h, "?market=nyc", 503);
  }
  for (const availability of [false, "error", true]) {
    const h = harness({ FOODSWIPE_CONTENT_MODE: mode }, [], availability);
    const empty = availability === true || (availability === false && mode !== "production");
    const response = await request(h, "", empty ? 200 : 503);
    if (empty) equal(ids(response.restaurants), []);
  }
}

const dcQA = { FOODSWIPE_ENABLE_DC_DISCOVERY: "true", NODE_ENV: "development" };
for (const stored of ["garbage", "dc", "NYC", "vancouver"]) {
  const h = harness({}, rows, true, {}, stored);
  equal(await h.load("lib/discoveryMarket.ts").getDiscoveryMarket(), {
    market: "nyc", selectableMarkets: ["nyc"], resetSelection: true,
  });
  equal((await request(h)).market, "nyc");
  equal(await h.load("app/discoveryMarketActions.ts").selectDiscoveryMarket(stored), false);
  equal(h.cookieWrites, []);
}

const switching = harness(dcQA, rows);
const select = switching.load("app/discoveryMarketActions.ts").selectDiscoveryMarket;
for (const id of [null, {}, "vancouver"]) equal(await select(id), false);
for (const market of ["nyc", "dc", "nyc"]) {
  equal(await select(market), true);
  equal((await request(switching)).market, market);
}
equal(switching.cookieWrites[0].options.secure, false);

for (const mode of ["demo", "mixed", "production"]) {
  const deployed = harness({ ...dcQA, NODE_ENV: "production", FOODSWIPE_CONTENT_MODE: mode }, rows, true, {}, "dc");
  equal(await deployed.load("lib/discoveryMarket.ts").getDiscoveryMarket(), {
    market: "nyc", selectableMarkets: ["nyc"], resetSelection: true,
  });
  await request(deployed, "?market=dc", 403);
  const choose = deployed.load("app/discoveryMarketActions.ts").selectDiscoveryMarket;
  equal(await choose("dc"), false);
  equal(deployed.cookieWrites, []);
  equal(await choose("nyc"), true);
  equal(deployed.cookieWrites[0], {
    key: "foodswipe.discovery-market.v1",
    options: { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 31536000 },
  });
}
const missingOrigin = harness(dcQA, rows, true, {}, undefined, null);
equal(await missingOrigin.load("app/discoveryMarketActions.ts").selectDiscoveryMarket("dc"), false);
equal(missingOrigin.cookieWrites, []);

const seedId = "le-diplomate";
const collisionRows = [{ slug: seedId, market: "nyc", status: "published", name: "Imported duplicate" }];
for (const allowSeeds of [true, false]) {
  const mode = allowSeeds ? "mixed" : "production";
  const h = harness({ ...dcQA, FOODSWIPE_CONTENT_MODE: mode }, collisionRows);
  const reads = h.load("lib/db/restaurants.ts");
  equal(await reads.getAppRestaurantById("constructor"), null);
  equal((await reads.getAppRestaurantById(seedId, { includeSeeds: allowSeeds })).market, allowSeeds ? "dc" : "nyc");
  equal((await reads.getAppRestaurantsByIds([seedId], { includeSeeds: allowSeeds }))[0].market, allowSeeds ? "dc" : "nyc");
  equal(ids((await request(h, "?market=nyc")).restaurants), allowSeeds ? [] : [seedId]);
  const dc = (await request(h, "?market=dc")).restaurants;
  equal(dc.filter((row) => row.id === seedId).length, allowSeeds ? 1 : 0);

  const locationFixture = (row, locationStatus = "approved") => ({
    ...row, area: "", address: "", cuisine: null, lat: 40.7, lng: -74,
    evidence: { sources: [{ dataset: "foursquare" }] }, locationStatus,
  });
  const mapDB = harness({ FOODSWIPE_CONTENT_MODE: mode }, [
    locationFixture(collisionRows[0]), locationFixture(rows[0]), locationFixture(rows[1]),
    locationFixture(rows[2]), locationFixture(rows[3]), locationFixture({ ...rows[1], slug: "pending" }, "pending"),
  ]);
  const locations = await mapDB.load("lib/db/restaurantLocations.ts").getApprovedMapLocations("nyc");
  equal(locations.map(({ slug }) => slug).sort(), allowSeeds ? ["nyc-visible"] : [seedId, "nyc-visible"].sort());
}

for (const market of ["nyc", "dc"]) {
  const h = harness({
    ...dcQA, MAPBOX_PUBLIC_TOKEN: "pk.fixture.token", FOODSWIPE_MAP_ENABLED: "true",
  }, rows, true, {}, market);
  const map = await h.load("app/map/page.tsx").default();
  // Map v2 page: <div canvas>[EditorialHeader, <main>{map or unavailable state}</main>]
  const content = map.props.children[1].props.children;
  equal(h.locationReads, [market]);
  if (market === "nyc") equal(content.props.locations, [{ slug: "nyc-visible" }]);
  else equal(content.type, "div");
}

const mapConfig = {
  FOODSWIPE_MAP_ENABLED: "true",
  GOOGLE_MAPS_BROWSER_KEY: "fixture-browser-key",
  GOOGLE_MAPS_API_KEY: "fixture-server-key",
  GOOGLE_MAPS_MAP_ID: "fixture-map-id",
  FOODSWIPE_MAP_TERMS_URL: "https://example.test/terms",
  FOODSWIPE_MAP_PRIVACY_URL: "https://example.test/privacy",
};
const mapRows = [
  { ...rows[0], googlePlaceId: "dc-place" },
  { ...rows[1], googlePlaceId: " nyc-place ", lat: 40.71, lng: -74.01 },
  { ...rows[2], googlePlaceId: "hidden-place" },
  { slug: "nyc-no-place", market: "nyc", status: "published", googlePlaceId: " " },
];
async function renderMap(h) {
  const page = await h.load("components/GoogleMapPrototypePage.tsx").default();
  return page.props.children.props.children[1];
}
for (const selectedMarket of [undefined, " ", " NYC ", "dc"]) {
  const h = harness({ ...mapConfig, FOODSWIPE_DEFAULT_MARKET: selectedMarket, FOODSWIPE_CONTENT_MODE: "mixed" }, mapRows);
  const market = selectedMarket === "dc" ? "dc" : "nyc";
  const map = await renderMap(h);
  equal(map.props.market, market);
  equal(map.props.browserKey, mapConfig.GOOGLE_MAPS_BROWSER_KEY);
  equal(map.props.targets, [{ slug: `${market}-visible`, placeId: `${market}-place` }]);
  equal(h.policyRequests, [mapConfig.FOODSWIPE_MAP_TERMS_URL, mapConfig.FOODSWIPE_MAP_PRIVACY_URL]);
  equal(h.dbReads(), 1);
}
for (const overrides of [
  { FOODSWIPE_MAP_ENABLED: undefined },
  { FOODSWIPE_DEFAULT_MARKET: "unsupported" },
  { GOOGLE_MAPS_BROWSER_KEY: undefined },
  { GOOGLE_MAPS_BROWSER_KEY: mapConfig.GOOGLE_MAPS_API_KEY },
  { GOOGLE_MAPS_MAP_ID: undefined },
  { GOOGLE_MAPS_MAP_ID: "DEMO_MAP_ID" },
  { FOODSWIPE_MAP_TERMS_URL: undefined },
  { FOODSWIPE_MAP_TERMS_URL: "https://example.test/map" },
  { FOODSWIPE_MAP_PRIVACY_URL: "http://example.test/privacy" },
  { FOODSWIPE_MAP_PRIVACY_URL: `${mapConfig.FOODSWIPE_MAP_TERMS_URL}#privacy` },
]) {
  const h = harness({ ...mapConfig, ...overrides }, mapRows);
  const map = await renderMap(h);
  equal(map.type, "div");
  equal(h.policyRequests, []);
  equal(h.dbReads(), 0);
}
for (const fixture of [[404, "text/html"], [200, "application/json"], [302, "text/html"], "error"]) {
  const h = harness(mapConfig, mapRows, true, { [mapConfig.FOODSWIPE_MAP_PRIVACY_URL]: fixture });
  equal((await renderMap(h)).type, "div");
  equal(h.dbReads(), 0);
}
console.log(`Public market checks passed (${checks} assertions; isolated DB fixtures, no network).`);
