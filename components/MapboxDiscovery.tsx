"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import MaterialIcon from "@/components/MaterialIcon";
import BookmarkToggle from "@/components/BookmarkToggle";
import { loadMapbox, type MapboxMap } from "@/lib/mapboxClient";
import {
  collectionFor, directionsUrl, indexOrder, type MapFilter, type MapLocation,
} from "@/lib/mapLocations";
import { boundsOf, firstViewLocations, groupOverlaps, type Position } from "@/lib/mapFraming";
import { saveMapReturnState, takeMapReturnState } from "@/lib/mapReturnState";
import { getMarketOrigin, type Market } from "@/lib/markets";
import { useFavorites } from "@/lib/storage";
import { describeStorageFailure, type StorageNotice } from "@/lib/storageErrors";

type Phase = "loading" | "ready" | "error";
type Entry = { button: HTMLButtonElement; marker: { remove(): void } };

// Fork and knife, drawn here so a pin never depends on a font or an image loading.
const FORK_KNIFE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3v8M4.5 3v5a2.5 2.5 0 0 0 5 0V3M7 11v10M17 21V3c-2.2 1.4-3 4-3 7 0 2 1 3 3 3"/></svg>';

const PALETTE: Record<string, [string, string]> = {
  land: ["background-color", "#e9e0ce"], "land-structure-polygon": ["fill-color", "#e9e0ce"],
  "land-structure-line": ["line-color", "#e9e0ce"], waterway: ["line-color", "#adc9c7"], water: ["fill-color", "#adc9c7"],
  "road-label-simple": ["text-color", "#566052"], "water-line-label": ["text-color", "#304e50"],
  "water-point-label": ["text-color", "#304e50"], "national-park": ["fill-color", "#c5d1ad"], building: ["fill-color", "#dbd0bf"],
};

/** Editorial cartography on the verified Light v11 style. Only layers that exist are touched. */
function applyCartography(map: MapboxMap) {
  for (const [id, [property, value]] of Object.entries(PALETTE)) {
    if (map.getLayer(id)) map.setPaintProperty(id, property, value);
  }
  if (map.getLayer("landuse")) {
    map.setPaintProperty("landuse", "fill-color", ["match", ["get", "class"],
      ["park", "grass", "wood", "cemetery", "pitch"], "#c4d1ae", ["hospital", "school"], "#e0d5c6", "#e8decb"]);
  }
  for (const layer of map.getStyle().layers) {
    if (layer.type === "symbol" && /settlement|state-label|settlement-subdivision/.test(layer.id)) {
      map.setPaintProperty(layer.id, "text-color", "#415645");
      map.setPaintProperty(layer.id, "text-halo-color", "#fcf7e9");
    }
    if (["road-simple", "bridge-simple", "tunnel-simple"].includes(layer.id)) {
      map.setPaintProperty(layer.id, "line-color", ["match", ["get", "class"],
        ["motorway", "trunk"], "#b99a77", "primary", "#d3b697", "secondary", "#e1cbb0", "#fffdf7"]);
    }
    if (layer.id === "poi-label") map.setLayoutProperty(layer.id, "visibility", "none");
  }
}

