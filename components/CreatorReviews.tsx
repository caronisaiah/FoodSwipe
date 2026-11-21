"use client";

import { useState } from "react";
import MaterialIcon from "@/components/MaterialIcon";
import type { ProfileVideoItem } from "@/components/RestaurantVideos";
import type { AnalyticsVideoPosition, RestaurantAnalyticsContext } from "@/lib/analytics";
import { reviewCreatorName, reviewFrame, reviewOriginLabel } from "@/lib/reviewMedia";
import { videoCanEmbed, videoSourceHref } from "@/lib/video";
import ReviewAttribution from "@/components/reviews/ReviewAttribution";
import ReviewPlayer from "@/components/reviews/ReviewPlayer";
import { useReviewImpression, useReviewSourceClick } from "@/components/reviews/useReviewAnalytics";

const FORMAT_LABEL = { portrait: "Vertical video", landscape: "Video", post: "Post" } as const;
const keyOf = (item: ProfileVideoItem) => `${item.origin}-${item.video.id}`;

/**
 * Profile v2 creator reviews (Concept A): one featured review in a reserved player frame, with the other
 * reviews listed to choose from. Choosing disposes the previous provider iframe and loads the next. Attribution
 * sits below the player, never over it. What may be embedded or linked is decided by lib/video.
 */
export default function CreatorReviews({
  items,
  analytics,
  tone = "light",
}: {
  items: ProfileVideoItem[];
  analytics: RestaurantAnalyticsContext;
  /** "dark" is Swipe's card: the player zone is also kept out of the deck's horizontal drag. */
  tone?: "light" | "dark";
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [chosen, setChosen] = useState(false);
  const found = items.findIndex((item) => keyOf(item) === selectedKey);
  const index = found === -1 ? 0 : found;
  const current = items[index];
  if (!current) return null;
  const name = reviewCreatorName(current.video, videoSourceHref(current.video));

  return (
    <div className="review-feature" data-tone={tone}>
      <div className="review-feature-grid">
      <FeaturedReview key={keyOf(current)} item={current} position={(index + 1) as AnalyticsVideoPosition}
        analytics={analytics} load={chosen ? "immediate" : "when-visible"} dragInert={tone === "dark"} />
      {items.length > 1 && (
        <ul className="review-selector" aria-label="Choose a review">
          {items.map((item, i) => (
            <SelectorRow key={keyOf(item)} item={item} position={(i + 1) as AnalyticsVideoPosition} analytics={analytics}
              current={i === index} total={items.length}
              onSelect={() => { setSelectedKey(keyOf(item)); setChosen(true); }} />
          ))}
        </ul>
      )}
      </div>
      <p role="status" className="sr-only">
        {chosen ? `Showing review ${index + 1} of ${items.length}${name ? ` by ${name}` : ""}.` : ""}
      </p>
    </div>
  );
}

function FeaturedReview({
  item,
  position,
  analytics,
  load,
  dragInert,
}: {
  item: ProfileVideoItem;
  position: AnalyticsVideoPosition;
  analytics: RestaurantAnalyticsContext;
  load: "immediate" | "when-visible";
  dragInert: boolean;
}) {
  const sourceClicked = useReviewSourceClick(item.video, position, analytics);
  return (
    // Swipe: taps and scrubs belong to the provider's player, not to the card's horizontal drag, and the browser
    // keeps vertical scrolling and pinch (the same pattern the old review card used).
    <div className="review-feature-main" style={dragInert ? { touchAction: "auto" } : undefined}
      onPointerDown={dragInert ? (event) => event.stopPropagation() : undefined}>
      <ReviewPlayer video={item.video} load={load} onSourceClick={sourceClicked} />
      <ReviewAttribution video={item.video} demoLabel={reviewOriginLabel(item.origin, item.video)}
        onSourceClick={sourceClicked} />
    </div>
  );
}

function SelectorRow({
  item,
  position,
  analytics,
  current,
  total,
  onSelect,
}: {
  item: ProfileVideoItem;
  position: AnalyticsVideoPosition;
  analytics: RestaurantAnalyticsContext;
  current: boolean;
  total: number;
  onSelect: () => void;
}) {
  const { video, origin } = item;
  const href = videoSourceHref(video);
  const name = reviewCreatorName(video, href) ?? `${video.platform} review`;
  const row = useReviewImpression<HTMLLIElement>(video, position, analytics);
  const playable = videoCanEmbed(video) || href !== undefined;
  return (
    <li ref={row}>
      <button type="button" className="review-select" aria-current={current || undefined}
        aria-label={`${name}, ${video.platform}, review ${position} of ${total}${current ? ", now showing" : ""}`}
        onClick={() => { if (!current) onSelect(); }}>
        <span className="review-disc" aria-hidden data-muted={!playable || undefined}>
          <MaterialIcon name={playable ? "play_arrow" : "videocam_off"} filled />
        </span>
        <span className="review-copy">
          <small>{[video.platform, reviewOriginLabel(origin, video), FORMAT_LABEL[reviewFrame(video)]].filter(Boolean).join(" · ")}</small>
          <strong>{name}</strong>
        </span>
        <span className="review-select-state" aria-hidden>{current ? "Showing" : ""}</span>
      </button>
    </li>
  );
}
