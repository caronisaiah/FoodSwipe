"use client";

import { useReducer, useState } from "react";
import MaterialIcon from "@/components/MaterialIcon";
import { DRAFT_HINT, apiErrorText, useCanPublish } from "@/components/AdminCandidates";
import { reasonForRequest, reasonReducer } from "@/lib/adminReasonField";
import type { ChecklistGroup } from "@/lib/adminReview";
import { MIN_OVERRIDE_REASON_LENGTH } from "@/lib/publicationChecks";
import { CheckIcon, Chip, inputClass, primaryButton, quietButton } from "./ui";
import type { SectionProps } from "./types";

/*
  G. Publication checklist and the explicit publication actions.

  The checklist is computed by the server from the same rules promotion enforces (lib/adminReview +
  lib/publicationChecks + lib/candidateReadiness), so what it shows is what the backend will do.

  The four actions are deliberately separate and never chained:
    Approve restaurant   marks the draft reviewed (status approved). Does not publish.
    Promote to feed      creates the live restaurant. Needs an approved draft; warnings need a written override.
    Approve a video / Attach a video   are in the Creator videos section, one lead at a time.
  Every consequential action is a button followed by a confirmation. Nothing happens on load or when another
  field is saved. Approve, reject and promote need the publication credential; the server enforces it too.
*/

const GROUPS: { id: ChecklistGroup; label: string }[] = [
  { id: "identity", label: "Identity" }, { id: "details", label: "Details" }, { id: "photo", label: "Photo" },
  { id: "videos", label: "Videos" }, { id: "publication", label: "Publication" },
];

type Pending = "approve" | "reject" | "reopen" | "promote" | null;

