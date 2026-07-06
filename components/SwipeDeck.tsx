"use client";

import Link from "next/link";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useMemo,
} from "react";
import {
  motion,
  useAnimationControls,
  useMotionValue,
  useScroll,
  useTransform,
} from "framer-motion";
import type { ScoredRestaurant, SwipeDirection } from "@/lib/types";
import { getMarketShortName } from "@/lib/markets";
import RestaurantCard from "@/components/RestaurantCard";
import RestaurantProfileView from "@/components/RestaurantProfileView";
import MaterialIcon from "@/components/MaterialIcon";

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

  // The live queue is the deck minus anything already swiped. Recording a swipe
  // drops the top card, so queue[0] is always the current card — no index drift.
  const swipedSet = useMemo(() => new Set(swipedIds), [swipedIds]);
  const queue = useMemo(
    () => deck.filter((s) => !swipedSet.has(s.restaurant.id)),
    [deck, swipedSet],
  );
  const top = queue[0];
  const next = queue[1];

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

  // Desktop affordance: arrow keys save/skip the current card.
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
    <div className="absolute inset-0 flex flex-col">
      {/* Screen-reader feedback + usage hint */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <p id="swipe-hint" className="sr-only">
        Scroll down through each restaurant&apos;s profile. Swipe or drag left to
        skip, right to save. You can also use the Left and Right arrow keys.
      </p>

      {/* Deck area */}
      <div
        role="group"
        aria-label="Restaurant swipe deck"
        aria-describedby="swipe-hint"
        className="relative min-h-0 flex-1"
      >
        {next && (
          // Lightweight peek behind the top card (no profile body / no video fetch).
          // Rendered before the top card so it paints underneath.
          <div
            aria-hidden
            inert
            className="pointer-events-none absolute inset-0 scale-[0.94] translate-y-3 opacity-50"
          >
            <RestaurantCard scored={next} />
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

/**
 * The active feed card — a Hinge-style scrollable restaurant profile. The
 * `motion.div` owns HORIZONTAL drag (save/skip); a native scroll container inside
 * owns VERTICAL scroll (the profile body). `touch-action: pan-y` on both lets the
 * browser route vertical pans to native scroll and horizontal pans to framer, so
 * they coexist without fighting. The hero fades on scroll via `useScroll` on the
 * card's own scroll container. The first scroll viewport is the hero card; the
 * profile body begins below it and appears only after a vertical scroll.
 */
const SwipeCard = forwardRef<SwipeCardHandle, SwipeCardProps>(
  function SwipeCard({ scored, onDecide }, ref) {
    const r = scored.restaurant;
    const trending = r.trendScore >= 75;
    const topChoice = r.vibeScore >= 90;

    const x = useMotionValue(0);
    const controls = useAnimationControls();
    const decided = useRef(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [copied, setCopied] = useState(false);

    const rotate = useTransform(x, [-720, -300, 0, 300, 720], [-22, -14, 0, 14, 22]);
    const saveOpacity = useTransform(x, [40, 140], [0, 1]);
    const skipOpacity = useTransform(x, [-140, -40], [1, 0]);

    // Scroll-linked hero fade — tracks this card's own scroll container.
    const { scrollY } = useScroll({ container: scrollRef });
    const heroOpacity = useTransform(scrollY, [0, 320], [1, 0]);
    const heroScale = useTransform(scrollY, [0, 320], [1, 1.04]);

    // Entrance: rise + scale into place.
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

    async function shareProfile() {
      if (typeof window === "undefined") return;
      const url = `${window.location.origin}/restaurants/${r.id}`;
      try {
        if (typeof navigator !== "undefined" && navigator.share) {
          await navigator.share({ title: r.name, text: `${r.name} — ${r.neighborhood}, ${getMarketShortName(r.market)}`, url });
          return;
        }
      } catch {
        return; // user dismissed the native share sheet
      }
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      } catch {
        // clipboard blocked — nothing else to do
      }
    }

    return (
      <motion.div
        className="absolute inset-0 cursor-grab touch-pan-y overflow-hidden rounded-[28px] bg-ink-2 ring-1 ring-white/10 shadow-2xl shadow-black/60 will-change-transform active:cursor-grabbing"
        style={{ x, rotate }}
        initial={{ scale: 0.96, y: 14, opacity: 0 }}
        animate={controls}
        drag="x"
        dragElastic={0.55}
        dragSnapToOrigin={false}
        whileTap={{ scale: 0.995 }}
        onDragEnd={(_, info) => {
          // Slightly higher than the old threshold so a diagonal scroll-flick
          // doesn't accidentally save/skip while reading the profile.
          const T = 130;
          if (info.offset.x > T || info.velocity.x > 650) leave("right");
          else if (info.offset.x < -T || info.velocity.x < -650) leave("left");
          else
            controls.start({
              x: 0,
              transition: { type: "spring", stiffness: 380, damping: 30 },
            });
        }}
      >
        {/* Vertical scroll container — the profile body + the scroll source.
            touch-action: pan-y keeps horizontal pans free for the card drag. */}
        <div
          ref={scrollRef}
          className="no-scrollbar h-full overflow-y-auto overscroll-contain pb-12 [touch-action:pan-y]"
        >
          <RestaurantProfileView
            restaurant={r}
            variant="feed"
            feedHeroFullscreen
            heroStyle={{ opacity: heroOpacity, scale: heroScale }}
          />
        </div>

        {/* Top scrim for control legibility over the hero */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-gradient-to-b from-black/45 to-transparent" />

        {/* Identity badges — fade out with the hero as you scroll */}
        <motion.div
          style={{ opacity: heroOpacity }}
          className="pointer-events-none absolute left-4 top-4 z-20 flex flex-col items-start gap-2"
        >
          {trending && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-chili/90 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-cream shadow-lg backdrop-blur-md">
              <MaterialIcon name="trending_up" className="text-[16px]" /> Trending in {getMarketShortName(r.market)}
            </span>
          )}
          {topChoice && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 text-xs font-semibold text-saffron ring-1 ring-saffron/30 backdrop-blur-md">
              <MaterialIcon name="stars" filled className="text-[16px]" /> Top Choice
            </span>
          )}
        </motion.div>

        {/* Persistent action — Share. (Save is the right-swipe; no redundant heart.)
            Sits below the feed top app bar so it never overlaps the notifications icon. */}
        <div
          className="absolute right-3 top-20 z-20"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <ActionButton label={copied ? "Copied" : "Share"} onClick={shareProfile}>
            <MaterialIcon name={copied ? "check" : "share"} className="text-2xl" />
          </ActionButton>
        </div>

        {/* Decision stamps */}
        <motion.div
          aria-hidden
          style={{ opacity: saveOpacity }}
          className="pointer-events-none absolute right-5 top-24 z-30 rotate-12 rounded-xl border-4 border-saffron px-3 py-1 font-display text-3xl font-extrabold tracking-wider text-saffron"
        >
          SAVE
        </motion.div>
        <motion.div
          aria-hidden
          style={{ opacity: skipOpacity }}
          className="pointer-events-none absolute left-5 top-24 z-30 -rotate-12 rounded-xl border-4 border-chili px-3 py-1 font-display text-3xl font-extrabold tracking-wider text-chili"
        >
          SKIP
        </motion.div>
      </motion.div>
    );
  },
);

/* -------------------------------------------------------------------------- */

function ActionButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-12 w-12 items-center justify-center rounded-full bg-black/40 text-cream ring-1 ring-white/20 backdrop-blur-md transition hover:bg-black/60 active:scale-90"
    >
      {children}
    </button>
  );
}

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
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-6 text-center">
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
            className="rounded-full bg-brand-gradient px-6 py-3 text-center font-semibold text-saffron-ink shadow-lg shadow-saffron/20"
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
