/**
 * Warms the next card's hero image so the swipe handoff is smooth. It is a courtesy
 * to the browser cache, never a verdict on the photo.
 *
 * - `ready`  the image loaded and decoded.
 * - `error`  the browser reported a genuine load error. Only this status may be used
 *            to discard a photo.
 * - `slow`   the wait ran out first. The image keeps loading and the hero's own
 *            loading rules (`placePhotoLoad`) show the logo until it arrives, so a
 *            slow photo is never marked failed.
 */
export type ImagePrewarmStatus = "ready" | "error" | "slow";

/** Only a genuine load error may discard a photo; a slow or unfinished one never does. */
export const prewarmDiscardsPhoto = (status: ImagePrewarmStatus): boolean => status === "error";

/** How long a caller waits for a prewarm before it stops waiting (not before it gives up). */
export const HERO_IMAGE_SETTLE_MAX_WAIT_MS = 5000;

export interface PrewarmImage {
  onload: ((event: Event) => unknown) | null;
  onerror: OnErrorEventHandler | ((event: Event) => unknown) | null;
  referrerPolicy: string;
  decoding: string;
  src: string;
  complete: boolean;
  naturalWidth: number;
  decode?: () => Promise<void>;
}

export interface PrewarmEnvironment {
  createImage: () => PrewarmImage;
  setTimeout: (callback: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
}

export function createHeroImagePrewarmer(
  env: PrewarmEnvironment,
  maxWaitMs = HERO_IMAGE_SETTLE_MAX_WAIT_MS,
) {
  // The final outcome of each image, once it is known. "pending" means still loading.
  const outcomes = new Map<string, "ready" | "error" | "pending">();
  const waits = new Map<string, Promise<ImagePrewarmStatus>>();
  // A detached image can be collected before it finishes, so hold it until it settles.
  const loading = new Map<string, PrewarmImage>();

  const restaurantOf = (key: string) => key.slice(0, key.indexOf("|"));

  function prewarm(restaurantId: string, url: string): Promise<ImagePrewarmStatus> {
    const key = `${restaurantId}|${url}`;
    const known = outcomes.get(key);
    if (known === "ready" || known === "error") return Promise.resolve(known);
    const existing = waits.get(key);
    if (existing) return existing;
    // Still loading after an earlier wait ended: report that, do not start a second load.
    if (known === "pending") return Promise.resolve("slow");

    outcomes.set(key, "pending");
    const wait = new Promise<ImagePrewarmStatus>((resolve) => {
      const img = env.createImage();
      loading.set(key, img);
      let finished = false;
      let timer = 0;

      const finish = (outcome: "ready" | "error") => {
        if (finished) return;
        finished = true;
        env.clearTimeout(timer);
        loading.delete(key);
        // A restaurant that was pruned meanwhile is not re-added.
        if (outcomes.has(key)) outcomes.set(key, outcome);
        resolve(outcome);
      };

      // Stop waiting, never stop loading: the image stays in `loading` and may still succeed.
      timer = env.setTimeout(() => {
        if (!finished) resolve("slow");
      }, maxWaitMs);

      img.onload = () => finish("ready");
      img.onerror = () => finish("error");
      img.referrerPolicy = "no-referrer";
      img.decoding = "async";
      img.src = url;

      if (typeof img.decode === "function") {
        img.decode()
          .then(() => finish("ready"))
          .catch(() => {
            if (img.complete) finish(img.naturalWidth > 0 ? "ready" : "error");
          });
      }
    });

    const tracked = wait.finally(() => {
      waits.delete(key);
    });
    waits.set(key, tracked);
    return tracked;
  }

  return {
    prewarm,
    /** What is known about an image right now, without waiting. */
    outcome: (restaurantId: string, url: string) => outcomes.get(`${restaurantId}|${url}`),
    /** Forget every image that does not belong to a restaurant in `keep`. */
    retainOnly(keep: ReadonlySet<string>) {
      for (const key of [...outcomes.keys()]) {
        if (!keep.has(restaurantOf(key))) {
          outcomes.delete(key);
          waits.delete(key);
        }
      }
    },
    clear() {
      outcomes.clear();
      waits.clear();
      loading.clear();
    },
  };
}
