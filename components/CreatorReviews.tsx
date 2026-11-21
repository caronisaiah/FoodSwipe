"use client";

import { useRef, useState } from "react";
import MaterialIcon from "@/components/MaterialIcon";
import VideoEmbed from "@/components/VideoEmbed";
import type { ProfileVideoItem } from "@/components/RestaurantVideos";
import {
  analyticsVideoPlatform, captureFoodSwipeEvent, type AnalyticsVideoPosition, type RestaurantAnalyticsContext,
} from "@/lib/analytics";
import { useVisibleOnce } from "@/lib/useVisibleOnce";
import { videoCanEmbed, videoSourceHref } from "@/lib/video";

/**
 * Profile v2 creator reviews: compact rows, each with the creator, the platform and the original post. An
 * allowed clip plays in the platform's own player only when asked for. What may be shown, embedded or linked
 * is still decided by lib/video, exactly as for Swipe's review cards.
 */
export default function CreatorReviews({ items, analytics, posterEmoji }: {
  items: ProfileVideoItem[];
  analytics: RestaurantAnalyticsContext;
  posterEmoji: string;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  return (
    <ul className="profile-reviews">
      {items.map((item, index) => {
        const key = `${item.origin}-${item.video.id}`;
        return (
          <ReviewRow key={key} item={item} position={(index + 1) as AnalyticsVideoPosition} analytics={analytics}
            posterEmoji={posterEmoji} open={openKey === key} onOpen={() => setOpenKey(key)} onClose={() => setOpenKey(null)} />
        );
      })}
    </ul>
  );
}

/** A TikTok-style post link carries its creator: https://www.tiktok.com/@name/video/123. */
function handleFromUrl(href: string | undefined): string | null {
  if (!href) return null;
  try {
    return new URL(href).pathname.match(/^\/(@[\w.-]+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

function ReviewRow({ item, position, analytics, posterEmoji, open, onOpen, onClose }: {
  item: ProfileVideoItem;
  position: AnalyticsVideoPosition;
  analytics: RestaurantAnalyticsContext;
  posterEmoji: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const { video, origin } = item;
  const canEmbed = videoCanEmbed(video);
  const href = videoSourceHref(video);
  const handle = video.creatorHandle && video.creatorHandle !== "@unknown" ? video.creatorHandle : handleFromUrl(href);
  const title = handle ?? video.creatorDisplayName ?? video.attributionText;
  const context = {
    ...analytics,
    platform: analyticsVideoPlatform(video.platform),
    videoPosition: position,
    renderMode: canEmbed ? "embed" as const : href ? "source_link" as const : "unavailable" as const,
  };
  const row = useVisibleOnce<HTMLLIElement>(() => captureFoodSwipeEvent("video_impression", context));
  const playButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const panel = `review-player-${video.id}`;
  const sourceClicked = () => captureFoodSwipeEvent("video_source_clicked", { ...context, sourcePlacement: "review_card" });

  return (
    <li ref={row} className="profile-review">
      <div className="profile-review-row">
        {canEmbed ? (
          <button ref={playButton} type="button" className="profile-play" aria-expanded={open} aria-controls={open ? panel : undefined}
            aria-label={`${open ? "Close" : "Play"} review by ${title}`}
            onClick={() => { if (open) onClose(); else { onOpen(); window.requestAnimationFrame(() => closeButton.current?.focus()); } }}>
            <MaterialIcon name={open ? "close" : "play_arrow"} filled />
          </button>
        ) : href ? (
          <a className="profile-play" href={href} target="_blank" rel="noopener noreferrer" onClick={sourceClicked}
            aria-label={`Watch review by ${title} on ${video.platform} (opens in a new tab)`}>
            <MaterialIcon name="play_arrow" filled />
          </a>
        ) : (
          <span className="profile-play" data-muted aria-hidden><MaterialIcon name="play_arrow" filled /></span>
        )}
        <div className="profile-review-copy">
          <small>{video.platform}{origin !== "seed" ? " · Demo clip" : ""}</small>
          <strong>{title}</strong>
          {!canEmbed && !href && <small>Preview only</small>}
        </div>
        {href && (
          <a className="profile-original" href={href} target="_blank" rel="noopener noreferrer" onClick={sourceClicked}
            aria-label={`Original post by ${title} on ${video.platform} (opens in a new tab)`}>
            <MaterialIcon name="arrow_outward" />
          </a>
        )}
      </div>
      {open && canEmbed && (
        <div id={panel} className="profile-player">
          <div className="profile-player-frame"><VideoEmbed video={video} posterEmoji={posterEmoji} fill onSourceClick={sourceClicked} /></div>
          <button ref={closeButton} type="button" className="profile-text-action"
            onClick={() => { onClose(); window.requestAnimationFrame(() => playButton.current?.focus()); }}>
            Close video
          </button>
        </div>
      )}
    </li>
  );
}
