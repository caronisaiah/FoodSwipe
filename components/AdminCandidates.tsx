"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PlacePhoto } from "@/lib/types";
import MaterialIcon from "@/components/MaterialIcon";

/*
  Internal restaurant-candidate REVIEW CONSOLE — NOT a public feature.

  An operations/data-quality tool for reviewing imported restaurant candidates
  before a human marks them reviewed. Protected by FOODSWIPE_ADMIN_SECRET (entered
  client-side, session-only, sent as the `x-foodswipe-admin-secret` header, never
  persisted). Nothing here publishes to `/feed`; "approved" means reviewed only.

  Types are mirrored locally (NOT imported from `lib/db/candidates`) so the Neon/
  Drizzle runtime never gets bundled into this client component.
*/

const STATUSES = ["needs_review", "candidate", "approved", "rejected"] as const;
type Status = (typeof STATUSES)[number];
type StatusFilter = "all" | Status;
const STATUS_FILTERS: StatusFilter[] = ["needs_review", "candidate", "approved", "rejected", "all"];

type SourceFilter = "all" | "manual" | "google_places";
const SOURCE_FILTERS: SourceFilter[] = ["all", "google_places", "manual"];

const LABEL: Record<string, string> = {
  all: "All",
  needs_review: "Needs review",
  candidate: "Candidate",
  approved: "Approved",
  rejected: "Rejected",
  manual: "Manual",
  google_places: "Google",
};

const STATUS_TONE: Record<string, string> = {
  needs_review: "bg-saffron/15 text-saffron ring-saffron/30",
  approved: "bg-mint/15 text-mint ring-mint/30",
  rejected: "bg-chili/15 text-chili-soft ring-chili/30",
  candidate: "bg-white/10 text-tan ring-white/15",
};

const CONFIDENCE_TONE: Record<string, string> = {
  high: "text-mint",
  medium: "text-saffron",
  low: "text-haze",
};

// Compact controlled-vocab hints (full vocab lives in lib/types.ts).
const VOCAB_HINT = {
  cuisine: "e.g. mexican, tacos, ramen, italian, pizza, bakery, coffee",
  dietary: "vegan, vegetarian, halal, gluten-free, no pork",
  vibe: "quick bite, date night, group dinner, late night, casual, hidden gem",
  bestFor: "quick bite, date night, group dinner, late night, casual",
  dish: 'short dishes, e.g. "Tacos", "Ramen"',
};

interface SuggestedTags {
  cuisineTags: string[];
  dietaryTags: string[];
  vibeTags: string[];
  bestFor: string[];
  dishHighlights: string[];
  reasonText: string;
}

/** Mirrors the CandidateRestaurant shape returned by the admin API. */
interface Candidate {
  id: string;
  slug: string | null;
  name: string;
  status: string;
  source: string;
  googlePlaceId: string | null;
  websiteDomain: string | null;
  address: string | null;
  neighborhood: string | null;
  priceLevel: number | null;
  cuisineTags: string[];
  dietaryTags: string[];
  vibeTags: string[];
  dishHighlights: string[];
  bestFor: string[];
  reasonText: string | null;
  reviewNotes: string | null;
  sourceExpiresAt: string | null;
  reviewLikelihoodScore: number | null;
  reviewLikelihoodReasons: string[];
  suggestionConfidence: string | null;
  suggestionReasons: string[];
  suggestedTags: SuggestedTags | null;
  createdAt: string;
  updatedAt: string;
}

/** A dry-run import preview row (toCandidateInput shape from the import route). */
interface PreviewRow {
  name: string | null;
  address: string | null;
  googlePlaceId: string | null;
  websiteDomain: string | null;
  priceLevel: number | null;
  cuisineTags?: string[];
  dietaryTags?: string[];
  vibeTags?: string[];
  bestFor?: string[];
  dishHighlights?: string[];
  reviewNotes: string | null;
  sourceExpiresAt: string | null;
  reviewLikelihoodScore: number | null;
  suggestionConfidence?: string | null;
  suggestionReasons?: string[];
  seedMatchWarning: string | null;
  isDuplicate?: boolean;
  duplicateOfStatus?: string | null;
}

type Msg = { type: "ok" | "err"; text: string } | null;

/* ----- helpers ----- */

function parseList(s: string): string[] {
  return s
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = [...b].sort();
  return [...a].sort().every((x, i) => x === sb[i]);
}

type ExpiryState = "none" | "soon" | "expired";
function expiryState(iso: string | null): ExpiryState {
  if (!iso) return "none";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "none";
  const now = Date.now();
  if (t < now) return "expired";
  if (t < now + 7 * 24 * 60 * 60 * 1000) return "soon";
  return "none";
}

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? "—" : t.toISOString().slice(0, 10);
}

function priceLabel(level: number | null): string {
  return level && level >= 1 && level <= 4 ? "$".repeat(level) : "—";
}

