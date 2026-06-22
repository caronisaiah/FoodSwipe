"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import MaterialIcon from "@/components/MaterialIcon";

/*
  Internal review tool — NOT a public feature.

  Drives the restaurant-candidate review workflow over the admin API, protected
  by FOODSWIPE_ADMIN_SECRET (entered client-side, session-only, sent as the
  `x-foodswipe-admin-secret` header — never persisted). Nothing here publishes to
  `/feed`: candidates are a review staging area. Imported rows land as
  `needs_review` for a human to curate/approve.

  Types are mirrored locally (NOT imported from `lib/db/candidates`) so the Neon/
  Drizzle runtime never gets bundled into this client component.
*/

// Mirrors CANDIDATE_STATUSES in lib/db/candidates.ts (review order first).
const STATUSES = ["needs_review", "candidate", "approved", "rejected"] as const;
type Status = (typeof STATUSES)[number];

type Filter = "all" | Status;
const FILTERS: Filter[] = ["needs_review", "candidate", "approved", "rejected", "all"];

const FILTER_LABEL: Record<Filter, string> = {
  all: "All",
  needs_review: "Needs review",
  candidate: "Candidate",
  approved: "Approved",
  rejected: "Rejected",
};

const STATUS_TONE: Record<string, string> = {
  needs_review: "text-saffron",
  approved: "text-mint",
  rejected: "text-chili-soft",
  candidate: "text-tan",
};

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
  lat: number | null;
  lng: number | null;
  priceLevel: number | null;
  cuisineTags: string[];
  dietaryTags: string[];
  vibeTags: string[];
  dishHighlights: string[];
  bestFor: string[];
  reasonText: string | null;
  reviewNotes: string | null;
  sourceFetchedAt: string | null;
  sourceExpiresAt: string | null;
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
  reviewNotes: string | null;
  sourceExpiresAt: string | null;
  seedMatchWarning: string | null;
}

type Msg = { type: "ok" | "err"; text: string } | null;

/* ----- helpers ----- */

