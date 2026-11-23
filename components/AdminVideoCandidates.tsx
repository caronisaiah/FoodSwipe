"use client";

import { createContext, useContext, useRef, useState } from "react";
import Link from "next/link";
import { isEmbedUrlAllowed } from "@/lib/video";
import MaterialIcon from "@/components/MaterialIcon";
import AdminRestaurantPicker, { type PickedRestaurant } from "@/components/AdminRestaurantPicker";

/*
  Internal social-video REVIEW CONSOLE — NOT a public feature.

  Intake TikTok/Instagram/YouTube URLs into a review queue, then approve + attach
  to a restaurant. Attaching is the ONLY path into restaurant_videos, and only for
  an approved candidate with a restaurant slug. Secret-gated (session-only, sent
  as the x-foodswipe-admin-secret header, never persisted). Types mirrored locally
  so the Neon/Drizzle runtime never bundles into this client component.
*/

const STATUS_FILTERS = ["all", "needs_review", "approved", "rejected", "attached"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
const PLATFORM_FILTERS = ["all", "tiktok", "instagram", "youtube"] as const;
type PlatformFilter = (typeof PLATFORM_FILTERS)[number];

const STATUS_TONE: Record<string, string> = {
  needs_review: "bg-saffron/15 text-saffron ring-saffron/30",
  approved: "bg-mint/15 text-mint ring-mint/30",
  rejected: "bg-chili/15 text-chili-soft ring-chili/30",
  attached: "bg-white/15 text-cream ring-white/20",
};
const PLATFORM_LABEL: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube" };

/** Which credential this session uses. The server enforces it; the UI only greys out dead ends. */
type AdminScope = "draft" | "publish";
const AdminScopeContext = createContext<AdminScope | null>(null);
function useCanPublish(): boolean {
  return useContext(AdminScopeContext) !== "draft";
}
const DRAFT_HINT = "The draft credential cannot do this. Sign in with the publication credential.";

interface BriefRestaurant { id: string; name: string; slug: string | null; market: string; status: string }
/** How a video lead is linked to a restaurant, resolved by the server from stable ids. */
interface Association {
  kind: "candidate" | "published" | "legacy-slug" | "none";
  candidate: BriefRestaurant | null;
  publishedSlug: string | null;
  publishedStatus: string | null;
  attachable: boolean;
  proposedCandidate: BriefRestaurant | null;
  problems: string[];
}

interface ApiErrorBody { error?: string; errors?: { field: string; message: string }[] }
function apiErrorText(data: ApiErrorBody, fallback: string): string {
  const list = (data.errors ?? []).map((e) => `${e.field}: ${e.message}`);
  if (list.length > 1) return `${data.error ?? fallback} — ${list.join(" · ")}`;
  return data.error ?? fallback;
}

/** The restaurant a candidate points at, as picker state (null when unlinked or linked only by a typed slug). */
function pickFromAssociation(a: Association | null | undefined): PickedRestaurant | null {
  if (!a) return null;
  if (a.candidate) {
    return { kind: "candidate", id: a.candidate.id, name: a.candidate.name, slug: a.candidate.slug, market: a.candidate.market, status: a.candidate.status, address: null, googlePlaceId: null, publishedSlug: a.publishedSlug };
  }
  if (a.kind === "published" && a.publishedSlug) {
    return { kind: "published", id: a.publishedSlug, name: a.publishedSlug, slug: a.publishedSlug, market: "", status: a.publishedStatus ?? "published", address: null, googlePlaceId: null, publishedSlug: a.publishedSlug };
  }
  return null;
}
const pickKey = (p: PickedRestaurant | null) => (p ? `${p.kind}:${p.kind === "published" ? p.slug : p.id}` : "");

interface VideoCandidate {
  id: string;
  status: string;
  platform: string;
  sourceUrl: string;
  normalizedSourceUrl: string;
  platformVideoId: string | null;
  restaurantSlug: string | null;
  candidateRestaurantId?: string | null;
  association?: Association | null;
  proposedRestaurantName: string | null;
  creatorHandle: string | null;
  creatorName: string | null;
  caption: string | null;
  thumbnailUrl: string | null;
  embedUrl: string | null;
  attributionText: string | null;
  publishedAt: string | null;
  discoveredAt: string;
  sourceFetchedAt: string | null;
  matchConfidence: number | null;
  matchReasons: string[];
  legalDisplayStatus: string;
  resolverStatus: string;
  resolverError: string | null;
  reviewNotes: string | null;
  attachedVideoId: string | null;
  createdAt: string;
  updatedAt: string;
}

type Msg = { type: "ok" | "err"; text: string } | null;

function parseList(s: string): string[] {
  return s.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
}

export default function AdminVideoCandidates() {
  const [secret, setSecret] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("needs_review");
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("all");
  const [list, setList] = useState<VideoCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<Msg>(null);
  const [adminScope, setAdminScope] = useState<AdminScope | null>(null);
  const deepLinkHandled = useRef(false);
  const loadSeq = useRef(0);

  function changeSecret(value: string) {
    setSecret(value);
  }

  // Intake form
  const [sourceUrl, setSourceUrl] = useState("");
  const [intakePick, setIntakePick] = useState<PickedRestaurant | null>(null);
  const [intakeProposed, setIntakeProposed] = useState("");
  const [intakeNotes, setIntakeNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [intakeMsg, setIntakeMsg] = useState<Msg>(null);

  async function load(status: StatusFilter, platform: PlatformFilter) {
    if (!secret.trim()) {
      setError("Enter the admin secret first.");
      return;
    }
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      if (status !== "all") sp.set("status", status);
      if (platform !== "all") sp.set("platform", platform);
      const qs = sp.toString();
      const res = await fetch(`/api/admin/videos/candidates${qs ? `?${qs}` : ""}`, {
        headers: { "x-foodswipe-admin-secret": secret },
      });
      const data = (await res.json()) as { candidates?: VideoCandidate[]; error?: string; adminScope?: AdminScope };
      if (seq !== loadSeq.current) return;
      if (!res.ok) {
        setList([]);
        setError(data.error ?? `Load failed (${res.status}).`);
        return;
      }
      const loaded = Array.isArray(data.candidates) ? data.candidates : [];
      setList(loaded);
      setAdminScope(data.adminScope === "draft" || data.adminScope === "publish" ? data.adminScope : null);
      // Direct links (…/candidates?candidate=<id>) open that record once, after the first load.
      const wanted = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("candidate");
      if (wanted && !deepLinkHandled.current && loaded.some((c) => c.id === wanted)) {
        deepLinkHandled.current = true;
        setExpandedId(wanted);
        requestAnimationFrame(() => document.getElementById(`video-candidate-${wanted}`)?.scrollIntoView({ block: "center" }));
      }
      setLoadedOnce(true);
    } catch {
      if (seq === loadSeq.current) setError("Network error — could not reach the admin API.");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }

  function selectStatus(s: StatusFilter) {
    setStatusFilter(s);
    if (loadedOnce && secret.trim()) void load(s, platformFilter);
  }
  function selectPlatform(p: PlatformFilter) {
    setPlatformFilter(p);
    if (loadedOnce && secret.trim()) void load(statusFilter, p);
  }

  function onChanged(updated: VideoCandidate) {
    // The server returns the association separately; keep whatever we already know if it is absent.
    setActionMsg({ type: "ok", text: `Saved candidate → ${updated.status}.` });
    setList((rows) => {
      if (statusFilter !== "all" && updated.status !== statusFilter) {
        return rows.filter((c) => c.id !== updated.id);
      }
      return rows.map((c) => (c.id === updated.id ? updated : c));
    });
  }

  async function submitIntake(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!secret.trim()) {
      setIntakeMsg({ type: "err", text: "Enter the admin secret first." });
      return;
    }
    if (!sourceUrl.trim()) {
      setIntakeMsg({ type: "err", text: "Paste a TikTok / Instagram / YouTube URL." });
      return;
    }
    setSubmitting(true);
    setIntakeMsg(null);
    try {
      const res = await fetch("/api/admin/videos/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-foodswipe-admin-secret": secret },
        body: JSON.stringify({
          sourceUrl: sourceUrl.trim(),
          ...(intakePick?.kind === "candidate" ? { candidateRestaurantId: intakePick.id } : {}),
          ...(intakePick?.kind === "published" ? { restaurantSlug: intakePick.slug } : {}),
          proposedRestaurantName: intakeProposed.trim() || undefined,
          reviewNotes: intakeNotes.trim() || undefined,
        }),
      });
      const data = (await res.json()) as { candidate?: VideoCandidate; error?: string; errors?: { field: string; message: string }[]; code?: string };
      if (res.status === 409 && data.candidate) {
        setIntakeMsg({ type: "err", text: "Already in the queue — showing the existing candidate." });
        if (loadedOnce) await load(statusFilter, platformFilter);
        setExpandedId(data.candidate.id);
        return;
      }
      if (!res.ok || !data.candidate) {
        setIntakeMsg({ type: "err", text: apiErrorText(data, `Intake failed (${res.status}).`) });
        return;
      }
      setIntakeMsg({ type: "ok", text: `Queued ${PLATFORM_LABEL[data.candidate.platform] ?? data.candidate.platform} candidate for review.` });
      setSourceUrl("");
      setIntakeProposed("");
      setIntakeNotes("");
      setIntakePick(null);
      if (loadedOnce) await load(statusFilter, platformFilter);
      else void load(statusFilter, platformFilter);
    } catch {
      setIntakeMsg({ type: "err", text: "Network error — could not reach the intake API." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AdminScopeContext.Provider value={adminScope}>
    <div className="mx-auto min-h-dvh w-full max-w-3xl px-3 pb-16 pt-[max(env(safe-area-inset-top),0.75rem)]">
      <div className="mb-4 rounded-xl border border-chili/40 bg-chili/10 p-2.5 text-xs text-cream">
        <p className="flex items-center gap-1.5 font-display font-bold text-chili-soft">
          <MaterialIcon name="reviews" className="text-sm" />
          Social video review queue
        </p>
        <p className="mt-0.5 text-cream/80">
          Review-first intake for TikTok / Instagram / YouTube URLs. Nothing is shown
          on a profile until an <span className="font-semibold">approved</span> candidate
          is explicitly <span className="font-semibold">attached</span>. No download or
          rehosting — links/embeds only.
        </p>
      </div>

      <header className="mb-3 flex items-center justify-between">
        <h1 className="font-display text-xl font-bold text-cream">Video candidates</h1>
        <div className="flex items-center gap-3 text-xs">
          <Link href="/admin/restaurants/profile" className="text-saffron underline-offset-2 hover:underline">
            Profile editor →
          </Link>
          <Link href="/admin/videos" className="text-haze underline-offset-2 hover:underline">
            Video intake
          </Link>
        </div>
      </header>

      <div className="mb-4">
        <label className="block">
          <span className="mb-1 flex items-baseline justify-between">
            <span className="text-xs font-semibold text-cream">Admin secret</span>
            <span className="text-[10px] text-haze">session only — not stored</span>
          </span>
          <input
            type="password"
            value={secret}
            onChange={(e) => changeSecret(e.target.value)}
            placeholder="FOODSWIPE_ADMIN_SECRET"
            className="w-full rounded-lg bg-surface-2 px-3 py-2 text-sm text-cream outline-none ring-1 ring-inset ring-white/10 placeholder:text-haze/60 focus:ring-saffron/60"
          />
        </label>
      </div>

      {adminScope && (
        <p data-testid="admin-scope" className={`-mt-2 mb-3 text-[11px] font-semibold ${adminScope === "draft" ? "text-saffron" : "text-mint"}`}>
          {adminScope === "draft"
            ? "Draft credential: you can add and edit leads. Approving, rejecting and attaching need the publication credential."
            : "Publication credential: full access."}
        </p>
      )}

      {/* Intake */}
      <section className="mb-5 rounded-xl bg-surface p-3 ring-1 ring-inset ring-white/10">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-haze">
          <MaterialIcon name="add_link" className="text-sm" />
          Add a video URL
        </p>
        <form onSubmit={submitIntake} className="space-y-2.5">
          <input
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://www.tiktok.com/@user/video/…  ·  instagram.com/reel/…  ·  youtube.com/watch?v=…"
            aria-label="Video URL"
            className="w-full rounded-lg bg-surface-2 px-3 py-2 text-sm text-cream outline-none ring-1 ring-inset ring-white/10 placeholder:text-haze/50 focus:ring-saffron/60"
          />
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <AdminRestaurantPicker secret={secret} value={intakePick} onChange={setIntakePick} label="Restaurant (linked by id)" />
            <input
              value={intakeProposed}
              onChange={(e) => setIntakeProposed(e.target.value)}
              placeholder="or proposed restaurant name (not linked)"
              aria-label="Proposed restaurant name"
              className="w-full rounded-lg bg-surface-2 px-3 py-2 text-sm text-cream outline-none ring-1 ring-inset ring-white/10 placeholder:text-haze/50 focus:ring-saffron/60"
            />
          </div>
          <input
            value={intakeNotes}
            onChange={(e) => setIntakeNotes(e.target.value)}
            placeholder="review notes (optional)"
            aria-label="Review notes"
            className="w-full rounded-lg bg-surface-2 px-3 py-2 text-sm text-cream outline-none ring-1 ring-inset ring-white/10 placeholder:text-haze/50 focus:ring-saffron/60"
          />
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-brand-gradient py-2 text-sm font-bold text-ink transition active:scale-[0.99] disabled:opacity-40"
          >
            {submitting ? "Resolving…" : "Add to review queue"}
          </button>
        </form>
        {intakeMsg && (
          <p className={`mt-2 text-xs ${intakeMsg.type === "ok" ? "text-mint" : "text-chili-soft"}`}>
            {intakeMsg.text}
          </p>
        )}
      </section>

      {/* Filters */}
      <div className="mb-2 space-y-2">
        <FilterRow label="Status">
          {STATUS_FILTERS.map((f) => (
            <Tab key={f} active={statusFilter === f} onClick={() => selectStatus(f)}>
              {f === "all" ? "All" : f}
            </Tab>
          ))}
        </FilterRow>
        <FilterRow label="Platform">
          {PLATFORM_FILTERS.map((f) => (
            <Tab key={f} active={platformFilter === f} onClick={() => selectPlatform(f)}>
              {f === "all" ? "All" : PLATFORM_LABEL[f]}
            </Tab>
          ))}
          <button
            type="button"
            onClick={() => void load(statusFilter, platformFilter)}
            disabled={loading}
            className="ml-auto flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1 text-xs font-semibold text-cream ring-1 ring-inset ring-white/15 hover:bg-white/20 disabled:opacity-40"
          >
            <MaterialIcon name="refresh" className="text-sm" />
            {loading ? "Loading…" : loadedOnce ? "Refresh" : "Load"}
          </button>
        </FilterRow>
      </div>

      {actionMsg && <p className="mb-2 text-xs text-mint">{actionMsg.text}</p>}
      {error && <p className="mb-2 text-xs text-chili-soft">{error}</p>}

      {!loadedOnce && !error ? (
        <p className="text-sm text-haze">Enter the admin secret and press Load to list candidates.</p>
      ) : list.length === 0 && !loading ? (
        <p className="text-sm text-haze">No candidates for this filter.</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl ring-1 ring-inset ring-white/10">
          {list.map((c) => (
            <CandidateRow
              key={c.id}
              candidate={c}
              secret={secret}
              expanded={expandedId === c.id}
              onToggle={() => setExpandedId((id) => (id === c.id ? null : c.id))}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </div>
    </AdminScopeContext.Provider>
  );
}

/** One-line description of where a lead points, from the server-resolved association. */
function linkLabel(c: VideoCandidate): string {
  const a = c.association;
  if (a?.candidate) {
    const live = a.publishedSlug ? `live /${a.publishedSlug}` : `draft · ${a.candidate.status}`;
    return `→ ${a.candidate.name} (${a.candidate.market.toUpperCase()}, ${live})`;
  }
  if (a?.kind === "published" && a.publishedSlug) return `→ /${a.publishedSlug} (live)`;
  if (a?.kind === "legacy-slug") return `→ typed slug "${c.restaurantSlug}" (not linked by id)`;
  if (c.proposedRestaurantName) return `→ ${c.proposedRestaurantName} (not linked)`;
  return "no restaurant linked";
}

function CandidateRow({
  candidate,
  secret,
  expanded,
  onToggle,
  onChanged,
}: {
  candidate: VideoCandidate;
  secret: string;
  expanded: boolean;
  onToggle: () => void;
  onChanged: (updated: VideoCandidate) => void;
}) {
  return (
    <li id={`video-candidate-${candidate.id}`} className="bg-surface">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-white/[0.03]"
        aria-expanded={expanded}
      >
        <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-tan ring-1 ring-inset ring-white/15">
          {PLATFORM_LABEL[candidate.platform] ?? candidate.platform}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-cream">
            {candidate.creatorName || candidate.creatorHandle || candidate.caption || candidate.sourceUrl}
          </p>
          <p className="truncate text-[11px] text-haze">
            {linkLabel(candidate)}
            {candidate.matchConfidence !== null ? ` · conf ${candidate.matchConfidence}` : ""}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${STATUS_TONE[candidate.status] ?? "text-haze"}`}>
          {candidate.status}
        </span>
        <MaterialIcon name={expanded ? "expand_less" : "expand_more"} className="shrink-0 text-base text-haze" />
      </button>
      {expanded && (
        <CandidateDetail key={candidate.updatedAt} candidate={candidate} secret={secret} onChanged={onChanged} />
      )}
    </li>
  );
}

function CandidateDetail({
  candidate,
  secret,
  onChanged,
}: {
  candidate: VideoCandidate;
  secret: string;
  onChanged: (updated: VideoCandidate) => void;
}) {
  const canPublish = useCanPublish();
  const association = candidate.association ?? null;
  const initialPick = pickFromAssociation(association);
  const [pick, setPick] = useState<PickedRestaurant | null>(initialPick);
  const [creatorName, setCreatorName] = useState(candidate.creatorName ?? "");
  const [proposed, setProposed] = useState(candidate.proposedRestaurantName ?? "");
  const [creatorHandle, setCreatorHandle] = useState(candidate.creatorHandle ?? "");
  const [caption, setCaption] = useState(candidate.caption ?? "");
  const [attribution, setAttribution] = useState(candidate.attributionText ?? "");
  const [confidence, setConfidence] = useState(candidate.matchConfidence === null ? "" : String(candidate.matchConfidence));
  const [reasons, setReasons] = useState(candidate.matchReasons.join(", "));
  const [notes, setNotes] = useState(candidate.reviewNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  // Inline preview for any official, allowlisted embed (YouTube / TikTok / Instagram).
  const canEmbed = isEmbedUrlAllowed(candidate.embedUrl);
  const verticalEmbed = candidate.platform === "tiktok" || candidate.platform === "instagram";
  const publishedSlug = association?.publishedSlug ?? null;
  const targetChanged = pickKey(pick) !== pickKey(initialPick);
  const reviewLocked = candidate.status === "attached" || Boolean(candidate.attachedVideoId);
  // Attach needs: the publication credential, an approved lead, and a restaurant that is PUBLISHED right now
  // (resolved by the server from the linked record, not from a typed slug).
  const canAttach = canPublish && !reviewLocked && candidate.status === "approved" && Boolean(association?.attachable) && Boolean(publishedSlug) && !targetChanged;

  async function linkProposed() {
    const proposed = association?.proposedCandidate;
    if (!proposed || reviewLocked || saving || !secret.trim()) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/videos/candidates/${candidate.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-foodswipe-admin-secret": secret },
        body: JSON.stringify({ candidateRestaurantId: proposed.id }),
      });
      const data = (await res.json()) as { candidate?: VideoCandidate; association?: Association | null; error?: string; errors?: { field: string; message: string }[] };
      if (!res.ok || !data.candidate) {
        setMsg({ type: "err", text: apiErrorText(data, `Link failed (${res.status}).`) });
        return;
      }
      onChanged({ ...data.candidate, association: data.association ?? null });
    } catch {
      setMsg({ type: "err", text: "Network error while linking." });
    } finally {
      setSaving(false);
    }
  }

  async function save(overrideStatus?: string) {
    if (reviewLocked || saving || attaching) return;
    if (!secret.trim()) {
      setMsg({ type: "err", text: "Enter the admin secret first." });
      return;
    }
    setSaving(true);
    setMsg(null);
    const conf = confidence.trim() === "" ? null : Math.round(Number(confidence));
    try {
      const res = await fetch(`/api/admin/videos/candidates/${candidate.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-foodswipe-admin-secret": secret },
        body: JSON.stringify({
          ...(overrideStatus ? { status: overrideStatus } : {}),
          ...(targetChanged
            ? pick?.kind === "candidate"
              ? { candidateRestaurantId: pick.id }
              : pick?.kind === "published"
                ? { restaurantSlug: pick.slug }
                : { candidateRestaurantId: null, restaurantSlug: null }
            : {}),
          proposedRestaurantName: proposed,
          creatorHandle: creatorHandle.trim() || null,
          creatorName: creatorName.trim() || null,
          caption: caption.trim() || null,
          attributionText: attribution.trim() || null,
          matchConfidence: conf,
          matchReasons: parseList(reasons),
          reviewNotes: notes,
        }),
      });
      const data = (await res.json()) as { candidate?: VideoCandidate; association?: Association | null; error?: string; errors?: { field: string; message: string }[] };
      if (!res.ok || !data.candidate) {
        setMsg({ type: "err", text: apiErrorText(data, `Save failed (${res.status}).`) });
        return;
      }
      onChanged({ ...data.candidate, association: data.association ?? candidate.association ?? null });
    } catch {
      setMsg({ type: "err", text: "Network error saving changes." });
    } finally {
      setSaving(false);
    }
  }

  async function attach() {
    if (!canAttach || saving || attaching || !secret.trim()) return;
    setAttaching(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/videos/candidates/${candidate.id}/attach`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-foodswipe-admin-secret": secret },
        body: JSON.stringify({ expectedRestaurantSlug: publishedSlug }),
      });
      const data = (await res.json()) as { candidate?: VideoCandidate; videoId?: string; restaurantSlug?: string; error?: string; errors?: { field: string; message: string }[] };
      if (!res.ok || !data.candidate) {
        setMsg({ type: "err", text: apiErrorText(data, `Attach failed (${res.status}).`) });
        return;
      }
      setMsg({ type: "ok", text: `Attached to /${data.restaurantSlug ?? data.candidate.restaurantSlug} (video ${data.videoId?.slice(0, 8)}…).` });
      onChanged({ ...data.candidate, association: candidate.association ?? null });
    } catch {
      setMsg({ type: "err", text: "Network error during attach." });
    } finally {
      setAttaching(false);
    }
  }

  return (
    <div className="space-y-2.5 border-t border-line bg-ink-2/40 p-3">
      {/* Preview */}
      <div className="overflow-hidden rounded-lg bg-ink-2 ring-1 ring-inset ring-white/5">
        {canEmbed ? (
          <div
            className={`relative mx-auto w-full ${verticalEmbed ? "aspect-[9/16] max-w-[280px]" : "aspect-video"}`}
          >
            <iframe
              src={candidate.embedUrl ?? ""}
              title={candidate.caption ?? `${PLATFORM_LABEL[candidate.platform] ?? candidate.platform} preview`}
              className="absolute inset-0 h-full w-full"
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : (
          <div className="flex items-center gap-3 p-3">
            {candidate.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- referenced thumbnail, loaded directly, never rehosted
              <img
                src={candidate.thumbnailUrl}
                alt="thumbnail"
                className="h-20 w-20 shrink-0 rounded-lg object-cover ring-1 ring-inset ring-white/10"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-surface text-haze ring-1 ring-inset ring-white/10">
                <MaterialIcon name="play_circle" className="text-2xl" />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-[11px] text-haze">
                {PLATFORM_LABEL[candidate.platform] ?? candidate.platform} · {candidate.legalDisplayStatus}
              </p>
              <a
                href={candidate.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 break-all text-xs text-saffron underline-offset-2 hover:underline"
              >
                <MaterialIcon name="open_in_new" className="text-[12px]" />
                Open on {PLATFORM_LABEL[candidate.platform] ?? candidate.platform}
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Resolver / legal-status diagnostics (debug: where embeddability stands) */}
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[11px]">
        <span className="text-haze">Resolver</span>
        <span className="text-tan">
          {candidate.resolverStatus}
          {candidate.resolverError ? ` — ${candidate.resolverError}` : ""}
        </span>
        <span className="text-haze">Candidate legal</span>
        <span className={canEmbed ? "text-mint" : "text-tan"}>
          {candidate.legalDisplayStatus} · {canEmbed ? "inline-playable" : "link-out"}
        </span>
        <span className="text-haze">Embed URL</span>
        <span className="truncate font-mono text-[10px] text-tan">{candidate.embedUrl ?? "—"}</span>
        <span className="text-haze">Source</span>
        <span className="truncate text-tan">{candidate.normalizedSourceUrl}</span>
        {candidate.platformVideoId && (
          <>
            <span className="text-haze">Video id</span>
            <span className="truncate font-mono text-[10px] text-tan">{candidate.platformVideoId}</span>
          </>
        )}
        {candidate.attachedVideoId && (
          <>
            <span className="text-haze">Attached row</span>
            <span className="truncate font-mono text-[10px] text-mint">{candidate.attachedVideoId}</span>
          </>
        )}
      </div>

      {/* Editable review fields */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div className="sm:col-span-2 space-y-1.5" data-testid="association">
          <AdminRestaurantPicker secret={secret} value={pick} onChange={setPick} label="Linked restaurant (by id)" disabled={reviewLocked} />
          {association?.kind === "candidate" && association.candidate && (
            <p className="text-[11px] text-haze">
              Linked to the draft <span className="font-semibold text-cream">{association.candidate.name}</span> ({association.candidate.market.toUpperCase()}, {association.candidate.status}).{" "}
              {association.attachable ? <>It is published as <span className="font-mono text-cream">/{association.publishedSlug}</span>.</> : "It is not published yet, so this video cannot be attached; the link follows the restaurant when it is promoted, even if its slug changes."}{" "}
              <a className="text-saffron underline-offset-2 hover:underline" href={`/admin/restaurants/candidates?candidate=${association.candidate.id}`}>Open restaurant →</a>
            </p>
          )}
          {association?.kind === "published" && (
            <p className="text-[11px] text-haze">Linked to the live restaurant <span className="font-mono text-cream">/{association.publishedSlug}</span>.</p>
          )}
          {association?.kind === "legacy-slug" && (
            <div data-testid="legacy-link-warning" className="rounded-lg bg-saffron/10 p-2 text-[11px] text-saffron ring-1 ring-inset ring-saffron/30">
              <p className="font-semibold">Linked by a typed slug only (&ldquo;{candidate.restaurantSlug}&rdquo;).</p>
              <p className="mt-0.5">{association.problems.join(" ")}</p>
              {association.proposedCandidate && (
                <button type="button" onClick={() => void linkProposed()} disabled={saving || reviewLocked}
                  className="mt-1.5 rounded-md bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-cream ring-1 ring-inset ring-white/15 hover:bg-white/20 disabled:opacity-40">
                  Link to {association.proposedCandidate.name} ({association.proposedCandidate.market.toUpperCase()}, {association.proposedCandidate.status})
                </button>
              )}
            </div>
          )}
          {association?.kind === "none" && <p className="text-[11px] text-saffron">Not linked to any restaurant yet.</p>}
          {targetChanged && <p role="status" className="text-[11px] text-saffron">The link changes when you Save.</p>}
        </div>
        <TField label="Proposed name" value={proposed} onChange={setProposed} />
        <TField label="Creator handle" hint="starts with @" value={creatorHandle} onChange={setCreatorHandle} />
        <TField label="Creator name" hint="shown as the credit" value={creatorName} onChange={setCreatorName} />
        <TField label="Match confidence (0–100)" value={confidence} onChange={setConfidence} placeholder="0–100" />
      </div>
      <TField label="Caption" value={caption} onChange={setCaption} />
      <TField label="Attribution text" value={attribution} onChange={setAttribution} />
      <TField label="Match reasons" hint="comma-separated" value={reasons} onChange={setReasons} />
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-cream">Review notes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="w-full resize-y rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-cream outline-none ring-1 ring-inset ring-white/10 focus:ring-saffron/60"
        />
      </label>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2.5">
        <button type="button" onClick={() => void save()} disabled={reviewLocked || saving || attaching}
          className="rounded-md bg-white/10 px-3 py-1.5 text-xs font-semibold text-cream ring-1 ring-inset ring-white/15 hover:bg-white/20 disabled:opacity-40">
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => void save("approved")} disabled={reviewLocked || saving || attaching || !canPublish} title={!canPublish ? DRAFT_HINT : undefined}
          className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold text-mint ring-1 ring-inset ring-mint/30 hover:bg-mint/10 disabled:opacity-40">
          <MaterialIcon name="check_circle" className="text-sm" /> Approve
        </button>
        <button type="button" onClick={() => void save("rejected")} disabled={reviewLocked || saving || attaching || !canPublish} title={!canPublish ? DRAFT_HINT : undefined}
          className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold text-chili-soft ring-1 ring-inset ring-chili/30 hover:bg-chili/10 disabled:opacity-40">
          <MaterialIcon name="cancel" className="text-sm" /> Reject
        </button>
        <button
          type="button"
          onClick={() => void attach()}
          disabled={saving || attaching || !canAttach || !secret.trim()}
          title={!canPublish ? DRAFT_HINT : canAttach && publishedSlug ? `Attach to /${publishedSlug}` : undefined}
          className="ml-auto flex items-center gap-1 rounded-md bg-brand-gradient px-3 py-1.5 text-xs font-bold text-ink transition active:scale-[0.98] disabled:opacity-40"
        >
          <MaterialIcon name="link" className="text-sm" />
          {candidate.status === "attached" ? "Attached" : attaching ? "Attaching…" : "Attach to feed"}
        </button>
      </div>
      {reviewLocked ? (
        <p className="text-[10px] text-haze">Review edits are locked for candidates with an attachment record.</p>
      ) : targetChanged ? (
        <p className="text-[10px] text-haze">Save the new restaurant link before attaching.</p>
      ) : canAttach ? (
        <p className="text-[10px] text-haze">Attachment target <span className="font-mono text-cream">/{publishedSlug}</span></p>
      ) : (
        <p className="text-[10px] text-haze">
          Attach needs the publication credential, status <span className="text-cream">approved</span>, and a linked restaurant that is already published.
        </p>
      )}
      {msg && (
        <p className={`text-[11px] ${msg.type === "ok" ? "text-mint" : "text-chili-soft"}`}>{msg.text}</p>
      )}
    </div>
  );
}

function TField({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-cream">{label}</span>
        {hint && <span className="text-[9px] text-haze">{hint}</span>}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-cream outline-none ring-1 ring-inset ring-white/10 placeholder:text-haze/50 focus:ring-saffron/60"
      />
    </label>
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
