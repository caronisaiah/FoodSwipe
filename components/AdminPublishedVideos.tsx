"use client";

import { useReducer, useRef, useState } from "react";
import Link from "next/link";
import MaterialIcon from "@/components/MaterialIcon";
import { REASON_MAX_LENGTH, reasonForRequest, reasonReducer } from "@/lib/adminReasonField";

/*
  Corrections and recovery for PUBLISHED videos (INTERNAL, publication credential).

  Editable: creator handle, creator display name, attribution text. Read-only by design: the source link,
  platform, caption and legal display status, so a correction can never re-point a video or loosen a
  display restriction. Hide is a soft delete; Restore brings a hidden video back unchanged. Every change is
  written to the audit log in the same database statement as the change.
*/

interface PublishedVideo {
  id: string;
  restaurantSlug: string;
  platform: string;
  sourceUrl: string | null;
  creatorHandle: string;
  creatorDisplayName: string | null;
  caption: string;
  attributionText: string;
  status: "active" | "hidden";
  legalDisplayStatus: string;
  updatedAt: string;
}

type Msg = { type: "ok" | "err"; text: string } | null;
const FILTERS = ["all", "active", "hidden"] as const;

export default function AdminPublishedVideos() {
  const [secret, setSecret] = useState("");
  const [restaurant, setRestaurant] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [videos, setVideos] = useState<PublishedVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Msg>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const seq = useRef(0);

  async function load() {
    if (!secret.trim()) {
      setError("Enter the admin secret first.");
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (filter !== "all") params.set("status", filter);
    if (restaurant.trim()) params.set("restaurant", restaurant.trim());
    try {
      const res = await fetch(`/api/admin/videos?${params}`, { headers: { "x-foodswipe-admin-secret": secret } });
      const data = (await res.json()) as { videos?: PublishedVideo[]; error?: string };
      if (mine !== seq.current) return;
      if (!res.ok) {
        setVideos([]);
        setError(data.error ?? `Load failed (${res.status}).`);
        return;
      }
      setVideos(data.videos ?? []);
      setLoadedOnce(true);
    } catch {
      if (mine === seq.current) setError("Network error — could not reach the admin API.");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }

  function replace(updated: PublishedVideo, text: string) {
    setVideos((rows) => rows.map((v) => (v.id === updated.id ? updated : v)));
    setNotice({ type: "ok", text });
  }

  return (
    <div className="mx-auto min-h-dvh w-full max-w-3xl px-3 pb-16 pt-[max(env(safe-area-inset-top),0.75rem)]">
      <div className="mb-4 rounded-xl border border-saffron/30 bg-saffron/10 p-2.5 text-xs text-cream">
        <p className="flex items-center gap-1.5 font-display font-bold text-saffron">
          <MaterialIcon name="video_library" className="text-sm" />
          Published videos
        </p>
        <p className="mt-0.5 text-cream/80">
          Correct creator attribution or hide / restore a live video. The source link, platform and display
          restrictions cannot be changed here. Every change is recorded in the audit history.
        </p>
      </div>

      <header className="mb-3 flex items-center justify-between">
        <h1 className="font-display text-xl font-bold text-cream">Corrections &amp; recovery</h1>
        <nav className="flex gap-3 text-xs text-haze">
          <Link href="/admin/audit" className="underline-offset-2 hover:underline">Audit history</Link>
          <Link href="/admin/videos/candidates" className="underline-offset-2 hover:underline">Video queue</Link>
        </nav>
      </header>

      <label className="mb-3 block">
        <span className="mb-1 flex items-baseline justify-between">
          <span className="text-xs font-semibold text-cream">Admin secret (publication)</span>
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

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset transition ${filter === f ? "bg-white/15 text-cream ring-white/20" : "text-haze ring-white/10 hover:bg-white/5"}`}>
            {f === "all" ? "All" : f}
          </button>
        ))}
        <input
          value={restaurant}
          onChange={(e) => setRestaurant(e.target.value)}
          placeholder="restaurant slug"
          aria-label="Restaurant slug"
          className="min-w-0 flex-1 rounded-lg bg-surface-2 px-2.5 py-1 text-xs text-cream outline-none ring-1 ring-inset ring-white/10 focus:ring-saffron/60"
        />
        <button type="button" onClick={() => void load()} disabled={loading}
          className="flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-cream ring-1 ring-inset ring-white/15 hover:bg-white/20 disabled:opacity-40">
          <MaterialIcon name="refresh" className="text-sm" />
          {loading ? "Loading…" : loadedOnce ? "Refresh" : "Load"}
        </button>
      </div>

      {notice && <p className={`mb-2 text-xs ${notice.type === "ok" ? "text-mint" : "text-chili-soft"}`} role="status">{notice.text}</p>}
      {error && <p className="mb-2 text-xs text-chili-soft" role="alert">{error}</p>}

      {!loadedOnce && !error ? (
        <p className="text-sm text-haze">Enter the publication secret and press Load.</p>
      ) : videos.length === 0 && !loading ? (
        <p className="text-sm text-haze">No videos match.</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl ring-1 ring-inset ring-white/10" data-testid="videos">
          {videos.map((v) => (
            <VideoRow key={`${v.id}-${v.updatedAt}-${v.status}`} video={v} secret={secret} open={openId === v.id}
              onToggle={() => setOpenId((id) => (id === v.id ? null : v.id))} onChanged={replace} onError={(text) => setNotice({ type: "err", text })} />
          ))}
        </ul>
      )}
    </div>
  );
}

function VideoRow({ video, secret, open, onToggle, onChanged, onError }: {
  video: PublishedVideo; secret: string; open: boolean; onToggle: () => void;
  onChanged: (v: PublishedVideo, text: string) => void; onError: (text: string) => void;
}) {
  const [handle, setHandle] = useState(video.creatorHandle);
  const [display, setDisplay] = useState(video.creatorDisplayName ?? "");
  const [attribution, setAttribution] = useState(video.attributionText);
  // The reason belongs to the single action it was typed for (see lib/adminReasonField).
  const [reason, dispatchReason] = useReducer(reasonReducer, "");
  const [busy, setBusy] = useState(false);
  const hidden = video.status === "hidden";

  async function call(path: string, method: string, body: unknown, ok: (data: { video?: PublishedVideo; changed?: boolean }) => void) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(path, {
        method,
        headers: { "x-foodswipe-admin-secret": secret, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { video?: PublishedVideo; changed?: boolean; error?: string; errors?: { field: string; message: string }[] };
      if (!res.ok) {
        onError(data.errors?.length ? data.errors.map((e) => `${e.field}: ${e.message}`).join(" ") : data.error ?? `Failed (${res.status}).`);
        return;
      }
      dispatchReason({ type: "action-succeeded" }); // never reuse this reason for the next action
      ok(data);
    } catch {
      onError("Network error — nothing was changed. Refresh before retrying.");
    } finally {
      setBusy(false);
    }
  }

  const auditReason = reasonForRequest(reason);
  const save = () =>
    call(`/api/admin/videos/${video.id}`, "PATCH",
      { creatorHandle: handle.trim(), creatorDisplayName: display.trim() || null, attributionText: attribution.trim(), auditReason },
      (d) => d.video && onChanged(d.video, d.changed ? "Correction saved and recorded." : "Nothing changed."));
  const hide = () =>
    call(`/api/admin/videos/${video.id}`, "DELETE", { auditReason }, () => onChanged({ ...video, status: "hidden" }, "Video hidden (recoverable)."));
  const restore = () =>
    call(`/api/admin/videos/${video.id}/restore`, "POST", { auditReason },
      (d) => d.video && onChanged(d.video, d.changed ? "Video restored." : "Already active."));

  return (
    <li className="bg-surface-1 p-2.5" data-testid="video-row">
      <button type="button" onClick={() => { if (open) dispatchReason({ type: "collapsed" }); onToggle(); }} className="flex w-full items-center gap-2 text-left" aria-expanded={open}>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-cream">{video.creatorHandle}{video.creatorDisplayName ? ` · ${video.creatorDisplayName}` : ""}</span>
          <span className="block truncate text-[11px] text-haze">{video.platform} · /{video.restaurantSlug} · {video.attributionText}</span>
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${hidden ? "bg-chili/20 text-chili-soft" : "bg-mint/15 text-mint"}`}>{video.status}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-haze">
            {video.sourceUrl ? (
              <a href={video.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-saffron underline-offset-2 hover:underline">
                <MaterialIcon name="open_in_new" className="text-[11px]" />View original
              </a>
            ) : "No source link"}{" · "}display: {video.legalDisplayStatus} · read-only
          </p>
          <label className="block text-[11px] text-haze">Creator handle
            <input value={handle} onChange={(e) => setHandle(e.target.value)} className="mt-0.5 w-full rounded-md bg-surface-2 px-2 py-1 text-xs text-cream ring-1 ring-inset ring-white/10 focus:ring-saffron/60" />
          </label>
          <label className="block text-[11px] text-haze">Creator display name
            <input value={display} onChange={(e) => setDisplay(e.target.value)} className="mt-0.5 w-full rounded-md bg-surface-2 px-2 py-1 text-xs text-cream ring-1 ring-inset ring-white/10 focus:ring-saffron/60" />
          </label>
          <label className="block text-[11px] text-haze">Attribution text
            <input value={attribution} onChange={(e) => setAttribution(e.target.value)} className="mt-0.5 w-full rounded-md bg-surface-2 px-2 py-1 text-xs text-cream ring-1 ring-inset ring-white/10 focus:ring-saffron/60" />
          </label>
          <label className="block text-[11px] text-haze">Reason for the next action (optional, recorded once)
            <input value={reason} onChange={(e) => dispatchReason({ type: "edited", value: e.target.value })} maxLength={REASON_MAX_LENGTH} className="mt-0.5 w-full rounded-md bg-surface-2 px-2 py-1 text-xs text-cream ring-1 ring-inset ring-white/10 focus:ring-saffron/60" />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void save()} disabled={busy}
              className="rounded-md bg-brand-gradient px-3 py-1.5 text-xs font-bold text-ink disabled:opacity-40">Save correction</button>
            {hidden ? (
              <button type="button" onClick={() => void restore()} disabled={busy}
                className="rounded-md bg-mint/20 px-3 py-1.5 text-xs font-bold text-mint ring-1 ring-inset ring-mint/30 disabled:opacity-40">Restore</button>
            ) : (
              <button type="button" onClick={() => void hide()} disabled={busy}
                className="rounded-md bg-chili/20 px-3 py-1.5 text-xs font-bold text-chili-soft ring-1 ring-inset ring-chili/30 disabled:opacity-40">Hide</button>
            )}
            <Link href={`/admin/audit?resource=${encodeURIComponent(video.id)}`} className="ml-auto text-[11px] text-haze underline-offset-2 hover:underline">History</Link>
          </div>
        </div>
      )}
    </li>
  );
}
