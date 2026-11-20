type Position = [number, number];
export type MapboxMap = {
  once(name: "load" | "moveend", callback: () => void): void;
  on(name: "load" | "moveend" | "movestart" | "idle", callback: () => void): void;
  on(name: "error", callback: (event: { error?: { status?: number } }) => void): void;
  project(position: Position): { x: number; y: number };
  fitBounds(bounds: [Position, Position], options: { padding: number; maxZoom: number; duration: number }): void;
  easeTo(options: { center: Position; zoom?: number; duration: number }): void;
  jumpTo(options: { center: Position; zoom?: number }): void;
  panBy(offset: [number, number], options: { duration: number }): void;
  zoomIn(options: { duration: number }): void;
  zoomOut(options: { duration: number }): void;
  getZoom(): number;
  setZoom(zoom: number): void;
  getCenter(): { lng: number; lat: number };
  getLayer(id: string): unknown;
  getStyle(): { layers: { id: string; type: string }[] };
  setPaintProperty(layer: string, property: string, value: unknown): void;
  setLayoutProperty(layer: string, property: string, value: unknown): void;
  areTilesLoaded(): boolean;
  touchZoomRotate: { disableRotation(): void };
  addControl(control: unknown, position: "top-right"): void;
  resize(): void;
  remove(): void;
};

type Marker = {
  setLngLat(position: Position): Marker;
  addTo(map: MapboxMap): Marker;
  remove(): void;
};

type MapboxGL = {
  supported(): boolean;
  Map: new (options: {
    accessToken: string;
    container: HTMLElement;
    style: string;
    projection: "mercator";
    center: Position;
    zoom: number;
    dragRotate: false;
    pitchWithRotate: false;
    touchPitch: false;
    fadeDuration: number;
  }) => MapboxMap;
  Marker: new (options: { element: HTMLButtonElement; anchor: "center" }) => Marker;
  NavigationControl: new (options: { showCompass: false }) => unknown;
};

const cdn = "https://api.mapbox.com/mapbox-gl-js/v3.35.0/mapbox-gl";
let pending: Promise<MapboxGL> | undefined;

export function loadMapbox(): Promise<MapboxGL> {
  if (pending) return pending;
  pending = new Promise<MapboxGL>((resolve, reject) => {
    const script = document.createElement("script");
    const css = document.createElement("link");
    script.src = `${cdn}.js`;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.integrity = "sha384-UKlFvybsfQZPb36iwl5Zfzm3LtId829lqWfjesecKFzQrxruQFUfK/qTUCjviBiB";
    css.href = `${cdn}.css`;
    css.rel = "stylesheet";
    css.crossOrigin = "anonymous";
    css.integrity = "sha384-VGmZ8wDuI0rTlg6/nTK2nvL/m5SskkpZ/7AoUq/Zk3EnuPEbBkRza0p/Hi6LRw4S";

    let loaded = 0;
    const timeout = window.setTimeout(fail, 12_000);
    function fail() {
      window.clearTimeout(timeout);
      script.remove();
      css.remove();
      reject(new Error("Mapbox could not load."));
    }
    function ready() {
      if (++loaded !== 2) return;
      const mapbox = (window as Window & { mapboxgl?: MapboxGL }).mapboxgl;
      if (!mapbox) return fail();
      window.clearTimeout(timeout);
      resolve(mapbox);
    }
    script.onload = css.onload = ready;
    script.onerror = css.onerror = fail;
    document.head.append(css, script);
  }).catch((error: unknown) => {
    pending = undefined;
    throw error;
  });
  return pending;
}
