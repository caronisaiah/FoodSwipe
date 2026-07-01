"use client";

import { useState } from "react";
import MaterialIcon from "@/components/MaterialIcon";

/*
  Tag Automation B3 + B4 — READ-ONLY admin preview of tag suggestions.

  - Deterministic suggestions (B2/B3): GET <suggestEndpoint>.
  - AI-assisted suggestions (B4): GET <suggestEndpoint>?mode=ai, grounded in
    official-website evidence; review-required.
  - Collect website evidence (B4): POST <collectEndpoint> (admin-triggered, bounded,
    same-domain only). Writes ONLY the evidence table — never tags.

  This panel NEVER applies, auto-fills, saves, PATCHes, or mutates the editor draft.
  It fetches only when the admin clicks a button. Types are mirrored locally so no
  server/DB module bundles into this client component; the admin secret is sent as
  a header only (never persisted/logged here).
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

const FIELDS: { key: string; label: string }[] = [
  { key: "cuisineTags", label: "Cuisine" },
  { key: "dietaryTags", label: "Dietary" },
  { key: "vibeTags", label: "Vibe" },
  { key: "dishHighlights", label: "Dishes" },
  { key: "bestFor", label: "Best for" },
  { key: "reasonText", label: "Reason text" },
];

const CONF_TONE: Record<Confidence, string> = { high: "text-mint", medium: "text-saffron", low: "text-haze" };

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
  collectEndpoint,
  websiteDomain,
}: {
  suggestEndpoint: string;
  secret: string;
  present?: Partial<Record<string, string[]>>;
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
    const cur = present?.[field];
    if (!Array.isArray(cur)) return false;
    return cur.some((t) => t.trim().toLowerCase() === value.trim().toLowerCase());
  }

  const total = result
    ? Object.values(result.suggestionsByField).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0)
    : 0;
  const canCollect = Boolean(collectEndpoint && websiteDomain);

  return (
    <section className="w-full max-w-full min-w-0 overflow-hidden rounded-xl bg-surface p-3 ring-1 ring-inset ring-white/10">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-haze">
            <MaterialIcon name="label" className="text-sm" />
            Tag suggestions
          </p>
          <p className="text-[10px] text-haze">Review-only — nothing is applied or saved. Edit fields by hand.</p>
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
                        const here = isPresent(key, s.value);
                        return (
                          <li
                            key={`${key}-${i}`}
                            className={`min-w-0 max-w-full overflow-hidden rounded-lg p-2 ring-1 ring-inset ${
                              caption ? "bg-ink-2/50 ring-white/5" : "bg-ink-2 ring-white/10"
                            }`}
                          >
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                              <span className="min-w-0 break-words text-xs font-semibold text-cream [overflow-wrap:anywhere]">{s.value || "—"}</span>
                              <span className={`text-[10px] font-bold ${CONF_TONE[s.confidence]}`}>{s.confidence}</span>
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
            Suggestions are not applied. {resultMode === "ai" ? "AI-assisted" : "Deterministic"} suggestions are review-required;
            caption/website hints reflect source text — verify before using. Apply UI comes later.
          </p>
        </div>
      )}
    </section>
  );
}
