"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import MaterialIcon from "@/components/MaterialIcon";
import { loadMapbox } from "@/lib/mapboxClient";
import type { MapLocation } from "@/lib/mapLocations";
import { getMarketOrigin, type Market } from "@/lib/markets";

export default function MapboxDiscovery({ token, market, locations }: {
  token: string;
  market: Market;
  locations: MapLocation[];
}) {
  const container = useRef<HTMLDivElement>(null);
  const selectedPin = useRef<{ element: HTMLButtonElement; position: MapLocation["position"] } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [visible, setVisible] = useState(locations.length);
  const [selected, setSelected] = useState<MapLocation | null>(null);
  const credits = [...new Map(locations.flatMap(({ notices }) => notices.map((notice) => [notice.label, notice] as const))).values()];

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let disposed = false;
    let loaded = false;
    let map: InstanceType<Awaited<ReturnType<typeof loadMapbox>>["Map"]> | undefined;
    let observer: ResizeObserver | undefined;
    const markers: { remove(): void }[] = [];
    const timeout = window.setTimeout(fail, 20_000);

    function cleanup() {
      window.clearTimeout(timeout);
      observer?.disconnect();
      for (const marker of markers) marker.remove();
      markers.length = 0;
      map?.remove();
      map = undefined;
      selectedPin.current = null;
    }
    function fail() {
      if (disposed) return;
      disposed = true;
      cleanup();
      setSelected(null);
      setStatus("error");
    }

    void loadMapbox().then((mapbox) => {
      if (disposed) return;
      if (!mapbox.supported()) return fail();
      const origin = getMarketOrigin(market);
      const instance = new mapbox.Map({
        accessToken: token,
        container: element,
        style: "mapbox://styles/mapbox/standard",
        projection: "mercator",
        center: [origin.lng, origin.lat],
        zoom: 11,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        config: { basemap: {
          lightPreset: "night",
          theme: "monochrome",
          colorWater: "#14292f",
          colorGreenspace: "#243937",
          show3dObjects: false,
          showPointOfInterestLabels: false,
          showTransitLabels: false,
        } },
      });
      map = instance;
      observer = new ResizeObserver(() => {
        instance.resize();
        const pin = selectedPin.current;
        if (!pin) return;
        const { x, y } = instance.project(pin.position);
        if (x < 44 || x > element.clientWidth - 44 || y < 52 || y > element.clientHeight - 44) {
          instance.jumpTo({ center: pin.position });
        }
      });
      observer.observe(element);
      instance.addControl(new mapbox.NavigationControl({ showCompass: false }), "top-right");
      instance.on("error", ({ error }) => {
        if (!loaded || error?.status === 401 || error?.status === 403) fail();
      });
      const updateVisible = () => {
        const { clientWidth, clientHeight } = element;
        setVisible(locations.filter(({ position }) => {
          const { x, y } = instance.project(position);
          return x >= 0 && x <= clientWidth && y >= 0 && y <= clientHeight;
        }).length);
      };
      instance.on("moveend", updateVisible);
      instance.once("load", () => {
        if (disposed) return;
        loaded = true;
        window.clearTimeout(timeout);
        const lngs = locations.map(({ position }) => position[0]);
        const lats = locations.map(({ position }) => position[1]);
        instance.fitBounds(
          [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          { padding: 42, maxZoom: 14, duration: 0 },
        );
        for (const location of locations) {
          const pin = document.createElement("button");
          pin.type = "button";
          pin.className = "foodswipe-map-pin";
          pin.setAttribute("role", "button");
          pin.setAttribute("aria-label", location.name);
          pin.setAttribute("aria-pressed", "false");
          pin.addEventListener("click", () => {
            selectedPin.current?.element.setAttribute("aria-pressed", "false");
            selectedPin.current = { element: pin, position: location.position };
            pin.setAttribute("aria-pressed", "true");
            setSelected(location);
          });
          markers.push(new mapbox.Marker({ element: pin, anchor: "center" }).setLngLat(location.position).addTo(instance));
        }
        updateVisible();
        setStatus("ready");
      });
    }).catch(fail);

    return () => {
      disposed = true;
      cleanup();
    };
  }, [locations, market, token]);

  function closePreview() {
    selectedPin.current?.element.setAttribute("aria-pressed", "false");
    selectedPin.current?.element.focus();
    selectedPin.current = null;
    setSelected(null);
  }

  return (
    <>
      <div className="relative min-h-0 flex-1 bg-ink-2">
        <div className="absolute inset-0">
          <div ref={container} aria-label="Restaurant discovery map" className="h-full w-full" />
        </div>
        {status !== "ready" && (
          <div role="status" className="absolute inset-0 z-10 grid place-items-center bg-ink-2 px-6 text-center text-sm text-cream">
            {status === "loading" ? "Loading restaurant map…" : "The map couldn’t load. Reload this page or return to Swipe."}
          </div>
        )}
        {status === "ready" && (
          <p role="status" className="pointer-events-none absolute left-3 top-3 max-w-[75%] rounded-full border border-line bg-ink px-3 py-1.5 text-xs font-semibold text-cream shadow-md">
            {visible === 0 ? "No curated restaurants in this area" : `${visible} curated ${visible === 1 ? "restaurant" : "restaurants"} in view`}
          </p>
        )}
      </div>
      {selected && (
        <section aria-label="Selected restaurant" className="max-h-[36dvh] shrink-0 overflow-y-auto border-t border-line bg-surface px-5 py-4 sm:px-7">
          <div className="flex items-start justify-between gap-3">
            <div>
              {selected.cuisine && <p className="text-xs font-semibold text-saffron">{selected.cuisine}</p>}
              <h2 className="font-display text-xl font-bold text-cream">{selected.name}</h2>
              {(selected.area || selected.address) && (
                <p className="mt-1 text-sm text-haze">{[selected.area, selected.address].filter(Boolean).join(" · ")}</p>
              )}
            </div>
            <button type="button" onClick={closePreview} aria-label="Close preview" className="grid size-9 shrink-0 place-items-center rounded-full border border-line text-haze">
              <MaterialIcon name="close" className="text-lg" />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-sm text-haze">
              <MaterialIcon name="play_circle" className="text-lg" />
              {selected.videoCount} creator {selected.videoCount === 1 ? "video" : "videos"}
            </span>
            <Link prefetch={false} href={`/restaurants/${encodeURIComponent(selected.slug)}`}
              className="rounded-full bg-saffron px-4 py-2 text-sm font-bold text-ink">View Profile</Link>
          </div>
        </section>
      )}
      {status === "ready" && (
        <footer className="flex shrink-0 flex-wrap gap-x-3 gap-y-1 border-t border-line bg-ink px-5 py-1.5 text-xs text-haze sm:px-7">
          {credits.map(({ label, url }) => <a key={label} href={url} className="underline">{label}</a>)}
        </footer>
      )}
    </>
  );
}
