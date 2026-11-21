"use client";

import { useEffect, useState } from "react";
import MaterialIcon from "@/components/MaterialIcon";

/**
 * The editorial Save control shared by the profile and the Map preview. It only presents state: `saved` comes
 * from the favorites store, so the fill and `aria-pressed` change when the write is confirmed, never on the press.
 *
 * - A 100 ms glyph settle (save .84 to 1, remove .94 to 1) plays once when the store confirms a change for the
 *   same restaurant. Opening another restaurant that is already saved does not play it.
 * - While a write is in flight the control stays focusable (`aria-disabled`, not `disabled`) and ignores presses;
 *   "Saving…" appears only if the write outlasts 150 ms.
 * - The label width is reserved so Save, Saved and Saving… never move their neighbours.
 */
export default function BookmarkToggle({ identity, name, saved, pending, unavailable = false, onToggle, className = "" }: {
  /** Which restaurant this control is for. A change of identity is never an acknowledgment. */
  identity: string;
  name: string;
  saved: boolean;
  pending: boolean;
  /** The store is not ready, so there is nothing to toggle yet. */
  unavailable?: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const [seen, setSeen] = useState<{ identity: string; saved: boolean; pop: "save" | "remove" | null; count: number }>(
    { identity, saved, pop: null, count: 0 },
  );
  if (seen.identity !== identity) setSeen({ identity, saved, pop: null, count: 0 });
  else if (seen.saved !== saved) setSeen({ identity, saved, pop: saved ? "save" : "remove", count: seen.count + 1 });

  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => setSlow(true), 150);
    return () => { window.clearTimeout(timer); setSlow(false); };
  }, [pending]);

  const label = pending && slow ? (saved ? "Removing…" : "Saving…") : saved ? "Saved" : "Save";
  const blocked = pending || unavailable;
  return (
    <>
      <button type="button" className={`bookmark-toggle ${className}`} aria-pressed={saved} aria-disabled={blocked || undefined}
        aria-busy={pending || undefined} onClick={() => { if (!blocked) onToggle(); }}>
        <span key={`${seen.count}-${saved}`} className="bookmark-glyph" data-pop={seen.pop ?? undefined}>
          <MaterialIcon name="bookmark" filled={saved} />
        </span>
        <span className="bookmark-label">{label}</span>
      </button>
      {/* The confirmation is spoken once, from the store's state, and only for a change the person made. */}
      <span role="status" className="sr-only">{seen.pop === "save" ? `${name} saved.` : seen.pop === "remove" ? `${name} removed from saved.` : ""}</span>
    </>
  );
}
