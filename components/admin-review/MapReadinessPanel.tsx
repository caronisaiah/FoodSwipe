"use client";

import { CheckIcon, Chip, Section } from "./ui";
import type { ChecklistState } from "@/lib/adminReview";
import type { SectionProps } from "./types";

/*
  F. Map readiness: read-only. The public map is fed by a SEPARATE map-location review of independently
  sourced locations; publishing a restaurant never creates a map point. This panel only reports where the
  restaurant stands against that system.
*/
export default function MapReadinessPanel({ review }: Pick<SectionProps, "review">) {
  const m = review.mapReadiness;
  const stateOf = (s: string): ChecklistState => (s === "valid" || s === "approved" ? "complete" : s === "invalid" || s === "rejected" ? "invalid" : s === "pending" ? "human" : s === "not_published" ? "info" : "missing");
  const rows: { label: string; state: ChecklistState; detail: string }[] = [
    { label: "Coordinates on the record", state: stateOf(m.coordinates.state), detail: m.coordinates.detail },
    { label: "Market", state: stateOf(m.market.state), detail: m.market.detail },
    { label: "Approved map location", state: stateOf(m.location.state), detail: m.location.detail },
  ];
  return (
    <Section id="map" title="Map readiness" icon="map" chip={m.canAppear ? <Chip tone="mint">Can appear on the map</Chip> : <Chip tone="haze">Not on the map</Chip>}>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.label} className="flex items-start gap-2 text-[12px]">
            <CheckIcon state={r.state} />
            <span><b className="font-semibold text-cream">{r.label}.</b> <span className="text-tan">{r.detail}</span></span>
          </li>
        ))}
      </ul>
      {m.notes.map((n) => <p key={n} className="mt-2 text-[10px] text-haze">{n}</p>)}
    </Section>
  );
}
