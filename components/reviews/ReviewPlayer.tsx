"use client";

import { useEffect, useRef, useState } from "react";
import MaterialIcon from "@/components/MaterialIcon";
import type { Video } from "@/lib/types";
import { videoCanEmbed, videoSourceHref } from "@/lib/video";
import {
  parseProviderSignal,
  reviewCreatorName,
  reviewEmbedSrc,
  reviewFrame,
  reviewTitle,
  YOUTUBE_LISTENING_MESSAGE,
} from "@/lib/reviewMedia";

/**
 * How a review's iframe is created.
 *  - "immediate":    now (a person just opened or chose this review).
 *  - "when-visible": once the frame is near the viewport; the person still presses the provider's own play.
 *  - "on-tap":       only after Watch review is pressed.
 */
export type ReviewLoadMode = "immediate" | "when-visible" | "on-tap";

type Phase = "facade" | "loading" | "ready" | "failed";

/**
 * The one place a review's provider iframe exists. A reserved frame is drawn first, so nothing
 * moves when the provider arrives; what may be embedded or linked is decided by lib/video. FoodSwipe
 * never draws over a live provider player: our loading, failure and link-only states live inside
 * the frame only while there is no player, and attribution belongs to ReviewAttribution, below it.
 * Remount with `key={video.id}` to dispose the previous iframe when the review changes.
 */
export default function ReviewPlayer({
  video,
  load,
  onSourceClick,
}: {
  video: Video;
  load: ReviewLoadMode;
  onSourceClick?: () => void;
}) {
  const canEmbed = videoCanEmbed(video);
  const href = videoSourceHref(video);
  const name = reviewCreatorName(video, href);
  const frame = reviewFrame(video);
  const [phase, setPhase] = useState<Phase>(canEmbed && load === "immediate" ? "loading" : "facade");
  const [attempt, setAttempt] = useState(0);
  const [stalled, setStalled] = useState(false);
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [src] = useState(() =>
    canEmbed && video.embedUrl
      ? reviewEmbedSrc(video.embedUrl, typeof window === "undefined" ? null : window.location.origin)
      : null,
  );

  // Near the viewport: create the iframe (never when the person asked to save data).
  useEffect(() => {
    if (!canEmbed || phase !== "facade" || load !== "when-visible") return;
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (connection?.saveData || typeof IntersectionObserver === "undefined" || !frameRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setPhase("loading");
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, [canEmbed, load, phase]);

  // The provider's own signals. Only messages from this iframe's window count.
  useEffect(() => {
    if (phase !== "loading" && phase !== "ready") return;
    const onMessage = (event: MessageEvent) => {
      const target = iframeRef.current?.contentWindow;
      if (!target || event.source !== target) return;
      const signal = parseProviderSignal(video.platform, event.origin, event.data);
      if (signal?.kind === "error") setPhase("failed");
      else if (signal?.kind === "measure") setMeasuredHeight(signal.height);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [phase, video.platform]);

  // A slow provider is not a failed one: say so, offer the original, keep waiting.
  useEffect(() => {
    if (phase !== "loading") return;
    const timer = window.setTimeout(() => setStalled(true), 8000);
    return () => window.clearTimeout(timer);
  }, [phase, attempt]);

  const sourceLink = href ? (
    <a className="review-state-link" href={href} target="_blank" rel="noopener noreferrer" onClick={onSourceClick}
      aria-label={`Watch on ${video.platform} (opens in a new tab)`}>
      Watch on {video.platform} <MaterialIcon name="arrow_outward" />
    </a>
  ) : null;

  const style = frame === "post" && measuredHeight ? { aspectRatio: "auto", height: measuredHeight } : undefined;
  let body: React.ReactNode;

  if (!canEmbed) {
    body = href ? (
      <div className="review-state">
        <small>{video.platform}</small>
        <strong>This review opens on {video.platform}</strong>
        <small>It plays where the creator posted it.</small>
        {sourceLink}
      </div>
    ) : (
      <div className="review-state">
        <small>{video.platform}</small>
        <strong>Source unavailable</strong>
        <small>The original post can no longer be shown.</small>
      </div>
    );
  } else if (phase === "failed") {
    body = (
      <div className="review-state">
        <small>{video.platform}</small>
        <strong>This review couldn&apos;t play here</strong>
        <small>The {video.platform} player reported a problem. The post may have been removed or restricted.</small>
        <span className="review-state-actions">
          {sourceLink}
          <button type="button" className="review-state-retry" onClick={() => { setStalled(false); setPhase("loading"); setAttempt((n) => n + 1); }}>
            Try again
          </button>
        </span>
      </div>
    );
  } else if (phase === "facade") {
    body = (
      <div className="review-state">
        <small>{video.platform}</small>
        <strong>{name ?? `${video.platform} review`}</strong>
        <button type="button" className="review-state-primary" onClick={() => setPhase("loading")}
          aria-label={`Load the ${video.platform} player for ${reviewTitle(name, video.platform)}`}>
          <MaterialIcon name="play_arrow" filled /> Watch review
        </button>
      </div>
    );
  } else {
    body = (
      <>
        <iframe
          key={attempt}
          ref={iframeRef}
          src={src ?? undefined}
          title={reviewTitle(name, video.platform)}
          className="review-iframe"
          data-ready={phase === "ready" || undefined}
          referrerPolicy="strict-origin-when-cross-origin"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          onLoad={(event) => {
            setPhase("ready");
            setStalled(false);
            if (video.platform === "YouTube" && src) {
              event.currentTarget.contentWindow?.postMessage(YOUTUBE_LISTENING_MESSAGE, new URL(src).origin);
            }
          }}
        />
        {phase === "loading" && (
          <div className="review-loading" role="status">
            <span className="review-spinner" aria-hidden />
            <small>{stalled ? `Still loading the ${video.platform} player.` : `Loading ${video.platform} player…`}</small>
            {stalled && sourceLink}
          </div>
        )}
      </>
    );
  }

  return (
    <div ref={frameRef} className="review-frame" data-frame={frame} data-phase={canEmbed ? phase : "static"} style={style}
      aria-busy={phase === "loading" || undefined}>
      {body}
    </div>
  );
}
