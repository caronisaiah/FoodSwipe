import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
function loadSource(source, filename, dependencies = {}, globals = {}) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const compiled = { exports: {} };
  runInNewContext(outputText, {
    ...globals,
    exports: compiled.exports,
    require: (specifier) => {
      assert(Object.hasOwn(dependencies, specifier), 'Unexpected scope: ' + specifier);
      return dependencies[specifier];
    },
  }, { filename });
  return compiled.exports;
}
function load(relative, dependencies = {}, globals = {}) {
  return loadSource(readFileSync(new URL(relative, import.meta.url), "utf8"), relative, dependencies, globals);
}

/** Let every queued event and promise continuation run. */
async function settle() {
  for (let i = 0; i < 25; i++) await new Promise((resolve) => setImmediate(resolve));
}
/** Manually driven timers, so hangs are simulated without waiting. */
function createClock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  return {
    setTimeout(fn, ms) {
      const id = ++nextId;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    pending: () => timers.size,
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        timers.delete(due[0]);
        due[1].fn();
        await settle();
      }
      now = end;
      await settle();
    },
  };
}

const markets = load("../lib/markets.ts");
const domain = load("../lib/discoveryState.ts", { "./markets": markets });
const errors = load("../lib/storageErrors.ts");
const {
  migrateLegacySwipes, isDiscoveryState, selectFavorites, selectSeen,
  addFavorite, removeFavorite, undoFavorite, recordSwipe, restartMarket,
} = domain;

let checks = 0;
// Values built inside a sandboxed module have another Object.prototype, so compare plain JSON on both sides.
const plain = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function equal(actual, expected) {
  assert.deepEqual(plain(actual), plain(expected));
  checks++;
}
const swipe = (restaurantId, direction, at) => ({ restaurantId, direction, at });
const favorite = (restaurantId, savedAt) => ({ restaurantId, savedAt });
for (const raw of [null, "", "bad JSON", "null", '{"partial":true}']) {
  const state = migrateLegacySwipes(raw);
  equal(isDiscoveryState(state), true);
  equal(selectFavorites(state), []);
  equal(selectSeen(state, "nyc"), []);
}

const legacy = [
  swipe("nyc-first", "right", 30),
  swipe("dc-first", "right", 30),
  swipe("nyc-pass", "left", 90),
  swipe("stale", "right"),
  swipe("nyc-first", "right", 10),
  swipe("dc-first", "left", 100),
  swipe("earlier", "right", 20),
  swipe("unknown-later", "right", "yesterday"),
  swipe("earlier", "right", -3),
  swipe("constructor", "right", 0),
  swipe("", "right", 400),
  swipe("bad-dir", "bogus", 500),
  { direction: "right", at: 16 },
  null,
];
const raw = JSON.stringify(legacy);
let state = migrateLegacySwipes(raw);
const original = [
  favorite("nyc-first", 30), favorite("dc-first", 30), favorite("earlier", 20), favorite("constructor", 0),
  favorite("stale", null), favorite("unknown-later", null),
];
equal(selectFavorites(state), original);
equal(migrateLegacySwipes(raw), JSON.parse(JSON.stringify(state)));
equal(selectSeen(state, "dc"), ["nyc-first", "dc-first", "nyc-pass", "stale", "earlier", "unknown-later", "constructor"]);
equal(isDiscoveryState(state), true);
equal(isDiscoveryState({ ...state, version: 2 }), false);
equal(isDiscoveryState({ ...state, favorites: [state.favorites[0], state.favorites[0]] }), false);
equal(isDiscoveryState({ ...state, history: { fake: { restarted: true, seenIds: [] } } }), false);

state = recordSwipe(state, "dc", "another-dc", "left", 40).state;
equal(selectFavorites(state), original);
state = restartMarket(state, "nyc").state;
equal(selectSeen(state, "nyc"), []);
equal(selectSeen(state, "dc").at(-1), "another-dc");
const replay = recordSwipe(state, "nyc", "nyc-first", "right", 70);
equal(replay.value, false);
equal(selectSeen(replay.state, "nyc"), ["nyc-first"]);
equal(selectFavorites(replay.state), original);
state = recordSwipe(replay.state, "nyc", "nyc-first", "left", 80).state;
equal(selectFavorites(state), original);