/** Surface a seed-overlap warning, whether it's a top-level field or in notes. */
function warningFrom(c: { reviewNotes: string | null; seedMatchWarning?: string | null }): string | null {
  if (c.seedMatchWarning && c.seedMatchWarning.trim()) return c.seedMatchWarning.trim();
  const m = c.reviewNotes?.match(/WARNING:\s*(.+)$/);
  return m ? m[1].trim() : null;
}

/** Sort highest review-likelihood first; null scores (e.g. manual) last. */
function byLikelihood(a: Candidate, b: Candidate): number {
  const sa = a.reviewLikelihoodScore;
  const sb = b.reviewLikelihoodScore;
  if (sa === null && sb === null) return 0;
  if (sa === null) return 1;
  if (sb === null) return -1;
  return sb - sa;
}

export default function AdminCandidates() {
  // Session-only admin secret (NOT persisted) — sent as a header to the API.
  const [secret, setSecret] = useState("");

  // Queue
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("needs_review");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<Msg>(null);
  const loadSeq = useRef(0);

  // Google import
  const [query, setQuery] = useState("");
  const [maxResults, setMaxResults] = useState("10");
  const [dryRun, setDryRun] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<Msg>(null);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);

  async function load(status: StatusFilter) {
    if (!secret.trim()) {
      setListError("Enter the admin secret first.");
      return;
    }
    const seq = ++loadSeq.current;
    setLoading(true);
    setListError(null);
    try {
      const qs = status === "all" ? "" : `?status=${status}`;
      const res = await fetch(`/api/admin/restaurants/candidates${qs}`, {
        headers: { "x-foodswipe-admin-secret": secret },
      });
      const data = (await res.json()) as { candidates?: Candidate[]; error?: string };
      if (seq !== loadSeq.current) return; // superseded by a newer load
      if (!res.ok) {
        setCandidates([]);
        setListError(data.error ?? `Load failed (${res.status}).`);
        return;
      }
      setCandidates(Array.isArray(data.candidates) ? data.candidates : []);
      setLoadedOnce(true);
    } catch {
      if (seq === loadSeq.current) setListError("Network error — could not reach the admin API.");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }

  function selectStatus(s: StatusFilter) {
    setStatusFilter(s);
    if (loadedOnce && secret.trim()) void load(s);
  }

  function onSaved(updated: Candidate) {
    setActionMsg({ type: "ok", text: `Saved “${updated.name}” → ${updated.status}.` });
    setCandidates((list) => {
      if (statusFilter !== "all" && updated.status !== statusFilter) {
        return list.filter((c) => c.id !== updated.id);
      }
      return list.map((c) => (c.id === updated.id ? updated : c));
    });
  }

  async function runImport(dry: boolean) {
    if (importing) return;
    if (!secret.trim()) {
      setImportMsg({ type: "err", text: "Enter the admin secret first." });
      return;
    }
    if (!query.trim()) {
      setImportMsg({ type: "err", text: "Enter a search query." });
      return;
    }
    setImporting(true);
    setImportMsg(null);
    const parsedMax = Math.trunc(Number(maxResults));
    const max = Number.isFinite(parsedMax) && parsedMax >= 1 ? Math.min(parsedMax, 20) : 10;
    try {
      const res = await fetch("/api/admin/restaurants/candidates/import/google", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-foodswipe-admin-secret": secret },
        body: JSON.stringify({ query: query.trim(), maxResults: max, dryRun: dry }),
      });
      const data = (await res.json()) as {
        dryRun?: boolean;
        found?: number;
        candidates?: PreviewRow[];
        imported?: number;
        skippedDuplicates?: number;
        error?: string;
      };
      if (!res.ok) {
        setImportMsg({ type: "err", text: data.error ?? `Import failed (${res.status}).` });
        return;
      }
      if (data.dryRun) {
        setPreview(Array.isArray(data.candidates) ? data.candidates : []);
        setImportMsg({
          type: "ok",
          text: `Preview only — nothing written. Found ${data.found ?? 0}.`,
        });
      } else {
        setPreview(null);
        setImportMsg({
          type: "ok",
          text: `Imported ${data.imported ?? 0}; skipped ${data.skippedDuplicates ?? 0} duplicate(s). Review below.`,
        });
        if (loadedOnce) await load(statusFilter);
      }
    } catch {
      setImportMsg({ type: "err", text: "Network error — could not reach the import route." });
    } finally {
      setImporting(false);
    }
  }

  // Client-side source + search filtering; status is server-filtered via load().
  const q = search.trim().toLowerCase();
  const visible = candidates
    .filter((c) => sourceFilter === "all" || c.source === sourceFilter)
    .filter((c) => {
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.address ?? "").toLowerCase().includes(q) ||
        (c.googlePlaceId ?? "").toLowerCase().includes(q)
      );
    })
    .slice()
    .sort(byLikelihood);

  // Data-quality flag: Place IDs that appear on more than one loaded candidate.
  const dupePlaceIds = new Set<string>();
  const seen = new Set<string>();
  for (const c of candidates) {
    if (!c.googlePlaceId) continue;
    if (seen.has(c.googlePlaceId)) dupePlaceIds.add(c.googlePlaceId);
    seen.add(c.googlePlaceId);
  }

  return (
    <div className="mx-auto min-h-dvh w-full max-w-3xl px-3 pb-16 pt-[max(env(safe-area-inset-top),0.75rem)]">
      {/* Internal banner */}
      <div className="mb-4 rounded-xl border border-chili/40 bg-chili/10 p-2.5 text-xs text-cream">
        <p className="flex items-center gap-1.5 font-display font-bold text-chili-soft">
          <MaterialIcon name="shield_person" className="text-sm" />
          Internal review console
        </p>
        <p className="mt-0.5 text-cream/80">
          Data-quality tool for imported candidates. Nothing here publishes to the
          feed — “approved” means reviewed only. Tags from import are conservative
          suggestions and must be checked by a human.
        </p>
      </div>

      <header className="mb-3 flex items-center justify-between">
        <h1 className="font-display text-xl font-bold text-cream">Restaurant candidates</h1>
        <div className="flex items-center gap-3 text-xs">
          <Link
            href="/admin/restaurants/published"
            className="text-saffron underline-offset-2 hover:underline"
          >
            Published →
          </Link>
          <Link href="/feed" className="text-haze underline-offset-2 hover:underline">
            Back to app
          </Link>
        </div>
      </header>

      <div className="mb-4">
        <Field label="Admin secret" hint="session only — not stored">
          <TextInput value={secret} onChange={setSecret} placeholder="FOODSWIPE_ADMIN_SECRET" type="password" />
        </Field>
      </div>

      {/* Google import panel */}
      <details className="mb-4 rounded-xl bg-surface ring-1 ring-inset ring-white/10">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-haze">
          <MaterialIcon name="travel_explore" className="text-sm" />
          Google Places import
        </summary>
        <div className="border-t border-line p-3">
          <p className="mb-2 flex items-start gap-1 rounded-lg bg-saffron/10 p-2 text-[11px] text-saffron">
            <MaterialIcon name="payments" className="mt-px text-xs" />
            Each preview or import calls Google Text Search (billable). Photo
            previews load per candidate only when you expand a row.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void runImport(dryRun);
            }}
            className="space-y-3"
          >
            <Field label="Search query" hint="cuisine + neighborhood">
              <TextInput value={query} onChange={setQuery} placeholder="brunch in Shaw, Washington DC" />
            </Field>
            <div className="grid grid-cols-2 items-end gap-3">
              <Field label="Max results" hint="1–20">
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={maxResults}
                  onChange={(e) => setMaxResults(e.target.value)}
                  onBlur={() => {
                    const n = Math.trunc(Number(maxResults));
                    setMaxResults(String(Number.isFinite(n) && n >= 1 ? Math.min(n, 20) : 10));
                  }}
                  className="w-full rounded-lg bg-surface-2 px-3 py-2 text-sm text-cream outline-none ring-1 ring-inset ring-white/10 focus:ring-saffron/60"
                />
              </Field>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 ring-1 ring-inset ring-white/10">
                <input
                  type="checkbox"
                  checked={dryRun}
                  onChange={(e) => setDryRun(e.target.checked)}
                  className="h-4 w-4 accent-saffron"
                />
                <span className="text-sm text-cream">
                  Dry run <span className="text-haze">(preview)</span>
                </span>
              </label>
            </div>
            <button
              type="submit"
              aria-disabled={importing}
              className={`w-full rounded-lg py-2 text-sm font-bold transition active:scale-[0.99] ${
                dryRun
                  ? "bg-white/10 text-cream ring-1 ring-inset ring-white/15 hover:bg-white/20"
                  : "bg-brand-gradient text-ink"
              } ${importing ? "opacity-40" : ""}`}
            >
              {importing
                ? dryRun
                  ? "Previewing…"
                  : "Importing…"
                : dryRun
                  ? "Preview candidates"
                  : "Import for real"}
            </button>
          </form>

          {importMsg && (
            <p
              role="status"
              className={`mt-2 text-xs ${importMsg.type === "ok" ? "text-mint" : "text-chili-soft"}`}
            >
              {importMsg.text}
            </p>
          )}

          {preview && (
            <div className="mt-3">
              <p className="mb-2 text-xs font-semibold text-cream">
                Preview ({preview.length}) — not yet saved, ranked by review likelihood
              </p>
              {preview.length === 0 ? (
                <p className="text-xs text-haze">No usable results for that query.</p>
              ) : (
                <ul className="space-y-2">
                  {preview.map((p, i) => (
                    <PreviewCard key={`${p.googlePlaceId ?? "row"}-${i}`} row={p} />
                  ))}
                </ul>
              )}
              {preview.length > 0 && (
                <button
                  type="button"
                  onClick={() => void runImport(false)}
                  disabled={importing}
                  className="mt-3 w-full rounded-lg bg-brand-gradient py-2 text-sm font-bold text-ink transition active:scale-[0.99] disabled:opacity-40"
                >
                  {importing ? "Importing…" : `Import these ${preview.length} for real`}
                </button>
              )}
              <p className="mt-2 text-[10px] leading-relaxed text-haze">
                Imports store the Google Place ID + review metadata and conservative
                suggested tags. No photos, review text, or ratings are stored
                publicly; nothing is published to the feed.
              </p>
            </div>
          )}
        </div>
      </details>

      {/* Filters */}
      <div className="mb-2 space-y-2">
        <FilterRow label="Status">
          {STATUS_FILTERS.map((f) => (
            <Tab key={f} active={statusFilter === f} onClick={() => selectStatus(f)}>
              {LABEL[f]}
            </Tab>
          ))}
        </FilterRow>
        <FilterRow label="Source">
          {SOURCE_FILTERS.map((f) => (
            <Tab key={f} active={sourceFilter === f} onClick={() => setSourceFilter(f)}>
              {LABEL[f]}
            </Tab>
          ))}
        </FilterRow>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <MaterialIcon
              name="search"
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-haze"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name / address / Place ID"
              aria-label="Search candidates"
              className="w-full rounded-lg bg-surface-2 py-1.5 pl-7 pr-3 text-sm text-cream outline-none ring-1 ring-inset ring-white/10 placeholder:text-haze/60 focus:ring-saffron/60"
            />
          </div>
          <button
            type="button"
            onClick={() => void load(statusFilter)}
            disabled={loading}
            className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-cream ring-1 ring-inset ring-white/15 hover:bg-white/20 disabled:opacity-40"
          >
            <MaterialIcon name="refresh" className="text-sm" />
            {loading ? "Loading…" : loadedOnce ? "Refresh" : "Load"}
          </button>
        </div>
      </div>

      {actionMsg && (
        <p role="status" className="mb-2 text-xs text-mint">
          {actionMsg.text}
        </p>
      )}
      {listError && <p className="mb-2 text-xs text-chili-soft">{listError}</p>}

      {/* Queue */}
      {!loadedOnce && !listError ? (
        <p className="text-sm text-haze">Enter the admin secret and press Load to list candidates.</p>
      ) : visible.length === 0 && !loading ? (
        <p className="text-sm text-haze">
          No candidates match {LABEL[statusFilter]}
          {sourceFilter !== "all" ? ` · ${LABEL[sourceFilter]}` : ""}
          {q ? ` · “${search}”` : ""}.
        </p>
      ) : (
        <>
          <p className="mb-1.5 text-[11px] text-haze">
            {visible.length} candidate{visible.length === 1 ? "" : "s"} · ranked by review likelihood
            {statusFilter !== "all" && (
              <span className="text-haze/70"> · “dup ID” detection is scoped to this status — use All for cross-status dupes</span>
            )}
          </p>
          <ul className="divide-y divide-line overflow-hidden rounded-xl ring-1 ring-inset ring-white/10">
            {visible.map((c) => (
              // Keyed by id only (NOT updatedAt) so an in-place save doesn't
              // remount the row — the photo preview stays mounted (no extra
              // Google call) and only the editor re-seeds (keyed by updatedAt).
              <CandidateRow
                key={c.id}
                candidate={c}
                secret={secret}
                expanded={expandedId === c.id}
                onToggle={() => setExpandedId((id) => (id === c.id ? null : c.id))}
                onSaved={onSaved}
                duplicatePlaceId={Boolean(c.googlePlaceId && dupePlaceIds.has(c.googlePlaceId))}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/* ----- queue row (collapsed summary + expandable editor) ----- */

function CandidateRow({
  candidate,
  secret,
  expanded,
  onToggle,
  onSaved,
  duplicatePlaceId,
}: {
  candidate: Candidate;
  secret: string;
  expanded: boolean;
  onToggle: () => void;
  onSaved: (updated: Candidate) => void;
  duplicatePlaceId: boolean;
}) {
  const warn = warningFrom(candidate);
  const expiry = expiryState(candidate.sourceExpiresAt);

  return (
    <li className="bg-surface">
      {/* Collapsed summary row */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-white/[0.03]"
        aria-expanded={expanded}
      >
        <ScoreChip score={candidate.reviewLikelihoodScore} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-cream">
            {candidate.name}
            {candidate.suggestionConfidence && (
              <span
                className={`text-[10px] font-medium ${CONFIDENCE_TONE[candidate.suggestionConfidence] ?? "text-haze"}`}
                title="Auto-suggestion confidence"
              >
                ◍ {candidate.suggestionConfidence}
              </span>
            )}
          </p>
          <p className="truncate text-[11px] text-haze">
            {candidate.neighborhood ? `${candidate.neighborhood} · ` : ""}
            {candidate.address ?? "no address"}
          </p>
        </div>
        <div className="hidden shrink-0 items-center gap-1 sm:flex">
          {duplicatePlaceId && <Flag tone="chili" icon="content_copy">dup ID</Flag>}
          {warn && <Flag tone="saffron" icon="warning">seed</Flag>}
          {expiry === "expired" && <Flag tone="chili" icon="schedule">expired</Flag>}
          {expiry === "soon" && <Flag tone="saffron" icon="schedule">stale soon</Flag>}
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${STATUS_TONE[candidate.status] ?? "text-haze"}`}>
          {candidate.status}
        </span>
        <MaterialIcon
          name={expanded ? "expand_less" : "expand_more"}
          className="shrink-0 text-base text-haze"
        />
      </button>

      {expanded && (
        <CandidateDetail candidate={candidate} secret={secret} onSaved={onSaved} warn={warn} />
      )}
    </li>
  );
}

/* ----- expanded review editor ----- */

function CandidateDetail({
  candidate,
  secret,
  onSaved,
  warn,
}: {
  candidate: Candidate;
  secret: string;
  onSaved: (updated: Candidate) => void;
  warn: string | null;
}) {
  return (
    <div className="border-t border-line bg-ink-2/40 p-3">
      <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
        {/* Left: photo (lazy — loads on expand) + provenance. Stable across saves
            (NOT keyed by updatedAt) so a save never refetches the Google photo. */}
        <div>
          <CandidatePhoto candidateId={candidate.id} secret={secret} name={candidate.name} />
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
            <Meta label="Source" value={LABEL[candidate.source] ?? candidate.source} />
            <Meta label="Place ID" value={candidate.googlePlaceId ?? "—"} mono />
            <Meta label="Website" value={candidate.websiteDomain ?? "—"} />
            <Meta label="Price" value={priceLabel(candidate.priceLevel)} />
            <Meta label="Expires" value={shortDate(candidate.sourceExpiresAt)} />
            <Meta label="Score" value={candidate.reviewLikelihoodScore === null ? "—" : `${candidate.reviewLikelihoodScore}/100`} />
          </dl>
          {warn && (
            <p className="mt-2 flex items-start gap-1 rounded-lg bg-saffron/10 p-1.5 text-[10px] text-saffron">
              <MaterialIcon name="warning" className="mt-px text-[11px]" />
              {warn}
            </p>
          )}
        </div>

        {/* Right: editor — keyed by updatedAt so it re-seeds when the candidate
            changes on the server, without remounting the photo above. */}
        <CandidateEditor key={candidate.updatedAt} candidate={candidate} secret={secret} onSaved={onSaved} />
      </div>
    </div>
  );
}

/* ----- editable review fields + quality actions (re-seeds on updatedAt) ----- */

function CandidateEditor({
  candidate,
  secret,
  onSaved,
}: {
  candidate: Candidate;
  secret: string;
  onSaved: (updated: Candidate) => void;
}) {
  const [status, setStatus] = useState<string>(candidate.status);
  const [cuisine, setCuisine] = useState(candidate.cuisineTags.join(", "));
  const [dietary, setDietary] = useState(candidate.dietaryTags.join(", "));
  const [vibe, setVibe] = useState(candidate.vibeTags.join(", "));
  const [bestFor, setBestFor] = useState(candidate.bestFor.join(", "));
  const [dishes, setDishes] = useState(candidate.dishHighlights.join(", "));
  const [reasonText, setReasonText] = useState(candidate.reasonText ?? "");
  const [reviewNotes, setReviewNotes] = useState(candidate.reviewNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [promoting, setPromoting] = useState(false);
  const [promoteMsg, setPromoteMsg] = useState<Msg>(null);
  const [promotedSlug, setPromotedSlug] = useState<string | null>(null);

  const snap = candidate.suggestedTags;

  async function promote() {
    if (promoting) return;
    if (!secret.trim()) {
      setPromoteMsg({ type: "err", text: "Enter the admin secret first." });
      return;
    }
    setPromoting(true);
    setPromoteMsg(null);
    try {
      const res = await fetch(`/api/admin/restaurants/candidates/${candidate.id}/promote`, {
        method: "POST",
        headers: { "x-foodswipe-admin-secret": secret },
      });
      const data = (await res.json()) as {
        restaurant?: { slug?: string };
        error?: string;
        missingFields?: string[];
      };
      if (res.ok && data.restaurant?.slug) {
        setPromotedSlug(data.restaurant.slug);
        setPromoteMsg({ type: "ok", text: "Promoted to the live feed." });
        return;
      }
      if (res.status === 409 && data.restaurant?.slug) {
        setPromotedSlug(data.restaurant.slug);
        setPromoteMsg({ type: "err", text: data.error ?? "Already promoted." });
        return;
      }
      if (res.status === 422 && data.missingFields?.length) {
        setPromoteMsg({ type: "err", text: `Missing required fields: ${data.missingFields.join(", ")}.` });
        return;
      }
      setPromoteMsg({ type: "err", text: data.error ?? `Promotion failed (${res.status}).` });
    } catch {
      setPromoteMsg({ type: "err", text: "Network error during promotion." });
    } finally {
      setPromoting(false);
    }
  }

  function resetToSuggestions() {
    if (!snap) return;
    setCuisine(snap.cuisineTags.join(", "));
    setDietary(snap.dietaryTags.join(", "));
    setVibe(snap.vibeTags.join(", "));
    setBestFor(snap.bestFor.join(", "));
    setDishes(snap.dishHighlights.join(", "));
    setReasonText(snap.reasonText);
    setMsg({ type: "ok", text: "Reset to suggestions — review and Save to persist." });
  }

  async function save(overrideStatus?: string) {
    if (saving) return;
    if (!secret.trim()) {
      setMsg({ type: "err", text: "Enter the admin secret first." });
      return;
    }
    const nextStatus = overrideStatus ?? status;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/restaurants/candidates/${candidate.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-foodswipe-admin-secret": secret },
        body: JSON.stringify({
          status: nextStatus,
          cuisineTags: parseList(cuisine),
          dietaryTags: parseList(dietary),
          vibeTags: parseList(vibe),
          bestFor: parseList(bestFor),
          dishHighlights: parseList(dishes),
          reasonText,
          reviewNotes,
        }),
      });
      const data = (await res.json()) as { candidate?: Candidate; error?: string };
      if (!res.ok || !data.candidate) {
        setMsg({ type: "err", text: data.error ?? `Save failed (${res.status}).` });
        return;
      }
      onSaved(data.candidate);
    } catch {
      setMsg({ type: "err", text: "Network error saving changes." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2.5">
          {candidate.suggestionConfidence && (
            <div className="rounded-lg bg-ink-2 p-2 ring-1 ring-inset ring-white/5">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-cream">
                <MaterialIcon name="auto_fix_high" className="text-sm" />
                Auto-suggested tags
                <span className={`ml-auto font-display ${CONFIDENCE_TONE[candidate.suggestionConfidence] ?? "text-haze"}`}>
                  {candidate.suggestionConfidence} confidence
                </span>
              </p>
              <p className="text-[9px] uppercase tracking-wide text-haze">
                Conservative, controlled-vocab only — verify before approving
              </p>
              {candidate.suggestionReasons.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {candidate.suggestionReasons.map((r, i) => (
                    <li key={i} className="text-[11px] text-tan">
                      · {r}
                    </li>
                  ))}
                </ul>
              )}
              {snap && (
                <button
                  type="button"
                  onClick={resetToSuggestions}
                  className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-cream ring-1 ring-inset ring-white/15 hover:bg-white/20"
                >
                  <MaterialIcon name="restart_alt" className="text-[11px]" />
                  Reset to suggestions
                </button>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <TagField label="Cuisine" hint={VOCAB_HINT.cuisine} value={cuisine} onChange={setCuisine}
              suggested={snap?.cuisineTags ?? null} confidence={candidate.suggestionConfidence} />
            <TagField label="Dietary" hint={VOCAB_HINT.dietary} value={dietary} onChange={setDietary}
              suggested={snap?.dietaryTags ?? null} confidence={candidate.suggestionConfidence} />
            <TagField label="Vibe" hint={VOCAB_HINT.vibe} value={vibe} onChange={setVibe}
              suggested={snap?.vibeTags ?? null} confidence={candidate.suggestionConfidence} />
            <TagField label="Best for" hint={VOCAB_HINT.bestFor} value={bestFor} onChange={setBestFor}
              suggested={snap?.bestFor ?? null} confidence={candidate.suggestionConfidence} />
          </div>
          <TagField label="Dish highlights" hint={VOCAB_HINT.dish} value={dishes} onChange={setDishes}
            suggested={snap?.dishHighlights ?? null} confidence={candidate.suggestionConfidence} />

          <Field label="Reason text" hint="neutral review copy — not marketing">
            <Textarea value={reasonText} onChange={setReasonText} placeholder="Why this matches…" />
          </Field>
          <Field label="Review notes" hint="provenance + curation notes">
            <Textarea value={reviewNotes} onChange={setReviewNotes} placeholder="Curation notes…" />
          </Field>

          {/* Quality controls */}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2.5">
            <label className="mr-1 flex items-center gap-1 text-[11px] text-haze">
              Status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="rounded-md bg-surface-2 px-2 py-1 text-xs text-cream outline-none ring-1 ring-inset ring-white/10 focus:ring-saffron/60"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s} className="bg-surface">
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => void save()} disabled={saving}
              className="rounded-md bg-brand-gradient px-3 py-1.5 text-xs font-bold text-ink transition active:scale-[0.98] disabled:opacity-40">
              {saving ? "Saving…" : "Save"}
            </button>
            <Action onClick={() => void save("needs_review")} disabled={saving} icon="flag">Needs review</Action>
            <Action onClick={() => void save("approved")} disabled={saving} icon="check_circle" tone="mint">Approve</Action>
            <Action onClick={() => void save("rejected")} disabled={saving} icon="cancel" tone="chili">Reject</Action>
            {msg && (
              <span className={`ml-1 text-[11px] ${msg.type === "ok" ? "text-mint" : "text-chili-soft"}`}>
                {msg.text}
              </span>
            )}
          </div>
          <p className="text-[10px] text-haze">
            “Approve” marks the candidate reviewed only — it does not publish to the feed.
          </p>

          {/* Promote to feed — explicit, separate step; only for approved candidates */}
          <div className="rounded-lg bg-ink-2 p-2 ring-1 ring-inset ring-white/5">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-cream">
              <MaterialIcon name="rocket_launch" className="text-sm" />
              Promote to live feed
            </p>
            {candidate.status === "approved" ? (
              <>
                <button
                  type="button"
                  onClick={() => void promote()}
                  disabled={promoting}
                  className="mt-1.5 flex items-center gap-1 rounded-md bg-brand-gradient px-3 py-1.5 text-xs font-bold text-ink transition active:scale-[0.98] disabled:opacity-40"
                >
                  <MaterialIcon name="publish" className="text-sm" />
                  {promoting ? "Promoting…" : "Promote to feed"}
                </button>
                <p className="mt-1 text-[10px] text-haze">
                  Creates a live DB restaurant from the reviewed fields. Requires name,
                  address, price, lat/lng, cuisine, a vibe/best-for, and reason text.
                </p>
              </>
            ) : (
              <p className="mt-1 text-[10px] text-haze">
                Set status to <span className="text-cream">approved</span> and Save first to enable promotion.
              </p>
            )}
            {promoteMsg && (
              <p className={`mt-1 text-[11px] ${promoteMsg.type === "ok" ? "text-mint" : "text-chili-soft"}`}>
                {promoteMsg.text}
              </p>
            )}
            {promotedSlug && (
              <a
                href={`/restaurants/${promotedSlug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-[11px] text-saffron underline-offset-2 hover:underline"
              >
                <MaterialIcon name="open_in_new" className="text-[11px]" />
                /restaurants/{promotedSlug}
              </a>
            )}
          </div>
    </div>
  );
}

/* ----- import preview card ----- */

function PreviewCard({ row }: { row: PreviewRow }) {
  const warn = warningFrom(row);
  const tags = [
    ...(row.cuisineTags ?? []),
    ...(row.dietaryTags ?? []),
    ...(row.vibeTags ?? []),
    ...(row.bestFor ?? []),
  ];
  return (
    <li className="rounded-lg bg-ink-2 p-2.5 ring-1 ring-inset ring-white/5">
      <div className="flex items-start gap-2">
        <ScoreChip score={row.reviewLikelihoodScore} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-cream">{row.name ?? "(no name)"}</p>
          <p className="truncate text-[11px] text-haze">{row.address ?? "—"}</p>
        </div>
      </div>
      <p className="mt-1 text-[11px] text-haze">
        {priceLabel(row.priceLevel)} · {row.websiteDomain ?? "no site"} · expires {shortDate(row.sourceExpiresAt)}
      </p>
      {row.isDuplicate && (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-chili-soft">
          <MaterialIcon name="content_copy" className="text-xs" />
          Exact duplicate (same Place ID){row.duplicateOfStatus ? ` · ${row.duplicateOfStatus}` : ""} — a real import skips it.
        </p>
      )}
      {warn && (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-saffron">
          <MaterialIcon name="warning" className="text-xs" />
          {warn}
        </p>
      )}
      {tags.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {tags.map((t, i) => (
            <span key={`${t}-${i}`} className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-tan">
              {t}
            </span>
          ))}
          {row.suggestionConfidence && (
            <span className={`px-1 text-[10px] ${CONFIDENCE_TONE[row.suggestionConfidence] ?? "text-haze"}`}>
              {row.suggestionConfidence} conf.
            </span>
          )}
        </div>
      ) : (
        <p className="mt-1.5 text-[10px] text-haze">No confident tag suggestions — needs human tagging.</p>
      )}
    </li>
  );
}

/* ----- candidate photo (lazy: only mounts when a row is expanded) ----- */

function CandidatePhoto({
  candidateId,
  secret,
  name,
}: {
  candidateId: string;
  secret: string;
  name: string;
}) {
  const [photo, setPhoto] = useState<PlacePhoto | null>(null);
  const [logo, setLogo] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => {
    // Mounts only when the row is expanded, so Google photo cost is bounded to
    // candidates the reviewer actually opens. setState only after the await.
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/admin/restaurants/candidates/${candidateId}/photo`, {
          headers: { "x-foodswipe-admin-secret": secret },
        });
        const data = (await res.json()) as { photo?: PlacePhoto | null; logoUrl?: string | null };
        if (cancelled) return;
        const p = data.photo;
        setPhoto(
          p && typeof p.photoUri === "string" && p.photoUri.length > 0
            ? { photoUri: p.photoUri, attributions: Array.isArray(p.attributions) ? p.attributions : [] }
            : null,
        );
        setLogo(typeof data.logoUrl === "string" && data.logoUrl.length > 0 ? data.logoUrl : null);
        setResolved(true);
      } catch {
        if (!cancelled) setResolved(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [candidateId, secret]);

  const showLogo = !photo && resolved && Boolean(logo) && !logoFailed;

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-ink-2 ring-1 ring-inset ring-white/5">
      {photo ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- ephemeral Google
              Place Photo loaded directly from Google; never downloaded/rehosted. */}
          <img
            src={photo.photoUri}
            alt={`${name} — photo via Google`}
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
          <PreviewAttribution attributions={photo.attributions} />
        </>
      ) : showLogo && logo ? (
        <div className="absolute inset-0 flex items-center justify-center p-3">
          <div className="flex h-full max-h-16 items-center justify-center rounded-md bg-white p-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- Logo.dev CDN
                image loaded directly; never downloaded/rehosted. */}
            <img
              src={logo}
              alt={`${name} logo`}
              className="h-full w-full object-contain"
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setLogoFailed(true)}
            />
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center gap-1.5 text-haze">
          <MaterialIcon name="storefront" className="text-2xl" />
          <span className="text-[11px]">{resolved ? "No photo" : "Loading…"}</span>
        </div>
      )}
    </div>
  );
}

function PreviewAttribution({ attributions }: { attributions: PlacePhoto["attributions"] }) {
  const items = attributions.filter((a) => a.displayName.trim().length > 0);
  return (
    <span className="absolute left-1.5 top-1.5 inline-flex max-w-[90%] items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] text-white/90 ring-1 ring-inset ring-white/15 backdrop-blur-md">
      <MaterialIcon name="photo_camera" className="text-[11px]" />
      <span className="truncate">
        {items.length > 0
          ? `Photo: ${items.map((a) => a.displayName).join(", ")} via Google`
          : "Photo via Google"}
      </span>
    </span>
  );
}

/* ----- primitives ----- */

function TagField({
  label,
  hint,
  value,
  onChange,
  suggested,
  confidence,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  suggested: string[] | null;
  confidence: string | null;
}) {
  const current = parseList(value);
  let badge: { text: string; cls: string } | null = null;
  if (suggested) {
    if (suggested.length === 0) {
      // The tagger made no suggestion for this field — don't imply confidence.
      badge = sameSet(current, suggested)
        ? { text: "no suggestion", cls: "text-haze" }
        : { text: "added", cls: "text-tan" };
    } else {
      badge = sameSet(current, suggested)
        ? { text: `auto · ${confidence ?? "?"}`, cls: CONFIDENCE_TONE[confidence ?? ""] ?? "text-haze" }
        : { text: "edited", cls: "text-tan" };
    }
  }
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-cream">{label}</span>
        {badge && <span className={`text-[10px] font-medium ${badge.cls}`}>{badge.text}</span>}
      </span>
      {current.length > 0 && (
        <span className="mb-1 flex flex-wrap gap-1">
          {current.map((t, i) => (
            <span key={`${t}-${i}`} className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-tan">
              {t}
            </span>
          ))}
        </span>
      )}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={hint}
        className="w-full rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-cream outline-none ring-1 ring-inset ring-white/10 placeholder:text-haze/50 focus:ring-saffron/60"
      />
    </label>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-semibold text-cream">{label}</span>
        {hint && <span className="text-[10px] text-haze">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-lg bg-surface-2 px-3 py-2 text-sm text-cream outline-none ring-1 ring-inset ring-white/10 placeholder:text-haze/60 focus:ring-saffron/60"
    />
  );
}

function Textarea({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={2}
      className="w-full resize-y rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-cream outline-none ring-1 ring-inset ring-white/10 placeholder:text-haze/50 focus:ring-saffron/60"
    />
  );
}

function Meta({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-haze">{label}</dt>
      <dd className={`min-w-0 truncate text-tan ${mono ? "font-mono text-[10px]" : ""}`}>{value}</dd>
    </>
  );
}

function ScoreChip({ score }: { score: number | null }) {
  const tone =
    score === null
      ? "bg-white/5 text-haze ring-white/10"
      : score >= 60
        ? "bg-mint/15 text-mint ring-mint/30"
        : score >= 30
          ? "bg-saffron/15 text-saffron ring-saffron/30"
          : "bg-white/5 text-haze ring-white/10";
  return (
    <span
      className={`flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-md text-[13px] font-bold leading-none ring-1 ring-inset ${tone}`}
      title="Review likelihood (internal)"
    >
      {score === null ? "—" : score}
    </span>
  );
}

function Flag({ tone, icon, children }: { tone: "chili" | "saffron"; icon: string; children: React.ReactNode }) {
  const cls =
    tone === "chili"
      ? "bg-chili/15 text-chili-soft ring-chili/30"
      : "bg-saffron/15 text-saffron ring-saffron/30";
  return (
    <span className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${cls}`}>
      <MaterialIcon name={icon} className="text-[11px]" />
      {children}
    </span>
  );
}

function Action({
  onClick,
  disabled,
  icon,
  tone,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  icon: string;
  tone?: "mint" | "chili";
  children: React.ReactNode;
}) {
  const cls =
    tone === "mint"
      ? "text-mint ring-mint/30 hover:bg-mint/10"
      : tone === "chili"
        ? "text-chili-soft ring-chili/30 hover:bg-chili/10"
        : "text-cream ring-white/15 hover:bg-white/10";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold ring-1 ring-inset transition disabled:opacity-40 ${cls}`}
    >
      <MaterialIcon name={icon} className="text-sm" />
      {children}
    </button>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-12 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-haze">{label}</span>
      {children}
    </div>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset transition ${
        active ? "bg-white/15 text-cream ring-white/20" : "text-haze ring-white/10 hover:bg-white/5"
      }`}
    >
      {children}
    </button>
  );
}