export default function ReadinessRail({ review, secret, onChanged }: SectionProps) {
  const { checklist, candidate, publicationChecks, promoted } = review;
  const canPublish = useCanPublish();
  const [pending, setPending] = useState<Pending>(null);
  const [reason, dispatchReason] = useReducer(reasonReducer, "");
  const [overrideReason, setOverrideReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const warnings = publicationChecks.filter((c) => c.severity === "warning");
  const warningCodes = [...new Set(warnings.map((w) => w.code))];
  const needsOverride = warningCodes.length > 0;
  const status = candidate.status;

  function cancel() {
    setPending(null);
    setAcknowledged(false);
    setOverrideReason("");
    dispatchReason({ type: "collapsed" });
  }

  async function setStatus(next: "approved" | "rejected" | "needs_review") {
    const body: Record<string, unknown> = { status: next };
    const r = reasonForRequest(reason);
    if (r) body.auditReason = r;
    const res = await fetch(`/api/admin/restaurants/candidates/${candidate.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", "x-foodswipe-admin-secret": secret }, body: JSON.stringify(body),
    });
    return { res, data: (await res.json()) as { error?: string; errors?: { field: string; message: string }[] } };
  }

  async function promote() {
    const res = await fetch(`/api/admin/restaurants/candidates/${candidate.id}/promote`, {
      method: "POST",
      headers: needsOverride ? { "x-foodswipe-admin-secret": secret, "Content-Type": "application/json" } : { "x-foodswipe-admin-secret": secret },
      body: needsOverride ? JSON.stringify({ override: { acknowledge: warningCodes, reason: overrideReason.trim() } }) : undefined,
    });
    const data = (await res.json()) as { restaurant?: { slug?: string }; heroSelectionWarning?: string; error?: string; code?: string; missingFields?: string[] };
    return { res, data };
  }

  async function run() {
    if (!pending || busy) return;
    if (!secret.trim()) { setMsg({ type: "err", text: "Enter the admin secret first." }); return; }
    setBusy(true);
    setMsg(null);
    try {
      if (pending === "promote") {
        const { res, data } = await promote();
        if (res.ok && data.restaurant?.slug) {
          setMsg({ type: data.heroSelectionWarning ? "err" : "ok", text: data.heroSelectionWarning ? `Published, but the hero selection was not copied: ${data.heroSelectionWarning}` : `Published as /${data.restaurant.slug}.` });
          cancel();
          onChanged();
          return;
        }
        if (res.status === 409 && data.code === "publication_checks_failed") {
          setMsg({ type: "err", text: "The server found warnings that were not acknowledged. The page has been refreshed: review them and try again." });
          onChanged();
          return;
        }
        setMsg({ type: "err", text: apiErrorText(data, `Promotion failed (${res.status}).`) });
        return;
      }
      const { res, data } = await setStatus(pending === "approve" ? "approved" : pending === "reject" ? "rejected" : "needs_review");
      if (!res.ok) { setMsg({ type: "err", text: apiErrorText(data, `Failed (${res.status}).`) }); return; }
      setMsg({ type: "ok", text: pending === "approve" ? "Approved. The restaurant is not published yet." : pending === "reject" ? "Rejected." : "Returned to review." });
      cancel();
      onChanged();
    } catch {
      setMsg({ type: "err", text: "Network error. Nothing was confirmed; refresh before retrying." });
    } finally {
      setBusy(false);
    }
  }

  // The written override is a condition of PUBLISHING only; approving, rejecting or reopening never needs one.
  const overrideOk = pending !== "promote" || !needsOverride || (acknowledged && overrideReason.trim().length >= MIN_OVERRIDE_REASON_LENGTH);
  const publishOnly = !canPublish;
  const canPromote = checklist.promotable && canPublish;

  return (
    <aside aria-label="Publication readiness" className="space-y-3 rounded-xl bg-surface-1 p-3 ring-1 ring-inset ring-white/10" data-testid="readiness-rail">
      <header>
        <h2 className="flex items-center gap-2 font-display text-base font-bold text-cream"><MaterialIcon name="fact_check" className="text-lg text-saffron" />Publication checklist</h2>
        <p className="mt-1 text-[12px] text-tan" data-testid="checklist-summary">{checklist.summary}</p>
        <p className="mt-1 flex flex-wrap gap-1.5">
          <Chip tone={checklist.blockers ? "chili" : "mint"}>{checklist.blockers} blocking</Chip>
          <Chip tone={checklist.humanDecisions ? "saffron" : "haze"}>{checklist.humanDecisions} need a person</Chip>
        </p>
      </header>

      {GROUPS.map((g) => {
        const items = checklist.items.filter((i) => i.group === g.id);
        if (items.length === 0) return null;
        return (
          <div key={g.id}>
            <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-haze">{g.label}</h3>
            <ul className="space-y-1.5">
              {items.map((i) => (
                <li key={i.id} className="flex items-start gap-2 text-[11px]" data-item={i.id} data-state={i.state}>
                  <CheckIcon state={i.state} />
                  <span className="min-w-0"><b className="font-semibold text-cream">{i.label}.</b> <span className="break-words text-haze">{i.detail}</span></span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      <div className="space-y-2 border-t border-line pt-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-haze">Restaurant actions</h3>
        {pending === null ? (
          <div className="flex flex-wrap gap-2">
            {status !== "approved" && <button type="button" className={primaryButton} disabled={publishOnly || busy} title={publishOnly ? DRAFT_HINT : undefined} onClick={() => setPending("approve")} data-testid="approve-restaurant">Approve restaurant…</button>}
            {status !== "rejected" && <button type="button" className={quietButton} disabled={publishOnly || busy} title={publishOnly ? DRAFT_HINT : undefined} onClick={() => setPending("reject")}>Reject…</button>}
            {status !== "needs_review" && <button type="button" className={quietButton} disabled={busy || (publishOnly && status === "approved")} onClick={() => setPending("reopen")}>Return to review…</button>}
            {!promoted && status === "approved" && (
              <button type="button" className={primaryButton} disabled={!canPromote || busy} title={publishOnly ? DRAFT_HINT : !checklist.promotable ? checklist.summary : undefined} onClick={() => setPending("promote")} data-testid="promote-restaurant">Promote to live feed…</button>
            )}
            {promoted && <a className={quietButton} href={`/restaurants/${promoted.slug}`} target="_blank" rel="noopener noreferrer">View live profile</a>}
          </div>
        ) : (
          <div className="space-y-2 rounded-lg bg-saffron/10 p-3 ring-1 ring-inset ring-saffron/30" data-testid="restaurant-confirm" role="group" aria-label="Confirm">
            {pending === "approve" && <><p className="text-[12px] font-semibold text-cream">Approve {candidate.name} as reviewed?</p><p className="text-[11px] text-tan">Approval marks the draft reviewed. It does not publish it and does not approve any video.</p></>}
            {pending === "reject" && <p className="text-[12px] font-semibold text-cream">Reject {candidate.name}?</p>}
            {pending === "reopen" && <p className="text-[12px] font-semibold text-cream">Return {candidate.name} to review?</p>}
            {pending === "promote" && (
              <>
                <p className="text-[12px] font-semibold text-cream">Publish {candidate.name} to the live FoodSwipe feed?</p>
                <p className="text-[11px] text-tan">This creates a public restaurant from the reviewed fields. It does not attach videos and does not create a map point.</p>
                {needsOverride && (
                  <div className="space-y-1.5" data-testid="override-form">
                    <p className="text-[11px] font-semibold text-saffron">These warnings need a decision from you:</p>
                    <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-cream/90">{warnings.map((w, i) => <li key={`${w.code}-${i}`}>{w.message}</li>)}</ul>
                    <label className="block text-[11px] text-haze">Why is publishing correct anyway? (at least {MIN_OVERRIDE_REASON_LENGTH} characters; recorded in the audit log)
                      <textarea className={`${inputClass} mt-1`} rows={2} maxLength={1000} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
                    </label>
                    <label className="flex items-start gap-2 text-[11px] text-cream"><input type="checkbox" className="mt-0.5" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />I have read these warnings ({warningCodes.join(", ")}).</label>
                  </div>
                )}
              </>
            )}
            {pending !== "promote" && (
              <label className="block text-[11px] text-haze">Optional reason (recorded in the audit log)
                <input className={`${inputClass} mt-1`} value={reason} onChange={(e) => dispatchReason({ type: "edited", value: e.target.value })} maxLength={1000} />
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={primaryButton} disabled={busy || !overrideOk} onClick={() => void run()} data-testid="restaurant-confirm-go">
                {busy ? "Working…" : pending === "approve" ? "Approve" : pending === "reject" ? "Reject" : pending === "reopen" ? "Return to review" : needsOverride ? "Publish with recorded override" : "Publish to FoodSwipe"}
              </button>
              <button type="button" className={quietButton} disabled={busy} onClick={cancel}>Cancel</button>
            </div>
          </div>
        )}
        {publishOnly && <p className="text-[11px] text-saffron">{DRAFT_HINT}</p>}
        {msg && <p role="status" className={`text-[11px] ${msg.type === "ok" ? "text-mint" : "text-chili-soft"}`}>{msg.text}</p>}
        <p className="text-[10px] text-haze">Videos are approved and attached one at a time under Creator videos. Nothing on this page publishes anything by itself.</p>
      </div>
    </aside>
  );
}
