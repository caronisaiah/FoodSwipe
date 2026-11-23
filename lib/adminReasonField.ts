/*
  Lifecycle of the optional "Reason" box beside an admin action (INTERNAL admin screens).

  The reason is recorded on the audit event of the ONE action it was typed for. It must never be carried
  over to a later, different action: a Restore must not be recorded with the reason typed for the earlier
  Hide. So the field resets whenever an action completes, the row is collapsed, or the record changes
  underneath it. It is kept only when an action fails, so the person can retry what they wrote.

  Nothing here invents a reason: an empty box sends no reason at all.
*/

/** Matches the server's limit (lib/adminAudit cleanReason); kept local so this client module has no server imports. */
export const REASON_MAX_LENGTH = 1000;

export type ReasonEvent =
  | { type: "edited"; value: string }
  | { type: "action-succeeded" }
  | { type: "action-failed" }
  | { type: "collapsed" }
  | { type: "record-changed" };

export function reasonReducer(current: string, event: ReasonEvent): string {
  switch (event.type) {
    case "edited":
      return event.value.slice(0, REASON_MAX_LENGTH);
    case "action-failed":
      return current;
    case "action-succeeded":
    case "collapsed":
    case "record-changed":
      return "";
  }
}

/** The reason to send with a request: the trimmed text the person typed, or nothing. */
export function reasonForRequest(current: string): string | undefined {
  const trimmed = current.trim();
  return trimmed ? trimmed : undefined;
}
