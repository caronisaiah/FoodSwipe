"use client";

import { useState } from "react";
import MaterialIcon from "@/components/MaterialIcon";
import { CUISINES, DIETARY, VIBES } from "@/lib/vocab";

/*
  Tag Automation B3 + B4 + B5 — admin review of tag suggestions.

  - Deterministic suggestions (B2/B3): GET <suggestEndpoint>.
  - AI-assisted suggestions (B4): GET <suggestEndpoint>?mode=ai, grounded in
    official-website evidence; review-required.
  - Collect website evidence (B4): POST <collectEndpoint> (admin-triggered, bounded,
    same-domain only). Writes ONLY the evidence table — never tags.

  B5 may apply explicitly selected suggestions to the parent editor's LOCAL draft
  via `onApplySelected`, but this panel never saves, PATCHes, changes status, or
  writes tags. It fetches only when the admin clicks a button. Types are mirrored
  locally so no server/DB module bundles into this client component; the admin
  secret is sent as a header only (never persisted/logged here).
*/

type Confidence = "high" | "medium" | "low";

interface Suggestion {
  field: string;
  value: string;
  confidence: Confidence;
  reason: string;
  evidenceSource: string;
  evidenceText?: string;
  reviewOnly: boolean;
  autoFillSafe: boolean;
}

interface SuggestionResult {
  suggestionsByField: Record<string, Suggestion[]>;
  overallConfidence: Confidence;
  reasons: string[];
  warnings: string[];
}

type ApplyField = "cuisineTags" | "dietaryTags" | "vibeTags" | "dishHighlights" | "bestFor" | "reasonText";

export interface AppliedTagSuggestions {
  cuisineTags?: string[];
  dietaryTags?: string[];
  vibeTags?: string[];
  dishHighlights?: string[];
  bestFor?: string[];
  reasonText?: string;
}

interface CurrentSuggestionValues {
  cuisineTags?: string[];
  dietaryTags?: string[];
  vibeTags?: string[];
  dishHighlights?: string[];
  bestFor?: string[];
  reasonText?: string | null;
}

interface EvidenceMeta {
  total: number;
  okDocs: number;
  latestFetchedAt: string | null;
  stale: boolean;
}

interface SuggestResponse {
  mode?: string;
  aiAvailable?: boolean;
  suggestions?: SuggestionResult;
  captionsConsidered?: number;
  evidenceMeta?: EvidenceMeta;
  evidenceSourcesUsed?: { sourceUrl: string; sourceType: string }[];
  error?: string;
}

interface CollectDoc {
  sourceUrl: string;
  sourceType: string;
  fetchStatus: string;
  error: string | null;
  chars: number;
  title: string | null;
}
interface CollectResponse {
  stored?: number;
  pagesFetched?: number;
  okPages?: number;
  totalCleanedChars?: number;
  evidenceMeta?: EvidenceMeta;
  warnings?: string[];
  documents?: CollectDoc[];
  error?: string;
}

const FIELDS: { key: ApplyField; label: string }[] = [
  { key: "cuisineTags", label: "Cuisine" },
  { key: "dietaryTags", label: "Dietary" },
  { key: "vibeTags", label: "Vibe" },
  { key: "dishHighlights", label: "Dishes" },
  { key: "bestFor", label: "Best for" },
  { key: "reasonText", label: "Reason text" },
];

const CONF_TONE: Record<Confidence, string> = { high: "text-mint", medium: "text-saffron", low: "text-haze" };

const BANNED_REASON_CLAIMS = [
  "best", "top", "most popular", "beloved", "famous", "world-famous", "authentic",
  "must-try", "must try", "viral", "trending", "#1", "number one", "legendary",
  "iconic", "renowned", "award-winning",
];

function suggestionId(field: ApplyField, index: number): string {
  return `${field}:${index}`;
}

function canonicalVocabValue(raw: string, values: readonly string[]): string | null {
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  return values.find((v) => v.toLowerCase() === key) ?? null;
}

