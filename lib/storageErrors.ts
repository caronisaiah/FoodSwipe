/**
 * Why a device-storage operation failed. The reason decides what we tell the
 * person and whether Retry can actually help. Pure module: no browser APIs.
 */
export type StorageFailureReason =
  /** IndexedDB or legacy storage is missing or refused (private browsing, blocked site data). */
  | "unavailable"
  /** Another tab holds a connection that stops this one from opening. */
  | "blocked"
  /** The browser did not answer in time and the operation was cancelled. */
  | "timeout"
  | "read-failed"
  /** A write was rolled back. Includes running out of space. */
  | "write-failed"
  /** The stored record fails validation. It is left untouched. */
  | "unreadable"
  /** The stored record or database was written by a newer build. It is left untouched. */
  | "unsupported"
  /** A transaction could not be confirmed finished. Writes from this tab stop until reload. */
  | "needs-reload";

export type StorageOperation = "open" | "read" | "write";

/** Plain, serializable description of a failure (safe to keep in a React snapshot). */
export interface StorageFailure {
  reason: StorageFailureReason;
  operation: StorageOperation;
  /** Set when the browser reported QuotaExceededError. */
  detail?: "quota";
}

export class StorageError extends Error implements StorageFailure {
  readonly reason: StorageFailureReason;
  readonly operation: StorageOperation;
  readonly detail?: "quota";

  constructor(failure: StorageFailure, options?: { cause?: unknown }) {
    super(`Device storage ${failure.operation} failed: ${failure.reason}`);
    this.name = "StorageError";
    this.reason = failure.reason;
    this.operation = failure.operation;
    this.detail = failure.detail;
    if (options && "cause" in options) (this as { cause?: unknown }).cause = options.cause;
  }
}

/** Keep only the serializable part of a failure. */
export function failureOf(failure: StorageFailure): StorageFailure {
  return failure.detail
    ? { reason: failure.reason, operation: failure.operation, detail: failure.detail }
    : { reason: failure.reason, operation: failure.operation };
}

function errorName(error: unknown): string {
  return error && typeof error === "object" && typeof (error as { name?: unknown }).name === "string"
    ? (error as { name: string }).name
    : "";
}

const REASONS: readonly string[] = [
  "unavailable", "blocked", "timeout", "read-failed", "write-failed", "unreadable", "unsupported", "needs-reload",
];
const OPERATIONS: readonly string[] = ["open", "read", "write"];

/** A plain failure description, such as the one kept in the discovery snapshot. */
export function isStorageFailure(value: unknown): value is StorageFailure {
  if (!value || typeof value !== "object") return false;
  const { reason, operation } = value as Record<string, unknown>;
  return typeof reason === "string" && REASONS.includes(reason)
    && typeof operation === "string" && OPERATIONS.includes(operation);
}

/** Turn anything thrown by IndexedDB (or our own code) into a classified failure. */
export function toStorageError(error: unknown, operation: StorageOperation): StorageError {
  if (error instanceof StorageError) return error;
  if (isStorageFailure(error)) return new StorageError(failureOf(error));
  const name = errorName(error);
  const cause = { cause: error };
  if (name === "QuotaExceededError") {
    return new StorageError({ reason: "write-failed", operation: "write", detail: "quota" }, cause);
  }
  if (name === "VersionError") return new StorageError({ reason: "unsupported", operation }, cause);
  if (name === "SecurityError") return new StorageError({ reason: "unavailable", operation }, cause);
  if (operation === "open") return new StorageError({ reason: "unavailable", operation }, cause);
  return new StorageError({ reason: operation === "write" ? "write-failed" : "read-failed", operation }, cause);
}

/** Whether pressing Retry can plausibly help. Corrupt or newer data and a stuck transaction need something else. */
export function canRetry(reason: StorageFailureReason): boolean {
  return reason !== "unreadable" && reason !== "unsupported" && reason !== "needs-reload";
}

/** Whether reloading the page is the useful next step. */
export function shouldReload(reason: StorageFailureReason): boolean {
  return reason === "needs-reload" || reason === "unsupported";
}

export type StorageAction = "save" | "remove" | "restore" | "skip" | "restart" | "load";

export interface StorageNotice {
  message: string;
  retry: boolean;
  reload: boolean;
}

const ACTION_PHRASE: Record<Exclude<StorageAction, "load">, string> = {
  save: "save",
  remove: "remove",
  restore: "restore",
  skip: "skip",
  restart: "start over",
};

/**
 * Person-facing explanation. Statements about saved data are only made where the
 * code guarantees them: a rolled-back or cancelled transaction changes nothing,
 * and an unreadable or newer record is never overwritten or deleted.
 */
export function describeStorageFailure(error: unknown, action: StorageAction, subject?: string): StorageNotice {
  const failure = toStorageError(error, action === "load" ? "read" : "write");
  const { reason } = failure;
  const what = action === "load" ? "" : `Couldn’t ${ACTION_PHRASE[action]}${subject ? ` ${subject}` : ""}. `;
  let message: string;
  switch (reason) {
    case "unreadable":
      message = `${what}Saved data on this device couldn’t be read. It hasn’t been changed or deleted.`;
      break;
    case "unsupported":
      message = `${what}Saved data on this device was created by a newer version of FoodSwipe. It has been left untouched. Reload to get the latest version.`;
      break;
    case "needs-reload":
      message = `${what}This device’s storage stopped responding. Reload the page to continue.`;
      break;
    case "timeout":
      message = `${what}This device’s storage didn’t respond in time. Nothing was changed.`;
      break;
    case "blocked":
      message = `${what}Another FoodSwipe tab is blocking storage. Close other FoodSwipe tabs and try again.`;
      break;
    case "unavailable":
      message = `${what}Saved places aren’t available in this browser. Private browsing or blocked site data can cause this.`;
      break;
    case "write-failed":
      message = failure.detail === "quota"
        ? `${what}This device is out of storage space. Your saved places are unchanged. Free some space and try again.`
        : `${what}Your saved places are unchanged.`;
      break;
    default:
      message = `${what}Saved places couldn’t be read on this device.`;
  }
  return { message, retry: canRetry(reason), reload: shouldReload(reason) };
}
