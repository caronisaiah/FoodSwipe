"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { SavedRestaurant } from "@/lib/types";
import { useFavorites } from "@/lib/storage";
import type { FavoriteRemoval } from "@/lib/discoveryState";
import EditorialHeader from "@/components/editorial/EditorialHeader";
import SavedRestaurantItem from "@/components/editorial/SavedRestaurantItem";
import MaterialIcon from "@/components/MaterialIcon";
import { captureFoodSwipeEvent, restaurantAnalyticsContext } from "@/lib/analytics";

const SAVED_BATCH_SIZE = 25;

async function loadSavedBatch(savedIds: string[], signal: AbortSignal) {
  // Malformed legacy IDs stay in favorites and appear as unavailable.
  const ids = savedIds.filter((id) => id.length > 0 && id.length <= 256 && !id.includes("\0"));
  const restaurants = new Map<string, SavedRestaurant | null>(savedIds.map((id) => [id, null]));
  if (!ids.length) return restaurants;
  const query = new URLSearchParams(ids.map((id) => ["id", id]));
  const response = await fetch(`/api/restaurants/saved?${query}`, { signal });
  if (!response.ok) throw new Error("Saved details couldn’t load.");
  const data = await response.json() as { restaurants?: SavedRestaurant[] };
  if (!Array.isArray(data.restaurants)) throw new Error("Missing saved restaurant details.");
  for (const restaurant of data.restaurants) {
    if (ids.includes(restaurant.id)) restaurants.set(restaurant.id, restaurant);
  }
  return restaurants;
}

type Removal = { receipt: FavoriteRemoval; id: string; name: string };
type Notice = { text: string; undo?: Removal };
type FocusRequest = { target: "undo" | "heading" } | { target: "record"; id: string };

function stillHasActionFocus(button: HTMLButtonElement) {
  return document.activeElement === button || document.activeElement === document.body;
}

