"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type {
  LegalDisplayStatus,
  MatchConfidence,
  Platform,
  Video,
  VideoSourceType,
} from "@/lib/types";
import { RESTAURANTS, getRestaurantById } from "@/lib/seed/restaurants";
import { normalizeVideo } from "@/lib/video";
import VideoEmbed from "@/components/VideoEmbed";

/*
  Internal demo tool — NOT a public feature.
  v1.2: attached videos are saved to a SHARED Postgres backend (via the admin
  API, protected by FOODSWIPE_ADMIN_SECRET) so deployed testers see the same
  real-media profiles. The YouTube resolve flow from v1.1 is unchanged. Restaurants
  still live in seed data; only video attachments are persisted.
*/

const PLATFORMS: Platform[] = ["TikTok", "Instagram", "YouTube", "Web"];
const SOURCE_TYPES: VideoSourceType[] = [
  "real-post",
  "creator-profile",
  "placeholder",
  "manual-seed",
];
const CONFIDENCES: MatchConfidence[] = ["high", "medium", "low", "manual"];
const LEGAL_STATUSES: LegalDisplayStatus[] = [
  "embeddable",
  "source-link-only",
  "placeholder-only",
  "unavailable",
];

interface FormState {
  restaurantId: string;
  platform: Platform;
  sourceUrl: string;
  embedUrl: string;
  creatorHandle: string;
  creatorDisplayName: string;
  caption: string;
  sourceType: VideoSourceType;
  matchConfidence: MatchConfidence;
  legalDisplayStatus: LegalDisplayStatus;
}

const INITIAL: FormState = {
  restaurantId: RESTAURANTS[0].id,
  platform: "TikTok",
  sourceUrl: "",
  embedUrl: "",
  creatorHandle: "",
  creatorDisplayName: "",
  caption: "",
  sourceType: "manual-seed",
  matchConfidence: "manual",
  legalDisplayStatus: "source-link-only",
};

function buildAttribution(f: FormState): string {
  const handle = f.creatorHandle.trim() || "@creator";
  const credit = f.creatorDisplayName.trim()
    ? `${f.creatorDisplayName.trim()} (${handle})`
    : handle;
  switch (f.sourceType) {
    case "real-post":
      return `Original post by ${credit} on ${f.platform}`;
    case "creator-profile":
      return `Review source: ${credit} on ${f.platform}`;
    case "manual-seed":
      return `${credit} on ${f.platform} (added for demo)`;
    default:
      return `Illustrative ${f.platform} preview — not a real post`;
  }
}

function toVideo(f: FormState, id: string): Video {
  return {
    id,
    platform: f.platform,
    sourceUrl: f.sourceUrl.trim() || undefined,
    embedUrl: f.embedUrl.trim() || undefined,
    creatorHandle: f.creatorHandle.trim() || "@creator",
    creatorDisplayName: f.creatorDisplayName.trim() || undefined,
    caption: f.caption.trim() || "(no caption)",
    attributionText: buildAttribution(f),
    discoveredAt: new Date().toISOString().slice(0, 10),
    isRealSource: f.sourceType === "real-post",
    sourceType: f.sourceType,
    matchConfidence: f.matchConfidence,
    legalDisplayStatus: f.legalDisplayStatus,
  };
}

type Msg = { type: "ok" | "err"; text: string } | null;