const removed = removeFavorite(state, "nyc-first");
equal(selectFavorites(removed.state), original.slice(1));
equal(selectSeen(removed.state, "nyc"), ["nyc-first"]);
const undone = undoFavorite(removed.state, removed.value);
equal(undone.value, true);
equal(selectFavorites(undone.state), original);
equal(undoFavorite(undone.state, removed.value).value, false);

const resaved = addFavorite(removed.state, "nyc-first", 99);
equal(selectFavorites(resaved.state)[0], favorite("nyc-first", 99));
const removedAgain = removeFavorite(resaved.state, "nyc-first");
equal(undoFavorite(removedAgain.state, removed.value).value, false);
equal(undoFavorite(removedAgain.state, removedAgain.value).value, true);
const addedFromProfile = addFavorite(undone.state, "profile-only", 30);
equal(selectSeen(addedFromProfile.state, "nyc"), ["nyc-first"]);
equal(selectFavorites(addedFromProfile.state).slice(0,3), [...original.slice(0,2), favorite("profile-only", 30)]);
equal(isDiscoveryState(JSON.parse(JSON.stringify(addedFromProfile.state))), true);

const large = migrateLegacySwipes(JSON.stringify(Array.from({ length: 1000 }, (_, i) =>
  swipe(`saved-${i}`, "right", i))));
equal(selectFavorites(large).length, 1000);
equal(selectFavorites(large)[0], favorite("saved-999", 999));
equal(isDiscoveryState(large), true);
// Exercise the real transaction callbacks across reopened module instances.
const persisted = { raw, record: undefined, reads: 0, blocked: true };
const clock = createClock();
function openFixture() {
  const window = {
    localStorage: {
      getItem(key) {
        assert.equal(key, "foodswipe.swipes.v2");
        persisted.reads++;
        if (persisted.blocked) throw new Error("Legacy storage read blocked");
        return persisted.raw;
      },
    },
    indexedDB: {
      open() {
        const request = {
          result: {
            transaction() {
              let written, aborted = false;
              const transaction = {
                abort() {
                  aborted = true;
                  queueMicrotask(() => transaction.onabort());
                },
                objectStore: () => ({
                  get() {
                    const read = { result: structuredClone(persisted.record) };
                    queueMicrotask(() => {
                      read.onsuccess();
                      if (aborted) return;
                      if (written) persisted.record = written;
                      transaction.oncomplete();
                    });
                    return read;
                  },
                  put: (next) => { written = structuredClone(next); },
                }),
              };
              return transaction;
            },
          },
        };
        queueMicrotask(() => request.onsuccess());
        return request;
      },
    },
  };
  return load(
    "../lib/discoveryStorage.ts",
    { "./discoveryState": domain, "./storageErrors": errors },
    { window, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
  );
}

const browser = openFixture();
await browser.refreshDiscovery();
equal(browser.getDiscoverySnapshot().status, "error");
equal(persisted.record ?? null, null);
persisted.blocked = false;
await browser.refreshDiscovery();
equal(browser.getDiscoverySnapshot().status, "ready");
equal(selectFavorites(persisted.record), original);
equal(persisted.raw, raw);
await browser.updateDiscovery((state) => removeFavorite(state, "nyc-first"));
equal(selectFavorites(persisted.record), original.slice(1));
persisted.raw = JSON.stringify([...legacy, swipe("nyc-first", "right", 999)]);
const reopened = openFixture();
await reopened.refreshDiscovery();
equal(selectFavorites(reopened.getDiscoverySnapshot().state), original.slice(1));
await reopened.refreshDiscovery();
equal(persisted.reads, 2);
await reopened.updateDiscovery((state) => restartMarket(state, "nyc"));
equal(selectFavorites(persisted.record), original.slice(1));
equal(selectSeen(persisted.record, "nyc"), []);
persisted.record = { version: 2 };
await reopened.refreshDiscovery();
equal(reopened.getDiscoverySnapshot().status, "error");
equal(persisted.record, { version: 2 });
equal(persisted.reads, 2);

equal(reopened.getDiscoverySnapshot().error, { reason: "unsupported", operation: "read" });
equal(browser.getDiscoverySnapshot().error ?? null, null);
equal(clock.pending(), 0);

// ---------------------------------------------------------------------------
// Failure, timeout, recovery and cross-build behavior.
//
// The device below models what IndexedDB guarantees that these checks rely on:
// readwrite transactions run one at a time; put() is only allowed while a
// transaction is active; abort() is refused once a transaction is committing or
// finished; an aborted transaction commits nothing; and a commit or abort can be
// delayed or never reported. It is a model, not a browser. Behavior in real
// Safari and Chrome is listed as remaining risk in the Phase 12 report.
// ---------------------------------------------------------------------------
const ok = (condition, message) => {
  assert(condition, message);
  checks++;
};
const plainFailure = (error) => ({
  reason: error.reason, operation: error.operation, ...(error.detail ? { detail: error.detail } : {}),
});
async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return assert.fail("Expected the operation to fail.");
}
function domError(name) {
  return Object.assign(new Error(name), { name });
}
const canonical = migrateLegacySwipes(raw);
const ID = "nyc-first";
const removeFav = (id) => (state) => removeFavorite(state, id);
const snap = (tab) => tab.getDiscoverySnapshot();