export default function MapboxDiscovery({ token, market, marketName, locations }: {
  token: string;
  market: Market;
  marketName: string;
  locations: MapLocation[];
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const {
    status: favoritesStatus, error: favoritesError, favorites, retry: retryFavorites, saveFavorite, removeFavorite,
  } = useFavorites();
  const savedIds = useMemo(() => new Set(favorites.map(({ restaurantId }) => restaurantId)), [favorites]);

  const [phase, setPhase] = useState<Phase>("loading");
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<MapFilter>("all");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [inView, setInView] = useState(0);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<StorageNotice | null>(null);

  const collection = useMemo(() => collectionFor(filter, locations, savedIds), [filter, locations, savedIds]);
  const index = useMemo(() => indexOrder(collection), [collection]);
  const ordinals = useMemo(() => new Map(indexOrder(locations).map(({ slug }, i) => [slug, i + 1])), [locations]);
  // A preview belongs to the collection on screen: unsaving under "Saved only" closes it.
  const selected = collection.find(({ slug }) => slug === selectedSlug) ?? null;
  const credits = useMemo(() => [...new Map(locations.flatMap(({ notices }) => notices.map((n) => [n.label, n] as const))).values()], [locations]);

  const mapElement = useRef<HTMLDivElement>(null);
  const previewElement = useRef<HTMLElement>(null);
  const profileLink = useRef<HTMLAnchorElement>(null);
  const indexElement = useRef<HTMLDivElement>(null);
  const listButton = useRef<HTMLButtonElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markers = useRef(new Map<string, Entry>());
  const drawRef = useRef<() => void>(() => undefined);
  const fitRef = useRef<(rows: MapLocation[], animate?: boolean) => void>(() => undefined);
  const latest = useRef({ collection, selectedSlug: selected?.slug ?? null, locations });
  const pendingLocate = useRef<{ slug: string; source: "marker" | "index" } | null>(null);
  const pendingFocus = useRef<"profile" | null>(null);
  const reduce = useRef(reduceMotion);
  const inFlight = useRef(false);

  useEffect(() => {
    latest.current = { collection, selectedSlug: selected?.slug ?? null, locations };
    reduce.current = reduceMotion;
  });

  const select = useCallback((slug: string, source: "marker" | "index") => {
    pendingLocate.current = { slug, source };
    setSelectedSlug(slug);
    setActionError(null);
    setListOpen(false);
  }, []);
  const selectRef = useRef(select);
  useEffect(() => { selectRef.current = select; }, [select]);

  // The bottom navigation grows with text size; keep the page's bottom padding equal to its real height.
  useEffect(() => {
    const page = mapElement.current?.closest<HTMLElement>(".map-page");
    const nav = page?.querySelector<HTMLElement>(".foodswipe-nav");
    if (!page || !nav) return;
    const observer = new ResizeObserver(() => page.style.setProperty("--map-footer-height", `${nav.offsetHeight}px`));
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);

  /* ---------------------------------------------------------------- the map */
  useEffect(() => {
    const element = mapElement.current;
    if (!element) return;
    let disposed = false;
    let ready = false;
    let map: MapboxMap | undefined;
    let observer: ResizeObserver | undefined;
    const entries = markers.current;
    const timeout = window.setTimeout(fail, 20_000);

    function cleanup() {
      window.clearTimeout(timeout);
      observer?.disconnect();
      for (const { marker } of entries.values()) marker.remove();
      entries.clear();
      map?.remove();
      map = undefined;
      mapRef.current = null;
      drawRef.current = () => undefined;
      fitRef.current = () => undefined;
    }
    function fail() {
      if (disposed) return;
      disposed = true;
      cleanup();
      setSelectedSlug(null);
      setPhase("error");
    }

    void loadMapbox().then((mapbox) => {
      if (disposed) return;
      if (!mapbox.supported()) return fail();
      const origin = getMarketOrigin(market);
      const instance = new mapbox.Map({
        accessToken: token,
        container: element,
        style: "mapbox://styles/mapbox/light-v11",
        projection: "mercator",
        center: [origin.lng, origin.lat],
        zoom: 11,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        fadeDuration: reduce.current ? 0 : 140,
      });
      map = instance;
      mapRef.current = instance;
      instance.touchZoomRotate.disableRotation();

      const fitTo = (rows: MapLocation[], animate = true) => {
        const bounds = boundsOf(rows);
        if (!bounds || !ready) return;
        const { clientWidth, clientHeight } = element;
        instance.fitBounds(bounds, {
          padding: Math.round(Math.min(72, Math.max(40, clientWidth * 0.07), Math.max(28, clientHeight * 0.13))),
          duration: animate && !reduce.current ? 280 : 0,
          maxZoom: rows.length === 1 ? 15.8 : 17.5,
        });
      };
      fitRef.current = fitTo;

      const draw = () => {
        if (!ready || !element.clientWidth) return;
        const { collection: rows, selectedSlug: active } = latest.current;
        const points = rows.map((item) => ({ item, ...instance.project(item.position) }));
        const keys = new Set<string>();
        for (const group of groupOverlaps(points)) {
          const members = group.map(({ item }) => item).sort((a, b) => a.slug.localeCompare(b.slug));
          const solo = members.length === 1;
          const key = members.map(({ slug }) => slug).join("|");
          keys.add(key);
          let entry = entries.get(key);
          if (!entry) {
            const button = document.createElement("button");
            button.type = "button";
            button.setAttribute("role", "button");
            button.className = `map-pin${solo ? "" : " map-pin-group"}`;
            button.innerHTML = `<span class="map-pin-body">${solo ? FORK_KNIFE : members.length}</span>`;
            button.setAttribute("aria-label", solo ? members[0].name
              : `Zoom to ${members.length} restaurants: ${members.map(({ name }) => name).join(", ")}`);
            button.addEventListener("click", () => {
              if (solo) return selectRef.current(members[0].slug, "marker");
              fitTo(members);
              const focusMember = () => {
                const next = entries.get(members[0].slug)?.button
                  ?? document.querySelector<HTMLButtonElement>(`[data-map-row="${CSS.escape(members[0].slug)}"]`);
                next?.focus({ preventScroll: true });
              };
              if (reduce.current) requestAnimationFrame(focusMember);
              else instance.once("moveend", () => requestAnimationFrame(focusMember));
            });
            const center: Position = solo ? members[0].position
              : [0, 1].map((i) => members.reduce((sum, { position }) => sum + position[i], 0) / members.length) as Position;
            entry = { button, marker: new mapbox.Marker({ element: button, anchor: "center" }).setLngLat(center).addTo(instance) };
            entries.set(key, entry);
          }
          entry.button.classList.toggle("is-selected", members.some(({ slug }) => slug === active));
          if (solo) entry.button.setAttribute("aria-pressed", String(members[0].slug === active));
          const onscreen = group.some(({ x, y }) => x >= 0 && y >= 0 && x <= element.clientWidth && y <= element.clientHeight);
          entry.button.tabIndex = onscreen ? 0 : -1;
          entry.button.setAttribute("aria-hidden", String(!onscreen));
        }
        for (const [key, entry] of [...entries]) {
          if (!keys.has(key)) { entry.marker.remove(); entries.delete(key); }
        }
        setInView(points.filter(({ x, y }) => x >= 0 && y >= 0 && x <= element.clientWidth && y <= element.clientHeight).length);
      };
      drawRef.current = draw;

      let lastHeight = element.clientHeight;
      observer = new ResizeObserver(() => {
        if (!element.clientWidth) return;
        instance.resize();
        // Opening or closing the preview changes the map's height. Mapbox would keep the camera
        // centered, sliding every pin; pan by half the change so the map stays where it was.
        const delta = element.clientHeight - lastHeight;
        lastHeight = element.clientHeight;
        if (ready && delta !== 0) instance.panBy([0, delta / 2], { duration: 0 });
        // Keep the open restaurant on screen if the layout changed under it; otherwise leave the camera alone.
        const open = latest.current.collection.find(({ slug }) => slug === latest.current.selectedSlug);
        if (open) {
          const { x, y } = instance.project(open.position);
          if (x < 44 || x > element.clientWidth - 44 || y < 52 || y > element.clientHeight - 44) {
            instance.jumpTo({ center: open.position });
          }
        }
        draw();
      });
      observer.observe(element);
      instance.addControl(new mapbox.NavigationControl({ showCompass: false }), "top-right");
      instance.on("error", ({ error }) => {
        if (error?.status === 401 || error?.status === 403 || (!ready && error?.status === 404)) fail();
      });
      instance.on("moveend", draw);
      instance.on("movestart", () => { delete element.dataset.settled; });
      instance.on("idle", () => { if (ready && instance.areTilesLoaded()) element.dataset.settled = "true"; });
      instance.once("load", () => {
        if (disposed) return;
        window.clearTimeout(timeout);
        applyCartography(instance);
        ready = true;
        instance.resize();
        const restored = takeMapReturnState(market);
        const known = restored?.selected && latest.current.locations.some(({ slug }) => slug === restored.selected);
        if (restored) {
          setFilter(restored.filter);
          if (known) {
            setSelectedSlug(restored.selected);
            pendingFocus.current = restored.focus === "profile" ? "profile" : null;
          }
          // The camera was saved with the preview open. Let the preview take its space first (two frames),
          // then restore the camera, so the same part of the map is on screen.
          window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
            if (disposed) return;
            instance.resize();
            instance.jumpTo({ center: restored.center, zoom: restored.zoom });
            if (indexElement.current) indexElement.current.scrollTop = restored.listScroll;
            draw();
          }));
        } else {
          const first = firstViewLocations(market, latest.current.locations);
          fitTo(first, false);
          // Leave room around the cluster so neighborhoods and rivers read as context.
          if (first.length > 1) instance.setZoom(instance.getZoom() - 1.12);
        }
        draw();
        setPhase("ready");
      });
    }).catch(fail);

    return () => {
      disposed = true;
      cleanup();
    };
  }, [attempt, market, token]);

  // Redraw markers whenever the collection or selection changes.
  useEffect(() => { drawRef.current(); }, [collection, selected, phase]);

  /* ------------------------------------------------ camera for a new selection */
  useEffect(() => {
    const request = pendingLocate.current;
    const map = mapRef.current;
    const area = mapElement.current;
    if (!request || request.slug !== selected?.slug) return;
    pendingLocate.current = null;
    if (!map || phase !== "ready" || !area) return;
    // Two frames: the preview changes the map's height, and the resize (and the pan that keeps the map
    // steady) lands after the first frame. Judge where the pin is only once that has settled.
    const locate = () => {
      const target = latest.current.collection.find(({ slug }) => slug === request.slug);
      if (!target) return;
      const bounds = area.getBoundingClientRect();
      const point = map.project(target.position);
      const sheet = previewElement.current?.getBoundingClientRect();
      const x = bounds.left + point.x;
      const y = bounds.top + point.y;
      const covered = Boolean(sheet && x >= sheet.left - 22 && x <= sheet.right + 22 && y >= sheet.top - 22 && y <= sheet.bottom + 22);
      const clear = point.x > 50 && point.y > 56 && point.x < area.clientWidth - 55 && point.y < area.clientHeight - 90;
      // Tapping a pin that is already clear of the sheet never moves the map.
      if (request.source === "marker" && clear && !covered) return;
      const zoom = map.getZoom();
      const crowded = latest.current.collection.some((other) => {
        if (other.slug === target.slug) return false;
        const p = map.project(other.position);
        return Math.hypot(p.x - point.x, p.y - point.y) * 2 ** (14 - zoom) < 46;
      });
      map.easeTo({
        center: target.position,
        zoom: request.source === "marker" ? zoom : Math.max(crowded ? 16.7 : 14, zoom),
        duration: reduce.current ? 0 : 240,
      });
    };
    let frame = window.requestAnimationFrame(() => { frame = window.requestAnimationFrame(locate); });
    return () => window.cancelAnimationFrame(frame);
  }, [phase, selected]);

  // On a short screen the preview can start below the fold: bring all of it into view.
  useEffect(() => {
    if (!selected) return;
    const frame = window.requestAnimationFrame(() => previewElement.current?.scrollIntoView({ block: "nearest", behavior: reduce.current ? "auto" : "smooth" }));
    return () => window.cancelAnimationFrame(frame);
  }, [selected]);

  // Returning from a profile lands focus back on its View profile link.
  useEffect(() => {
    if (pendingFocus.current === "profile" && selected) {
      pendingFocus.current = null;
      profileLink.current?.focus({ preventScroll: true });
    }
  }, [selected]);

  const closePreview = useCallback(() => {
    const slug = latest.current.selectedSlug;
    setSelectedSlug(null);
    setActionError(null);
    // Return focus to the pin that opened it, or to the index row on small or failed maps.
    window.requestAnimationFrame(() => {
      const pin = [...markers.current.entries()].find(([key]) => slug && key.split("|").includes(slug))?.[1].button;
      (pin ?? document.querySelector<HTMLElement>(`[data-map-row="${CSS.escape(slug ?? "")}"]`))?.focus({ preventScroll: true });
    });
  }, []);

  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") closePreview(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closePreview, selected]);

  /* ------------------------------------------------------------- favorites */
  const savedNow = selected ? savedIds.has(selected.slug) : false;
  async function toggleSaved() {
    if (!selected || inFlight.current) return;
    inFlight.current = true;
    const slug = selected.slug;
    const was = savedIds.has(slug);
    setPending(true);
    setActionError(null);
    try {
      if (was) await removeFavorite(slug);
      else await saveFavorite(slug);
    } catch (error) {
      setActionError(describeStorageFailure(error, was ? "remove" : "save", selected.name));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  const storageNotice = actionError ?? (favoritesStatus === "error"
    ? describeStorageFailure(favoritesError ?? { reason: "read-failed", operation: "read" }, "load")
    : null);

  function rememberForReturn() {
    const map = mapRef.current;
    if (!map || !selected) return;
    const { lng, lat } = map.getCenter();
    saveMapReturnState({
      market, center: [lng, lat], zoom: map.getZoom(), selected: selected.slug, filter,
      listScroll: indexElement.current?.scrollTop ?? 0, focus: "profile", armed: false, savedAt: Date.now(),
    });
  }

  const savedCount = locations.filter(({ slug }) => savedIds.has(slug)).length;
  const unmappedSaved = favorites.length - savedCount;
  const showEmptySaved = filter === "saved" && favoritesStatus === "ready" && collection.length === 0;

  return (
    <div className={`map-layout${listOpen ? " map-list-mode" : ""}`} data-map-phase={phase}>
      <aside className="map-rail">
        <div className="map-geography">
          <div>
            <p className="editorial-eyebrow">Restaurant map</p>
            <h1 id="map-title" className="editorial-page-title">{marketName}</h1>
          </div>
          <button ref={listButton} type="button" className="map-view-toggle" aria-controls="map-index"
            aria-expanded={listOpen} onClick={() => setListOpen((open) => !open)}>
            <MaterialIcon name={listOpen ? "map" : "list"} />
            <span>{listOpen ? "Map" : "List"}</span>
          </button>
        </div>
        <div className="map-filters" role="group" aria-label="Map collection">
          <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            All places <span>{locations.length}</span>
          </button>
          <button type="button" aria-pressed={filter === "saved"} onClick={() => setFilter("saved")}>
            <MaterialIcon name="bookmark" /> Saved only{favoritesStatus === "ready" ? <span>{savedCount}</span> : null}
          </button>
        </div>
        <div id="map-index" ref={indexElement} className="map-directory" aria-label="Restaurant index">
          <div className="map-index-head">
            <span>Restaurant index</span>
            <span aria-live="polite">{index.length} {index.length === 1 ? "place" : "places"}</span>
          </div>
          {index.length === 0 ? (
            <p className="map-index-empty">{filter === "saved" ? "Nothing saved on the map yet." : "No restaurants on the map yet."}</p>
          ) : (
            <ul>
              {index.map((location) => (
                <li key={location.slug}>
                  <button type="button" data-map-row={location.slug} className="map-row"
                    aria-pressed={selected?.slug === location.slug} onClick={() => select(location.slug, "index")}>
                    <span className="map-row-no" aria-hidden>{String(ordinals.get(location.slug) ?? 0).padStart(2, "0")}</span>
                    <span className="map-row-copy">
                      <strong>{location.name}</strong>
                      {location.area && <small>{location.area}</small>}
                    </span>
                    <MaterialIcon name="chevron_right" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <div className="map-field">
        <div className="map-frame">
          <div className="map-canvas">
            <div ref={mapElement} role="region" aria-label={`Interactive restaurant map of ${marketName}`} className="h-full w-full" />
          </div>
          {phase === "ready" && (
            <>
              <p role="status" className="map-count">
                {inView === 0 ? "No places in view" : `${inView} ${inView === 1 ? "place" : "places"} in view`}
              </p>
              <div className="map-tools">
                <button type="button" aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn({ duration: reduceMotion ? 0 : 180 })}>
                  <MaterialIcon name="add" />
                </button>
                <button type="button" aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut({ duration: reduceMotion ? 0 : 180 })}>
                  <MaterialIcon name="remove" />
                </button>
                <button type="button" aria-label="Fit all restaurants in this collection" title="Fit collection"
                  onClick={() => fitRef.current(collection)}>
                  <MaterialIcon name="fit_screen" />
                </button>
              </div>
            </>
          )}
          {showEmptySaved && (
            <div className="map-empty">
              <h2 className="editorial-section-title">{unmappedSaved > 0 && savedCount === 0 ? "Saved places aren’t on the map" : "No saved places yet"}</h2>
              <p>
                {unmappedSaved > 0 && savedCount === 0
                  ? "Your saved restaurants don’t have approved map locations yet. They stay in Saved."
                  : "Save a restaurant from its preview or from Swipe and it appears here."}
              </p>
              <div>
                <button type="button" className="editorial-action editorial-action-secondary" onClick={() => setFilter("all")}>Show all places</button>
                <Link href="/saved" className="editorial-action editorial-action-secondary">Open Saved</Link>
              </div>
            </div>
          )}
          {phase !== "ready" && (
            <div role="status" className="map-state">
              {phase === "loading" ? (
                <p>Loading restaurant map…</p>
              ) : (
                <div>
                  <MaterialIcon name="map" />
                  <h2 className="editorial-section-title">The map couldn’t load</h2>
                  <p>The restaurant list still works. You can also try the map again.</p>
                  <div>
                    <button type="button" className="editorial-action" onClick={() => { setPhase("loading"); setAttempt((n) => n + 1); }}>Try again</button>
                    <button type="button" className="editorial-action editorial-action-secondary" onClick={() => setListOpen(true)}>Open the list</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {selected && (
          <section ref={previewElement} aria-label="Selected restaurant" className="map-preview">
            <div className="map-preview-head">
              <div>
                {(selected.cuisine || selected.area) && (
                  <p className="editorial-eyebrow">{[selected.cuisine, selected.area].filter(Boolean).join(" · ")}</p>
                )}
                <h2 className="editorial-section-title">{selected.name}</h2>
                {selected.address && <p className="map-address">{selected.address}</p>}
              </div>
              <button type="button" className="editorial-icon-button map-preview-close" aria-label="Close preview" onClick={closePreview}>
                <MaterialIcon name="close" />
              </button>
            </div>
            {storageNotice && (
              <p className="map-notice" role="alert">
                {storageNotice.message}
                {favoritesStatus === "error" && storageNotice.retry && <button type="button" onClick={() => void retryFavorites()}>Retry</button>}
                {storageNotice.reload && <button type="button" onClick={() => window.location.reload()}>Reload</button>}
              </p>
            )}
            <div className="map-actions">
              <Link ref={profileLink} prefetch={false} href={`/restaurants/${encodeURIComponent(selected.slug)}?from=map`}
                className="editorial-action" onClick={rememberForReturn}>
                View profile <MaterialIcon name="arrow_forward" />
              </Link>
              <BookmarkToggle identity={selected.slug} name={selected.name} saved={savedNow} pending={pending}
                unavailable={favoritesStatus !== "ready"} onToggle={() => void toggleSaved()} className="map-action" />
              <a className="map-action" href={directionsUrl(selected)} target="_blank" rel="noopener noreferrer"
                aria-label={`Directions to ${selected.name} (opens in a new tab)`}>
                <MaterialIcon name="directions" /> Directions
              </a>
            </div>
          </section>
        )}

        <footer className="map-credits" aria-label="Restaurant location attribution">
          <span>Places</span>
          {credits.map(({ label, url }) => <a key={label} href={url}>{label}</a>)}
        </footer>
      </div>
    </div>
  );
}
