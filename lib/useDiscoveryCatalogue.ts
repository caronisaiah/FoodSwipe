"use client";

import { useEffect, useEffectEvent, useState } from "react";
import type { Market } from "@/lib/markets";
import type { Restaurant } from "@/lib/types";

type CatalogueResult = { status: "error" } | { status: "ready"; restaurants: Restaurant[] };

export function useDiscoveryCatalogue(market: Market | null, onReady?: () => void) {
  const [attempt, setAttempt] = useState(0);
  const [response, setResponse] = useState<{ market: Market; attempt: number; result: CatalogueResult }>();

  const notifyReady = useEffectEvent(() => onReady?.());

  useEffect(() => {
    if (!market) return;
    const controller = new AbortController();

    async function load(requestedMarket: Market) {
      let result: CatalogueResult;
      try {
        const res = await fetch(`/api/restaurants?market=${requestedMarket}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Could not load the discovery catalogue.");
        const data = await res.json() as { market?: Market; restaurants?: Restaurant[] };
        if (data.market !== requestedMarket || !Array.isArray(data.restaurants) ||
          data.restaurants.some((restaurant) => restaurant?.market !== requestedMarket)) {
          throw new Error("Unexpected discovery catalogue.");
        }
        result = { status: "ready", restaurants: data.restaurants };
      } catch {
        result = { status: "error" };
      }
      if (!controller.signal.aborted) {
        if (result.status === "ready") notifyReady();
        setResponse({ market: requestedMarket, attempt, result });
      }
    }

    void load(market);
    return () => controller.abort();
  }, [market, attempt]);

  const catalogue = response && response.market === market && response.attempt === attempt
    ? response.result
    : { status: "loading" as const };
  return { catalogue, retry: () => setAttempt((previous) => previous + 1), retried: attempt > 0 };
}