export default function SavedClient() {
  const { status, favorites, removeFavorite, undoRemoveFavorite, retry: retryStorage } = useFavorites();
  const reduceMotion = useReducedMotion() ?? false;
  const [catalogue, setCatalogue] = useState(new Map<string, SavedRestaurant | null>());
  const [failedRequest, setFailedRequest] = useState<string>();
  const [notice, setNotice] = useState<Notice>();
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const page = useRef<HTMLDivElement>(null);
  const navigation = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusRequest = useRef<FocusRequest>(null);

  useEffect(() => {
    const container = page.current;
    const rail = navigation.current;
    if (!container || !rail) return;
    const observer = new ResizeObserver(() => {
      container.style.setProperty("--saved-footer-height", `${rail.offsetHeight}px`);
    });
    observer.observe(rail);
    return () => observer.disconnect();
  }, []);

  // The store can replace favorite objects when only discovery history changed.
  const request = JSON.stringify(favorites.filter(({ restaurantId }) => !catalogue.has(restaurantId))
    .slice(0, SAVED_BATCH_SIZE)
    .map(({ restaurantId }) => restaurantId));
  const catalogueError = request !== "[]" && request === failedRequest;

  useEffect(() => {
    if (status !== "ready" || request === "[]" || request === failedRequest) return;
    const controller = new AbortController();
    void loadSavedBatch(JSON.parse(request) as string[], controller.signal).then(
      (restaurants) => {
        if (!controller.signal.aborted) setCatalogue((current) => new Map([...current, ...restaurants]));
      },
      () => {
        if (!controller.signal.aborted) setFailedRequest(request);
      },
    );
    return () => controller.abort();
  }, [failedRequest, request, status]);

  useEffect(() => {
    const focus = focusRequest.current;
    if (!focus) return;
    focusRequest.current = null;
    const target = focus.target === "undo" ? undoButton.current
      : focus.target === "record" ? removeButtons.current.get(focus.id) : heading.current;
    (target ?? heading.current)?.focus();
  }, [notice]);

  useEffect(() => {
    if (!notice || notice.undo) return;
    const timeout = window.setTimeout(() => setNotice(undefined), 3500);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  async function remove(id: string, restaurant: SavedRestaurant | null, button: HTMLButtonElement) {
    if (busy || status !== "ready") return;
    const focused = document.activeElement === button;
    const name = restaurant?.name ?? "unavailable restaurant";
    setBusy(true);
    setFeedback("");
    try {
      const receipt = await removeFavorite(id);
      if (!receipt) {
        if (focused && stillHasActionFocus(button)) heading.current?.focus();
        setFeedback("This restaurant was already removed from Saved.");
        return;
      }
      if (focused && stillHasActionFocus(button)) focusRequest.current = { target: "undo" };
      setNotice({ text: `Removed ${name} from Saved.`, undo: { receipt, name, id } });
      if (restaurant) captureFoodSwipeEvent("restaurant_unsaved", {
        ...restaurantAnalyticsContext(restaurant, "saved"),
        unsaveSource: "saved_list",
      });
    } catch {
      setFeedback(`Couldn’t remove ${name} from Saved.`);
    } finally {
      setBusy(false);
    }
  }

  async function restore(button: HTMLButtonElement) {
    const undo = notice?.undo;
    if (!undo || busy || status !== "ready") return;
    const focused = document.activeElement === button;
    setBusy(true);
    setFeedback("");
    try {
      const restored = await undoRemoveFavorite(undo.receipt);
      if (focused && stillHasActionFocus(button)) {
        focusRequest.current = restored ? { target: "record", id: undo.id } : { target: "heading" };
      }
      setNotice({ text: restored ? `Restored ${undo.name} to Saved.` : "That removal can no longer be undone." });
    } catch {
      setFeedback(`Couldn’t restore ${undo.name} to Saved.`);
    } finally {
      setBusy(false);
    }
  }

  const featuredIndex = favorites.findIndex(({ restaurantId }) => catalogue.get(restaurantId));
  const featured = favorites[featuredIndex];
  const ordered = featured ? [featured, ...favorites.filter((favorite) => favorite !== featured)] : favorites;
  const featureLabel = featured?.savedAt === null ? "Saved restaurant"
    : featuredIndex === 0 ? "Most recent save"
    : favorites.slice(0, featuredIndex).every(({ restaurantId }) => catalogue.get(restaurantId) === null)
      ? "Most recent available save" : "Available save";
  const shown = ordered.filter(({ restaurantId }) => catalogue.has(restaurantId));
  const count = favorites.length;

  const actionNotice = (notice || feedback) && (
    <motion.div className="saved-notice" initial={reduceMotion ? false : { opacity: 0.9, y: 4 }}
      animate={{ opacity: 1, y: 0 }} transition={{ duration: reduceMotion ? 0 : 0.15, ease: [0.22, 1, 0.36, 1] }}>
      <div>
        {notice && <p>{notice.text}</p>}
        {feedback && <p>{feedback}</p>}
      </div>
      {notice?.undo && <button ref={undoButton} type="button" aria-disabled={busy || status !== "ready" || undefined}
        onClick={(event) => void restore(event.currentTarget)}>Undo</button>}
    </motion.div>
  );

  return (
    <div ref={page} className="editorial-canvas saved-page">
      <EditorialHeader skipTo="saved-title" skipLabel="Skip to saved places" notice={actionNotice} navigationRef={navigation} />
      <main className="saved-layout">
        <header className="saved-header">
          <h1 id="saved-title" ref={heading} tabIndex={-1} className="editorial-page-title">Saved for later</h1>
          {(status === "ready" || count > 0) && <span>{count} {count === 1 ? "place" : "places"}</span>}
        </header>

        {status === "error" ? (
          <section className="saved-state">
            <h2 className="editorial-section-title">Couldn’t access favorites</h2>
            <p role="alert">Saved favorites couldn’t be read on this device.</p>
            <button type="button" className="editorial-action editorial-action-secondary" onClick={() => {
              heading.current?.focus();
              void retryStorage();
            }}>Retry device storage</button>
          </section>
        ) : catalogueError ? (
          <section className="saved-state">
            <h2 className="editorial-section-title">Restaurant details couldn’t load</h2>
            <p role="alert">Your favorites are still saved on this device.</p>
            <button type="button" className="editorial-action editorial-action-secondary" onClick={() => {
              heading.current?.focus();
              setFailedRequest(undefined);
            }}>Retry restaurant details</button>
          </section>
        ) : status === "loading" || request !== "[]" ? (
          <p className="saved-loading" role="status">{status === "loading" ? "Loading saved places…" : "Loading restaurant details…"}</p>
        ) : count === 0 ? (
          <section className="saved-state">
            <MaterialIcon name="bookmark_border" />
            <h2 className="editorial-section-title">No saved places yet</h2>
            <p>Save somewhere you’d like to try while you explore.</p>
            <Link className="editorial-action" href="/feed">Explore restaurants <MaterialIcon name="arrow_forward" /></Link>
          </section>
        ) : null}

        {shown.length > 0 && (
          <ul className="saved-list" aria-label="Saved restaurants">
            {shown.map(({ restaurantId }) => {
              const restaurant = catalogue.get(restaurantId) ?? null;
              return <SavedRestaurantItem
                key={restaurantId}
                id={restaurantId}
                restaurant={restaurant}
                featureLabel={featured?.restaurantId === restaurantId ? featureLabel : undefined}
                reduceMotion={reduceMotion}
                busy={busy || status !== "ready"}
                removeRef={(button) => {
                  if (button) removeButtons.current.set(restaurantId, button);
                  else removeButtons.current.delete(restaurantId);
                }}
                onRemove={(button) => void remove(restaurantId, restaurant, button)}
              />;
            })}
          </ul>
        )}
        <p className="sr-only" role="status">{feedback || notice?.text || ""}</p>
      </main>
    </div>
  );
}
