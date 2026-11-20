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
  heroMediaImageUrl,
  normalizeClientHeroMedia,
  type ClientHeroMedia,
} from "@/lib/clientHeroMedia";
import {
  motion,
  useAnimationControls,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
} from "framer-motion";
import type { ScoredRestaurant, SwipeDirection } from "@/lib/types";
import { getMarketShortName } from "@/lib/markets";
import { createHeroImagePrewarmer, prewarmDiscardsPhoto } from "@/lib/heroImagePrewarm";
import RestaurantCard from "@/components/RestaurantCard";
import RestaurantProfileView from "@/components/RestaurantProfileView";
import MaterialIcon from "@/components/MaterialIcon";
import {
  captureFoodSwipeEvent,
  restaurantAnalyticsContext,
} from "@/lib/analytics";

const HERO_HANDOFF_MAX_WAIT_MS = 350;

interface OutgoingSwipe {
  card: ScoredRestaurant;
  nextCard: ScoredRestaurant | undefined;
}

interface SwipeDeckProps {
  /** Full ranked list. */
  deck: ScoredRestaurant[];
  /** Changes only when the user explicitly starts the deck over. */
  deckCycle: number;
  /** Ids already swiped — filtered out of the live queue. */
  swipedIds: string[];
  onSwipe: (restaurantId: string, direction: SwipeDirection) => Promise<boolean>;
  /** Live count of saved restaurants, shown on the empty state. */
  savedCount: number;
  /** Clear discovery history for the active market. */
  onReset: () => void;
}

