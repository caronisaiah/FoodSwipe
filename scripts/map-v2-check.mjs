// Run with node scripts/map-v2-check.mjs. No network, database or browser.
//
// Map v2 logic: the first view, overlapping-marker groups, the Saved-only collection (which must never
// touch favorites), directions, and the bounded return state P14-C will use.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";

const ts = createRequire(import.meta.url)("typescript");
const cache = new Map();
function load(path, dependencies = {}, globals = {}) {
  if (!cache.has(path)) {
    cache.set(path, ts.transpileModule(readFileSync(new URL("../" + path + ".ts", import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText);
  }
  const exports = {};
  runInNewContext(cache.get(path), {
    exports, URL, Math, JSON, Number, Array, Object, Map, Set, Date, ...globals,
    require(name) { assert(Object.hasOwn(dependencies, name), "Unexpected dependency " + name); return dependencies[name]; },
  }, { filename: path });
  return exports;
}
const plain = (value) => JSON.parse(JSON.stringify(value));

const markets = load("lib/markets");
const locationsLib = load("lib/mapLocations");
const framing = load("lib/mapFraming", { "./markets": markets, "./mapLocations": locationsLib });
const returnState = (storage) => load("lib/mapReturnState", { "./markets": markets, "./mapLocations": locationsLib }, { window: { sessionStorage: storage } });

// The eight approved NYC locations (slug, area, position) as served by the production map page.
const nyc = [
  ["4-charles-prime-rib", "West Village", -74.00066077636762, 40.735144952599605],
  ["7th-street-burger-east-village", "East Village", -73.98537317, 40.72689329],
  ["deux-luxe", "Nolita", -73.9965301736953, 40.720575103653076],
  ["emily", "Clinton Hill", -73.96644339, 40.68349896],
  ["gotham-burger-social-club", "Lower East Side", -73.98753669, 40.72003623],
  ["milk-burger", "South Bronx", -73.92005431, 40.80359455],
  ["minetta-tavern", "Greenwich Village", -74.00064852, 40.73000953],
  ["moonburger", "Nolita", -73.996296, 40.720954],
].map(([slug, area, lng, lat]) => ({ slug, name: slug.replace(/-/g, " "), area, address: null, cuisine: null, videoCount: 0, position: [lng, lat], notices: [] }));

test("New York opens on Lower Manhattan's six restaurants; the other two stay reachable", () => {
  const first = framing.firstViewLocations("nyc", nyc).map((l) => l.slug).sort();
  assert.deepEqual(plain(first), ["4-charles-prime-rib", "7th-street-burger-east-village", "deux-luxe", "gotham-burger-social-club", "minetta-tavern", "moonburger"]);
  assert.equal(first.includes("emily") || first.includes("milk-burger"), false);
  const all = framing.boundsOf(nyc);
  assert.ok(all[0][0] < -74.00 && all[1][1] > 40.80, "Fit collection covers the Bronx point");
  assert.equal(nyc.length, 8, "every approved location stays in the collection");
});

test("a frame that would show fewer than two restaurants, or no frame, shows everything", () => {
  assert.equal(framing.firstViewLocations("nyc", [nyc[3], nyc[5]]).length, 2);
  assert.equal(framing.firstViewLocations("nyc", [nyc[0], nyc[3]]).length, 2);
  assert.equal(framing.firstViewLocations("dc", nyc).length, 8);
  assert.equal(framing.boundsOf([]), null);
});

test("overlapping 46 px targets form groups, chains join, and far markers stay single", () => {
  const p = (item, x, y) => ({ item, x, y });
  const groups = framing.groupOverlaps([p("a", 0, 0), p("b", 30, 0), p("c", 70, 0), p("d", 300, 300), p("e", 300, 345)]);
  assert.deepEqual(plain(groups.map((g) => g.map((m) => m.item))), [["a", "b", "c"], ["d", "e"]]);
  assert.equal(framing.groupOverlaps([p("a", 0, 0), p("b", 46, 0)]).length, 2, "exactly 46 px apart do not overlap");
  assert.equal(framing.groupOverlaps([p("a", 0, 0), p("b", 45, 45)]).length, 1);
  assert.deepEqual(plain(framing.groupOverlaps([])), []);
  // Every input point appears in exactly one group.
  const flat = framing.groupOverlaps(nyc.map((l, i) => p(l.slug, i * 20, 0))).flat();
  assert.equal(flat.length, nyc.length);
});

test("Saved-only is the intersection of saved ids and approved locations and never changes favorites", () => {
  const saved = new Set(["deux-luxe", "milk-burger", "not-mapped-restaurant", "dc-only-place"]);
  const frozen = Object.freeze([...saved]);
  const collection = locationsLib.collectionFor("saved", nyc, saved);
  assert.deepEqual(plain(collection.map((l) => l.slug)), ["deux-luxe", "milk-burger"]);
  assert.deepEqual([...saved], [...frozen], "the saved set is untouched");
  assert.equal(saved.size, 4, "unmapped and cross-market favorites remain saved");
  assert.equal(locationsLib.collectionFor("saved", nyc, new Set()).length, 0);
  assert.equal(locationsLib.collectionFor("all", nyc, saved).length, 8);
  assert.notEqual(locationsLib.collectionFor("all", nyc, saved), nyc, "a copy, not the source array");
  // A saved id never creates a point that has no approved position.
  assert.ok(locationsLib.collectionFor("saved", nyc, saved).every((l) => nyc.includes(l)));
});

test("the index is alphabetical and stable, and directions use the verified destination", () => {
  const index = locationsLib.indexOrder(nyc).map((l) => l.slug);
  assert.equal(index[0], "4-charles-prime-rib");
  assert.deepEqual(plain(index), plain(locationsLib.indexOrder([...nyc].reverse()).map((l) => l.slug)));
  const url = locationsLib.directionsUrl({ name: "Gotham Burger Social Club", address: "131 Essex St, New York, NY 10002" });
  assert.equal(new URL(url).searchParams.get("destination"), "Gotham Burger Social Club, 131 Essex St, New York, NY 10002");
  assert.equal(new URL(url).hostname, "www.google.com");
  assert.equal(new URL(locationsLib.directionsUrl({ name: "A & B", address: null })).searchParams.get("destination"), "A & B");
});

const good = { market: "nyc", center: [-73.99, 40.73], zoom: 12.7, selected: "deux-luxe", filter: "saved", listScroll: 120, focus: "profile", savedAt: 1_000_000 };
test("return state accepts only complete, recent, bounded values for this market", () => {
  const { parseMapReturnState: parse } = returnState({});
  assert.deepEqual(plain(parse(good, "nyc", 1_000_500)), good);
  assert.equal(parse({ ...good, selected: null }, "nyc", 1_000_500).selected, null);
  const bad = [
    null, "x", [], { ...good, market: "dc" }, { ...good, market: "atlantis" }, { ...good, center: [200, 0] }, { ...good, center: [0, 95] },
    { ...good, center: [NaN, 1] }, { ...good, center: [1] }, { ...good, zoom: 30 }, { ...good, zoom: -1 }, { ...good, listScroll: -5 },
    { ...good, filter: "everything" }, { ...good, focus: "https://evil.example" }, { ...good, selected: "" }, { ...good, selected: "x".repeat(257) },
    { ...good, selected: 7 }, { ...good, selected: "a\0b" }, { ...good, savedAt: 1_000_000 - 31 * 60_000 }, { ...good, savedAt: 9_999_999 }, { ...good, savedAt: "now" },
  ];
  for (const value of bad) assert.equal(parse(value, "nyc", 1_000_500), null, JSON.stringify(value)?.slice(0, 60));
  assert.equal(parse(good, "dc", 1_000_500), null, "another market's snapshot is never applied");
});

test("return state is read once, and storage failures degrade to the normal first view", () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const lib = returnState(storage);
  lib.saveMapReturnState(good);
  assert.deepEqual(plain(lib.takeMapReturnState("nyc", 1_000_500)), good);
  assert.equal(lib.takeMapReturnState("nyc", 1_000_500), null, "cleared after one return");
  lib.saveMapReturnState(good);
  assert.equal(lib.takeMapReturnState("dc", 1_000_500), null);
  assert.equal(store.size, 0, "even a mismatched snapshot is cleared");
  store.set(lib.MAP_RETURN_KEY, "{not json");
  assert.equal(lib.takeMapReturnState("nyc", 1_000_500), null);
  const broken = returnState({ getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } });
  assert.doesNotThrow(() => broken.saveMapReturnState(good));
  assert.equal(broken.takeMapReturnState("nyc"), null);
});
