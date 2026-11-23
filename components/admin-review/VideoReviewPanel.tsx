"use client";

import { useReducer, useState } from "react";
import MaterialIcon from "@/components/MaterialIcon";
import { DRAFT_HINT, apiErrorText, useCanPublish } from "@/components/AdminCandidates";
import { reasonForRequest, reasonReducer } from "@/lib/adminReasonField";
import { buildDeclarationReason } from "@/lib/adminReview";
import { Chip, Section, StageIcon, inputClass, primaryButton, quietButton, shortDay } from "./ui";
import type { ReviewVideo, SectionProps } from "./types";

/*
  D + E. Creator-video reviews for this restaurant, including unpublished leads, next to the restaurant itself.

  Uses the existing endpoints only:
    PATCH /api/admin/videos/candidates/[id]         approve, reject, reopen, link a lead to this draft by id
    POST  /api/admin/videos/candidates/[id]/attach  put an APPROVED lead on a PUBLISHED restaurant's profile
  Nothing runs by itself: every consequential step is a button followed by an explicit confirmation, and the
  page never approves, attaches or links anything on load.

  Players: nothing is embedded until you press Load player, only one player exists at a time, and only
  official allow-listed provider embeds are ever created. The original link stays visible at all times.
*/

const PLATFORM: Record<string, string> = { tiktok: "TikTok", youtube: "YouTube", instagram: "Instagram" };
const STATUS_TONE: Record<string, "mint" | "saffron" | "chili" | "tan"> = { needs_review: "saffron", approved: "mint", attached: "mint", rejected: "chili" };
const STATUS_LABEL: Record<string, string> = { needs_review: "Under review", approved: "Approved", attached: "Live", rejected: "Rejected" };

type Pending = "approve" | "reject" | "reopen" | "attach" | "link" | null;

