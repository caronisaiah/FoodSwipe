"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { isEmbedUrlAllowed } from "@/lib/video";
import MaterialIcon from "@/components/MaterialIcon";

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

interface VideoCandidate {
  id: string;
  status: string;
  platform: string;
  sourceUrl: string;
  normalizedSourceUrl: string;
  platformVideoId: string | null;
  restaurantSlug: string | null;
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

/** A pickable restaurant for the slug combobox (id IS the public slug). */
interface RestaurantOption {
  id: string;
  name: string;
  neighborhood: string;
}

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
  const loadSeq = useRef(0);

  // Attachable restaurants (seed + published) for the slug typeahead. Public list
  // — no secret needed; the combobox just won't suggest if it can't load.
  const [options, setOptions] = useState<RestaurantOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/restaurants");
        const data = (await res.json()) as { restaurants?: { id: string; name: string; neighborhood?: string }[] };
        if (!cancelled && Array.isArray(data.restaurants)) {
          setOptions(
            data.restaurants
              .map((r) => ({ id: r.id, name: r.name, neighborhood: r.neighborhood ?? "" }))
              .sort((a, b) => a.name.localeCompare(b.name)),
          );
        }
      } catch {
        // ignore — typeahead degrades to a plain input
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Intake form
  const [sourceUrl, setSourceUrl] = useState("");
  const [intakeSlug, setIntakeSlug] = useState("");
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
      const data = (await res.json()) as { candidates?: VideoCandidate[]; error?: string };
      if (seq !== loadSeq.current) return;
      if (!res.ok) {
        setList([]);
        setError(data.error ?? `Load failed (${res.status}).`);
        return;
      }
      setList(Array.isArray(data.candidates) ? data.candidates : []);
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
          restaurantSlug: intakeSlug.trim() || undefined,
          proposedRestaurantName: intakeProposed.trim() || undefined,
          reviewNotes: intakeNotes.trim() || undefined,
        }),
      });
      const data = (await res.json()) as { candidate?: VideoCandidate; error?: string };
      if (res.status === 409 && data.candidate) {
        setIntakeMsg({ type: "err", text: "Already in the queue — showing the existing candidate." });
        if (loadedOnce) await load(statusFilter, platformFilter);
        setExpandedId(data.candidate.id);
        return;
      }
      if (!res.ok || !data.candidate) {
        setIntakeMsg({ type: "err", text: data.error ?? `Intake failed (${res.status}).` });
        return;
      }
      setIntakeMsg({ type: "ok", text: `Queued ${PLATFORM_LABEL[data.candidate.platform] ?? data.candidate.platform} candidate for review.` });
      setSourceUrl("");
      setIntakeProposed("");
      setIntakeNotes("");
      if (loadedOnce) await load(statusFilter, platformFilter);
      else void load(statusFilter, platformFilter);
    } catch {
      setIntakeMsg({ type: "err", text: "Network error — could not reach the intake API." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
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
            onChange={(e) => setSecret(e.target.value)}
            placeholder="FOODSWIPE_ADMIN_SECRET"
            className="w-full rounded-lg bg-surface-2 px-3 py-2 text-sm text-cream outline-none ring-1 ring-inset ring-white/10 placeholder:text-haze/60 focus:ring-saffron/60"
          />
        </label>
      </div>

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
            <SlugCombobox
              value={intakeSlug}
              onChange={setIntakeSlug}
              options={options}
              placeholder="restaurant slug — type a name to search"
            />
            <input
              value={intakeProposed}
              onChange={(e) => setIntakeProposed(e.target.value)}
              placeholder="or proposed restaurant name"
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
              options={options}
              expanded={expandedId === c.id}
              onToggle={() => setExpandedId((id) => (id === c.id ? null : c.id))}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CandidateRow({
  candidate,
  secret,
  options,
  expanded,
  onToggle,
  onChanged,
}: {
  candidate: VideoCandidate;
  secret: string;
  options: RestaurantOption[];
  expanded: boolean;
  onToggle: () => void;
  onChanged: (updated: VideoCandidate) => void;
}) {
  return (
    <li className="bg-surface">
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
            {candidate.restaurantSlug ? `→ /${candidate.restaurantSlug}` : candidate.proposedRestaurantName ? `→ ${candidate.proposedRestaurantName}` : "no restaurant set"}
            {candidate.matchConfidence !== null ? ` · conf ${candidate.matchConfidence}` : ""}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${STATUS_TONE[candidate.status] ?? "text-haze"}`}>
          {candidate.status}
        </span>
        <MaterialIcon name={expanded ? "expand_less" : "expand_more"} className="shrink-0 text-base text-haze" />
      </button>
      {expanded && (
        <CandidateDetail key={candidate.updatedAt} candidate={candidate} secret={secret} options={options} onChanged={onChanged} />
      )}
    </li>
  );
}

function CandidateDetail({
  candidate,
  secret,
  options,
  onChanged,
}: {
  candidate: VideoCandidate;
  secret: string;
  options: RestaurantOption[];
  onChanged: (updated: VideoCandidate) => void;
}) {
  const [restaurantSlug, setRestaurantSlug] = useState(candidate.restaurantSlug ?? "");
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

  async function save(overrideStatus?: string) {
    if (saving) return;
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
          restaurantSlug,
          proposedRestaurantName: proposed,
          creatorHandle,
          caption,
          attributionText: attribution,
          matchConfidence: conf,
          matchReasons: parseList(reasons),
          reviewNotes: notes,
        }),
      });
      const data = (await res.json()) as { candidate?: VideoCandidate; error?: string };
      if (!res.ok || !data.candidate) {
        setMsg({ type: "err", text: data.error ?? `Save failed (${res.status}).` });
        return;
      }
      onChanged(data.candidate);
    } catch {
      setMsg({ type: "err", text: "Network error saving changes." });
    } finally {
      setSaving(false);
    }
  }

  async function attach() {
    if (attaching) return;
    setAttaching(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/videos/candidates/${candidate.id}/attach`, {
        method: "POST",
        headers: { "x-foodswipe-admin-secret": secret },
      });
      const data = (await res.json()) as { candidate?: VideoCandidate; videoId?: string; error?: string };
      if (!res.ok || !data.candidate) {
        setMsg({ type: "err", text: data.error ?? `Attach failed (${res.status}).` });
        return;
      }
      setMsg({ type: "ok", text: `Attached to /${data.candidate.restaurantSlug} (video ${data.videoId?.slice(0, 8)}…).` });
      onChanged(data.candidate);
    } catch {
      setMsg({ type: "err", text: "Network error during attach." });
    } finally {
      setAttaching(false);
    }
  }

  const canAttach = candidate.status === "approved" && Boolean(candidate.restaurantSlug);

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
        <label className="block">
          <span className="mb-1 flex items-baseline justify-between gap-2">
            <span className="text-xs font-semibold text-cream">Restaurant slug</span>
            <span className="text-[9px] text-haze">type a name to search</span>
          </span>
          <SlugCombobox value={restaurantSlug} onChange={setRestaurantSlug} options={options} placeholder="le-diplomate" />
        </label>
        <TField label="Proposed name" value={proposed} onChange={setProposed} />
        <TField label="Creator handle" value={creatorHandle} onChange={setCreatorHandle} />
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
        <button type="button" onClick={() => void save()} disabled={saving}
          className="rounded-md bg-white/10 px-3 py-1.5 text-xs font-semibold text-cream ring-1 ring-inset ring-white/15 hover:bg-white/20 disabled:opacity-40">
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={() => void save("approved")} disabled={saving}
          className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold text-mint ring-1 ring-inset ring-mint/30 hover:bg-mint/10 disabled:opacity-40">
          <MaterialIcon name="check_circle" className="text-sm" /> Approve
        </button>
        <button type="button" onClick={() => void save("rejected")} disabled={saving}
          className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold text-chili-soft ring-1 ring-inset ring-chili/30 hover:bg-chili/10 disabled:opacity-40">
          <MaterialIcon name="cancel" className="text-sm" /> Reject
        </button>
        <button
          type="button"
          onClick={() => void attach()}
          disabled={attaching || !canAttach}
          title={canAttach ? "" : "Requires status approved + a restaurant slug (Save first)."}
          className="ml-auto flex items-center gap-1 rounded-md bg-brand-gradient px-3 py-1.5 text-xs font-bold text-ink transition active:scale-[0.98] disabled:opacity-40"
        >
          <MaterialIcon name="link" className="text-sm" />
          {candidate.status === "attached" ? "Re-attach" : attaching ? "Attaching…" : "Attach to feed"}
        </button>
      </div>
      {!canAttach && candidate.status !== "attached" && (
        <p className="text-[10px] text-haze">
          Attach needs status <span className="text-cream">approved</span> and a saved restaurant slug.
        </p>
      )}
      {msg && (
        <p className={`text-[11px] ${msg.type === "ok" ? "text-mint" : "text-chili-soft"}`}>{msg.text}</p>
      )}
    </div>
  );
}

