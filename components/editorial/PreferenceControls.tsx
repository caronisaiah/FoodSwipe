"use client";

import { useId } from "react";
import MaterialIcon from "@/components/MaterialIcon";

export function SegmentedPreference<Value extends string | number>({
  legend,
  description,
  options,
  value,
  onChange,
}: {
  legend: string;
  description?: string;
  options: readonly { value: Value; label: string; hint?: string }[];
  value: Value;
  onChange: (value: Value) => void;
}) {
  const id = useId();

  return (
    <fieldset className="editorial-field" aria-describedby={description ? id + "-description" : undefined}>
      <legend>{legend}</legend>
      {description && <p id={id + "-description"} className="editorial-field-note">{description}</p>}
      <div className="editorial-segmented">
        {options.map((option) => (
          <label key={option.value} className="editorial-choice editorial-segment">
            <input
              type="radio"
              name={id}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            <span className="editorial-choice-face">
              <strong>{option.label}</strong>
              {option.hint && <span>{option.hint}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function PreferenceCheck({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="editorial-choice editorial-checkbox">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="editorial-choice-face">
        <span>{label}</span>
        <span className="editorial-checkmark" aria-hidden="true"><MaterialIcon name="check" /></span>
      </span>
    </label>
  );
}
