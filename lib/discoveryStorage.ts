import { EMPTY_DISCOVERY, isDiscoveryState, LEGACY_SWIPES_KEY, migrateLegacySwipes } from "./discoveryState";
import type { DiscoveryState, Mutation } from "./discoveryState";

const DB_NAME = "foodswipe-discovery";
const STORE = "state";
const RECORD = "current";

export interface DiscoverySnapshot {
  status: "loading" | "ready" | "error";
  state: DiscoveryState;
}

export const INITIAL_DISCOVERY: DiscoverySnapshot = { status: "loading", state: EMPTY_DISCOVERY };
let snapshot = INITIAL_DISCOVERY;
let connection: Promise<IDBDatabase> | undefined;
let channel: BroadcastChannel | undefined;
let listening = false;
const subscribers = new Set<() => void>();

function database(): Promise<IDBDatabase> {
  if (connection) return connection;
  connection = new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Browser discovery storage is blocked by another tab."));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) {
        db.close();
        return;
      }
      db.onversionchange = () => {
        db.close();
        connection = undefined;
      };
      db.onclose = () => { connection = undefined; };
      resolve(db);
    };
  }).catch((error: unknown) => {
    connection = undefined;
    throw error;
  });
  return connection;
}

async function transact<T>(update: (state: DiscoveryState) => Mutation<T>) {
  const db = await database();
  return new Promise<Mutation<T> & { changed: boolean }>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const request = store.get(RECORD);
    let result: Mutation<T> & { changed: boolean };
    let failure: unknown;
    request.onsuccess = () => {
      try {
        const stored: unknown = request.result;
        const firstRead = stored === undefined;
        const state = firstRead ? migrateLegacySwipes(window.localStorage.getItem(LEGACY_SWIPES_KEY)) : stored;
        if (!isDiscoveryState(state)) throw new Error("Browser discovery storage is unreadable.");
        const next = update(state);
        result = { ...next, changed: firstRead || next.state !== state };
        if (result.changed) store.put(result.state, RECORD);
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    };
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error("Discovery transaction aborted."));
    transaction.oncomplete = () => resolve(result);
  });
}

function publish(next: DiscoverySnapshot) {
  snapshot = next;
  subscribers.forEach((notify) => notify());
}

export async function updateDiscovery<T>(update: (state: DiscoveryState) => Mutation<T>): Promise<T> {
  let result;
  try {
    result = await transact(update);
  } catch (error) {
    publish({ status: "error", state: snapshot.state });
    throw error;
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