/**
 * Restaurant-slug typeahead. Type a name OR a slug; matching restaurants (seed +
 * published) appear in a dropdown, and picking one stores the actual slug (the
 * value attach resolves). Still accepts free-typed slugs, and shows whether the
 * current value is an exact known slug so a mistyped name is obvious before attach.
 */
function SlugCombobox({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (slug: string) => void;
  options: RestaurantOption[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const q = value.trim().toLowerCase();
  const matches =
    q.length === 0
      ? options.slice(0, 8)
      : options.filter((o) => o.id.toLowerCase().includes(q) || o.name.toLowerCase().includes(q)).slice(0, 8);
  const exact = options.find((o) => o.id === value.trim());

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        aria-label="Restaurant slug"
        autoComplete="off"
        className="w-full rounded-lg bg-surface-2 px-3 py-2 text-sm text-cream outline-none ring-1 ring-inset ring-white/10 placeholder:text-haze/50 focus:ring-saffron/60"
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-lg bg-surface-2 py-1 shadow-xl ring-1 ring-inset ring-white/15">
          {matches.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                // Prevent the input's blur (which closes the list) from firing before the click.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
                className="flex w-full items-baseline gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-white/10"
              >
                <span className="truncate text-cream">{o.name}</span>
                {o.neighborhood && <span className="shrink-0 truncate text-haze">{o.neighborhood}</span>}
                <span className="ml-auto shrink-0 truncate font-mono text-[10px] text-haze">/{o.id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {value.trim() !== "" &&
        (exact ? (
          <p className="mt-0.5 flex items-center gap-1 text-[10px] text-mint">
            <MaterialIcon name="check_circle" className="text-[11px]" />
            {exact.name}
          </p>
        ) : (
          <p className="mt-0.5 text-[10px] text-haze">No exact slug match — pick one from the list.</p>
        ))}
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
