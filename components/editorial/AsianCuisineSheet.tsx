"use client";

import { useId, useRef, useState } from "react";
import MaterialIcon from "@/components/MaterialIcon";
import type { Craving } from "@/lib/types";
import { PreferenceCheck } from "@/components/editorial/PreferenceControls";

export interface AsianChoice {
  value: Craving;
  label: string;
}

/**
 * The "Asian" row in Tune's cuisine list: a regular row that opens a compact bottom
 * sheet with "All Asian" and the specific Asian cuisines this market carries. "All
 * Asian" and the specifics are mutually exclusive; the parent owns that rule.
 */
export default function AsianCuisineSheet({
  choices, unavailable, allAsian, selected, onAll, onChoice,
}: {
  /** Specific choices present in the active market, in list order. */
  choices: AsianChoice[];
  /** Selected specifics this market does not carry. Kept visible so they can be cleared. */
  unavailable: AsianChoice[];
  allAsian: boolean;
  /** Values of the selected specifics (market or not). */
  selected: Craving[];
  onAll: (checked: boolean) => void;
  onChoice: (value: Craving, checked: boolean) => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const count = selected.length;
  const summary = allAsian ? "All" : count > 0 ? String(count) : null;
  const names = choices.concat(unavailable).filter(({ value }) => selected.includes(value)).map(({ label }) => label);
  const state = allAsian ? "All Asian" : names.join(", ") || "none selected";

  return (
    <div className="asian-group">
      <div className="editorial-choice editorial-checkbox">
        <button
          ref={trigger}
          type="button"
          className="editorial-choice-face asian-trigger"
          data-selected={allAsian || count > 0 ? "" : undefined}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={id}
          aria-label={`Asian cuisines, ${state}`}
          onClick={() => {
            setOpen(true);
            dialog.current?.showModal();
          }}
        >
          <span>
            Asian{summary && <small> · {summary}</small>}
            <MaterialIcon name="expand_more" className="asian-caret" />
          </span>
          <span className="editorial-checkmark" aria-hidden="true"><MaterialIcon name="check" /></span>
        </button>
      </div>
      <dialog
        ref={dialog}
        id={id}
        className="asian-sheet"
        aria-labelledby={`${id}-title`}
        onClose={() => {
          setOpen(false);
          trigger.current?.focus({ preventScroll: true });
        }}
        onClick={(event) => {
          // A tap on the backdrop targets the dialog itself, outside its box. Clicks that
          // bubble up from a row (including keyboard-made ones, at 0,0) must not count.
          if (event.target !== event.currentTarget) return;
          const box = event.currentTarget.getBoundingClientRect();
          const outside = event.clientX < box.left || event.clientX > box.right
            || event.clientY < box.top || event.clientY > box.bottom;
          if (outside) event.currentTarget.close();
        }}
      >
        <div className="asian-sheet-head">
          <h2 id={`${id}-title`} className="editorial-section-title">Asian cuisines</h2>
          <button type="button" className="asian-done" onClick={() => dialog.current?.close()}>Done</button>
        </div>
        <PreferenceCheck label="All Asian" checked={allAsian} onChange={onAll} />
        <div className="editorial-checklist editorial-checklist-cuisine">
          {choices.map(({ value, label }) => (
            <PreferenceCheck
              key={value}
              label={label}
              checked={selected.includes(value)}
              onChange={(checked) => onChoice(value, checked)}
            />
          ))}
          {unavailable.map(({ value, label }) => (
            <div key={value} className="asian-unavailable">
              <PreferenceCheck
                label={label}
                note="Not in this market"
                checked
                onChange={(checked) => onChoice(value, checked)}
              />
            </div>
          ))}
        </div>
      </dialog>
    </div>
  );
}
