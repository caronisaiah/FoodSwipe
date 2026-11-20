import { EMPTY_DISCOVERY, isDiscoveryState, LEGACY_SWIPES_KEY, migrateLegacySwipes } from "./discoveryState";
import type { DiscoveryState, Mutation } from "./discoveryState";
import { failureOf, StorageError, toStorageError, type StorageFailure, type StorageOperation } from "./storageErrors";

const DB_NAME = "foodswipe-discovery";
const STORE = "state";
const RECORD = "current";

/**
 * Opening cannot be cancelled, but nothing can be written before it succeeds.
 * A connection that arrives after we gave up is closed, never used.
 */
const OPEN_TIMEOUT_MS = 10_000;
/**
 * A transaction still unfinished after this long is aborted, never abandoned.
 * abort() is the only thing that stops a queued read-modify-write from committing.
 */
const TRANSACTION_TIMEOUT_MS = 8_000;
/** After abort(), the browser must confirm. If it does not, this tab stops trusting its connection. */
const SETTLE_GRACE_MS = 2_000;

export interface DiscoverySnapshot {
  status: "loading" | "ready" | "error";
  state: DiscoveryState;
  /** Why the last operation failed. Present only while status is "error". */
  error?: StorageFailure;
}

export const INITIAL_DISCOVERY: DiscoverySnapshot = { status: "loading", state: EMPTY_DISCOVERY };
let snapshot = INITIAL_DISCOVERY;
let connection: Promise<IDBDatabase> | undefined;
let channel: BroadcastChannel | undefined;
let listening = false;
const subscribers = new Set<() => void>();
/**
 * Transactions we reported as failed although the browser never confirmed they
 * finished. One of them could still commit, so writes from this tab stop until
 * it settles (which clears this) or the page reloads.
 */
let unconfirmed = 0;

function closeQuietly(db: IDBDatabase) {
  try {
    db.close();
  } catch {
    // Already closed.
  }
}

/** Stop using a connection that failed. The next operation opens a fresh one. */
function discard(db: IDBDatabase) {
  connection = undefined;
  closeQuietly(db);
}

function database(): Promise<IDBDatabase> {
  if (connection) return connection;
  const attempt: Promise<IDBDatabase> = new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = window.indexedDB.open(DB_NAME, 1);
    } catch (error) {
      reject(toStorageError(error, "open"));
      return;
    }
    let settled = false;
    const timer = setTimeout(() => fail(new StorageError({ reason: "timeout", operation: "open" })), OPEN_TIMEOUT_MS);
    function fail(error: unknown) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(toStorageError(error, "open"));
    }
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => fail(request.error);
    request.onblocked = () => fail(new StorageError({ reason: "blocked", operation: "open" }));
    request.onsuccess = () => {
      const db = request.result;
      if (settled) {
        // We already reported this open as failed. No transaction was ever started on it.
        closeQuietly(db);
        return;
      }
      settled = true;
      clearTimeout(timer);
      db.onversionchange = () => {
        closeQuietly(db);
        if (connection === attempt) connection = undefined;
      };
      db.onclose = () => {
        if (connection === attempt) connection = undefined;
      };
      resolve(db);
    };
  }).catch((error: unknown) => {
    if (connection === attempt) connection = undefined;
    throw error;
  });
  connection = attempt;
  return attempt;
}

/** A stored record that fails validation is never rewritten. A newer version is named as such. */
function rejectedRecord(stored: unknown): StorageError {
  const version = stored && typeof stored === "object" ? (stored as { version?: unknown }).version : undefined;
  const newer = typeof version === "number" && Number.isSafeInteger(version) && version > 1;
  return new StorageError({ reason: newer ? "unsupported" : "unreadable", operation: "read" });
}

