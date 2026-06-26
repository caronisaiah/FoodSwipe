"use client";

import { useState } from "react";
import MaterialIcon from "@/components/MaterialIcon";

/*
  Tag Automation B3 — READ-ONLY admin preview of deterministic tag suggestions.

  Fetches GET <endpoint> (a B2 suggest-tags route) using the session-only admin
  secret, and renders the engine's per-field suggestions with confidence, reason,
  evidence, and review-only/caption attribution. It NEVER applies, auto-fills, or
  saves anything, never mutates the editor's draft, and only fetches when the admin
  clicks "Suggest tags". Types are mirrored locally so no server/DB module bundles
  into this client component.
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

interface SuggestResponse {
  suggestions?: SuggestionResult;
  captionsConsidered?: number;
  error?: string;
}

/** Field display order + labels. */
const FIELDS: { key: string; label: string }[] = [
  { key: "cuisineTags", label: "Cuisine" },
  { key: "dietaryTags", label: "Dietary" },
  { key: "vibeTags", label: "Vibe" },
  { key: "dishHighlights", label: "Dishes" },
  { key: "bestFor", label: "Best for" },
  { key: "reasonText", label: "Reason text" },
];

const CONF_TONE: Record<Confidence, string> = {
  high: "text-mint",
  medium: "text-saffron",
  low: "text-haze",
};

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
};

function isCaptionSource(src: string): boolean {
  return src === "video_candidate_caption" || src === "attached_video_caption";
}

/**
 * @param endpoint  GET suggest-tags route (candidate id or published slug).
 * @param secret    session-only admin secret (sent as header; never persisted here).
 * @param present   current DRAFT tags by field, for an "Already present" badge.
 */
export default function TagSuggestionsPanel({
  endpoint,
  secret,
  present,
}: {
  endpoint: string;
  secret: string;
  present?: Partial<Record<string, string[]>>;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SuggestionResult | null>(null);
  const [captionsConsidered, setCaptionsConsidered] = useState<number | null>(null);
  const [ran, setRan] = useState(false);

  async function run() {
    if (loading) return;
    if (!secret.trim()) {
      setError("Enter the admin secret first.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { headers: { "x-foodswipe-admin-secret": secret } });
      const data = (await res.json()) as SuggestResponse;
      if (!res.ok) {
        setResult(null);
        setError(data.error ?? `Could not load suggestions (${res.status}).`);
        return;
      }
      setResult(data.suggestions ?? null);
      setCaptionsConsidered(typeof data.captionsConsidered === "number" ? data.captionsConsidered : null);
      setRan(true);
    } catch {
      setError("Network error loading suggestions.");
    } finally {
      setLoading(false);
    }
  }

  function isPresent(field: string, value: string): boolean {
    const cur = present?.[field];
    if (!Array.isArray(cur)) return false;
    return cur.some((t) => t.trim().toLowerCase() === value.trim().toLowerCase());
  }

  const total = result
    ? Object.values(result.suggestionsByField).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0)
    : 0;

  return (
    <section className="rounded-xl bg-surface p-3 ring-1 ring-inset ring-white/10">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-haze">
            <MaterialIcon name="label" className="text-sm" />
            Deterministic suggestions
          </p>
          <p className="text-[10px] text-haze">Review-only — nothing is applied or saved. Edit fields by hand.</p>
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={loading}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-cream ring-1 ring-inset ring-white/15 hover:bg-white/20 disabled:opacity-40"
        >
          <MaterialIcon name="label" className="text-sm" />
          {loading ? "Computing…" : ran ? "Re-run" : "Suggest tags"}
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-chili-soft">{error}</p>}

      {result && (
        <div className="mt-2 space-y-2">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-haze">
            <span>
              Overall confidence:{" "}
              <span className={`font-display font-bold ${CONF_TONE[result.overallConfidence]}`}>
                {result.overallConfidence}
              </span>
            </span>
            <span>· {total} suggestion(s)</span>
            {captionsConsidered !== null && <span>· {captionsConsidered} caption(s) considered</span>}
          </p>

          {result.warnings.length > 0 && (
            <div className="rounded-lg bg-saffron/10 p-2 text-[11px] text-saffron ring-1 ring-inset ring-saffron/20">
              {result.warnings.map((w, i) => (
                <p key={i} className="flex items-start gap-1">
                  <MaterialIcon name="warning" className="mt-px text-[12px]" />
                  {w}
                </p>
              ))}
            </div>
          )}

          {total === 0 ? (
            <p className="text-sm text-haze">No safe suggestions.</p>
          ) : (
            <div className="space-y-2">
              {FIELDS.map(({ key, label }) => {
                const items = result.suggestionsByField[key] ?? [];
                if (items.length === 0) return null;
                return (
                  <div key={key}>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-tan">{label}</p>
                    <ul className="space-y-1">
                      {items.map((s, i) => {
                        const caption = isCaptionSource(s.evidenceSource);
                        const present = isPresent(key, s.value);
                        return (
                          <li
                            key={`${key}-${i}`}
                            className={`rounded-lg p-2 ring-1 ring-inset ${
                              caption ? "bg-ink-2/50 ring-white/5" : "bg-ink-2 ring-white/10"
                            }`}
                          >
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-xs font-semibold text-cream">{s.value || "—"}</span>
                              <span className={`text-[10px] font-bold ${CONF_TONE[s.confidence]}`}>
                                {s.confidence}
                              </span>
                              {s.reviewOnly && (
                                <span className="rounded-full bg-saffron/15 px-1.5 py-0.5 text-[9px] font-semibold text-saffron ring-1 ring-inset ring-saffron/25">
                                  review-only
                                </span>
                              )}
                              {present && (
                                <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] font-semibold text-haze ring-1 ring-inset ring-white/15">
                                  already present
                                </span>
                              )}
                              <span className="ml-auto text-[9px] uppercase tracking-wide text-haze">
                                {EVIDENCE_LABEL[s.evidenceSource] ?? s.evidenceSource}
                              </span>
                            </div>
                            <p className="mt-0.5 text-[10px] text-haze">{s.reason}</p>
                            {s.evidenceText && (
                              <p className="mt-0.5 truncate text-[10px] italic text-tan">“{s.evidenceText}”</p>
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

          <p className="text-[10px] text-haze">
            Suggestions are not applied. Caption-derived hints are review-only and reflect creators’ words — verify
            before using. Apply UI comes later.
          </p>
        </div>
      )}
    </section>
  );
}