function cleanDish(raw: string): string | null {
  let value = raw
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[@#*_~`>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (value.length < 2) return null;
  if (value.length > 40) value = value.slice(0, 40).trim();
  return value || null;
}

function hasBannedReasonClaim(raw: string): boolean {
  const value = raw.toLowerCase();
  return BANNED_REASON_CLAIMS.some((claim) => value.includes(claim));
}

function cleanReasonText(raw: string): string | null {
  const value = raw.replace(/\s+/g, " ").trim();
  if (value.length < 12 || hasBannedReasonClaim(value)) return null;
  return value.slice(0, 280).trim();
}

function canonicalSuggestionValue(field: ApplyField, raw: string): string | null {
  switch (field) {
    case "cuisineTags":
      return canonicalVocabValue(raw, CUISINES);
    case "dietaryTags":
      return canonicalVocabValue(raw, DIETARY);
    case "vibeTags":
    case "bestFor":
      return canonicalVocabValue(raw, VIBES);
    case "dishHighlights":
      return cleanDish(raw);
    case "reasonText":
      return cleanReasonText(raw);
    default:
      return null;
  }
}

function emptyApplyPayload(): Required<Omit<AppliedTagSuggestions, "reasonText">> {
  return {
    cuisineTags: [],
    dietaryTags: [],
    vibeTags: [],
    dishHighlights: [],
    bestFor: [],
  };
}

const EVIDENCE_LABEL: Record<string, string> = {
  google_primary_type: "Google type (primary)",
  google_type: "Google type",
  name: "Name",
  price_level: "Price + type",
  existing_tag: "Existing tag",
  video_candidate_caption: "Video-candidate caption",
  attached_video_caption: "Attached-video caption",
  admin_text: "Admin text",
  neutral_template: "Template",
  website_homepage: "Website · homepage",
  website_menu: "Website · menu",
  website_about: "Website · about",
  website_events: "Website · events",
  website_unknown: "Website",
};

function isCaptionSource(src: string): boolean {
  return src === "video_candidate_caption" || src === "attached_video_caption";
}
function isWebsiteSource(src: string): boolean {
  return src.startsWith("website_");
}

export default function TagSuggestionsPanel({
  suggestEndpoint,
  secret,
  present,
  currentValues,
  onApplySelected,
  applyEnabled = true,
  collectEndpoint,
  websiteDomain,
}: {
  suggestEndpoint: string;
  secret: string;
  present?: Partial<Record<string, string[]>>;
  currentValues?: CurrentSuggestionValues;
  onApplySelected?: (suggestions: AppliedTagSuggestions) => void;
  applyEnabled?: boolean;
  collectEndpoint?: string;
  websiteDomain?: string | null;
}) {
  const [loading, setLoading] = useState<"" | "deterministic" | "ai">("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SuggestionResult | null>(null);
  const [resultMode, setResultMode] = useState<"deterministic" | "ai">("deterministic");
  const [captionsConsidered, setCaptionsConsidered] = useState<number | null>(null);
  const [evidenceMeta, setEvidenceMeta] = useState<EvidenceMeta | null>(null);
  const [evidenceUsed, setEvidenceUsed] = useState<{ sourceUrl: string; sourceType: string }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [applyMsg, setApplyMsg] = useState<{ type: "ok" | "err"; text: string; warnings?: string[] } | null>(null);

  const [collecting, setCollecting] = useState(false);
  const [collectMsg, setCollectMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [collectDocs, setCollectDocs] = useState<CollectDoc[] | null>(null);

  async function runSuggest(mode: "deterministic" | "ai") {
    if (loading) return;
    if (!secret.trim()) {
      setError("Enter the admin secret first.");
      return;
    }
    setLoading(mode);
    setError(null);
    setApplyMsg(null);
    setSelected(new Set());
    try {
      const res = await fetch(`${suggestEndpoint}${mode === "ai" ? "?mode=ai" : ""}`, {
        headers: { "x-foodswipe-admin-secret": secret },
      });
      const data = (await res.json()) as SuggestResponse;
      if (!res.ok) {
        setResult(null);
        setError(data.error ?? `Could not load suggestions (${res.status}).`);
        if (data.evidenceMeta) setEvidenceMeta(data.evidenceMeta);
        return;
      }
      setResult(data.suggestions ?? null);
      setResultMode(mode);
      setCaptionsConsidered(typeof data.captionsConsidered === "number" ? data.captionsConsidered : null);
      setEvidenceMeta(data.evidenceMeta ?? null);
      setEvidenceUsed(Array.isArray(data.evidenceSourcesUsed) ? data.evidenceSourcesUsed : []);
      setSelected(new Set());
    } catch {
      setError("Network error loading suggestions.");
    } finally {
      setLoading("");
    }
  }

  async function collectEvidence() {
    if (collecting || !collectEndpoint) return;
    if (!secret.trim()) {
      setCollectMsg({ type: "err", text: "Enter the admin secret first." });
      return;
    }
    setCollecting(true);
    setCollectMsg(null);
    try {
      const res = await fetch(collectEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-foodswipe-admin-secret": secret },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as CollectResponse;
      if (!res.ok) {
        setCollectMsg({ type: "err", text: data.error ?? `Collection failed (${res.status}).` });
        return;
      }
      if (data.evidenceMeta) setEvidenceMeta(data.evidenceMeta);
      setCollectDocs(Array.isArray(data.documents) ? data.documents : []);
      const warn = data.warnings?.length ? ` · ${data.warnings.join(" ")}` : "";
      setCollectMsg({
        type: "ok",
        text: `Collected ${data.okPages ?? 0}/${data.pagesFetched ?? 0} readable page(s), ${data.totalCleanedChars ?? 0} chars.${warn}`,
      });
    } catch {
      setCollectMsg({ type: "err", text: "Network error collecting evidence." });
    } finally {
      setCollecting(false);
    }
  }

  function isPresent(field: string, value: string): boolean {
    const values = currentValues ?? present;
    const cur = values?.[field as keyof CurrentSuggestionValues];
    if (!Array.isArray(cur)) return false;
    return cur.some((t) => t.trim().toLowerCase() === value.trim().toLowerCase());
  }

  function currentReasonText(): string {
    return (currentValues?.reasonText ?? "").trim();
  }

  function isSelectable(field: ApplyField, suggestion: Suggestion): boolean {
    if (!onApplySelected || !applyEnabled) return false;
    const canonical = canonicalSuggestionValue(field, suggestion.value);
    if (!canonical) return false;
    if (field === "reasonText") return currentReasonText().toLowerCase() !== canonical.toLowerCase();
    return !isPresent(field, canonical);
  }

  function toggleSelected(id: string, enabled: boolean) {
    if (!enabled) return;
    setApplyMsg(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function suggestionEntries(): { id: string; field: ApplyField; suggestion: Suggestion }[] {
    if (!result) return [];
    return FIELDS.flatMap(({ key }) => {
      const items = result.suggestionsByField[key] ?? [];
      return items.map((suggestion, index) => ({ id: suggestionId(key, index), field: key, suggestion }));
    });
  }

  function selectHighConfidenceSafe() {
    const ids = suggestionEntries()
      .filter(({ field, suggestion }) =>
        field !== "reasonText" &&
        suggestion.confidence === "high" &&
        suggestion.autoFillSafe &&
        !suggestion.reviewOnly &&
        !isCaptionSource(suggestion.evidenceSource) &&
        !isWebsiteSource(suggestion.evidenceSource) &&
        isSelectable(field, suggestion),
      )
      .map(({ id }) => id);
    setApplyMsg(null);
    setSelected(new Set(ids));
  }

  function applySelected() {
    if (!onApplySelected || !applyEnabled || selected.size === 0) return;

    const payload = emptyApplyPayload();
    const warnings: string[] = [];
    let appliedCount = 0;
    let skippedCount = 0;
    const seen: Record<Exclude<ApplyField, "reasonText">, Set<string>> = {
      cuisineTags: new Set(),
      dietaryTags: new Set(),
      vibeTags: new Set(),
      dishHighlights: new Set(),
      bestFor: new Set(),
    };
    let nextReasonText: string | undefined;

    for (const { id, field, suggestion } of suggestionEntries()) {
      if (!selected.has(id)) continue;
      const canonical = canonicalSuggestionValue(field, suggestion.value);
      if (!canonical) {
        skippedCount++;
        warnings.push(`Skipped "${suggestion.value}" for ${field}: not valid for this field.`);
        continue;
      }
      if (field === "reasonText") {
        if (currentReasonText()) {
          skippedCount++;
          warnings.push("Skipped reason text because the form draft already has reason text.");
          continue;
        }
        nextReasonText = canonical;
        appliedCount++;
        continue;
      }
      if (isPresent(field, canonical)) {
        skippedCount++;
        continue;
      }
      const key = canonical.toLowerCase();
      if (seen[field].has(key)) {
        skippedCount++;
        continue;
      }
      seen[field].add(key);
      payload[field].push(canonical);
      appliedCount++;
    }

    const suggestions: AppliedTagSuggestions = {};
    for (const field of ["cuisineTags", "dietaryTags", "vibeTags", "dishHighlights", "bestFor"] as const) {
      if (payload[field].length > 0) suggestions[field] = payload[field];
    }
    if (nextReasonText) suggestions.reasonText = nextReasonText;

    if (appliedCount === 0 || Object.keys(suggestions).length === 0) {
      setApplyMsg({
        type: "err",
        text: skippedCount > 0 ? "Nothing was applied. Selected suggestions were already present or not safe to apply." : "Select at least one suggestion first.",
        warnings,
      });
      return;
    }

    onApplySelected(suggestions);
    setSelected(new Set());
    setApplyMsg({
      type: "ok",
      text: `Applied ${appliedCount} suggestion(s) to the form draft — review and Save manually.`,
      warnings,
    });
  }

  const total = result
    ? Object.values(result.suggestionsByField).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0)
    : 0;
  const canCollect = Boolean(collectEndpoint && websiteDomain);
  const canApply = Boolean(onApplySelected && applyEnabled);
  const safeSelectableCount = suggestionEntries().filter(({ field, suggestion }) =>
    field !== "reasonText" &&
    suggestion.confidence === "high" &&
    suggestion.autoFillSafe &&
    !suggestion.reviewOnly &&
    !isCaptionSource(suggestion.evidenceSource) &&
    !isWebsiteSource(suggestion.evidenceSource) &&
    isSelectable(field, suggestion),
  ).length;

  return (
    <section className="w-full max-w-full min-w-0 overflow-hidden rounded-xl bg-surface p-3 ring-1 ring-inset ring-white/10">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-haze">
            <MaterialIcon name="label" className="text-sm" />
            Tag suggestions
          </p>
          <p className="text-[10px] text-haze">
            {canApply
              ? "Select suggestions to apply to this form draft only. Click Save to persist changes."
              : "Preview-only — nothing is applied or saved. Edit fields by hand."}
          </p>
        </div>
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => void runSuggest("deterministic")}
            disabled={loading !== ""}
            className="flex max-w-full items-center justify-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-cream ring-1 ring-inset ring-white/15 hover:bg-white/20 disabled:opacity-40"
          >
            <MaterialIcon name="rule" className="text-sm" />
            {loading === "deterministic" ? "Computing…" : "Deterministic"}
          </button>
          <button
            type="button"
            onClick={() => void runSuggest("ai")}
            disabled={loading !== ""}
            className="flex max-w-full items-center justify-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-cream ring-1 ring-inset ring-white/15 hover:bg-white/20 disabled:opacity-40"
          >
            <MaterialIcon name="neurology" className="text-sm" />
            {loading === "ai" ? "Asking…" : "AI-assisted"}
          </button>
        </div>
      </div>

      {/* Website evidence (B4) */}
      {canCollect && (
        <div className="mt-2 min-w-0 max-w-full overflow-hidden rounded-lg bg-ink-2 p-2 ring-1 ring-inset ring-white/5">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 flex-1 break-words text-[10px] text-haze [overflow-wrap:anywhere]">
              Official website evidence:{" "}
              <span className="font-mono text-tan">{websiteDomain}</span>
              {evidenceMeta && evidenceMeta.okDocs > 0 ? (
                <span className="text-mint">
                  {" "}· {evidenceMeta.okDocs} doc(s){evidenceMeta.stale ? " (stale)" : ""}
                </span>
              ) : (
                <span> · none collected yet</span>
              )}
            </p>
            <button
              type="button"
              onClick={() => void collectEvidence()}
              disabled={collecting}
              className="flex max-w-full items-center justify-center gap-1 rounded-lg bg-white/10 px-2.5 py-1 text-left text-[11px] font-semibold text-cream ring-1 ring-inset ring-white/15 hover:bg-white/20 disabled:opacity-40"
            >
              <MaterialIcon name="travel_explore" className="text-[13px]" />
              {collecting ? "Collecting…" : "Collect website evidence"}
            </button>
          </div>
          {collectMsg && (
            <p className={`mt-1 break-words text-[10px] [overflow-wrap:anywhere] ${collectMsg.type === "ok" ? "text-mint" : "text-chili-soft"}`}>
              {collectMsg.text}
            </p>
          )}
          {collectDocs && collectDocs.length > 0 && (
            <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto pr-1">
              {collectDocs.map((d, i) => (
                <li key={i} className="break-words text-[10px] leading-relaxed text-haze [overflow-wrap:anywhere]">
                  <span className="text-tan">{d.sourceType}</span> · {d.fetchStatus}
                  {d.error ? ` (${d.error})` : ` · ${d.chars} chars`} · {d.sourceUrl}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 break-words text-[9px] text-haze [overflow-wrap:anywhere]">
            Bounded fetch of the restaurant’s own site only (≤3 pages). Stored privately as review evidence — never shown publicly.
          </p>
        </div>
      )}

      {error && <p className="mt-2 break-words text-xs text-chili-soft [overflow-wrap:anywhere]">{error}</p>}

      {result && (
        <div className="mt-2 min-w-0 max-w-full space-y-2 overflow-hidden">
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-haze">
            <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-tan ring-1 ring-inset ring-white/15">
              {resultMode === "ai" ? "AI-assisted · review required" : "Deterministic"}
            </span>
            <span>
              Overall:{" "}
              <span className={`font-display font-bold ${CONF_TONE[result.overallConfidence]}`}>
                {result.overallConfidence}
              </span>
            </span>
            <span>· {total} suggestion(s)</span>
            {captionsConsidered !== null && <span>· {captionsConsidered} caption(s)</span>}
          </p>

          {resultMode === "ai" && evidenceUsed.length > 0 && (
            <p className="break-words text-[10px] text-haze [overflow-wrap:anywhere]">
              Evidence used:{" "}
              {evidenceUsed.map((e, i) => (
                <span key={i} className="text-tan">
                  {i > 0 ? ", " : ""}
                  {e.sourceType}
                </span>
              ))}
            </p>
          )}

          {result.warnings.length > 0 && (
            <div className="min-w-0 overflow-hidden rounded-lg bg-saffron/10 p-2 text-[11px] text-saffron ring-1 ring-inset ring-saffron/20">
              {result.warnings.map((w, i) => (
                <p key={i} className="flex min-w-0 items-start gap-1 break-words [overflow-wrap:anywhere]">
                  <MaterialIcon name="warning" className="mt-px text-[12px]" />
                  {w}
                </p>
              ))}
            </div>
          )}

          {canApply && total > 0 && (
            <div className="min-w-0 overflow-hidden rounded-lg bg-ink-2 p-2 ring-1 ring-inset ring-white/5">
              <p className="break-words text-[10px] text-haze [overflow-wrap:anywhere]">
                Suggestions are applied to the form only. Click Save to persist changes.
              </p>
              <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={selectHighConfidenceSafe}
                  disabled={safeSelectableCount === 0}
                  className="flex max-w-full items-center justify-center gap-1 rounded-lg bg-white/10 px-2.5 py-1 text-left text-[11px] font-semibold text-cream ring-1 ring-inset ring-white/15 hover:bg-white/20 disabled:opacity-40"
                >
                  <MaterialIcon name="done_all" className="text-[13px]" />
                  Select high-confidence safe suggestions
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(new Set());
                    setApplyMsg(null);
                  }}
                  disabled={selected.size === 0}
                  className="flex max-w-full items-center justify-center gap-1 rounded-lg bg-white/10 px-2.5 py-1 text-left text-[11px] font-semibold text-cream ring-1 ring-inset ring-white/15 hover:bg-white/20 disabled:opacity-40"
                >
                  <MaterialIcon name="close" className="text-[13px]" />
                  Clear selection
                </button>
                <button
                  type="button"
                  onClick={applySelected}
                  disabled={selected.size === 0}
                  className="flex max-w-full items-center justify-center gap-1 rounded-lg bg-brand-gradient px-2.5 py-1 text-left text-[11px] font-bold text-ink transition active:scale-[0.98] disabled:opacity-40"
                >
                  <MaterialIcon name="playlist_add_check" className="text-[13px]" />
                  Apply selected to form
                </button>
                {selected.size > 0 && <span className="text-[10px] text-haze">{selected.size} selected</span>}
              </div>
              {applyMsg && (
                <div className={`mt-1.5 text-[10px] ${applyMsg.type === "ok" ? "text-mint" : "text-chili-soft"}`}>
                  <p className="break-words [overflow-wrap:anywhere]">{applyMsg.text}</p>
                  {applyMsg.warnings && applyMsg.warnings.length > 0 && (
                    <ul className="mt-0.5 space-y-0.5">
                      {applyMsg.warnings.map((w, i) => (
                        <li key={i} className="break-words [overflow-wrap:anywhere]">
                          {w}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          {total === 0 ? (
            <p className="text-sm text-haze">No safe suggestions.</p>
          ) : (
            <div className="min-w-0 max-w-full space-y-2 overflow-hidden">
              {FIELDS.map(({ key, label }) => {
                const items = result.suggestionsByField[key] ?? [];
                if (items.length === 0) return null;
                return (
                  <div key={key} className="min-w-0 max-w-full">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-tan">{label}</p>
                    <ul className="min-w-0 max-w-full space-y-1">
                      {items.map((s, i) => {
                        const caption = isCaptionSource(s.evidenceSource);
                        const website = isWebsiteSource(s.evidenceSource);
                        const id = suggestionId(key, i);
                        const canonical = canonicalSuggestionValue(key, s.value);
                        const here = canonical
                          ? key === "reasonText"
                            ? currentReasonText().toLowerCase() === canonical.toLowerCase()
                            : isPresent(key, canonical)
                          : false;
                        const reasonWouldOverwrite = key === "reasonText" && Boolean(canonical) && Boolean(currentReasonText()) && !here;
                        const selectable = isSelectable(key, s);
                        const selectedHere = selectable && selected.has(id);
                        return (
                          <li
                            key={`${key}-${i}`}
                            className={`min-w-0 max-w-full overflow-hidden rounded-lg p-2 ring-1 ring-inset ${
                              selectedHere
                                ? "bg-saffron/10 ring-saffron/40"
                                : caption
                                  ? "bg-ink-2/50 ring-white/5"
                                  : "bg-ink-2 ring-white/10"
                            }`}
                          >
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                              {canApply && (
                                <input
                                  type="checkbox"
                                  checked={selectedHere}
                                  disabled={!selectable}
                                  onChange={() => toggleSelected(id, selectable)}
                                  aria-label={`Select ${s.value || "suggestion"} for ${label}`}
                                  className="h-3.5 w-3.5 shrink-0 accent-saffron disabled:opacity-40"
                                />
                              )}
                              <span className="min-w-0 break-words text-xs font-semibold text-cream [overflow-wrap:anywhere]">{s.value || "—"}</span>
                              <span className={`text-[10px] font-bold ${CONF_TONE[s.confidence]}`}>{s.confidence}</span>
                              {selectedHere && (
                                <span className="rounded-full bg-saffron/15 px-1.5 py-0.5 text-[9px] font-semibold text-saffron ring-1 ring-inset ring-saffron/25">
                                  selected
                                </span>
                              )}
                              {s.reviewOnly && (
                                <span className="rounded-full bg-saffron/15 px-1.5 py-0.5 text-[9px] font-semibold text-saffron ring-1 ring-inset ring-saffron/25">
                                  review-only
                                </span>
                              )}
                              {website && (
                                <span className="rounded-full bg-mint/10 px-1.5 py-0.5 text-[9px] font-semibold text-mint ring-1 ring-inset ring-mint/25">
                                  website evidence
                                </span>
                              )}
                              {here && (
                                <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] font-semibold text-haze ring-1 ring-inset ring-white/15">
                                  already present
                                </span>
                              )}
                              {!canonical && (
                                <span className="rounded-full bg-chili/15 px-1.5 py-0.5 text-[9px] font-semibold text-chili-soft ring-1 ring-inset ring-chili/25">
                                  not applied
                                </span>
                              )}
                              {reasonWouldOverwrite && (
                                <span className="rounded-full bg-chili/15 px-1.5 py-0.5 text-[9px] font-semibold text-chili-soft ring-1 ring-inset ring-chili/25">
                                  won&apos;t overwrite
                                </span>
                              )}
                              <span className="ml-auto min-w-0 max-w-full break-words text-right text-[9px] uppercase tracking-wide text-haze [overflow-wrap:anywhere]">
                                {EVIDENCE_LABEL[s.evidenceSource] ?? s.evidenceSource}
                              </span>
                            </div>
                            <p className="mt-0.5 break-words text-[10px] text-haze [overflow-wrap:anywhere]">{s.reason}</p>
                            {s.evidenceText && (
                              <p className="mt-0.5 max-h-24 overflow-y-auto break-words pr-1 text-[10px] italic leading-relaxed text-tan [overflow-wrap:anywhere]">
                                “{s.evidenceText}”
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}

          <p className="break-words text-[10px] text-haze [overflow-wrap:anywhere]">
            {canApply
              ? `Apply updates this form draft only. ${resultMode === "ai" ? "AI-assisted" : "Deterministic"} suggestions are review-required; caption/website hints reflect source text — verify before saving.`
              : `Suggestions are not applied. ${resultMode === "ai" ? "AI-assisted" : "Deterministic"} suggestions are review-required; caption/website hints reflect source text — verify before using.`}
          </p>
        </div>
      )}
    </section>
  );
}
