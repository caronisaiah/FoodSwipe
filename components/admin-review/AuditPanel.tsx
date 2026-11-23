"use client";

import Link from "next/link";
import { Chip, Section, humanAction } from "./ui";
import type { SectionProps } from "./types";

/*
  H. Recent audit history for this restaurant and its video leads. It uses the existing audit log and its
  authorization: the review response only carries events for the PUBLICATION credential, so a draft-only agent
  sees no history here (and was never sent any).
*/
export default function AuditPanel({ review }: Pick<SectionProps, "review">) {
  const { audit, candidate } = review;
  return (
    <Section id="audit" title="Audit history" icon="history" chip={audit.visible ? <Chip tone="tan">{audit.events.length} recent</Chip> : <Chip tone="haze">Publication credential only</Chip>}>
      {!audit.visible ? (
        <p className="text-[12px] text-haze">The audit history is visible to the publication credential only. This credential cannot read it.</p>
      ) : audit.events.length === 0 ? (
        <p className="text-[12px] text-haze">No audited changes yet for this restaurant or its video leads.</p>
      ) : (
        <ol className="space-y-2" data-testid="audit-events">
          {audit.events.map((e) => {
            const fields = Object.keys(e.changes ?? {});
            return (
              <li key={e.id} className="rounded-lg bg-ink-2/60 p-2 text-[11px] ring-1 ring-inset ring-white/5">
                <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <b className="font-semibold text-cream">{humanAction(e.action)}</b>
                  <span className="text-haze">{e.occurredAt.slice(0, 16).replace("T", " ")} UTC</span>
                </p>
                <p className="text-haze">
                  Credential <b className="text-tan">{e.actorIdentity}</b> ({e.authScope}, shared credential)
                  {fields.length ? <> · changed {fields.slice(0, 6).join(", ")}{fields.length > 6 ? "…" : ""}</> : null}
                </p>
                {e.reason && <p className="mt-0.5 break-words text-tan">Reason: “{e.reason}”</p>}
              </li>
            );
          })}
        </ol>
      )}
      {audit.visible && (
        <p className="mt-2 text-[11px]">
          <Link className="text-saffron underline-offset-2 hover:underline" href={`/admin/audit?resource=${encodeURIComponent(candidate.id)}`}>Open the full audit history</Link>
        </p>
      )}
    </Section>
  );
}