export default function SwipeDeck({
  deck,
  deckCycle,
  swipedIds,
  onSwipe,
  savedCount,
  onReset,
}: SwipeDeckProps) {
  const cardRef = useRef<SwipeCardHandle>(null);
  const impressionCycleRef = useRef(deckCycle);
  const impressedRestaurantIdsRef = useRef(new Set<string>());

  // The live queue is the deck minus anything already swiped. Recording a swipe
  // drops the top card, so queue[0] is always the current card — no index drift.
  const swipedSet = useMemo(() => new Set(swipedIds), [swipedIds]);
  const queue = useMemo(
    () => deck.filter((s) => !swipedSet.has(s.restaurant.id)),
    [deck, swipedSet],
  );
  const [outgoingSwipe, setOutgoingSwipe] = useState<OutgoingSwipe | null>(null);
  const top = outgoingSwipe ? outgoingSwipe.card : queue[0];
  const next = outgoingSwipe ? outgoingSwipe.nextCard : queue[1];
  const topId = top?.restaurant.id ?? null;
  const nextId = next?.restaurant.id ?? null;

  const [announcement, setAnnouncement] = useState("");
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const reducedMotion = useReducedMotion() ?? false;
  const outgoingSwipeRef = useRef<OutgoingSwipe | null>(null);
  const [heroMediaById, setHeroMediaById] = useState<Record<string, ClientHeroMedia | null>>({});
  const neededHeroIdsRef = useRef(new Set<string>());
  const heroMediaRef = useRef(new Map<string, ClientHeroMedia | null>());
  const heroFetchControllersRef = useRef(new Map<string, AbortController>());
  const heroPreparePromisesRef = useRef(new Map<string, Promise<void>>());
  const [prewarmer] = useState(() =>
    createHeroImagePrewarmer({
      createImage: () => new window.Image(),
      setTimeout: (callback, ms) => window.setTimeout(callback, ms),
      clearTimeout: (id) => window.clearTimeout(id),
    }),
  );
  const isAdvancing = outgoingSwipe !== null;

  useEffect(() => {
    if (impressionCycleRef.current === deckCycle) return;
    impressionCycleRef.current = deckCycle;
    impressedRestaurantIdsRef.current.clear();
  }, [deckCycle]);

  useEffect(() => {
    if (!top || impressedRestaurantIdsRef.current.has(top.restaurant.id)) return;
    impressedRestaurantIdsRef.current.add(top.restaurant.id);
    const feedPosition = deck.findIndex(
      (item) => item.restaurant.id === top.restaurant.id,
    );
    if (feedPosition < 0) return;
    captureFoodSwipeEvent("restaurant_impression", {
      ...restaurantAnalyticsContext(top.restaurant, "feed", feedPosition + 1),
      feedPosition: feedPosition + 1,
    });
  }, [deck, deckCycle, top]);

  const setTransition = useCallback((transition: OutgoingSwipe | null) => {
    outgoingSwipeRef.current = transition;
    setOutgoingSwipe(transition);
  }, []);

  const publishHeroMedia = useCallback(
    (restaurantId: string, media: ClientHeroMedia | null) => {
      const keep = neededHeroIdsRef.current;
      if (!keep.has(restaurantId)) return;
      heroMediaRef.current.set(restaurantId, media);
      setHeroMediaById((prev) => {
        const nextState: Record<string, ClientHeroMedia | null> = {};
        let changed = prev[restaurantId] !== media;
        for (const id of keep) {
          if (id === restaurantId) {
            nextState[id] = media;
          } else if (Object.prototype.hasOwnProperty.call(prev, id)) {
            nextState[id] = prev[id];
          }
        }
        for (const id of Object.keys(prev)) {
          if (!keep.has(id)) changed = true;
        }
        return changed ? nextState : prev;
      });
    },
    [],
  );

  const prepareHeroMedia = useCallback(
    (restaurantId: string): Promise<void> => {
      if (heroMediaRef.current.has(restaurantId)) {
        const cached = heroMediaRef.current.get(restaurantId) ?? null;
        const cachedUrl = heroMediaImageUrl(cached);
        return cachedUrl
          ? prewarmer.prewarm(restaurantId, cachedUrl).then((status) => {
              if (prewarmDiscardsPhoto(status) && cached) {
                publishHeroMedia(restaurantId, withoutFailedHeroUrl(cached));
              }
            })
          : Promise.resolve();
      }

      const existing = heroPreparePromisesRef.current.get(restaurantId);
      if (existing) return existing;

      const controller = new AbortController();
      heroFetchControllersRef.current.set(restaurantId, controller);

      const promise = (async () => {
        try {
          const res = await fetch(`/api/restaurants/${restaurantId}/photo`, {
            signal: controller.signal,
          });
          const data: unknown = res.ok ? await res.json() : { status: `http-${res.status}` };
          const media = normalizeClientHeroMedia(restaurantId, data);
          if (!neededHeroIdsRef.current.has(restaurantId)) return;

          publishHeroMedia(restaurantId, media);

          let displayMedia = media;
          for (let attempt = 0; attempt < 2; attempt++) {
            const url = heroMediaImageUrl(displayMedia);
            if (!url) break;
            const status = await prewarmer.prewarm(restaurantId, url);
            // Only a genuine load error discards the photo. A slow one keeps loading and
            // the hero shows the logo until it arrives.
            if (!prewarmDiscardsPhoto(status)) break;
            displayMedia = withoutFailedHeroUrl(displayMedia);
            publishHeroMedia(restaurantId, displayMedia);
          }
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") return;
          publishHeroMedia(restaurantId, {
            restaurantId,
            photo: null,
            logoUrl: null,
            status: "error",
          });
        } finally {
          heroFetchControllersRef.current.delete(restaurantId);
          heroPreparePromisesRef.current.delete(restaurantId);
        }
      })();

      heroPreparePromisesRef.current.set(restaurantId, promise);
      return promise;
    },
    [prewarmer, publishHeroMedia],
  );

  const waitForHeroReady = useCallback(
    async (restaurantId: string | null) => {
      if (!restaurantId) return;
      await Promise.race([
        prepareHeroMedia(restaurantId),
        new Promise<void>((resolve) => window.setTimeout(resolve, HERO_HANDOFF_MAX_WAIT_MS)),
      ]);
    },
    [prepareHeroMedia],
  );

  useEffect(() => {
    const keep = new Set<string>();
    if (topId) keep.add(topId);
    if (nextId) keep.add(nextId);
    neededHeroIdsRef.current = keep;

    for (const id of keep) void prepareHeroMedia(id);

    for (const [id, controller] of heroFetchControllersRef.current) {
      if (!keep.has(id)) {
        controller.abort();
        heroFetchControllersRef.current.delete(id);
      }
    }

    for (const id of heroMediaRef.current.keys()) {
      if (!keep.has(id)) heroMediaRef.current.delete(id);
    }

    prewarmer.retainOnly(keep);
  }, [nextId, prepareHeroMedia, prewarmer, topId]);

  useEffect(() => {
    const controllers = heroFetchControllersRef.current;
    const preparePromises = heroPreparePromisesRef.current;
    return () => {
      for (const controller of controllers.values()) {
        controller.abort();
      }
      controllers.clear();
      preparePromises.clear();
      prewarmer.clear();
    };
  }, [prewarmer]);

  const handleSwipeAccepted = useCallback(
    (restaurantId: string, direction: SwipeDirection) => {
      if (!top || top.restaurant.id !== restaurantId || outgoingSwipeRef.current) {
        return null;
      }
      const transition: OutgoingSwipe = { card: top, nextCard: next };
      setTransition(transition);
      // Persist the accepted gesture even if navigation interrupts the animation.
      // Keep the outgoing card rendered until the animation and media handoff finish.
      const committed = onSwipe(restaurantId, direction);
      // The caller reports failures. Marking it handled keeps a rejection during the
      // animation from surfacing as an unhandled promise rejection.
      committed.catch(() => undefined);
      if (next) void prepareHeroMedia(next.restaurant.id);
      return async () => {
        try {
          await waitForHeroReady(next?.restaurant.id ?? null);
          if (await committed) {
            const verb = direction === "right" ? "Saved" : "Passed";
            setAnnouncement(`${verb} ${top.restaurant.name}.`);
            // A brief visual confirmation for both decisions (the live region above announces them).
            setSavedNotice(`${top.restaurant.name} ${direction === "right" ? "saved" : "passed"}`);
          }
        } catch (error) {
          console.error("Finishing the swipe failed.", error);
        } finally {
          // Whatever happened, the deck must never stay mid-transition.
          setTransition(null);
        }
      };
    },
    [next, onSwipe, prepareHeroMedia, setTransition, top, waitForHeroReady],
  );

  const topHeroMedia = top ? heroMediaById[top.restaurant.id] ?? null : null;
  const nextHeroMedia = next ? heroMediaById[next.restaurant.id] ?? null : null;

  // The save confirmation clears itself.
  useEffect(() => {
    if (!savedNotice) return;
    const timer = window.setTimeout(() => setSavedNotice(null), 2200);
    return () => window.clearTimeout(timer);
  }, [savedNotice]);

  // Desktop affordance: arrow keys save/skip the current card.
  useEffect(() => {
    if (!top || isAdvancing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") cardRef.current?.swipe("left");
      else if (e.key === "ArrowRight") cardRef.current?.swipe("right");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isAdvancing, top]);

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* Screen-reader feedback + usage hint */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {top ? (
        <>
          <p id="swipe-hint" className="sr-only">
            Scroll down through each restaurant&apos;s profile. Swipe or drag left to
            pass, right to save. You can also use the Pass and Save buttons, or the Left
            and Right arrow keys. Tap the photo, or use the photo buttons, to see more photos.
          </p>

          {/* Deck area */}
          <div
            role="group"
            aria-label="Restaurant swipe deck"
            aria-describedby="swipe-hint"
            className="swipe-stage isolate relative min-h-0 flex-1 overflow-hidden bg-ink-2"
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 z-0 bg-ink-2"
            />
            {next && (
              // Lightweight peek behind the top card (no profile body / no video fetch).
              // Explicit z-index keeps the stack to: backplate -> one peek -> active.
              <motion.div
                aria-hidden
                inert
                className="pointer-events-none absolute inset-0 z-10"
                initial={false}
                animate={{ scale: 0.955, y: 10, opacity: 1 }}
                transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 30 }}
              >
                <RestaurantCard scored={next} heroMedia={nextHeroMedia} />
              </motion.div>
            )}
            <SwipeCard
              ref={cardRef}
              key={top.restaurant.id}
              scored={top}
              heroMedia={topHeroMedia}
              isAdvancing={isAdvancing}
              onSwipeAccepted={handleSwipeAccepted}
              reducedMotion={reducedMotion}
            />
            {savedNotice && (
              <p aria-hidden className="swipe-toast">{savedNotice}</p>
            )}
          </div>
        </>
      ) : (
        <EmptyState savedCount={savedCount} onReset={onReset} total={deck.length} />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function withoutFailedHeroUrl(media: ClientHeroMedia): ClientHeroMedia {
  if (media.photo) return { ...media, photo: null };
  if (media.logoUrl) return { ...media, logoUrl: null };
  return media;
}

/* -------------------------------------------------------------------------- */

interface SwipeCardHandle {
  swipe: (direction: SwipeDirection) => void;
}

interface SwipeCardProps {
  scored: ScoredRestaurant;
  heroMedia: ClientHeroMedia | null;
  isAdvancing: boolean;
  onSwipeAccepted: (restaurantId: string, direction: SwipeDirection) => (() => Promise<void>) | null;
  reducedMotion: boolean;
}

/**
 * The active feed card — a scrollable restaurant profile. The motion wrapper handles
 * horizontal pass/save drags. The browser handles vertical scrolling and pinch zoom,
 * including inside the drag surface where Motion sets an inline touch action. The hero
 * fades via `useScroll` on the card's own scroll container. The first scroll viewport is
 * the full-bleed photo and its credit; the profile begins below it. The Pass / Full
 * profile / Save dock stays on screen while the profile scrolls.
 */
const SwipeCard = forwardRef<SwipeCardHandle, SwipeCardProps>(
  function SwipeCard(
    { scored, heroMedia, isAdvancing, onSwipeAccepted, reducedMotion },
    ref,
  ) {
    const r = scored.restaurant;

    const x = useMotionValue(0);
    const controls = useAnimationControls();
    const decided = useRef(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [copied, setCopied] = useState(false);
    const [scrolled, setScrolled] = useState(false);

    const rotate = useTransform(x, [-720, -300, 0, 300, 720], [-18, -10, 0, 10, 18]);
    const saveOpacity = useTransform(x, [32, 132], [0, 1]);
    const skipOpacity = useTransform(x, [-132, -32], [1, 0]);

    // Scroll-linked hero fade — tracks this card's own scroll container.
    const { scrollY } = useScroll({ container: scrollRef });
    const heroProgress = useTransform(scrollY, (latest) => {
      const viewportHeight = scrollRef.current?.clientHeight ?? 640;
      return Math.min(1, latest / (viewportHeight * 0.7));
    });
    const heroOpacity = useTransform(heroProgress, [0, 1], [1, 0]);
    const heroScale = useTransform(heroProgress, [0, 1], [1, 1.05]);
    // "Full profile" is only a hint until the profile is on screen.
    useMotionValueEvent(scrollY, "change", (latest) => setScrolled(latest > 48));

    // Entrance: rise + scale into place.
    useEffect(() => {
      controls.start({
        scale: 1,
        y: 0,
        opacity: 1,
        transition: reducedMotion
          ? { duration: 0 }
          : { type: "spring", stiffness: 330, damping: 28, mass: 0.9 },
      });
    }, [controls, reducedMotion]);

    useEffect(() => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTop = 0;
    }, [r.id]);

    const leave = useCallback(
      async (direction: SwipeDirection) => {
        if (decided.current || isAdvancing) return;
        const finishSwipe = onSwipeAccepted(r.id, direction);
        if (!finishSwipe) return;
        decided.current = true;
        try {
          await controls.start({
            x: direction === "right" ? 720 : -720,
            y: -18,
            scale: 0.96,
            transition: { duration: reducedMotion ? 0 : 0.34, ease: [0.22, 1, 0.36, 1] },
          });
        } finally {
          await finishSwipe();
        }
      },
      [controls, isAdvancing, onSwipeAccepted, r.id, reducedMotion],
    );

    useImperativeHandle(ref, () => ({ swipe: leave }), [leave]);

    const scrollToProfile = useCallback(() => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTo({ top: el.clientHeight, behavior: reducedMotion ? "auto" : "smooth" });
    }, [reducedMotion]);

    async function shareProfile() {
      if (typeof window === "undefined") return;
      const url = `${window.location.origin}/restaurants/${r.id}`;
      try {
        if (typeof navigator !== "undefined" && navigator.share) {
          await navigator.share({ title: r.name, text: `${r.name} — ${r.neighborhood}, ${getMarketShortName(r.market)}`, url });
          captureFoodSwipeEvent("restaurant_shared", {
            ...restaurantAnalyticsContext(r, "feed"),
            method: "native",
          });
          return;
        }
      } catch {
        return; // user dismissed the native share sheet
      }
      try {
        await navigator.clipboard.writeText(url);
        captureFoodSwipeEvent("restaurant_shared", {
          ...restaurantAnalyticsContext(r, "feed"),
          method: "clipboard",
        });
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      } catch {
        // clipboard blocked — nothing else to do
      }
    }

    return (
      <motion.div
        className={`swipe-card absolute inset-0 z-20 cursor-grab [touch-action:pan-y_pinch-zoom]! overflow-hidden bg-ink-2 will-change-transform active:cursor-grabbing ${
          isAdvancing ? "pointer-events-none" : ""
        }`}
        style={{ x, rotate: reducedMotion ? 0 : rotate }}
        initial={reducedMotion ? false : { scale: 0.98, y: 10, opacity: 1 }}
        animate={controls}
        drag={isAdvancing ? false : "x"}
        dragElastic={0.42}
        dragMomentum={false}
        dragSnapToOrigin={false}
        onDragEnd={(_, info) => {
          if (isAdvancing) return;
          // Slightly higher than the old threshold so a diagonal scroll-flick
          // doesn't accidentally save/skip while reading the profile.
          const T = 130;
          if (info.offset.x > T || info.velocity.x > 650) leave("right");
          else if (info.offset.x < -T || info.velocity.x < -650) leave("left");
          else
            controls.start({
              x: 0,
              y: 0,
              scale: 1,
              transition: reducedMotion
                ? { duration: 0 }
                : { type: "spring", stiffness: 420, damping: 34, mass: 0.85 },
            });
        }}
      >
        {/* Vertical scroll container — the profile body + the scroll source.
            Allow browser pinch zoom alongside vertical scrolling. */}
        <div
          ref={scrollRef}
          className="no-scrollbar h-full min-h-0 overflow-y-auto overscroll-contain [overflow-anchor:none] [touch-action:pan-y_pinch-zoom]"
        >
          <RestaurantProfileView
            restaurant={r}
            variant="feed"
            feedHeroFullscreen
            heroStyle={reducedMotion ? undefined : { opacity: heroOpacity, scale: heroScale }}
            heroMedia={heroMedia}
          />
        </div>

        {/* Top scrim for control legibility over the hero */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-gradient-to-b from-[#101a16]/80 to-transparent" />

        {/* Persistent action — Share. Sits below the feed top bar so it never overlaps it. */}
        <div
          className="swipe-share absolute z-20"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <ActionButton label={copied ? "Copied" : "Share"} onClick={shareProfile}>
            <MaterialIcon name={copied ? "check" : "share"} className="text-2xl" />
          </ActionButton>
        </div>

        {/* Decision dock: explicit alternatives to the horizontal drag. */}
        <div className="swipe-dock" data-scrolled={scrolled || undefined} onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" className="swipe-decision" disabled={isAdvancing}
            onClick={() => void leave("left")}>
            <MaterialIcon name="close" /> Pass
          </button>
          <button type="button" className="swipe-profile-link" data-hidden={scrolled || undefined}
            disabled={isAdvancing || scrolled} tabIndex={scrolled ? -1 : undefined}
            aria-label={`Full profile for ${r.name}`} onClick={scrollToProfile}>
            <MaterialIcon name="keyboard_arrow_up" />
            <span>Full profile</span>
          </button>
          <button type="button" className="swipe-decision swipe-decision-save" disabled={isAdvancing}
            onClick={() => void leave("right")}>
            <MaterialIcon name="bookmark" /> Save
          </button>
        </div>

        {/* Decision stamps */}
        <motion.div
          aria-hidden
          style={{ opacity: saveOpacity }}
          className="swipe-stamp swipe-stamp-save pointer-events-none absolute right-5 top-28 z-30 rotate-6 font-display"
        >
          SAVE
        </motion.div>
        <motion.div
          aria-hidden
          style={{ opacity: skipOpacity }}
          className="swipe-stamp swipe-stamp-pass pointer-events-none absolute left-5 top-28 z-30 -rotate-6 font-display"
        >
          PASS
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
      className="swipe-share-button flex items-center justify-center transition active:scale-90"
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
          You went through all {total} spots in this market.
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