function parseList(s: string): string[] {
  return s
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
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
function warningFrom(c: {
  reviewNotes: string | null;
  seedMatchWarning?: string | null;
}): string | null {
  if (c.seedMatchWarning && c.seedMatchWarning.trim()) return c.seedMatchWarning.trim();
  const m = c.reviewNotes?.match(/WARNING:\s*(.+)$/);
  return m ? m[1].trim() : null;
}

export default function AdminCandidates() {
  // Session-only admin secret (NOT persisted) — sent as a header to the API.
  const [secret, setSecret] = useState("");

  // List
  const [statusFilter, setStatusFilter] = useState<Filter>("needs_review");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  // Monotonic token so out-of-order list responses can't clobber a newer filter.
  const loadSeq = useRef(0);

  // Google import
  const [query, setQuery] = useState("");
  // Kept as a raw string so the field can be cleared/retyped; clamped to 1–20 on
  // blur and again when the import runs.
  const [maxResults, setMaxResults] = useState("10");
  const [dryRun, setDryRun] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<Msg>(null);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);

  async function load(status: Filter) {
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

  function selectStatus(s: Filter) {
    setStatusFilter(s);
    if (loadedOnce && secret.trim()) void load(s);
  }

  // Replace (or drop, if it left the active filter) a saved candidate in place.
  function onSaved(updated: Candidate) {
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
        headers: {
          "Content-Type": "application/json",
          "x-foodswipe-admin-secret": secret,
        },
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
          text: `Preview only — nothing was written. Found ${data.found ?? 0}.`,
        });
      } else {
        setPreview(null);
        setImportMsg({
          type: "ok",
          text: `Imported ${data.imported ?? 0}; skipped ${data.skippedDuplicates ?? 0} duplicate(s). Review them below.`,
        });
        if (loadedOnce) await load(statusFilter);
      }
    } catch {
      setImportMsg({ type: "err", text: "Network error — could not reach the import route." });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="mx-auto min-h-dvh w-full max-w-2xl px-4 pb-16 pt-[max(env(safe-area-inset-top),1rem)]">
      {/* Internal banner */}
      <div className="mb-5 rounded-2xl border border-chili/40 bg-chili/10 p-3 text-sm text-cream">
        <p className="flex items-center gap-1.5 font-display font-bold text-chili-soft">
          <MaterialIcon name="shield_person" className="text-base" />
          Internal review tool
        </p>
        <p className="mt-1 text-xs text-cream/80">
          Not a public feature. Candidates are a review staging area — nothing here
          is published to the feed. Imports require the admin secret and land as
          <span className="font-semibold"> needs_review</span> for human curation.
        </p>
      </div>

      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-cream">Restaurant candidates</h1>
        <Link href="/feed" className="text-xs text-haze underline-offset-2 hover:underline">
          ← Back to app
        </Link>
      </header>

      {/* Admin secret (session only) */}
      <div className="mb-5">
        <Field label="Admin secret" hint="session only — not stored">
          <TextInput
            value={secret}
            onChange={setSecret}
            placeholder="FOODSWIPE_ADMIN_SECRET"
            type="password"
          />
        </Field>
      </div>

      {/* Google Places import */}
      <section className="mb-6 rounded-2xl bg-surface p-3 ring-1 ring-inset ring-white/10">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-haze">
          <MaterialIcon name="travel_explore" className="text-sm" />
          Google Places import
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void runImport(dryRun);
          }}
          className="space-y-3"
        >
          <Field label="Search query" hint="e.g. “brunch in Shaw, Washington DC”">
            <TextInput value={query} onChange={setQuery} placeholder="cuisine + neighborhood" />
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
                className="w-full rounded-xl bg-surface-2 px-3 py-2 text-sm text-cream outline-none ring-1 ring-inset ring-white/10 focus:ring-saffron/60"
              />
            </Field>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 ring-1 ring-inset ring-white/10">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
                className="h-4 w-4 accent-saffron"
              />
              <span className="text-sm text-cream">
                Dry run <span className="text-haze">(preview, no writes)</span>
              </span>
            </label>
          </div>
          <button
            type="submit"
            aria-disabled={importing}
            className={`w-full rounded-full py-2.5 font-bold transition active:scale-[0.98] ${
              dryRun
                ? "bg-white/10 text-cream ring-1 ring-inset ring-white/15 hover:bg-white/20"
                : "bg-brand-gradient text-ink shadow-lg shadow-saffron/20"
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

        {/* Dry-run preview */}
        {preview && (
          <div className="mt-3">
            <p className="mb-2 text-xs font-semibold text-cream">
              Preview ({preview.length}) — not yet saved
            </p>
            {preview.length === 0 ? (
              <p className="text-xs text-haze">No usable results for that query.</p>
            ) : (
              <ul className="space-y-2">
                {preview.map((p, i) => {
                  const warn = warningFrom(p);
                  return (
                    <li
                      key={`${p.googlePlaceId ?? "row"}-${i}`}
                      className="rounded-xl bg-ink-2 p-2.5 ring-1 ring-inset ring-white/5"
                    >
                      <p className="text-sm font-semibold text-cream">{p.name ?? "(no name)"}</p>
                      <p className="truncate text-xs text-haze">{p.address ?? "—"}</p>
                      <p className="mt-1 text-[11px] text-haze">
                        {priceLabel(p.priceLevel)} · {p.websiteDomain ?? "no site"} · expires{" "}
                        {shortDate(p.sourceExpiresAt)}
                      </p>
                      {warn && (
                        <p className="mt-1 flex items-center gap-1 text-[11px] text-saffron">
                          <MaterialIcon name="warning" className="text-xs" />
                          {warn}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {preview.length > 0 && (
              <button
                type="button"
                onClick={() => void runImport(false)}
                disabled={importing}
                className="mt-3 w-full rounded-full bg-brand-gradient py-2.5 font-bold text-ink shadow-lg shadow-saffron/20 transition active:scale-[0.98] disabled:opacity-40"
              >
                {importing ? "Importing…" : `Import these ${preview.length} for real`}
              </button>
            )}
            <p className="mt-2 text-[10px] leading-relaxed text-haze">
              Imports store only the Google Place ID plus review metadata (name,
              address, lat/lng, website host, price). No photos, reviews, or ratings
              are stored, and nothing is published to the feed.
            </p>
          </div>
        )}
      </section>

      {/* Filter + load */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => selectStatus(f)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset transition ${
              statusFilter === f
                ? "bg-white/15 text-cream ring-white/20"
                : "text-haze ring-white/10 hover:bg-white/5"
            }`}
          >
            {FILTER_LABEL[f]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void load(statusFilter)}
          disabled={loading}
          className="ml-auto flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-cream ring-1 ring-inset ring-white/15 hover:bg-white/20 disabled:opacity-40"
        >
          <MaterialIcon name="refresh" className="text-sm" />
          {loading ? "Loading…" : loadedOnce ? "Refresh" : "Load"}
        </button>
      </div>

      {listError && <p className="mb-2 text-xs text-chili-soft">{listError}</p>}

      {/* List */}
      {!loadedOnce && !listError ? (
        <p className="text-sm text-haze">
          Enter the admin secret and press Load to list candidates.
        </p>
      ) : candidates.length === 0 && !loading ? (
        <p className="text-sm text-haze">
          No candidates for “{FILTER_LABEL[statusFilter]}”.
        </p>
      ) : (
        <ul className="space-y-3">
          {candidates.map((c) => (
            // Key on updatedAt so a row whose server data changed (e.g. after a
            // Refresh) remounts and re-seeds its editable defaults, rather than
            // showing a stale draft over fresh summary data.
            <CandidateRow
              key={`${c.id}:${c.updatedAt}`}
              candidate={c}
              secret={secret}
              onSaved={onSaved}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/* ----- one candidate (read-only summary + editable review fields) ----- */

function CandidateRow({
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
  const [dishes, setDishes] = useState(candidate.dishHighlights.join(", "));
  const [bestFor, setBestFor] = useState(candidate.bestFor.join(", "));
  const [reasonText, setReasonText] = useState(candidate.reasonText ?? "");
  const [reviewNotes, setReviewNotes] = useState(candidate.reviewNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const warn = warningFrom(candidate);
  const expiry = expiryState(candidate.sourceExpiresAt);

  async function save() {
    if (!secret.trim()) {
      setMsg({ type: "err", text: "Enter the admin secret first." });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/restaurants/candidates/${candidate.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-foodswipe-admin-secret": secret,
        },
        body: JSON.stringify({
          status,
          cuisineTags: parseList(cuisine),
          dietaryTags: parseList(dietary),
          vibeTags: parseList(vibe),
          dishHighlights: parseList(dishes),
          bestFor: parseList(bestFor),
          reasonText,
          reviewNotes,
        }),
      });
      const data = (await res.json()) as { candidate?: Candidate; error?: string };
      if (!res.ok || !data.candidate) {
        setMsg({ type: "err", text: data.error ?? `Save failed (${res.status}).` });
        return;
      }
      setMsg({ type: "ok", text: "Saved." });
      onSaved(data.candidate);
    } catch {
      setMsg({ type: "err", text: "Network error saving changes." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="rounded-2xl bg-surface p-3 ring-1 ring-inset ring-white/5">
      {/* Summary */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-cream">{candidate.name}</p>
          <p className="truncate text-xs text-haze">{candidate.address ?? "no address"}</p>
        </div>
        <span
          className={`shrink-0 text-[11px] font-semibold ${STATUS_TONE[candidate.status] ?? "text-haze"}`}
        >
          {candidate.status}
        </span>
      </div>

      {/* Flags */}
      {(warn || expiry !== "none") && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {expiry === "expired" && (
            <Flag tone="chili" icon="schedule">
              Source metadata expired ({shortDate(candidate.sourceExpiresAt)})
            </Flag>
          )}
          {expiry === "soon" && (
            <Flag tone="saffron" icon="schedule">
              Expires soon ({shortDate(candidate.sourceExpiresAt)})
            </Flag>
          )}
          {warn && (
            <Flag tone="saffron" icon="warning">
              {warn}
            </Flag>
          )}
        </div>
      )}

      {/* Provenance (read-only) */}
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
        <Meta label="Source" value={candidate.source} />
        <Meta label="Place ID" value={candidate.googlePlaceId ?? "—"} mono />
        <Meta label="Website" value={candidate.websiteDomain ?? "—"} />
        <Meta label="Price" value={priceLabel(candidate.priceLevel)} />
        <Meta label="Source expires" value={shortDate(candidate.sourceExpiresAt)} />
      </dl>

      {/* Editable review fields */}
      <div className="mt-3 space-y-2.5 border-t border-line pt-3">
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Status">
            <Select
              value={status}
              onChange={setStatus}
              options={STATUSES.map((s) => ({ value: s, label: s }))}
            />
          </Field>
          <Field label="Cuisine tags" hint="comma-separated">
            <TextInput value={cuisine} onChange={setCuisine} placeholder="thai, noodles" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Dietary tags" hint="comma-separated">
            <TextInput value={dietary} onChange={setDietary} placeholder="vegan, halal" />
          </Field>
          <Field label="Vibe tags" hint="comma-separated">
            <TextInput value={vibe} onChange={setVibe} placeholder="cozy, date-night" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Dish highlights" hint="comma-separated">
            <TextInput value={dishes} onChange={setDishes} placeholder="khao soi, sisig" />
          </Field>
          <Field label="Best for" hint="comma-separated">
            <TextInput value={bestFor} onChange={setBestFor} placeholder="groups, late-night" />
          </Field>
        </div>
        <Field label="Reason text">
          <Textarea value={reasonText} onChange={setReasonText} placeholder="Why this matches…" />
        </Field>
        <Field label="Review notes">
          <Textarea value={reviewNotes} onChange={setReviewNotes} placeholder="Curation notes…" />
        </Field>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-full bg-brand-gradient px-4 py-2 text-sm font-bold text-ink shadow-lg shadow-saffron/20 transition active:scale-[0.98] disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          {msg && (
            <span
              role="status"
              className={`text-xs ${msg.type === "ok" ? "text-mint" : "text-chili-soft"}`}
            >
              {msg.text}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

/* ----- primitives ----- */

function Flag({
  tone,
  icon,
  children,
}: {
  tone: "chili" | "saffron";
  icon: string;
  children: React.ReactNode;
}) {
  const cls =
    tone === "chili"
      ? "bg-chili/15 text-chili-soft ring-chili/30"
      : "bg-saffron/15 text-saffron ring-saffron/30";
  return (
    <span
      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${cls}`}
    >
      <MaterialIcon name={icon} className="text-xs" />
      {children}
    </span>
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
      className="w-full rounded-xl bg-surface-2 px-3 py-2 text-sm text-cream outline-none ring-1 ring-inset ring-white/10 placeholder:text-haze/60 focus:ring-saffron/60"
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
      className="w-full resize-y rounded-xl bg-surface-2 px-3 py-2 text-sm text-cream outline-none ring-1 ring-inset ring-white/10 placeholder:text-haze/60 focus:ring-saffron/60"
    />
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl bg-surface-2 px-3 py-2 text-sm text-cream outline-none ring-1 ring-inset ring-white/10 focus:ring-saffron/60"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-surface">
          {o.label}
        </option>
      ))}
    </select>
  );
}