function createDevice({ record, legacyRaw = null, legacyBlocked = false, dbVersion = 1 } = {}) {
  const device = {
    record: record === undefined ? undefined : structuredClone(record),
    dbVersion,
    created: false,
    legacy: { raw: legacyRaw, blocked: legacyBlocked, reads: 0 },
    opens: 0, closes: 0, transactions: 0, puts: 0, commits: 0, aborts: 0, deleteDatabaseCalls: 0,
    holds: new Set(),
    held: [],
    faults: { quota: false, deliverAfterAbort: false, hostile: false, openThrows: null },
    running: null,
    waiting: [],
  };
  // An event is delivered next tick, unless a hold names its kind ("get") or one tab's kind ("get@B").
  function dispatch(kind, tag, run) {
    const key = [kind, `${kind}@${tag}`].find((candidate) => device.holds.has(candidate));
    if (key) device.held.push({ key, run });
    else setImmediate(run);
  }
  device.hold = (key) => device.holds.add(key);
  device.release = async (key) => {
    device.holds.delete(key);
    const ready = device.held.filter((entry) => entry.key === key);
    device.held = device.held.filter((entry) => entry.key !== key);
    for (const entry of ready) entry.run();
    await settle();
  };
  function free(finished) {
    if (finished && device.running === finished) device.running = null;
    while (!device.running && device.waiting.length) {
      const next = device.waiting.shift();
      if (next.state !== "active") continue;
      device.running = next;
      begin(next);
    }
  }
  function begin(tx) {
    dispatch("get", tx.tag, () => {
      // A compliant engine answers an aborted transaction with an error, never a result.
      if (tx.state !== "active" && !device.faults.deliverAfterAbort) return;
      tx.inCallback = true;
      tx.getRequest.result = structuredClone(device.record);
      try {
        tx.getRequest.onsuccess?.();
      } finally {
        tx.inCallback = false;
      }
      if (tx.state === "active") commit(tx);
      else if (device.faults.hostile && tx.write !== undefined) {
        // A broken engine that commits a write made after the transaction was aborted.
        device.record = structuredClone(tx.write);
        device.commits++;
      }
    });
  }
  function commit(tx) {
    tx.state = "committing";
    dispatch("commit", tx.tag, () => {
      if (tx.write !== undefined && device.faults.quota) {
        tx.state = "finished";
        tx.error = domError("QuotaExceededError");
        device.aborts++;
        dispatch("abort-event", tx.tag, () => tx.onabort?.());
        free(tx);
        return;
      }
      if (tx.write !== undefined) {
        device.record = structuredClone(tx.write);
        device.commits++;
      }
      tx.state = "finished";
      dispatch("complete-event", tx.tag, () => tx.oncomplete?.());
      free(tx);
    });
  }
  function makeDb(tag) {
    const db = {
      closed: false,
      close() {
        db.closed = true;
        device.closes++;
      },
      createObjectStore() {},
      transaction(storeName, mode) {
        assert.equal(storeName, "state");
        assert.equal(mode, "readwrite");
        if (db.closed) throw domError("InvalidStateError");
        device.transactions++;
        const tx = {
          tag, state: "active", write: undefined, inCallback: false, error: null, getRequest: undefined,
          abort() {
            if (tx.state === "committing" || tx.state === "finished") throw domError("InvalidStateError");
            tx.state = "finished";
            tx.write = undefined;
            device.aborts++;
            device.waiting = device.waiting.filter((entry) => entry !== tx);
            dispatch("abort-event", tag, () => tx.onabort?.());
            free(tx);
          },
          objectStore() {
            return {
              get(key) {
                assert.equal(key, "current");
                tx.getRequest = {};
                return tx.getRequest;
              },
              put(value, key) {
                if ((tx.state !== "active" && !device.faults.hostile) || !tx.inCallback) {
                  throw domError("TransactionInactiveError");
                }
                assert.equal(key, "current");
                device.puts++;
                tx.write = structuredClone(value);
                return {};
              },
            };
          },
        };
        device.waiting.push(tx);
        free();
        return tx;
      },
    };
    return db;
  }
  device.indexedDBFor = (tag) => ({
    open(name, version) {
      assert.equal(name, "foodswipe-discovery");
      assert.equal(version, 1);
      if (device.faults.openThrows) throw device.faults.openThrows;
      device.opens++;
      const request = {};
      request.result = makeDb(tag);
      dispatch("open", tag, () => {
        if (device.dbVersion > version) {
          request.error = domError("VersionError");
          request.onerror?.();
          return;
        }
        if (!device.created) {
          device.created = true;
          request.onupgradeneeded?.();
        }
        request.onsuccess?.();
      });
      return request;
    },
    deleteDatabase() {
      device.deleteDatabaseCalls++;
      throw new Error("Recovery must never delete the user's database.");
    },
  });
  return device;
}

