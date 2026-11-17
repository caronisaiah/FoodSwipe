// Only the Maps JavaScript API surface used by the discovery map.
export type Position = { lat: number; lng: number };
export type PlaceCredit = { provider: string; providerURI?: string };

type MapEvent = "idle" | "tilesloaded";
type MapInstance = {
  addListener(event: MapEvent, handler: () => void): { remove(): void };
  getBounds(): { contains(position: Position): boolean } | undefined;
  getMapCapabilities(): { isAdvancedMarkersAvailable?: boolean };
};

type Maps = {
  importLibrary(name: "maps"): Promise<{
    Map: new (element: HTMLElement, options: {
      center: Position;
      zoom: number;
      mapId: string;
      gestureHandling: "greedy";
      mapTypeControl: false;
      streetViewControl: false;
      fullscreenControl: false;
      clickableIcons: false;
    }) => MapInstance;
  }>;
  importLibrary(name: "marker"): Promise<{
    AdvancedMarkerElement: new (options: {
      map: MapInstance;
      position: Position;
      gmpClickable: true;
      title: string;
    }) => HTMLElement & { map: MapInstance | null; zIndex: number };
    PinElement: new (options: { background: string; borderColor: string; glyphColor: string; scale: number }) => HTMLElement;
  }>;
  importLibrary(name: "places"): Promise<{
    Place: new (options: { id: string }) => {
      fetchFields(options: { fields: ["location"] }): Promise<unknown>;
      location?: { toJSON(): Position } | null;
      attributions?: PlaceCredit[] | null;
    };
  }>;
};

export type MapsWindow = Window & {
  google?: { maps?: Maps };
  gm_authFailure?: () => void;
  foodSwipeMapsReady?: () => void;
};

let pending: Promise<Maps> | undefined;

export function loadGoogleMaps(key: string): Promise<Maps> {
  const browser = window as MapsWindow;
  if (browser.google?.maps?.importLibrary) return Promise.resolve(browser.google.maps);
  if (pending) return pending;

  pending = new Promise<Maps>((resolve, reject) => {
    const script = document.createElement("script");
    const url = new URL("https://maps.googleapis.com/maps/api/js");
    url.search = new URLSearchParams({ key, v: "weekly", loading: "async", callback: "foodSwipeMapsReady" }).toString();
    script.src = url.href;
    script.async = true;
    const timeout = window.setTimeout(fail, 15_000);
    function fail() {
      window.clearTimeout(timeout);
      script.remove();
      delete browser.foodSwipeMapsReady;
      reject(new Error("Google Maps could not load."));
    }
    browser.foodSwipeMapsReady = () => {
      if (!browser.google?.maps?.importLibrary) return fail();
      window.clearTimeout(timeout);
      delete browser.foodSwipeMapsReady;
      resolve(browser.google.maps);
    };
    script.onerror = fail;
    document.head.append(script);
  }).catch((error: unknown) => {
    pending = undefined;
    throw error;
  });
  return pending;
}

export function validMapPosition(position: Position | null | undefined): position is Position {
  return !!position && Number.isFinite(position.lat) && Number.isFinite(position.lng)
    && Math.abs(position.lat) <= 90 && Math.abs(position.lng) <= 180
    && (position.lat !== 0 || position.lng !== 0);
}
