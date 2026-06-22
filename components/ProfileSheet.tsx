"use client";

import { useEffect, useRef } from "react";
import {
  motion,
  useDragControls,
  useScroll,
  useTransform,
} from "framer-motion";
import type { Restaurant } from "@/lib/types";
import RestaurantProfileView from "@/components/RestaurantProfileView";
import SaveButton from "@/components/SaveButton";
import MaterialIcon from "@/components/MaterialIcon";

/**
 * In-feed restaurant profile — a full-height, Hinge-style profile card. The feed
 * stays mounted behind it. The body scrolls vertically inside the card; as the
 * user scrolls down, the hero image gradually fades + lifts (scroll-linked, not
 * timed — so it reverses as they scroll back up). Controls float over the hero so
 * the hero reads as the top of a card, not a header bar over a popup.
 *
 * Closes via the close button, backdrop tap, Escape, or dragging the handle down.
 * Drag-to-dismiss is handle-only (`useDragControls` + `dragListener={false}`), so
 * it never competes with the body's vertical scroll.
 */
export default function ProfileSheet({
  restaurant,
  onClose,
}: {
  restaurant: Restaurant;
  onClose: () => void;
}) {
  const dragControls = useDragControls();
  const closeRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll-linked hero fade: tracks the card's own scroll container.
  const { scrollY } = useScroll({ container: scrollRef });
  const heroOpacity = useTransform(scrollY, [0, 320], [1, 0]);
  const heroScale = useTransform(scrollY, [0, 320], [1, 1.04]);

  // Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Move focus into the card on open.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-black/65 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        aria-hidden
      />

      {/* Card */}
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={`${restaurant.name} profile`}
        className="absolute inset-x-0 bottom-0 mx-auto h-[96dvh] max-w-md overflow-hidden rounded-t-3xl bg-ink-2 ring-1 ring-white/10 shadow-2xl shadow-black/60"
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
        drag="y"
        dragControls={dragControls}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.4 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 120 || info.velocity.y > 500) onClose();
        }}
      >
        {/* Scrollable card body — the scroll source for the hero fade */}
        <div
          ref={scrollRef}
          className="no-scrollbar h-full overflow-y-auto overscroll-contain pb-10"
        >
          <RestaurantProfileView
            restaurant={restaurant}
            heroStyle={{ opacity: heroOpacity, scale: heroScale }}
          />
        </div>

        {/* Floating controls over the hero (stay put while the hero scrolls/fades) */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20">
          <div
            className="pointer-events-none h-24 bg-gradient-to-b from-black/45 to-transparent"
            aria-hidden
          />
          {/* Drag handle — the only region that initiates drag-to-dismiss */}
          <div
            className="pointer-events-auto absolute left-1/2 top-0 flex h-10 w-24 -translate-x-1/2 cursor-grab touch-none items-start justify-center pt-2.5 active:cursor-grabbing"
            onPointerDown={(e) => dragControls.start(e)}
          >
            <span className="h-1.5 w-12 rounded-full bg-white/40" aria-hidden />
          </div>
          {/* Close */}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close profile"
            className="pointer-events-auto absolute left-4 top-3.5 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-cream ring-1 ring-inset ring-white/20 backdrop-blur-md transition hover:bg-black/60"
          >
            <MaterialIcon name="close" className="text-xl" />
          </button>
          {/* Save */}
          <div className="pointer-events-auto absolute right-4 top-3.5">
            <SaveButton restaurantId={restaurant.id} />
          </div>
        </div>
      </motion.div>
    </div>
  );
}