function openTab(device, { tag = "tab", bus = new Set(), build = "current" } = {}) {
  const clock = createClock();
  const window = {
    localStorage: {
      getItem(key) {
        assert.equal(key, "foodswipe.swipes.v2");
        device.legacy.reads++;
        if (device.legacy.blocked) throw domError("SecurityError");
        return device.legacy.raw;
      },
    },
    indexedDB: device.indexedDBFor(tag),
    addEventListener() {},
  };
  const document = { visibilityState: "visible", addEventListener() {} };
  class FakeChannel {
    constructor() {
      bus.add(this);
    }
    postMessage() {
      bus.sent = (bus.sent ?? 0) + 1;
      for (const peer of bus) if (peer !== this) setImmediate(() => peer.onmessage?.({}));
    }
  }
  const globals = {
    window, document, BroadcastChannel: FakeChannel, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
  };
  const storage = build === "current"
    ? load("../lib/discoveryStorage.ts", { "./discoveryState": domain, "./storageErrors": errors }, globals)
    : loadSource(build.storage, "6c77e58/lib/discoveryStorage.ts", { "./discoveryState": build.domain }, globals);
  return { ...storage, clock, window };
}

// 1. Opening the database never completes.
{
  const device = createDevice({ record: canonical });
  device.hold("open");
  const tab = openTab(device);
  const attempt = rejection(tab.updateDiscovery(removeFav(ID)));
  await settle();
  equal(device.transactions, 0);
  await tab.clock.advance(9_999);
  equal(snap(tab).status, "loading");
  await tab.clock.advance(1);
  equal(plainFailure(await attempt), { reason: "timeout", operation: "open" });
  equal(snap(tab).error, { reason: "timeout", operation: "open" });
  equal(tab.clock.pending(), 0);
  await device.release("open");
  equal([device.closes, device.transactions, device.puts], [1, 0, 0]);
  equal(device.record, canonical);
  await tab.refreshDiscovery();
  equal(snap(tab).status, "ready");
  equal(snap(tab).error ?? null, null);
  equal(selectFavorites(snap(tab).state), original);
  equal(device.record, canonical);
}

// 2. A read that never answers is aborted. A late answer cannot write, even from an engine that delivers it
//    and from a hostile one that would commit a write made after the abort.
for (const mode of ["compliant", "late-delivery", "hostile"]) {
  const device = createDevice({ record: canonical });
  device.faults.deliverAfterAbort = mode !== "compliant";
  device.faults.hostile = mode === "hostile";
  const tab = openTab(device);
  await tab.refreshDiscovery();
  equal(snap(tab).status, "ready");
  device.hold("get");
  const attempt = rejection(tab.updateDiscovery(removeFav(ID)));
  await settle();
  await tab.clock.advance(8_000);
  equal(plainFailure(await attempt), { reason: "timeout", operation: "read" });
  equal([device.aborts, device.puts], [1, 0]);
  equal(device.record, canonical);
  equal(tab.clock.pending(), 0);
  await device.release("get");
  equal([device.puts, device.commits], [0, 0]);
  equal(device.record, canonical);
  equal(snap(tab).status, "error");
  await tab.refreshDiscovery();
  equal(snap(tab).status, "ready");
  equal(selectFavorites(snap(tab).state), original);
}

