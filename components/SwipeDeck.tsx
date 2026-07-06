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
  useScroll,
  useTransform,
} from "framer-motion";
import type { ScoredRestaurant, SwipeDirection } from "@/lib/types";
import { getMarketShortName } from "@/lib/markets";
import RestaurantCard from "@/components/RestaurantCard";
import RestaurantProfileView from "@/components/RestaurantProfileView";
import MaterialIcon from "@/components/MaterialIcon";

const HERO_HANDOFF_MAX_WAIT_MS = 350;
const HERO_IMAGE_SETTLE_MAX_WAIT_MS = 5000;

type ImagePrewarmStatus = "ready" | "error";

interface OutgoingSwipe {
  restaurantId: string;
  restaurantName: string;
  direction: SwipeDirection;
  nextRestaurantId: string | null;
  nextRestaurantName: string | null;
}

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
  const topId = top?.restaurant.id ?? null;
  const nextId = next?.restaurant.id ?? null;

  const [announcement, setAnnouncement] = useState("");
  const [outgoingSwipe, setOutgoingSwipe] = useState<OutgoingSwipe | null>(null);
  const outgoingSwipeRef = useRef<OutgoingSwipe | null>(null);
  const [heroMediaById, setHeroMediaById] = useState<Record<string, ClientHeroMedia | null>>({});
  const neededHeroIdsRef = useRef(new Set<string>());
  const heroMediaRef = useRef(new Map<string, ClientHeroMedia | null>());
  const heroFetchControllersRef = useRef(new Map<string, AbortController>());
  const heroPreparePromisesRef = useRef(new Map<string, Promise<void>>());
  const imagePrewarmPromisesRef = useRef(new Map<string, Promise<ImagePrewarmStatus>>());
  const imagePrewarmStatusRef = useRef(new Map<string, ImagePrewarmStatus | "pending">());
  const isAdvancing = outgoingSwipe?.restaurantId === topId;

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

  const prewarmHeroImage = useCallback((restaurantId: string, url: string) => {
    const key = `${restaurantId}|${url}`;
    const known = imagePrewarmStatusRef.current.get(key);
    if (known === "ready" || known === "error") return Promise.resolve(known);

    const existing = imagePrewarmPromisesRef.current.get(key);
    if (existing) return existing;

    imagePrewarmStatusRef.current.set(key, "pending");
    const promise = new Promise<ImagePrewarmStatus>((resolve) => {
      if (typeof window === "undefined") {
        resolve("ready");
        return;
      }

      const img = new window.Image();
      let settled = false;
      const timeoutRef = { id: 0 };

      const settle = (status: ImagePrewarmStatus) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutRef.id);
        imagePrewarmStatusRef.current.set(key, status);
        resolve(status);
      };
      timeoutRef.id = window.setTimeout(() => settle("error"), HERO_IMAGE_SETTLE_MAX_WAIT_MS);

      img.onload = () => settle("ready");
      img.onerror = () => settle("error");
      img.referrerPolicy = "no-referrer";
      img.decoding = "async";
      img.src = url;

      if (typeof img.decode === "function") {
        img.decode()
          .then(() => settle("ready"))
          .catch(() => {
            if (img.complete) {
              settle(img.naturalWidth > 0 ? "ready" : "error");
            }
          });
      }
    });

    const tracked = promise.finally(() => {
      imagePrewarmPromisesRef.current.delete(key);
    });
    imagePrewarmPromisesRef.current.set(key, tracked);
    return tracked;
  }, []);

  const prepareHeroMedia = useCallback(
    (restaurantId: string): Promise<void> => {
      if (heroMediaRef.current.has(restaurantId)) {
        const cached = heroMediaRef.current.get(restaurantId) ?? null;
        const cachedUrl = heroMediaImageUrl(cached);
        return cachedUrl
          ? prewarmHeroImage(restaurantId, cachedUrl).then((status) => {
              if (status === "error" && cached) {
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
            const status = await prewarmHeroImage(restaurantId, url);
            if (status === "ready") break;
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
    [prewarmHeroImage, publishHeroMedia],
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

  const outgoingId = outgoingSwipe?.restaurantId ?? null;
  const outgoingNextId = outgoingSwipe?.nextRestaurantId ?? null;

  useEffect(() => {
    const keep = new Set<string>();
    if (topId) keep.add(topId);
    if (nextId) keep.add(nextId);
    if (outgoingId) keep.add(outgoingId);
    if (outgoingNextId) keep.add(outgoingNextId);
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

    for (const key of imagePrewarmStatusRef.current.keys()) {
      if (!keep.has(heroImageKeyRestaurantId(key))) {
        imagePrewarmStatusRef.current.delete(key);
      }
    }

    for (const key of imagePrewarmPromisesRef.current.keys()) {
      if (!keep.has(heroImageKeyRestaurantId(key))) {
        imagePrewarmPromisesRef.current.delete(key);
      }
    }

  }, [nextId, outgoingId, outgoingNextId, prepareHeroMedia, topId]);

  useEffect(() => {
    const controllers = heroFetchControllersRef.current;
    const preparePromises = heroPreparePromisesRef.current;
    const prewarmPromises = imagePrewarmPromisesRef.current;
    const prewarmStatus = imagePrewarmStatusRef.current;
    return () => {
      for (const controller of controllers.values()) {
        controller.abort();
      }
      controllers.clear();
      preparePromises.clear();
      prewarmPromises.clear();
      prewarmStatus.clear();
    };
  }, []);

  const handleSwipeAccepted = useCallback(
    (restaurantId: string, direction: SwipeDirection) => {
      if (outgoingSwipeRef.current?.restaurantId !== top?.restaurant.id) {
        outgoingSwipeRef.current = null;
      }
      if (!top || top.restaurant.id !== restaurantId || outgoingSwipeRef.current) {
        return false;
      }
      const transition: OutgoingSwipe = {
        restaurantId,
        restaurantName: top.restaurant.name,
        direction,
        nextRestaurantId: next?.restaurant.id ?? null,
        nextRestaurantName: next?.restaurant.name ?? null,
      };
      setTransition(transition);
      if (transition.nextRestaurantId) void prepareHeroMedia(transition.nextRestaurantId);
      return true;
    },
    [next, prepareHeroMedia, setTransition, top],
  );

  const handleCardLeftScreen = useCallback(
    (restaurantId: string, direction: SwipeDirection) => {
      const transition = outgoingSwipeRef.current;
      if (
        !transition ||
        transition.restaurantId !== restaurantId ||
        transition.direction !== direction
      ) {
        return;
      }

      void (async () => {
        await waitForHeroReady(transition.nextRestaurantId);
        const verb = direction === "right" ? "Saved" : "Skipped";
        const upcoming = transition.nextRestaurantName
          ? `Now showing ${transition.nextRestaurantName}.`
          : "That was the last spot.";
        setAnnouncement(`${verb} ${transition.restaurantName}. ${upcoming}`);
        onSwipe(restaurantId, direction);
        setTransition(null);
      })();
    },
    [onSwipe, setTransition, waitForHeroReady],
  );

  const topHeroMedia = top ? heroMediaById[top.restaurant.id] ?? null : null;
  const nextHeroMedia = next ? heroMediaById[next.restaurant.id] ?? null : null;

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
        className="isolate relative min-h-0 flex-1 overflow-hidden rounded-[28px] bg-ink-2"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 rounded-[28px] bg-ink-2"
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
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
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
          onCardLeftScreen={handleCardLeftScreen}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function heroImageKeyRestaurantId(key: string): string {
  const separator = key.indexOf("|");
  return separator === -1 ? key : key.slice(0, separator);
}

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
  onSwipeAccepted: (restaurantId: string, direction: SwipeDirection) => boolean;
  onCardLeftScreen: (restaurantId: string, direction: SwipeDirection) => void;
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
  function SwipeCard(
    { scored, heroMedia, isAdvancing, onSwipeAccepted, onCardLeftScreen },
    ref,
  ) {
    const r = scored.restaurant;

    const x = useMotionValue(0);
    const controls = useAnimationControls();
    const decided = useRef(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [copied, setCopied] = useState(false);

    const rotate = useTransform(x, [-720, -300, 0, 300, 720], [-18, -10, 0, 10, 18]);
    const saveOpacity = useTransform(x, [32, 132], [0, 1]);
    const skipOpacity = useTransform(x, [-132, -32], [1, 0]);

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
        transition: { type: "spring", stiffness: 330, damping: 28, mass: 0.9 },
      });
    }, [controls]);

    const leave = useCallback(
      async (direction: SwipeDirection) => {
        if (decided.current || isAdvancing) return;
        if (!onSwipeAccepted(r.id, direction)) return;
        decided.current = true;
        try {
          await controls.start({
            x: direction === "right" ? 720 : -720,
            y: -18,
            scale: 0.96,
            transition: { duration: 0.34, ease: [0.22, 1, 0.36, 1] },
          });
        } finally {
          onCardLeftScreen(r.id, direction);
        }
      },
      [controls, isAdvancing, onCardLeftScreen, onSwipeAccepted, r.id],
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
        className={`absolute inset-0 z-20 cursor-grab touch-pan-y overflow-hidden rounded-[28px] bg-ink-2 ring-1 ring-white/10 shadow-2xl shadow-black/60 will-change-transform active:cursor-grabbing ${
          isAdvancing ? "pointer-events-none" : ""
        }`}
        style={{ x, rotate }}
        initial={{ scale: 0.98, y: 10, opacity: 1 }}
        animate={controls}
        drag={isAdvancing ? false : "x"}
        dragElastic={0.42}
        dragMomentum={false}
        dragSnapToOrigin={false}
        whileTap={isAdvancing ? undefined : { scale: 0.995 }}
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
              transition: { type: "spring", stiffness: 420, damping: 34, mass: 0.85 },
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
            heroMedia={heroMedia}
          />
        </div>

        {/* Top scrim for control legibility over the hero */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-gradient-to-b from-black/45 to-transparent" />

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
