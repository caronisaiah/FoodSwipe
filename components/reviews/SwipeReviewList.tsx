"use client";

import { useId, useRef, useState } from "react";
import MaterialIcon from "@/components/MaterialIcon";
import type { ProfileVideoItem } from "@/components/RestaurantVideos";
import type { AnalyticsVideoPosition, RestaurantAnalyticsContext } from "@/lib/analytics";
import { reviewCreatorName, reviewOriginLabel, reviewTitle } from "@/lib/reviewMedia";
import { sourceLinkLabel, videoCanEmbed, videoSourceHref } from "@/lib/video";
import ReviewViewer from "@/components/reviews/ReviewViewer";
import { useReviewImpression, useReviewSourceClick } from "@/components/reviews/useReviewAnalytics";

/**
 * Concept C on Swipe: a compact, always-visible list. No provider iframe exists until a person
 * presses Watch, and then only one, inside the viewer. Link-only reviews are plain links;
 * an unavailable review is stated honestly and cannot be opened.
 */
export default function SwipeReviewList({
  items,
  analytics,
}: {
  items: ProfileVideoItem[];
  analytics: RestaurantAnalyticsContext;
}) {
  const titleId = useId();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  if (items.length === 0) return null;

  return (
    <section aria-labelledby={titleId} className="review-list">
      <h3 id={titleId}>Creator reviews</h3>
      <ul>
        {items.map((item, index) => (
          <ReviewListRow
            key={`${item.origin}-${item.video.id}`}
            item={item}
            position={(index + 1) as AnalyticsVideoPosition}
            analytics={analytics}
            onOpen={(element) => {
              opener.current = element;
              setOpenIndex(index);
            }}
          />
        ))}
      </ul>
      {openIndex !== null && (
        <ReviewViewer
          items={items}
          index={Math.min(openIndex, items.length - 1)}
          onIndexChange={setOpenIndex}
          analytics={analytics}
          onClose={() => {
            setOpenIndex(null);
            const target = opener.current;
            window.requestAnimationFrame(() => {
              if (target?.isConnected) target.focus();
            });
          }}
        />
      )}
    </section>
  );
}

function ReviewListRow({
  item,
  position,
  analytics,
  onOpen,
}: {
  item: ProfileVideoItem;
  position: AnalyticsVideoPosition;
  analytics: RestaurantAnalyticsContext;
  onOpen: (element: HTMLElement) => void;
}) {
  const { video, origin } = item;
  const canEmbed = videoCanEmbed(video);
  const href = videoSourceHref(video);
  const name = reviewCreatorName(video, href);
  const row = useReviewImpression<HTMLLIElement>(video, position, analytics);
  const sourceClicked = useReviewSourceClick(video, position, analytics);
  const originLabel = reviewOriginLabel(origin, video);
  const meta = originLabel ? `${video.platform} · ${originLabel}` : video.platform;
  const copy = (
    <>
      <span className="review-disc" aria-hidden>
        <MaterialIcon name={canEmbed || href ? "play_arrow" : "videocam_off"} filled />
      </span>
      <span className="review-copy">
        <small>{meta}</small>
        <strong>{name ?? `${video.platform} review`}</strong>
        {!canEmbed && href && <small>Opens on {video.platform}</small>}
        {!canEmbed && !href && <small>Source unavailable</small>}
      </span>
    </>
  );

  return (
    <li ref={row} className="review-list-row">
      {canEmbed ? (
        <button type="button" className="review-open" aria-haspopup="dialog"
          aria-label={`Watch ${reviewTitle(name, video.platform)}`}
          onClick={(event) => onOpen(event.currentTarget)}>
          {copy}
          <span className="review-open-cta" aria-hidden>Watch</span>
        </button>
      ) : href ? (
        <a className="review-open" href={href} target="_blank" rel="noopener noreferrer" onClick={sourceClicked}
          aria-label={`Watch ${reviewTitle(name, video.platform)} on ${video.platform} (opens in a new tab)`}>
          {copy}
          <MaterialIcon name="arrow_outward" className="review-open-icon" />
        </a>
      ) : (
        <div className="review-open" data-muted>{copy}</div>
      )}
      {canEmbed && href && (
        <a className="review-original" href={href} target="_blank" rel="noopener noreferrer" onClick={sourceClicked}
          aria-label={`${sourceLinkLabel(video)}${name ? ` by ${name}` : ""} on ${video.platform} (opens in a new tab)`}>
          <MaterialIcon name="arrow_outward" />
        </a>
      )}
    </li>
  );
}