// 3. A commit that is already under way cannot be aborted. It is reported as it really ends, not as a failure.
{
  const device = createDevice({ record: canonical });
  const tab = openTab(device);
  await tab.refreshDiscovery();
  device.hold("commit");
  let outcome = "pending";
  const attempt = tab.updateDiscovery(removeFav(ID));
  attempt.then(() => { outcome = "resolved"; }, () => { outcome = "rejected"; });
  await settle();
  await tab.clock.advance(8_000);
  equal([outcome, device.aborts], ["pending", 0]);
  await device.release("commit");
  equal(outcome, "resolved");
  equal(selectFavorites(device.record), original.slice(1));
  equal(snap(tab).status, "ready");
  equal(selectFavorites(snap(tab).state), original.slice(1));
  equal(tab.clock.pending(), 0);
}

// 4. A commit the browser never reports. Writes from this tab stop, so nothing stale can land over newer data.
{
  const device = createDevice({ record: canonical });
  const tab = openTab(device);
  await tab.refreshDiscovery();
  device.hold("commit");
  const attempt = rejection(tab.updateDiscovery(removeFav(ID)));
  await settle();
  await tab.clock.advance(10_000);
  equal(plainFailure(await attempt), { reason: "needs-reload", operation: "write" });
  equal(snap(tab).status, "error");
  equal(snap(tab).error, { reason: "needs-reload", operation: "write" });
  const before = device.transactions;
  const refused = await rejection(tab.updateDiscovery((state) => addFavorite(state, "newer-intent", 500)));
  equal(plainFailure(refused).reason, "needs-reload");
  equal(device.transactions, before);
  equal(device.record, canonical);
  await device.release("commit");
  equal(snap(tab).status, "ready");
  equal(selectFavorites(snap(tab).state), original.slice(1));
  equal(selectFavorites(device.record), original.slice(1));
  await tab.updateDiscovery((state) => addFavorite(state, "after-fence", 600));
  equal(selectFavorites(device.record)[0], favorite("after-fence", 600));
  equal(tab.clock.pending(), 0);
}

// 5. An abort the browser accepts but never confirms. The late events change nothing.
{
  const device = createDevice({ record: canonical });
  const tab = openTab(device);
  await tab.refreshDiscovery();
  device.hold("get");
  device.hold("abort-event");
  const attempt = rejection(tab.updateDiscovery(removeFav(ID)));
  await settle();
  await tab.clock.advance(10_000);
  equal(plainFailure(await attempt), { reason: "needs-reload", operation: "read" });
  equal([device.aborts, device.puts], [1, 0]);
  await device.release("get");
  await device.release("abort-event");
  equal(device.record, canonical);
  equal(snap(tab).status, "ready");
  equal(tab.clock.pending(), 0);
}

// 6. Running out of space. The last good favorites stay on screen and in storage, and a retry works.
{
  const device = createDevice({ record: canonical });
  const tab = openTab(device);
  await tab.refreshDiscovery();
  const swipeRight = (state) => recordSwipe(state, "nyc", "fresh-place", "right", 700);
  device.faults.quota = true;
  const failure = await rejection(tab.updateDiscovery(swipeRight));
  equal(plainFailure(failure), { reason: "write-failed", operation: "write", detail: "quota" });
  ok(failure instanceof errors.StorageError, "write failures are StorageError instances");
  equal(snap(tab).status, "ready");
  equal(snap(tab).error ?? null, null);
  equal(selectFavorites(snap(tab).state), original);
  equal(device.record, canonical);
  const notice = errors.describeStorageFailure(failure, "save", "Fresh Place");
  ok(notice.message.startsWith("Couldn’t save Fresh Place.") && notice.message.includes("out of storage space"), notice.message);
  equal([notice.retry, notice.reload], [true, false]);
  device.faults.quota = false;
  equal(await tab.updateDiscovery(swipeRight), true);
  equal(selectFavorites(device.record).filter(({ restaurantId }) => restaurantId === "fresh-place").length, 1);
  equal(selectSeen(device.record, "nyc").filter((id) => id === "fresh-place").length, 1);
  equal(device.record.nextRevision, canonical.nextRevision + 1);
}
{
  // The very first write also stores the migrated list, so a failure here leaves nothing readable yet.
  const device = createDevice({ legacyRaw: raw });
  device.faults.quota = true;
  const tab = openTab(device);
  const failure = await rejection(tab.updateDiscovery((state) => ({ state, value: undefined })));
  equal(plainFailure(failure), { reason: "write-failed", operation: "write", detail: "quota" });
  equal(snap(tab).status, "error");
  equal(snap(tab).error?.reason, "write-failed");
  equal(device.record ?? null, null);
  equal(device.legacy.raw, raw);
  device.faults.quota = false;
  await tab.refreshDiscovery();
  equal(snap(tab).status, "ready");
  equal(selectFavorites(device.record), original);
  equal(device.legacy.reads, 2);
}