export default function VideoReviewPanel({ review, secret, onChanged }: SectionProps) {
  const [activePlayer, setActivePlayer] = useState<string | null>(null);
  const { videos, candidate, promoted } = review;
  const underReview = videos.filter((v) => v.status === "needs_review").length;
  const live = videos.filter((v) => v.status === "attached").length;
  const approved = videos.filter((v) => v.status === "approved").length;
  const slugOnly = videos.filter((v) => v.linkedBy === "slug").length;

  return (
    <Section
      id="videos" title="Creator videos" icon="video_library"
      chip={videos.length === 0 ? <Chip>None linked</Chip> : <Chip tone={underReview ? "saffron" : "mint"}>{underReview} under review · {approved} approved · {live} live</Chip>}
    >
      {videos.length === 0 ? (
        <p className="text-[12px] text-haze">No video leads are linked to this restaurant. Add leads from the <a className="text-saffron underline-offset-2 hover:underline" href="/admin/videos/candidates">video queue</a> and link them to this draft by id.</p>
      ) : (
        <>
          <p className="mb-3 text-[11px] text-haze">
            Every lead tied to this restaurant is listed, including ones that are not published. Open a player only when you want to watch it: one at a time, official embeds only.
            {slugOnly > 0 ? ` ${slugOnly} lead${slugOnly === 1 ? " is" : "s are"} linked by a typed slug only; link ${slugOnly === 1 ? "it" : "them"} to this draft by id.` : ""}
          </p>
          <ul className="space-y-3" data-testid="video-leads">
            {videos.map((video) => (
              <VideoLeadCard
                key={`${video.id}-${video.updatedAt}`}
                video={video}
                restaurantName={candidate.name}
                candidateId={candidate.id}
                restaurantPublished={Boolean(promoted && promoted.status === "published")}
                secret={secret}
                playerOpen={activePlayer === video.id}
                onPlay={() => setActivePlayer(video.id)}
                onClosePlayer={() => setActivePlayer((cur) => (cur === video.id ? null : cur))}
                onChanged={onChanged}
              />
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

function VideoLeadCard({ video, restaurantName, candidateId, restaurantPublished, secret, playerOpen, onPlay, onClosePlayer, onChanged }: {
  video: ReviewVideo;
  restaurantName: string;
  candidateId: string;
  restaurantPublished: boolean;
  secret: string;
  playerOpen: boolean;
  onPlay: () => void;
  onClosePlayer: () => void;
  onChanged: () => void;
}) {
  const canPublish = useCanPublish();
  const [pending, setPending] = useState<Pending>(null);
  const [watched, setWatched] = useState(false);
  const [identified, setIdentified] = useState(false);
  const [note, dispatchNote] = useReducer(reasonReducer, "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const locked = video.status === "attached";
  const creator = [video.creatorHandle, video.creatorName].filter(Boolean).join(" · ");
  const attachable = video.status === "approved" && Boolean(video.association?.attachable) && Boolean(video.association?.publishedSlug) && restaurantPublished;

  function cancel() {
    setPending(null);
    setWatched(false);
    setIdentified(false);
    dispatchNote({ type: "collapsed" });
  }

  async function run(kind: Exclude<Pending, null>) {
    if (busy) return;
    if (!secret.trim()) { setMsg({ type: "err", text: "Enter the admin secret first." }); return; }
    setBusy(true);
    setMsg(null);
    try {
      let res: Response;
      if (kind === "attach") {
        res = await fetch(`/api/admin/videos/candidates/${video.id}/attach`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-foodswipe-admin-secret": secret },
          body: JSON.stringify({ expectedRestaurantSlug: video.association?.publishedSlug }),
        });
      } else {
        const body: Record<string, unknown> =
          kind === "link" ? { candidateRestaurantId: candidateId }
          : { status: kind === "approve" ? "approved" : kind === "reject" ? "rejected" : "needs_review" };
        const reason = kind === "approve"
          ? buildDeclarationReason({ watchedVideo: watched, restaurantIdentified: identified, note })
          : reasonForRequest(note);
        if (reason) body.auditReason = reason;
        res = await fetch(`/api/admin/videos/candidates/${video.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "x-foodswipe-admin-secret": secret },
          body: JSON.stringify(body),
        });
      }
      const data = (await res.json()) as { error?: string; errors?: { field: string; message: string }[] };
      if (!res.ok) { setMsg({ type: "err", text: apiErrorText(data, `Failed (${res.status}).`) }); return; }
      cancel();
      onChanged();
    } catch {
      setMsg({ type: "err", text: "Network error. Nothing was confirmed; refresh before retrying." });
    } finally {
      setBusy(false);
    }
  }

  const publishOnly = !canPublish;
  return (
    <li className="rounded-xl bg-ink-2/50 p-3 ring-1 ring-inset ring-white/10" data-testid="video-lead" data-status={video.status}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-cream">
            <MaterialIcon name="smart_display" className="text-base text-saffron" />
            {PLATFORM[video.platform] ?? video.platform}
            <span className="font-normal text-tan">{creator || "Creator not recorded"}</span>
          </p>
          <p className="mt-0.5 text-[11px] text-haze">{video.attributionText ?? "No attribution text saved."}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip tone={STATUS_TONE[video.status] ?? "haze"}>{STATUS_LABEL[video.status] ?? video.status}</Chip>
          <Chip tone={video.linkedBy === "id" ? "mint" : "saffron"} title={video.linkedBy === "id" ? "Linked to this restaurant by its stable record id" : "Linked only by a typed restaurant slug"}>
            {video.linkedBy === "id" ? "Linked by id" : "Linked by slug only"}
          </Chip>
          <Chip tone="tan" title="The stored legal display classification">{video.legalDisplayStatus}{video.canEmbed ? " · official embed" : " · link only"}</Chip>
        </div>
      </div>

      {video.caption && <p className="mt-2 line-clamp-2 text-[11px] text-tan">“{video.caption}”</p>}
      {video.reviewNotes && (
        <details open className="mt-2 rounded-lg bg-white/5 p-2 text-[11px]" data-testid="lead-notes">
          <summary className="cursor-pointer font-semibold text-cream">Notes from whoever queued this lead <span className="font-normal text-haze">(not a human review)</span></summary>
          <p className="mt-1 whitespace-pre-wrap break-words text-tan">{video.reviewNotes}</p>
        </details>
      )}
      <p className="mt-1 text-[11px]">
        <a className="inline-flex items-center gap-1 break-all text-saffron underline-offset-2 hover:underline" href={video.sourceUrl} target="_blank" rel="noopener noreferrer" data-testid="view-original">
          <MaterialIcon name="open_in_new" className="text-[12px]" />View original on {PLATFORM[video.platform] ?? video.platform}
        </a>
        <span className="ml-2 text-haze">added {shortDay(video.discoveredAt)}</span>
      </p>

      <ol className="mt-3 grid gap-1.5 sm:grid-cols-2" data-testid="evidence-stages">
        {video.stages.map((stage) => (
          <li key={stage.id} className="flex items-start gap-2 rounded-lg bg-white/5 p-2 text-[11px]" data-stage={stage.id} data-state={stage.state}>
            <StageIcon state={stage.state} />
            <span className="min-w-0">
              <b className="block font-semibold text-cream">{stage.label}</b>
              <span className="block break-words text-haze">{stage.detail}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-3">
        {playerOpen && video.canEmbed && video.embedUrl ? (
          <div>
            <div className={`relative mx-auto w-full overflow-hidden rounded-lg bg-black ring-1 ring-inset ring-white/10 ${video.verticalEmbed ? "aspect-[9/16] max-w-[280px]" : "aspect-video max-w-md"}`}>
              <iframe
                src={video.embedUrl}
                title={`${PLATFORM[video.platform] ?? video.platform} video: ${creator || "creator"}`}
                className="absolute inset-0 h-full w-full"
                referrerPolicy="strict-origin-when-cross-origin"
                allow="encrypted-media; picture-in-picture"
                allowFullScreen
              />
            </div>
            <div className="mt-1.5 text-center"><button type="button" onClick={onClosePlayer} className={quietButton}>Close player</button></div>
          </div>
        ) : video.canEmbed ? (
          <button type="button" onClick={onPlay} className={quietButton} data-testid="load-player"><MaterialIcon name="play_circle" className="text-sm" />Load player</button>
        ) : (
          <p className="text-[11px] text-haze">This platform or link has no official embed we can show. Use View original to watch it.</p>
        )}
      </div>

      {!locked && pending === null && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {video.linkedBy === "slug" && <button type="button" onClick={() => setPending("link")} disabled={busy} className={quietButton}>Link to this draft by id</button>}
          {video.status !== "approved" && <button type="button" onClick={() => setPending("approve")} disabled={busy || publishOnly} title={publishOnly ? DRAFT_HINT : undefined} className={primaryButton}>Approve…</button>}
          {video.status !== "rejected" && <button type="button" onClick={() => setPending("reject")} disabled={busy || publishOnly} title={publishOnly ? DRAFT_HINT : undefined} className={quietButton}>Reject…</button>}
          {video.status !== "needs_review" && <button type="button" onClick={() => setPending("reopen")} disabled={busy || publishOnly} title={publishOnly ? DRAFT_HINT : undefined} className={quietButton}>Return to review…</button>}
          {attachable && <button type="button" onClick={() => setPending("attach")} disabled={busy || publishOnly} title={publishOnly ? DRAFT_HINT : undefined} className={primaryButton}>Attach to live profile…</button>}
          {video.status === "approved" && !attachable && <span className="text-[11px] text-haze">Attaching becomes available once the restaurant is published.</span>}
          {publishOnly && <span className="text-[11px] text-saffron">{DRAFT_HINT}</span>}
        </div>
      )}
      {locked && <p className="mt-3 border-t border-line pt-3 text-[11px] text-mint">This video is live on the restaurant&apos;s profile. Corrections and hiding are done under Published videos.</p>}

      {pending && (
        <div className="mt-3 space-y-2 rounded-lg bg-saffron/10 p-3 ring-1 ring-inset ring-saffron/30" data-testid="video-confirm" role="group" aria-label="Confirm">
          {pending === "approve" && (
            <>
              <p className="text-[12px] font-semibold text-cream">Approve this video for FoodSwipe?</p>
              <p className="text-[11px] text-tan">Approving marks the lead reviewed. It does not put it on the profile: attaching is a separate step after the restaurant is published.</p>
              <label className="flex items-start gap-2 text-[12px] text-cream"><input type="checkbox" className="mt-0.5" checked={watched} onChange={(e) => setWatched(e.target.checked)} />I watched this video.</label>
              <label className="flex items-start gap-2 text-[12px] text-cream"><input type="checkbox" className="mt-0.5" checked={identified} onChange={(e) => setIdentified(e.target.checked)} />I confirmed it shows {restaurantName}.</label>
              <p className="text-[10px] text-haze">What you tick is recorded in the audit log as your declaration under this shared credential. FoodSwipe does not check audio, sponsorship or which branch is shown.</p>
            </>
          )}
          {pending === "reject" && <p className="text-[12px] font-semibold text-cream">Reject this video lead?</p>}
          {pending === "reopen" && <p className="text-[12px] font-semibold text-cream">Return this lead to review?</p>}
          {pending === "link" && <p className="text-[12px] text-cream">Link this lead to <b>{restaurantName}</b> by its stable record id, so it stays correct if the restaurant&apos;s slug changes?</p>}
          {pending === "attach" && <p className="text-[12px] text-cream">Attach this approved video to <b>/{video.association?.publishedSlug}</b>? It becomes visible on the live restaurant profile.</p>}
          {pending !== "attach" && pending !== "link" && (
            <label className="block text-[11px] text-haze">{pending === "approve" ? "Optional note (recorded with your declaration)" : "Optional reason (recorded in the audit log)"}
              <input className={`${inputClass} mt-1`} value={note} onChange={(e) => dispatchNote({ type: "edited", value: e.target.value })} maxLength={400} />
            </label>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void run(pending)} disabled={busy} className={primaryButton} data-testid="video-confirm-go">
              {busy ? "Working…" : pending === "approve" ? "Approve for FoodSwipe" : pending === "reject" ? "Reject" : pending === "reopen" ? "Return to review" : pending === "attach" ? "Attach and publish video" : "Link by id"}
            </button>
            <button type="button" onClick={cancel} disabled={busy} className={quietButton}>Cancel</button>
          </div>
        </div>
      )}
      {msg && <p role="status" className={`mt-2 text-[11px] ${msg.type === "ok" ? "text-mint" : "text-chili-soft"}`}>{msg.text}</p>}
    </li>
  );
}
