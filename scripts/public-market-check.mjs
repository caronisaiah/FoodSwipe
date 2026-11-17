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
function harness(env, rows = [], dbAvailable = true, policyResponses = {}) {
  const cache = new Map();
  const warnings = [];
  const policyRequests = [];
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
        where: (predicate) => { result = result.filter(predicate); return query; },
        orderBy: async () => result,
        limit: async (count) => result.slice(0, count),
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
      if (name === "next/server") return { connection: async () => {} };
      if (name === "react/jsx-runtime") return require(name);
      if (name.startsWith("@/components/")) return { default: () => null };
      if (name === "drizzle-orm") return {
        eq: (key, value) => (row) => row[key] === value,
        and: (...conditions) => (row) => conditions.every((condition) => condition(row)),
        desc: (key) => key,
      };
      if (relative === "lib/db/restaurants.ts") {
        if (name === "./index") return { getDb: () => dbAvailable ? db : null };
        if (name === "./schema") return { restaurants: table };
        if (["./candidates", "./heroMediaSelections", "@/lib/candidateReadiness"].includes(name)) return {};
      }
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
  return { load, warnings, policyRequests, dbReads: () => dbReads, failRead: () => { failApiRead = true; } };
}

const rows = [
  { slug: "dc-visible", name: "DC", market: "dc", status: "published" },
  { slug: "nyc-visible", name: "NYC", market: "nyc", status: "published" },
  { slug: "nyc-hidden", name: "Hidden", market: "nyc", status: "hidden" },
];
let checks = 0;
const equal = (actual, expected) => {
  // VM arrays have another prototype; compare their serialized domain values.
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), JSON.parse(JSON.stringify(expected)));
  checks++;
};
const ids = (restaurants) => restaurants.map((restaurant) => restaurant.id);
async function request(h, query = "") {
  const res = await h.load("app/api/restaurants/route.ts").GET(new Request(`https://example.test/api/restaurants${query}`));
  equal(res.status, 200);
  equal(res.headers.get("cache-control"), "no-store");
  return (await res.json()).restaurants;
}
for (const mode of ["demo", "mixed", "production"]) {
  for (const configured of [undefined, "", " dc ", " NYC ", "unsupported"]) {
    const h = harness({ FOODSWIPE_CONTENT_MODE: mode, FOODSWIPE_DEFAULT_MARKET: configured }, rows);
    const market = configured === " NYC " ? "nyc" : configured === "unsupported" ? null : "dc";
    equal(h.load("lib/publicMarket.ts").getDefaultPublicMarket(), market);
    const seeds = ids(h.load("lib/seed/restaurants.ts").RESTAURANTS);
    const dc = mode === "production" ? ["dc-visible"] : [...seeds, "dc-visible"];
    const expected = market === "nyc" ? ["nyc-visible"] : market === "dc" ? dc : [];
    for (const query of ["", "?market=garbage", "?market="]) equal(ids(await request(h, query)), expected);
    equal(ids(await request(h, "?market=dc")), dc);
    equal(ids(await request(h, "?market=nyc")), ["nyc-visible"]);
    const seedIds = mode !== "production" && market === "dc" ? seeds : [];
    equal(ids(h.load("app/feed/page.tsx").default().props.children.props.initialRestaurants), seedIds);
    equal(ids(h.load("app/saved/page.tsx").default().props.children.props.seedRestaurants), seedIds);
    const reads = h.load("lib/db/restaurants.ts");
    equal((await reads.getAppRestaurantById("dc-visible", { includeSeeds: false })).id, "dc-visible");
    equal(await reads.getAppRestaurantById("nyc-hidden", { includeSeeds: false }), null);
    equal(await reads.getAppRestaurantById(seeds[0], { includeSeeds: false }), null);
    h.failRead();
    equal(ids(await request(h)), seedIds);
    if (market === null) equal(h.warnings.length, 1);
  }
  for (const availability of [false, "error"]) {
    const h = harness({ FOODSWIPE_CONTENT_MODE: mode, FOODSWIPE_DEFAULT_MARKET: "nyc" }, [], availability);
    equal(ids(await request(h)), []);
    equal(ids(await request(h, "?market=nyc")), []);
  }
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