// 7. Corrupted or newer data is never changed, deleted or replaced.
for (const [record, reason] of [
  [{ version: 1, favorites: "nope", nextRevision: 0, legacySeenIds: [], history: {} }, "unreadable"],
  [{ version: 2, favorites: [{ restaurantId: "future" }], extra: ["kept"] }, "unsupported"],
]) {
  const device = createDevice({ record, legacyRaw: raw });
  const tab = openTab(device);
  await tab.refreshDiscovery();
  equal(snap(tab).status, "error");
  equal(snap(tab).error, { reason, operation: "read" });
  equal(device.record, record);
  equal([device.puts, device.commits, device.deleteDatabaseCalls, device.legacy.reads], [0, 0, 0, 0]);
  const refused = await rejection(tab.updateDiscovery((state) => addFavorite(state, "blocked-write", 1)));
  equal(plainFailure(refused).reason, reason);
  equal(device.record, record);
  const notice = errors.describeStorageFailure(snap(tab).error, "load");
  equal([notice.retry, notice.reload], [false, reason === "unsupported"]);
  ok(/untouched|hasn’t been changed or deleted/.test(notice.message), notice.message);
}
{
  // A database created by a newer build is reported, never deleted or downgraded.
  const device = createDevice({ record: canonical, dbVersion: 2 });
  const tab = openTab(device);
  await tab.refreshDiscovery();
  equal(snap(tab).error, { reason: "unsupported", operation: "open" });
  equal([device.deleteDatabaseCalls, device.transactions, device.puts], [0, 0, 0]);
  equal(device.record, canonical);
}
{
  const device = createDevice({ record: canonical });
  const tab = openTab(device);
  tab.window.indexedDB = undefined;
  await tab.refreshDiscovery();
  equal(snap(tab).error, { reason: "unavailable", operation: "open" });
  tab.window.indexedDB = device.indexedDBFor("tab");
  await tab.refreshDiscovery();
  equal(snap(tab).status, "ready");
  device.faults.openThrows = domError("SecurityError");
  const blocked = openTab(device);
  await blocked.refreshDiscovery();
  equal(snap(blocked).error, { reason: "unavailable", operation: "open" });
}
{
  const device = createDevice({ legacyRaw: raw, legacyBlocked: true });
  const tab = openTab(device);
  await tab.refreshDiscovery();
  equal(snap(tab).error, { reason: "unavailable", operation: "read" });
  equal(device.record ?? null, null);
}

// 8. A failed or hung swipe never leaves the app stuck, and recording it later happens exactly once.
{
  const device = createDevice({ record: canonical });
  const tab = openTab(device);
  await tab.refreshDiscovery();
  const swipeRight = (state) => recordSwipe(state, "nyc", "recovered", "right", 800);
  device.faults.quota = true;
  await rejection(tab.updateDiscovery(swipeRight));
  device.faults.quota = false;
  device.hold("get");
  const hung = rejection(tab.updateDiscovery(swipeRight));
  await settle();
  await tab.clock.advance(8_000);
  equal(plainFailure(await hung).reason, "timeout");
  await device.release("get");
  equal(device.record, canonical);
  equal(await tab.updateDiscovery(swipeRight), true);
  equal(snap(tab).status, "ready");
  equal(selectFavorites(device.record).filter(({ restaurantId }) => restaurantId === "recovered").length, 1);
  equal(selectSeen(device.record, "nyc").filter((id) => id === "recovered").length, 1);
  equal(device.record.nextRevision, canonical.nextRevision + 1);
}

