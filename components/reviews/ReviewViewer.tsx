"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import MaterialIcon from "@/components/MaterialIcon";
import type { ProfileVideoItem } from "@/components/RestaurantVideos";
import type { AnalyticsVideoPosition, RestaurantAnalyticsContext } from "@/lib/analytics";
import { reviewCreatorName } from "@/lib/reviewMedia";
import { videoSourceHref } from "@/lib/video";
import ReviewAttribution from "@/components/reviews/ReviewAttribution";
import ReviewPlayer from "@/components/reviews/ReviewPlayer";
import { useReviewSourceClick } from "@/components/reviews/useReviewAnalytics";

/**
 * Concept C's single-player viewer: a native modal <dialog>, so everything behind it is inert, Tab stays
 * inside, and Escape closes it. It lives in a portal on <body>, outside Swipe's draggable card, and swallows
 * key presses so the deck's Arrow-key save/pass shortcut cannot fire while a review is open. Exactly one
 * provider iframe exists while it is open; closing the viewer unmounts it.
 */
export default function ReviewViewer({
  items,
  index,
  onIndexChange,
  onClose,
  analytics,
}: {
  items: ProfileVideoItem[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  analytics?: RestaurantAnalyticsContext;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const item = items[index];
  const total = items.length;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  if (!item || typeof document === "undefined") return null;
  const name = reviewCreatorName(item.video, videoSourceHref(item.video));

  const step = (delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= total) return;
    onIndexChange(target);
    // The step button we just used may become disabled; keep focus inside the viewer.
    window.requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && dialogRef.current?.contains(active) && !(active as HTMLButtonElement).disabled) return;
      (delta === 1 ? previousRef.current : nextRef.current)?.focus();
    });
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      className="review-viewer"
      aria-labelledby={titleId}
      // React's dev double-mount closes and reopens the dialog; only a close that leaves it closed is a real one.
      onClose={(event) => {
        if (!event.currentTarget.open) onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) dialogRef.current?.close();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="review-viewer-body">
        <header className="review-viewer-head">
          <h2 id={titleId}>{name ?? `${item.video.platform} review`}</h2>
          <button ref={closeRef} type="button" className="review-viewer-close" aria-label="Close review"
            onClick={() => dialogRef.current?.close()}>
            <MaterialIcon name="close" />
          </button>
        </header>
        <ViewerReview key={item.video.id} item={item} position={(index + 1) as AnalyticsVideoPosition} analytics={analytics} />
        {total > 1 && (
          <nav className="review-viewer-nav" aria-label="Reviews">
            <button ref={previousRef} type="button" disabled={index === 0} onClick={() => step(-1)}>
              <MaterialIcon name="chevron_left" /> Previous
            </button>
            <span>{index + 1} of {total}</span>
            <button ref={nextRef} type="button" disabled={index === total - 1} onClick={() => step(1)}>
              Next <MaterialIcon name="chevron_right" />
            </button>
          </nav>
        )}
        <p role="status" className="sr-only">
          Showing review {index + 1} of {total}{name ? ` by ${name}` : ""}.
        </p>
      </div>
    </dialog>,
    document.body,
  );
}

function ViewerReview({
  item,
  position,
  analytics,
}: {
  item: ProfileVideoItem;
  position: AnalyticsVideoPosition;
  analytics?: RestaurantAnalyticsContext;
}) {
  const sourceClicked = useReviewSourceClick(item.video, position, analytics);
  return (
    <>
      <ReviewPlayer video={item.video} load="immediate" onSourceClick={sourceClicked} />
      <ReviewAttribution video={item.video} demoLabel={item.origin === "seed" ? undefined : item.origin === "local" ? "Local" : "Demo clip"} onSourceClick={sourceClicked} />
    </>
  );
}
