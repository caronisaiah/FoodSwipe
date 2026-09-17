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
function harness(env, rows = [], dbAvailable = true) {
  const cache = new Map();
  const warnings = [];
  let failApiRead = false;
  const table = Object.fromEntries(["status", "market", "slug", "createdAt"].map((key) => [key, key]));
  const db = {
    select() {
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
    runInNewContext(output, { module: compiledModule, exports: compiledModule.exports, require: localRequire,
      process: { env }, console: { warn: (message) => warnings.push(message) }, URL, Response },
    { filename: relative });
    return compiledModule.exports;
  }
  return { load, warnings, failRead: () => { failApiRead = true; } };
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
console.log(`Public market checks passed (${checks} assertions; isolated DB fixtures, no network).`);