// 9. A request that times out can never land later over newer data from another tab.
for (const mode of ["compliant", "late-delivery", "hostile"]) {
  const device = createDevice({ record: canonical });
  device.faults.deliverAfterAbort = mode !== "compliant";
  device.faults.hostile = mode === "hostile";
  const a = openTab(device, { tag: "A" });
  const b = openTab(device, { tag: "B" });
  await a.refreshDiscovery();
  await b.refreshDiscovery();
  device.hold("get@A");
  const stale = rejection(a.updateDiscovery(removeFav(ID)));
  await settle();
  await a.clock.advance(8_000);
  equal(plainFailure(await stale).reason, "timeout");
  await b.updateDiscovery((state) => addFavorite(state, "newer-intent", 900));
  const afterNewer = structuredClone(device.record);
  await device.release("get@A");
  equal(device.record, afterNewer);
  equal(selectFavorites(device.record).some(({ restaurantId }) => restaurantId === ID), true);
  equal(selectFavorites(device.record).some(({ restaurantId }) => restaurantId === "newer-intent"), true);
  equal(device.puts, 1);
}

// 10. Two tabs, with a failure and a retry in between. Tabs hear about each other's committed changes only.
{
  const device = createDevice({ record: canonical });
  const bus = new Set();
  const a = openTab(device, { tag: "A", bus });
  const b = openTab(device, { tag: "B", bus });
  const stopA = a.subscribeDiscovery(() => {});
  const stopB = b.subscribeDiscovery(() => {});
  await settle();
  equal([snap(a).status, snap(b).status, bus.size], ["ready", "ready", 2]);
  device.hold("get@B");
  const refreshB = b.refreshDiscovery();
  await settle();
  await b.clock.advance(8_000);
  await refreshB;
  equal(snap(b).error, { reason: "timeout", operation: "read" });
  await device.release("get@B");
  await a.updateDiscovery((state) => addFavorite(state, "from-a", 950));
  await settle();
  equal(snap(b).status, "ready");
  equal(selectFavorites(snap(b).state)[0], favorite("from-a", 950));
  device.faults.quota = true;
  const sentBefore = bus.sent ?? 0;
  await rejection(a.updateDiscovery((state) => addFavorite(state, "doomed", 960)));
  await settle();
  equal(bus.sent ?? 0, sentBefore);
  equal(selectFavorites(snap(b).state).some(({ restaurantId }) => restaurantId === "doomed"), false);
  device.faults.quota = false;
  await a.updateDiscovery((state) => addFavorite(state, "doomed", 960));
  await settle();
  equal(selectFavorites(snap(b).state)[0], favorite("doomed", 960));
  stopA();
  stopB();
}

// 11. Classification and wording. Claims about saved data are made only where the code guarantees them.
for (const [input, operation, expected] of [
  [{ name: "QuotaExceededError" }, "read", { reason: "write-failed", operation: "write", detail: "quota" }],
  [{ name: "VersionError" }, "open", { reason: "unsupported", operation: "open" }],
  [{ name: "SecurityError" }, "read", { reason: "unavailable", operation: "read" }],
  [{ name: "UnknownError" }, "read", { reason: "read-failed", operation: "read" }],
  [{ name: "AbortError" }, "write", { reason: "write-failed", operation: "write" }],
  [new TypeError("no indexedDB"), "open", { reason: "unavailable", operation: "open" }],
  [null, "read", { reason: "read-failed", operation: "read" }],
  [{ reason: "timeout", operation: "open" }, "write", { reason: "timeout", operation: "open" }],
]) equal(plainFailure(errors.toStorageError(input, operation)), expected);
equal(["unreadable", "unsupported", "needs-reload"].map((reason) => errors.canRetry(reason)), [false, false, false]);
equal(["timeout", "blocked", "unavailable", "read-failed", "write-failed"].every((reason) => errors.canRetry(reason)), true);
equal(["needs-reload", "unsupported"].every((reason) => errors.shouldReload(reason)), true);
equal(["timeout", "unreadable", "write-failed"].some((reason) => errors.shouldReload(reason)), false);
{
  const say = (reason, operation = "write", action = "save") =>
    errors.describeStorageFailure({ reason, operation }, action, "Place").message;
  ok(say("timeout").includes("Nothing was changed."), "a cancelled operation changed nothing");
  ok(say("write-failed").includes("unchanged"), "a rolled-back write leaves saved places unchanged");
  ok(say("unsupported", "read", "load").includes("untouched"), "newer data is left untouched");
  ok(!/unchanged|Nothing was changed/.test(say("needs-reload")), "an unconfirmed outcome makes no claim about saved data");
  ok(say("blocked").includes("Close other FoodSwipe tabs"), "a blocked open names the fix");
}

