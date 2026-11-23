"use client";

import { useState } from "react";
import MaterialIcon from "@/components/MaterialIcon";
import TagSuggestionsPanel, { type AppliedTagSuggestions } from "@/components/TagSuggestionsPanel";
import { cleanPublicReasonText } from "@/lib/publicReasonText";
import {
  DRAFT_HINT, Field, PriceLevelSelect, TagField, Textarea, VOCAB_HINT, apiErrorText, mergeDraftList,
  parseList, priceDraftValue, pricePayload, useCanPublish,
} from "@/components/AdminCandidates";
import { Chip, Section, primaryButton } from "./ui";
import type { SectionProps } from "./types";

/*
  B. Restaurant details: cuisine, price, vibe, best-for, dishes, public description and review notes.

  Uses the existing PATCH (which enforces the controlled vocabulary). Values the automatic tagger suggested are
  labelled as suggestions everywhere they appear. Saving them does NOT confirm them: the confirmation step is a
  person approving the restaurant after checking, and this screen never claims otherwise.
*/

const same = (a: string[], b: string[]) => a.join("|") === b.join("|");

export default function DetailsPanel({ review, secret, onChanged }: SectionProps) {
  const { candidate } = review;
  const canPublish = useCanPublish();
  const locked = !canPublish && candidate.status === "approved";
  const [cuisine, setCuisine] = useState(candidate.cuisineTags.join(", "));
  const [dietary, setDietary] = useState(candidate.dietaryTags.join(", "));
  const [vibe, setVibe] = useState(candidate.vibeTags.join(", "));
  const [bestFor, setBestFor] = useState(candidate.bestFor.join(", "));
  const [dishes, setDishes] = useState(candidate.dishHighlights.join(", "));
  const [price, setPrice] = useState(priceDraftValue(candidate.priceLevel));
  const [reason, setReason] = useState(cleanPublicReasonText(candidate.reasonText) ?? "");
  const [notes, setNotes] = useState(candidate.reviewNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const snap = candidate.suggestedTags;

  const body: Record<string, unknown> = {};
  if (pricePayload(price) !== (candidate.priceLevel ?? null)) body.priceLevel = pricePayload(price);
  if (!same(parseList(cuisine), candidate.cuisineTags)) body.cuisineTags = parseList(cuisine);
  if (!same(parseList(dietary), candidate.dietaryTags)) body.dietaryTags = parseList(dietary);
  if (!same(parseList(vibe), candidate.vibeTags)) body.vibeTags = parseList(vibe);
  if (!same(parseList(bestFor), candidate.bestFor)) body.bestFor = parseList(bestFor);
  if (!same(parseList(dishes), candidate.dishHighlights)) body.dishHighlights = parseList(dishes);
  if (reason !== (cleanPublicReasonText(candidate.reasonText) ?? "")) body.reasonText = reason;
  if (notes !== (candidate.reviewNotes ?? "")) body.reviewNotes = notes;
  const changed = Object.keys(body);

  async function save() {
    if (saving || changed.length === 0) return;
    if (!secret.trim()) { setMsg({ type: "err", text: "Enter the admin secret first." }); return; }
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/restaurants/candidates/${candidate.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-foodswipe-admin-secret": secret },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string; errors?: { field: string; message: string }[] };
      if (!res.ok) { setMsg({ type: "err", text: apiErrorText(data, `Save failed (${res.status}).`) }); return; }
      setMsg({ type: "ok", text: `Saved ${changed.join(", ")}.` });
      onChanged();
    } catch {
      setMsg({ type: "err", text: "Network error. Nothing was confirmed; refresh before retrying." });
    } finally {
      setSaving(false);
    }
  }

  function applySuggestions(s: AppliedTagSuggestions) {
    setCuisine((p) => mergeDraftList(p, s.cuisineTags));
    setDietary((p) => mergeDraftList(p, s.dietaryTags));
    setVibe((p) => mergeDraftList(p, s.vibeTags));
    setBestFor((p) => mergeDraftList(p, s.bestFor));
    setDishes((p) => mergeDraftList(p, s.dishHighlights));
    const text = cleanPublicReasonText(s.reasonText);
    if (text) setReason((p) => (p.trim() ? p : text));
    setMsg({ type: "ok", text: "Suggestions added to the form. Review them, then Save." });
  }

  const auto = candidate.suggestionConfidence;
  return (
    <Section
      id="details" title="Details" icon="restaurant_menu"
      chip={auto ? <Chip tone="tan" title="Suggested by the automatic tagger, not confirmed by a person">Auto-suggested tags · {auto} confidence</Chip> : undefined}
    >
      {snap && auto && (
        <p className="mb-3 flex items-start gap-1.5 rounded-lg bg-white/5 p-2 text-[11px] text-tan ring-1 ring-inset ring-white/10" data-testid="suggestion-note">
          <MaterialIcon name="auto_fix_high" className="mt-px text-sm" />
          <span>
            Tags marked <b>auto</b> are the tagger&apos;s conservative guess from the restaurant&apos;s name and Google data, not something a person confirmed.
            Saving them does not confirm them. Check them, then approve the restaurant when you are satisfied.
          </span>
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Price level" hint="required to publish"><PriceLevelSelect value={price} onChange={setPrice} /></Field>
        <TagField label="Cuisine" hint={VOCAB_HINT.cuisine} value={cuisine} onChange={setCuisine} suggested={snap?.cuisineTags ?? null} confidence={auto} />
        <TagField label="Vibe" hint={VOCAB_HINT.vibe} value={vibe} onChange={setVibe} suggested={snap?.vibeTags ?? null} confidence={auto} />
        <TagField label="Best for" hint={VOCAB_HINT.bestFor} value={bestFor} onChange={setBestFor} suggested={snap?.bestFor ?? null} confidence={auto} />
        <TagField label="Dietary" hint={VOCAB_HINT.dietary} value={dietary} onChange={setDietary} suggested={snap?.dietaryTags ?? null} confidence={auto} />
        <TagField label="Dish highlights" hint={VOCAB_HINT.dish} value={dishes} onChange={setDishes} suggested={snap?.dishHighlights ?? null} confidence={auto} />
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Public description" hint="shown as “Why you’ll like it”; blank uses safe fallback copy">
          <Textarea value={reason} onChange={setReason} placeholder="One or two honest sentences." />
        </Field>
        <Field label="Review notes" hint="internal: where this came from, what you checked">
          <Textarea value={notes} onChange={setNotes} placeholder="Curation notes…" />
        </Field>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void save()} disabled={saving || changed.length === 0 || locked} className={primaryButton}>
          {saving ? "Saving…" : changed.length ? `Save ${changed.length} change${changed.length === 1 ? "" : "s"}` : "No changes"}
        </button>
        {locked && <span className="text-[11px] text-saffron">{DRAFT_HINT}</span>}
        {msg && <span role="status" className={`text-[11px] ${msg.type === "ok" ? "text-mint" : "text-chili-soft"}`}>{msg.text}</span>}
      </div>

      <div className="mt-3">
        <TagSuggestionsPanel
          suggestEndpoint={`/api/admin/restaurants/candidates/${candidate.id}/suggest-tags`}
          collectEndpoint={`/api/admin/restaurants/candidates/${candidate.id}/collect-website-evidence`}
          websiteDomain={candidate.websiteDomain}
          secret={secret}
          currentValues={{ cuisineTags: parseList(cuisine), dietaryTags: parseList(dietary), vibeTags: parseList(vibe), bestFor: parseList(bestFor), dishHighlights: parseList(dishes), reasonText: reason }}
          onApplySelected={applySuggestions}
        />
      </div>
    </Section>
  );
}