async function transact<T>(update: (state: DiscoveryState) => Mutation<T>) {
  if (unconfirmed > 0) throw new StorageError({ reason: "needs-reload", operation: "write" });
  const db = await database();
  return new Promise<Mutation<T> & { changed: boolean }>((resolve, reject) => {
    let transaction: IDBTransaction;
    let store: IDBObjectStore;
    let read: IDBRequest;
    try {
      transaction = db.transaction(STORE, "readwrite");
      store = transaction.objectStore(STORE);
      read = store.get(RECORD);
    } catch (error) {
      discard(db);
      reject(toStorageError(error, "read"));
      return;
    }

    let phase: StorageOperation = "read";
    let result: (Mutation<T> & { changed: boolean }) | undefined;
    let failure: unknown;
    let settled = false;
    let finished = false;
    let timedOut = false;
    let grace: ReturnType<typeof setTimeout> | undefined;
    let counted = false;

    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      action();
    };
    const abortQuietly = () => {
      try {
        transaction.abort();
      } catch {
        // Already committing or finished. Its own events report the real outcome.
      }
    };
    const finish = () => {
      finished = true;
      clearTimeout(timer);
      clearTimeout(grace);
      if (counted) {
        // The transaction we could not confirm has now settled. Reread what is actually stored.
        counted = false;
        unconfirmed--;
        if (unconfirmed === 0) void refreshDiscovery();
      }
    };

    read.onsuccess = () => {
      // After a timeout nothing further is written, even if the browser still delivers this.
      if (timedOut) return;
      try {
        const stored: unknown = read.result;
        const firstRead = stored === undefined;
        const state = firstRead ? migrateLegacySwipes(window.localStorage.getItem(LEGACY_SWIPES_KEY)) : stored;
        if (!isDiscoveryState(state)) throw rejectedRecord(stored);
        const next = update(state);
        result = { ...next, changed: firstRead || next.state !== state };
        if (result.changed) {
          phase = "write";
          store.put(result.state, RECORD);
        }
      } catch (error) {
        failure = error;
        abortQuietly();
      }
    };
    transaction.onabort = () => {
      finish();
      settle(() => reject(
        failure === undefined && timedOut
          ? new StorageError({ reason: "timeout", operation: phase })
          : toStorageError(failure ?? transaction.error, phase),
      ));
    };
    transaction.oncomplete = () => {
      finish();
      settle(() => resolve(result as Mutation<T> & { changed: boolean }));
    };

    // Referenced by finish(), which only runs from later browser events.
    const timer = setTimeout(() => {
      if (finished) return;
      timedOut = true;
      abortQuietly();
      grace = setTimeout(() => {
        if (finished) return;
        // Neither a commit nor an abort was reported. We cannot prove nothing will commit,
        // so stop writing from this tab instead of letting a stale change land later.
        counted = true;
        unconfirmed++;
        discard(db);
        settle(() => reject(new StorageError({ reason: "needs-reload", operation: phase })));
      }, SETTLE_GRACE_MS);
    }, TRANSACTION_TIMEOUT_MS);
  });
}

function publish(next: DiscoverySnapshot) {
  snapshot = next;
  subscribers.forEach((notify) => notify());
}

/**
 * A write that was rolled back or cancelled leaves the last good favorites
 * readable, so the app keeps showing them and the caller reports the failure.
 * Anything else means the stored data could not be trusted or reached.
 */
function reportFailure(failure: StorageError) {
  if (snapshot.status === "ready" && failure.operation === "write" && failure.reason !== "needs-reload") return;
  publish({ status: "error", state: snapshot.state, error: failureOf(failure) });
}

export async function updateDiscovery<T>(update: (state: DiscoveryState) => Mutation<T>): Promise<T> {
  let result;
  try {
    result = await transact(update);
  } catch (error) {
    const failure = toStorageError(error, "read");
    reportFailure(failure);
    throw failure;
  }
  publish({ status: "ready", state: result.state });
  if (result.changed) {
    try {
      channel?.postMessage(null);
    } catch {
      // A notification failure cannot undo a committed browser transaction.
    }
  }
  return result.value;
}

export async function refreshDiscovery() {
  try {
    await updateDiscovery((state) => ({ state, value: undefined }));
  } catch {
    // The snapshot already carries the error and any last readable state.
  }
}

export function getDiscoverySnapshot() {
  return snapshot;
}

export function subscribeDiscovery(notify: () => void) {
  subscribers.add(notify);
  if (!listening) {
    listening = true;
    try {
      channel = new BroadcastChannel(DB_NAME);
      channel.onmessage = () => void refreshDiscovery();
    } catch {
      // Refresh on return to the page in browsers without BroadcastChannel.
    }
    window.addEventListener("pageshow", refreshDiscovery);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void refreshDiscovery();
    });
    void refreshDiscovery();
  }
  return () => { subscribers.delete(notify); };
}