// 12. Compatibility with the Phase 10 release candidate (6c77e588). Its stored data and ours are interchangeable.
const OLD_BUILD = "6c77e588e5823c0277a9645e14d4ea18cd849b44";
function gitShow(path) {
  return execFileSync("git", ["show", `${OLD_BUILD}:${path}`], {
    cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
}
let old;
try {
  old = { state: gitShow("lib/discoveryState.ts"), storage: gitShow("lib/discoveryStorage.ts") };
} catch (error) {
  if (process.env.FOODSWIPE_SKIP_CROSS_BUILD !== "1") {
    throw new Error(
      `Cannot read ${OLD_BUILD} from Git. Fetch full history, or set FOODSWIPE_SKIP_CROSS_BUILD=1 to skip this check on purpose.`,
      { cause: error },
    );
  }
  console.warn(`SKIPPED cross-build compatibility: ${OLD_BUILD} is not available.`);
}
if (old) {
  const oldDomain = loadSource(old.state, "6c77e58/lib/discoveryState.ts", { "./markets": markets });
  equal(old.state === readFileSync(new URL("../lib/discoveryState.ts", import.meta.url), "utf8"), true);
  for (const source of [old.storage, readFileSync(new URL("../lib/discoveryStorage.ts", import.meta.url), "utf8")]) {
    for (const declaration of [
      'const DB_NAME = "foodswipe-discovery";', 'const STORE = "state";', 'const RECORD = "current";',
      "window.indexedDB.open(DB_NAME, 1)",
    ]) ok(source.includes(declaration), declaration);
  }
  const device = createDevice({ legacyRaw: raw });
  const oldTab = openTab(device, { tag: "old", build: { storage: old.storage, domain: oldDomain } });
  const newTab = openTab(device, { tag: "new" });
  await oldTab.refreshDiscovery();
  equal(selectFavorites(device.record), original);
  await oldTab.updateDiscovery((state) => oldDomain.recordSwipe(state, "nyc", "old-save", "right", 1000));
  const removal = await oldTab.updateDiscovery((state) => oldDomain.removeFavorite(state, ID));
  await oldTab.updateDiscovery((state) => oldDomain.restartMarket(state, "dc"));
  const afterOld = structuredClone(device.record);
  await newTab.refreshDiscovery();
  equal(selectFavorites(snap(newTab).state), oldDomain.selectFavorites(afterOld));
  equal(selectSeen(snap(newTab).state, "dc"), oldDomain.selectSeen(afterOld, "dc"));
  equal(await newTab.updateDiscovery((state) => undoFavorite(state, removal)), true);
  await newTab.updateDiscovery((state) => recordSwipe(state, "nyc", "new-skip", "left", 1100));
  await newTab.updateDiscovery((state) => removeFavorite(state, "old-save"));
  await oldTab.refreshDiscovery();
  const final = structuredClone(device.record);
  equal(oldDomain.isDiscoveryState(final), true);
  equal(oldDomain.selectFavorites(snap(oldTab).state), selectFavorites(final));
  equal(oldDomain.selectSeen(snap(oldTab).state, "nyc"), selectSeen(final, "nyc"));
  equal(Object.keys(final).sort(), ["favorites", "history", "legacySeenIds", "nextRevision", "version"]);
  equal(final.version, 1);
  equal(Object.keys(final.favorites[0]).sort(), ["order", "removed", "restaurantId", "revision", "savedAt"]);
  equal(oldDomain.selectFavorites(final).some(({ restaurantId }) => restaurantId === "old-save"), false);
  equal(oldDomain.selectFavorites(final).some(({ restaurantId }) => restaurantId === ID), true);
  device.faults.quota = true;
  await rejection(newTab.updateDiscovery((state) => addFavorite(state, "never-stored", 1)));
  device.faults.quota = false;
  equal(device.record, final);
  await oldTab.updateDiscovery((state) => oldDomain.addFavorite(state, "old-again", 1200));
  await newTab.refreshDiscovery();
  equal(selectFavorites(snap(newTab).state)[0], favorite("old-again", 1200));
}

console.log(`Favorites checks passed (${checks} assertions, isolated storage and a modelled IndexedDB device). Real-browser cross-tab and hang behavior is covered in browser QA.`);
