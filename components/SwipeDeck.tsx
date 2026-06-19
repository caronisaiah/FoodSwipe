"use client";

import Link from "next/link";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  motion,
  useAnimationControls,
  useMotionValue,
  useTransform,
} from "framer-motion";
import type { ScoredRestaurant, SwipeDirection } from "@/lib/types";
import RestaurantCard from "@/components/RestaurantCard";

interface SwipeDeckProps {
  /** Full ranked list. */
  deck: ScoredRestaurant[];
  /** Ids already swiped — filtered out of the live queue. */
  swipedIds: string[];
  onSwipe: (restaurantId: string, direction: SwipeDirection) => void;
  /** Live count of saved restaurants, shown on the empty state. */
  savedCount: number;
  /** Clear swipes + start the deck over. */
  onReset: () => void;
}

export default function SwipeDeck({
  deck,
  swipedIds,
  onSwipe,
  savedCount,
  onReset,
}: SwipeDeckProps) {
  const cardRef = useRef<SwipeCardHandle>(null);

  // The live queue is just the deck minus anything already swiped. Recording a
  // swipe drops the top card, so queue[0] is always the current card — no index
  // bookkeeping, no risk of the deck reshuffling under the user.
  const swipedSet = useMemo(() => new Set(swipedIds), [swipedIds]);
  const queue = useMemo(
    () => deck.filter((s) => !swipedSet.has(s.restaurant.id)),
    [deck, swipedSet],
  );
  const top = queue[0];
  const next = queue[1];

  // Announced to screen readers after each decision (no visual change).
  const [announcement, setAnnouncement] = useState("");

  const handleDecide = useCallback(
    (direction: SwipeDirection) => {
      if (!top) return;
      const verb = direction === "right" ? "Saved" : "Skipped";
      const upcoming = next
        ? `Now showing ${next.restaurant.name}.`
        : "That was the last spot.";
      setAnnouncement(`${verb} ${top.restaurant.name}. ${upcoming}`);
      onSwipe(top.restaurant.id, direction);
    },
    [onSwipe, top, next],
  );

  // Desktop affordance: arrow keys swipe.
  useEffect(() => {
    if (!top) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") cardRef.current?.swipe("left");
      else if (e.key === "ArrowRight") cardRef.current?.swipe("right");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [top]);

  if (!top) {
    return (
      <EmptyState savedCount={savedCount} onReset={onReset} total={deck.length} />
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Screen-reader feedback + usage hint */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <p id="swipe-hint" className="sr-only">
        Swipe or drag cards left to skip, right to save. You can also use the Skip
        and Save buttons, or the Left and Right arrow keys.
      </p>

      {/* Deck area */}
      <div
        role="group"
        aria-label="Restaurant swipe deck"
        aria-describedby="swipe-hint"
        className="relative min-h-0 flex-1"
      >
        {next && (
          // Rendered before the top card so it paints underneath (no z-index needed).
          // inert + aria-hidden keep its links out of the tab order / a11y tree.
          <div
            aria-hidden
            inert
            className="pointer-events-none absolute inset-0 scale-[0.94] translate-y-3 opacity-50"
          >
            <RestaurantCard scored={next} interactive={false} />
          </div>
        )}
        <SwipeCard
          ref={cardRef}
          key={top.restaurant.id}
          scored={top}
          onDecide={handleDecide}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

interface SwipeCardHandle {
  swipe: (direction: SwipeDirection) => void;
}

interface SwipeCardProps {
  scored: ScoredRestaurant;
  onDecide: (direction: SwipeDirection) => void;
}

const SwipeCard = forwardRef<SwipeCardHandle, SwipeCardProps>(
  function SwipeCard({ scored, onDecide }, ref) {
    const x = useMotionValue(0);
    const controls = useAnimationControls();
    const decided = useRef(false);

    // Rotate is derived from x (single source of truth). The range extends to
    // ±720 so the fling-off in leave() actually reaches its full tilt rather
    // than being clamped — no separate `rotate` keyframe needed on the controls.
    const rotate = useTransform(
      x,
      [-720, -300, 0, 300, 720],
      [-22, -14, 0, 14, 22],
    );
    const saveOpacity = useTransform(x, [40, 140], [0, 1]);
    const skipOpacity = useTransform(x, [-140, -40], [1, 0]);

    // Entrance: rise + scale into place (from the `initial` state on the div).
    useEffect(() => {
      controls.start({
        scale: 1,
        y: 0,
        opacity: 1,
        transition: { type: "spring", stiffness: 300, damping: 26 },
      });
    }, [controls]);

    const leave = useCallback(
      async (direction: SwipeDirection) => {
        if (decided.current) return;
        decided.current = true;
        await controls.start({
          x: direction === "right" ? 720 : -720,
          opacity: 0,
          transition: { duration: 0.32, ease: [0.4, 0, 1, 1] },
        });
        onDecide(direction);
      },
      [controls, onDecide],
    );

    useImperativeHandle(ref, () => ({ swipe: leave }), [leave]);

    return (
      <motion.div
        className="absolute inset-0 cursor-grab touch-pan-y will-change-transform active:cursor-grabbing"
        style={{ x, rotate }}
        initial={{ scale: 0.96, y: 14, opacity: 0 }}
        animate={controls}
        drag="x"
        dragElastic={0.55}
        dragSnapToOrigin={false}
        whileTap={{ scale: 0.99 }}
        onDragEnd={(_, info) => {
          const T = 110;
          if (info.offset.x > T || info.velocity.x > 650) leave("right");
          else if (info.offset.x < -T || info.velocity.x < -650) leave("left");
          // Not past threshold: spring back to center (rotate follows x).
          else
            controls.start({
              x: 0,
              transition: { type: "spring", stiffness: 380, damping: 30 },
            });
        }}
      >
        {/* Decision stamps — each sits on the side the card flies toward. */}
        <motion.div
          aria-hidden
          style={{ opacity: saveOpacity }}
          className="pointer-events-none absolute right-5 top-6 z-20 rotate-12 rounded-xl border-4 border-mint px-3 py-1 font-display text-3xl font-extrabold tracking-wider text-mint"
        >
          SAVE
        </motion.div>
        <motion.div
          aria-hidden
          style={{ opacity: skipOpacity }}
          className="pointer-events-none absolute left-5 top-6 z-20 -rotate-12 rounded-xl border-4 border-coral px-3 py-1 font-display text-3xl font-extrabold tracking-wider text-coral"
        >
          SKIP
        </motion.div>

        <RestaurantCard scored={scored} onSave={() => leave("right")} />
      </motion.div>
    );
  },
);

/* -------------------------------------------------------------------------- */

function EmptyState({
  savedCount,
  onReset,
  total,
}: {
  savedCount: number;
  onReset: () => void;
  total: number;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="text-6xl">🎉</div>
      <div>
        <h2 className="font-display text-2xl font-bold text-cream">
          You&apos;re all caught up
        </h2>
        <p className="mt-1 text-sm text-haze">
          You went through all {total} spots near you
          {savedCount > 0 ? ` and saved ${savedCount}.` : "."}
        </p>
      </div>
      <div className="flex flex-col items-stretch gap-3">
        {savedCount > 0 && (
          <Link
            href="/saved"
            className="rounded-full bg-brand-gradient px-6 py-3 text-center font-semibold text-ink shadow-lg shadow-coral/20"
          >
            View {savedCount} saved {savedCount === 1 ? "spot" : "spots"}{" "}
            <span aria-hidden>→</span>
          </Link>
        )}
        <button
          type="button"
          onClick={onReset}
          className="rounded-full border border-white/15 px-6 py-3 font-semibold text-cream transition hover:bg-white/5"
        >
          <span aria-hidden>↺</span> Start over
        </button>
      </div>
    </div>
  );
}