export default function AdminVideos() {
  const [form, setForm] = useState<FormState>(INITIAL);

  // Session-only admin secret (NOT persisted) — sent as a header to the API.
  const [adminSecret, setAdminSecret] = useState("");

  // v1.1 YouTube resolve flow
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  // v1.2 backend attach + persisted list
  const [attaching, setAttaching] = useState(false);
  const [attachMsg, setAttachMsg] = useState<Msg>(null);
  const [persisted, setPersisted] = useState<Video[]>([]);
  const [persistError, setPersistError] = useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Load a restaurant's shared/persisted videos (event/effect-driven; setState
  // only happens after the await, never synchronously inside an effect body).
  const reloadPersisted = useCallback(async (restaurantId: string) => {
    try {
      const res = await fetch(`/api/restaurants/${restaurantId}/videos`);
      const data = (await res.json()) as { videos?: Video[]; error?: string };
      setPersisted(Array.isArray(data.videos) ? data.videos : []);
      setPersistError(data.error ?? null);
    } catch {
      setPersisted([]);
      setPersistError("Could not load saved videos.");
    }
  }, []);

  // Load on restaurant change. Inlined (not the callback) so setState only runs
  // in the async continuation, never synchronously in the effect body.
  useEffect(() => {
    const id = form.restaurantId;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/restaurants/${id}/videos`);
        const data = (await res.json()) as { videos?: Video[]; error?: string };
        if (cancelled) return;
        setPersisted(Array.isArray(data.videos) ? data.videos : []);
        setPersistError(data.error ?? null);
      } catch {
        if (cancelled) return;
        setPersisted([]);
        setPersistError("Could not load saved videos.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [form.restaurantId]);

  async function resolveYouTube() {
    if (!youtubeUrl.trim() || resolving) return;
    setResolving(true);
    setResolveError(null);
    try {
      const res = await fetch("/api/resolve/youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: youtubeUrl,
          creatorHandle: form.creatorHandle,
          creatorDisplayName: form.creatorDisplayName,
          caption: form.caption,
        }),
      });
      const data: { video?: Video; error?: string } = await res.json();
      if (!res.ok || !data.video) {
        setResolveError(data.error ?? "Could not resolve that URL.");
        return;
      }
      const v = data.video;
      setForm((f) => ({
        ...f,
        platform: v.platform,
        sourceUrl: v.sourceUrl ?? "",
        embedUrl: v.embedUrl ?? "",
        sourceType: v.sourceType,
        legalDisplayStatus: v.legalDisplayStatus,
        matchConfidence: v.matchConfidence,
        creatorHandle: v.creatorHandle,
        creatorDisplayName: v.creatorDisplayName ?? "",
        caption: v.caption,
      }));
    } catch {
      setResolveError("Network error — could not reach the resolver.");
    } finally {
      setResolving(false);
    }
  }

  const canAttach =
    form.caption.trim().length > 0 && form.creatorHandle.trim().length > 0;

  // Preview the ENFORCED result so the tester can't be misled by a bad combo.
  const preview = normalizeVideo(toVideo(form, "admin-preview")) ?? toVideo(form, "admin-preview");

  async function attach() {
    if (!canAttach || attaching) return;
    if (!adminSecret.trim()) {
      setAttachMsg({ type: "err", text: "Enter the admin secret first." });
      return;
    }
    const cleaned = normalizeVideo(toVideo(form, "pending"));
    if (!cleaned) {
      setAttachMsg({ type: "err", text: "Video data is invalid." });
      return;
    }
    setAttaching(true);
    setAttachMsg(null);
    try {
      const res = await fetch("/api/admin/videos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-foodswipe-admin-secret": adminSecret,
        },
        body: JSON.stringify({ restaurantId: form.restaurantId, video: cleaned }),
      });
      const data = (await res.json()) as { video?: Video; error?: string };
      if (!res.ok || !data.video) {
        setAttachMsg({
          type: "err",
          text: data.error ?? `Attach failed (${res.status}).`,
        });
        return;
      }
      setAttachMsg({ type: "ok", text: "Saved to the shared library." });
      setForm((f) => ({
        ...f,
        sourceUrl: "",
        embedUrl: "",
        creatorHandle: "",
        creatorDisplayName: "",
        caption: "",
      }));
      await reloadPersisted(form.restaurantId);
    } catch {
      setAttachMsg({ type: "err", text: "Network error — could not reach the server." });
    } finally {
      setAttaching(false);
    }
  }

  async function removePersisted(id: string) {
    if (!adminSecret.trim()) {
      setAttachMsg({ type: "err", text: "Enter the admin secret to remove." });
      return;
    }
    try {
      const res = await fetch(`/api/admin/videos/${id}`, {
        method: "DELETE",
        headers: { "x-foodswipe-admin-secret": adminSecret },
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setAttachMsg({ type: "err", text: d.error ?? "Remove failed." });
        return;
      }
      await reloadPersisted(form.restaurantId);
    } catch {
      setAttachMsg({ type: "err", text: "Network error removing video." });
    }
  }

  const restaurantName = getRestaurantById(form.restaurantId)?.name ?? "restaurant";

  return (
    <div className="mx-auto min-h-dvh w-full max-w-md px-4 pb-16 pt-[max(env(safe-area-inset-top),1rem)]">
      {/* Internal banner */}
      <div className="mb-5 rounded-2xl border border-pink/40 bg-pink/10 p-3 text-sm text-cream">
        <p className="font-display font-bold text-pink">⚠️ Internal demo tool</p>
        <p className="mt-1 text-xs text-cream/80">
          Not a public feature. Attached videos save to a shared backend (requires
          the admin secret) so all testers see them. Don&apos;t paste anything you
          wouldn&apos;t legally embed.
        </p>
      </div>

      <header className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-cream">Video intake</h1>
        <Link href="/feed" className="text-xs text-haze underline-offset-2 hover:underline">
          ← Back to app
        </Link>
      </header>

      {/* Admin secret (session only) */}
      <div className="mb-5">
        <Field label="Admin secret" hint="session only — not stored">
          <Input
            value={adminSecret}
            onChange={setAdminSecret}
            placeholder="FOODSWIPE_ADMIN_SECRET"
            type="password"
          />
        </Field>
      </div>

      {/* YouTube resolver (v1.1) */}
      <div className="mb-5 rounded-2xl bg-surface p-3 ring-1 ring-inset ring-white/10">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-haze">
          Resolve from YouTube
        </p>
        <div className="flex gap-2">
          <input
            value={youtubeUrl}
            onChange={(e) => setYoutubeUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") resolveYouTube();
            }}
            placeholder="https://www.youtube.com/watch?v=…"
            aria-label="YouTube URL"
            className="min-w-0 flex-1 rounded-xl bg-ink-2 px-3 py-2 text-sm text-cream outline-none ring-1 ring-inset ring-white/10 placeholder:text-haze/60 focus:ring-coral/60"
          />
          <button
            type="button"
            onClick={resolveYouTube}
            disabled={resolving || youtubeUrl.trim() === ""}
            className="shrink-0 rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold text-cream ring-1 ring-inset ring-white/15 transition hover:bg-white/20 disabled:opacity-40"
          >
            {resolving ? "Resolving…" : "Resolve"}
          </button>
        </div>
        {resolveError && (
          <p role="alert" className="mt-2 text-xs text-coral">
            {resolveError}
          </p>
        )}
        <p className="mt-2 text-[10px] leading-relaxed text-haze">
          Paste a YouTube watch / Shorts / embed / youtu.be link. We build a
          privacy-enhanced youtube-nocookie embed — no API key, nothing downloaded.
        </p>
      </div>

      {/* Live preview */}
      <div className="mb-5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-haze">
          Live preview
        </p>
        <div className="relative mx-auto aspect-[9/16] w-48 overflow-hidden rounded-2xl ring-1 ring-white/10">
          <VideoEmbed video={preview} fill />
        </div>
        <p className="mt-1.5 text-center text-[11px] text-haze">
          Effective: <span className="text-cream">{preview.legalDisplayStatus}</span>
          {preview.isRealSource ? " · real source" : ""}
        </p>
      </div>

      {/* Form */}
      <div className="space-y-3">
        <Field label="Restaurant">
          <Select
            value={form.restaurantId}
            onChange={(v) => set("restaurantId", v)}
            options={RESTAURANTS.map((r) => ({ value: r.id, label: r.name }))}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Platform">
            <Select
              value={form.platform}
              onChange={(v) => set("platform", v as Platform)}
              options={PLATFORMS.map((p) => ({ value: p, label: p }))}
            />
          </Field>
          <Field label="Source type">
            <Select
              value={form.sourceType}
              onChange={(v) => set("sourceType", v as VideoSourceType)}
              options={SOURCE_TYPES.map((p) => ({ value: p, label: p }))}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Match confidence">
            <Select
              value={form.matchConfidence}
              onChange={(v) => set("matchConfidence", v as MatchConfidence)}
              options={CONFIDENCES.map((p) => ({ value: p, label: p }))}
            />
          </Field>
          <Field label="Legal display status">
            <Select
              value={form.legalDisplayStatus}
              onChange={(v) => set("legalDisplayStatus", v as LegalDisplayStatus)}
              options={LEGAL_STATUSES.map((p) => ({ value: p, label: p }))}
            />
          </Field>
        </div>

        <Field label="Creator handle" hint="required">
          <Input
            value={form.creatorHandle}
            onChange={(v) => set("creatorHandle", v)}
            placeholder="@districtbites"
          />
        </Field>
        <Field label="Creator display name" hint="optional">
          <Input
            value={form.creatorDisplayName}
            onChange={(v) => set("creatorDisplayName", v)}
            placeholder="District Bites"
          />
        </Field>
        <Field label="Caption" hint="required">
          <Input
            value={form.caption}
            onChange={(v) => set("caption", v)}
            placeholder="the sisig that broke my brain 🤯"
          />
        </Field>
        <Field label="Source URL" hint="real link shown for source-link-only / real-post">
          <Input
            value={form.sourceUrl}
            onChange={(v) => set("sourceUrl", v)}
            placeholder="https://…"
          />
        </Field>
        <Field label="Embed URL" hint="optional — only used when status is embeddable">
          <Input
            value={form.embedUrl}
            onChange={(v) => set("embedUrl", v)}
            placeholder="https://www.youtube-nocookie.com/embed/…"
          />
        </Field>

        <button
          type="button"
          onClick={attach}
          aria-disabled={!canAttach || attaching}
          aria-describedby="attach-help"
          className={`w-full rounded-full bg-brand-gradient py-3 font-bold text-ink shadow-lg shadow-coral/20 transition active:scale-[0.98] ${
            canAttach && !attaching ? "" : "opacity-40"
          }`}
        >
          {attaching ? "Saving…" : `Attach to ${restaurantName}`}
        </button>
        <p id="attach-help" className="text-center text-xs text-haze">
          {canAttach
            ? "Saves to the shared backend (needs the admin secret above)."
            : "Creator handle and caption are required."}
        </p>
        {attachMsg && (
          <p
            role="status"
            className={`text-center text-xs ${attachMsg.type === "ok" ? "text-mint" : "text-coral"}`}
          >
            {attachMsg.text}
          </p>
        )}
      </div>

      {/* Persisted (shared) videos for the selected restaurant */}
      <div className="mt-8">
        <h2 className="mb-2 font-display text-lg font-semibold text-cream">
          Saved for {restaurantName} ({persisted.length})
        </h2>
        {persistError && (
          <p className="mb-2 text-xs text-coral">{persistError}</p>
        )}
        {persisted.length === 0 ? (
          <p className="text-sm text-haze">
            No shared videos yet. Attached clips appear here and on the restaurant
            profile for every tester.
          </p>
        ) : (
          <ul className="space-y-2">
            {persisted.map((v) => (
              <li
                key={v.id}
                className="flex items-center gap-3 rounded-2xl bg-surface p-3 ring-1 ring-inset ring-white/5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-cream">
                    {v.creatorDisplayName ?? v.creatorHandle}
                    <span className="ml-2 font-normal text-haze">
                      {v.platform} · {v.legalDisplayStatus}
                    </span>
                  </p>
                  <p className="truncate text-xs text-haze">{v.caption}</p>
                </div>
                <Link
                  href={`/restaurants/${form.restaurantId}`}
                  className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-cream ring-1 ring-inset ring-white/15 hover:bg-white/20"
                >
                  View
                </Link>
                <button
                  type="button"
                  onClick={() => removePersisted(v.id)}
                  aria-label={`Hide ${v.caption}`}
                  className="shrink-0 rounded-full p-1.5 text-haze hover:bg-white/10 hover:text-coral"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ----- form primitives ----- */

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

function Input({
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
      className="w-full rounded-xl bg-surface px-3 py-2 text-sm text-cream outline-none ring-1 ring-inset ring-white/10 placeholder:text-haze/60 focus:ring-coral/60"
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
      className="w-full rounded-xl bg-surface px-3 py-2 text-sm text-cream outline-none ring-1 ring-inset ring-white/10 focus:ring-coral/60"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-surface">
          {o.label}
        </option>
      ))}
    </select>
  );
}
