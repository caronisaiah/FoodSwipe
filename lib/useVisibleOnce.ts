"use client";

import { useEffect, useRef, type RefObject } from "react";

const DEFAULT_VISIBLE_RATIO = 0.5;
const DEFAULT_VISIBLE_DURATION_MS = 500;

/** Calls onVisible once after the element remains meaningfully visible. */
export function useVisibleOnce<ElementType extends Element>(
  onVisible: () => void,
  options: { ratio?: number; durationMs?: number; enabled?: boolean } = {},
): RefObject<ElementType | null> {
  const elementRef = useRef<ElementType>(null);
  const callbackRef = useRef(onVisible);
  const firedRef = useRef(false);

  const ratio = options.ratio ?? DEFAULT_VISIBLE_RATIO;
  const durationMs = options.durationMs ?? DEFAULT_VISIBLE_DURATION_MS;
  const enabled = options.enabled ?? true;

  useEffect(() => {
    callbackRef.current = onVisible;
  }, [onVisible]);

  useEffect(() => {
    const element = elementRef.current;
    if (
      !enabled ||
      !element ||
      firedRef.current ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }

    let timer: number | undefined;
    const clearTimer = () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry || entry.intersectionRatio < ratio) {
          clearTimer();
          return;
        }
        if (timer !== undefined) return;

        timer = window.setTimeout(() => {
          timer = undefined;
          if (firedRef.current) return;
          firedRef.current = true;
          observer.disconnect();
          callbackRef.current();
        }, durationMs);
      },
      { threshold: ratio },
    );

    observer.observe(element);
    return () => {
      clearTimer();
      observer.disconnect();
    };
  }, [durationMs, enabled, ratio]);

  return elementRef;
}
