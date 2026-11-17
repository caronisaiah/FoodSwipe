"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps, validMapPosition, type MapsWindow, type PlaceCredit, type Position } from "@/lib/googleMap";
import { getMarketOrigin, getMarketShortName, type Market } from "@/lib/markets";

type Target = { slug: string; placeId: string };
type Preview = { slug: string; label: string };
type MapStatus = "loading-map" | "loading-restaurants" | "ready" | "unavailable";

function creditHref(value: string | undefined) {
  try {
    const link = new URL(value ?? "");
    if (link.protocol === "https:" || link.protocol === "http:") return link.href;
  } catch {
    // The provider name still appears when its link is unavailable.
  }
}

async function withTimeout<T>(request: Promise<T>, milliseconds: number): Promise<T> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error("Google Maps request timed out.")), milliseconds);
      }),
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}

export default function MapDiscovery({ browserKey, mapId, market, targets }: {
  browserKey: string;
  mapId: string;
  market: Market;
  targets: Target[];
}) {
  const element = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<MapStatus>("loading-map");
  const [visibleCount, setVisibleCount] = useState(0);
  const [unavailableCount, setUnavailableCount] = useState(0);
  const [selected, setSelected] = useState<Preview | null>(null);
  const [credits, setCredits] = useState<PlaceCredit[]>([]);

  useEffect(() => {
    const container = element.current;
    if (!container) return;
    const browser = window as MapsWindow;
    const previousAuthFailure = browser.gm_authFailure;
    let stopped = false;
    const cleanups: (() => void)[] = [];
    const started = window.setTimeout(fail, 20_000);

    function stop() {
      stopped = true;
      window.clearTimeout(started);
      for (const cleanup of cleanups) cleanup();
      container?.replaceChildren();
      if (browser.gm_authFailure === authFailure) browser.gm_authFailure = previousAuthFailure;
    }

    function fail() {
      if (stopped) return;
      stop();
      setSelected(null);
      setCredits([]);
      setStatus("unavailable");
    }

    function authFailure() {
      fail();
      previousAuthFailure?.();
    }

    browser.gm_authFailure = authFailure;

    void (async () => {
      const maps = await loadGoogleMaps(browserKey);
      if (stopped) return;
      const [{ Map: GoogleMap }, { AdvancedMarkerElement, PinElement }] = await Promise.all([
        maps.importLibrary("maps"),
        maps.importLibrary("marker"),
      ]);
      if (stopped) return;
      const map = new GoogleMap(container, {
        center: getMarketOrigin(market),
        zoom: 11,
        mapId,
        gestureHandling: "greedy",
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
      });
      const pins: InstanceType<typeof AdvancedMarkerElement>[] = [];
      const positions: Position[] = [];
      let selectedPin: InstanceType<typeof AdvancedMarkerElement> | undefined;
      const mapCredits = new Map<string, PlaceCredit>();
      let unavailable = 0;

      function updateVisibleCount() {
        const bounds = map.getBounds();
        if (!bounds) return;
        setVisibleCount(positions.filter((position) => bounds.contains(position)).length);
      }
      const idle = map.addListener("idle", updateVisibleCount);
      cleanups.push(() => idle.remove());

      let loaded = false;
      const tiles = map.addListener("tilesloaded", () => {
        if (loaded || stopped) return;
        loaded = true;
        if (map.getMapCapabilities().isAdvancedMarkersAvailable === false) return fail();
        window.clearTimeout(started);
        if (targets.length === 0) {
          setStatus("ready");
          return;
        }
        setStatus("loading-restaurants");
        void resolvePins().catch(fail);
      });
      cleanups.push(() => {
        tiles.remove();
        for (const pin of pins) pin.map = null;
      });

      async function resolvePins() {
        const { Place } = await withTimeout(maps.importLibrary("places"), 8_000);
        if (stopped) return;
        let cursor = 0;
        await Promise.all(Array.from({ length: Math.min(4, targets.length) }, async () => {
          while (!stopped && cursor < targets.length) {
            const index = cursor++;
            const { slug, placeId } = targets[index];
            const label = `Restaurant ${index + 1}`;
            try {
              const place = new Place({ id: placeId });
              // Attribution is returned automatically, so location is the only billable field requested.
              await withTimeout(place.fetchFields({ fields: ["location"] }), 8_000);
              if (stopped) return;
              const position = place.location?.toJSON();
              if (!validMapPosition(position)) {
                unavailable++;
                continue;
              }
              const marker = new AdvancedMarkerElement({ map, position, title: label, gmpClickable: true });
              marker.append(new PinElement({ background: "#fbbf64", borderColor: "#63350f", glyphColor: "#351707", scale: 0.85 }));
              marker.addEventListener("gmp-click", () => {
                if (selectedPin) selectedPin.zIndex = 0;
                selectedPin = marker;
                marker.zIndex = 1;
                setSelected({ slug, label });
              });
              pins.push(marker);
              positions.push(position);
              for (const credit of place.attributions ?? []) {
                if (!credit.provider) continue;
                mapCredits.set(`${credit.provider}|${credit.providerURI ?? ""}`, credit);
              }
              if (mapCredits.size > 0) setCredits([...mapCredits.values()]);
              updateVisibleCount();
            } catch {
              unavailable++;
            }
          }
        }));
        if (stopped) return;
        setUnavailableCount(unavailable);
        setStatus("ready");
      }
    })().catch(fail);

    return stop;
  }, [browserKey, mapId, market, targets]);

  return (
    <>
      <div className="relative min-h-0 flex-1 bg-ink-2">
        <div ref={element} aria-label="Restaurant discovery map" className="absolute inset-0" />
        {(status === "loading-map" || status === "unavailable") && (
          <div role="status" className="absolute inset-0 grid place-items-center bg-ink-2 px-6 text-center text-sm text-cream">
            {status === "loading-map" ? `Loading ${getMarketShortName(market)} map…` : "The map couldn’t load. Reload this page or return to Swipe."}
          </div>
        )}
      </div>
      {(status === "loading-restaurants" || status === "ready") && (
        <div className="max-h-[36dvh] shrink-0 overflow-y-auto overscroll-contain border-t border-line bg-surface px-4 py-2.5 text-sm text-haze">
          <p role="status">
            {status === "loading-restaurants" ? "Finding curated restaurant pins…"
              : visibleCount === 0 ? "No curated restaurants in this map area. Pan or zoom out to explore."
              : `${visibleCount} curated ${visibleCount === 1 ? "restaurant" : "restaurants"} in view`}
          </p>
          {unavailableCount > 0 && <p className="mt-1 text-xs">Some restaurant locations couldn’t be loaded.</p>}
          {selected && (
            <section aria-label="Selected restaurant" className="mt-2 rounded-2xl border border-line bg-ink-2 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-cream">{selected.label}</h2>
                  <p className="text-xs text-haze">Location from Google Maps</p>
                </div>
                <button type="button" onClick={() => setSelected(null)} className="px-1 text-xs underline">Close</button>
              </div>
              <Link href={`/restaurants/${encodeURIComponent(selected.slug)}`} className="mt-2 inline-block font-semibold text-saffron underline">
                View Profile
              </Link>
            </section>
          )}
          {credits.length > 0 && (
            <p className="mt-1 text-xs">
              {credits.map((credit) => {
                const href = creditHref(credit.providerURI);
                return (
                  <span key={`${credit.provider}|${credit.providerURI ?? ""}`} className="mr-2">
                    {href ? <a href={href} className="underline">{credit.provider}</a> : credit.provider}
                  </span>
                );
              })}
            </p>
          )}
        </div>
      )}
    </>
  );
}
