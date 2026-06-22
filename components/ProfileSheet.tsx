"use client";

import { useEffect, useRef } from "react";
import { motion, useDragControls } from "framer-motion";
import type { Restaurant } from "@/lib/types";
import RestaurantProfileView from "@/components/RestaurantProfileView";
import SaveButton from "@/components/SaveButton";
import MaterialIcon from "@/components/MaterialIcon";

/**
 * In-feed restaurant profile — a full-height bottom sheet overlay (Midnight Luxe).
 * The feed stays mounted behind it. Closes via the close button, backdrop tap,
 * Escape, or dragging the handle/header down. Content scrolls independently of
 * the drag-to-dismiss (drag is handle-driven via `useDragControls`, so scrolling
 * the body never dismisses the sheet). Rendered inside an `AnimatePresence` in
 * FeedClient so it animates in/out.
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

  // Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Move focus into the sheet on open.
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

      {/* Sheet panel */}
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={`${restaurant.name} profile`}
        className="absolute inset-x-0 bottom-0 mx-auto flex h-[94dvh] max-w-md flex-col overflow-hidden rounded-t-3xl bg-ink-2 ring-1 ring-white/10 shadow-2xl shadow-black/60"
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
        {/* Header — only this region initiates drag-to-dismiss */}
        <div
          className="shrink-0 cursor-grab touch-none bg-ink-2 active:cursor-grabbing"
          onPointerDown={(e) => dragControls.start(e)}
        >
          <div className="flex justify-center pt-2.5">
            <span className="h-1.5 w-12 rounded-full bg-white/25" aria-hidden />
          </div>
          <div className="flex items-center justify-between px-4 py-2">
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close profile"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-cream ring-1 ring-inset ring-white/15 transition hover:bg-white/20"
            >
              <MaterialIcon name="close" className="text-xl" />
            </button>
            <SaveButton restaurantId={restaurant.id} />
          </div>
        </div>

        {/* Scrollable content */}
        <div className="no-scrollbar flex-1 overflow-y-auto overscroll-contain pb-10">
          <RestaurantProfileView restaurant={restaurant} />
        </div>
      </motion.div>
    </div>
  );
}
