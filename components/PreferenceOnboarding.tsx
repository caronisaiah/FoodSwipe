"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import BottomNav from "@/components/BottomNav";
import MaterialIcon from "@/components/MaterialIcon";
import DiscoveryCity from "@/components/editorial/DiscoveryCity";
import { PreferenceCheck, SegmentedPreference } from "@/components/editorial/PreferenceControls";
import type { Market } from "@/lib/markets";
import { BUDGET_OPTIONS, CRAVING_OPTIONS, VIBE_OPTIONS } from "@/lib/options";
import { usePreferences } from "@/lib/storage";
import type { Restaurant } from "@/lib/types";

type OptionsState =
  | { status: "loading" | "error" }
  | { status: "ready"; restaurants: Restaurant[] };

function updateChoice<Value>(values: Value[], value: Value, checked: boolean) {
  return checked ? [...values.filter((item) => item !== value), value] : values.filter((item) => item !== value);
}

export default function PreferenceOnboarding({ market }: { market: Market | null }) {
  const { preferences, setPreferences } = usePreferences();
  const [catalogue, setCatalogue] = useState<OptionsState>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const preferenceSection = useRef<HTMLElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!market) return;
    const controller = new AbortController();

    async function loadOptions() {
      try {
        // Match the feed's default catalogue. An alternate-market read only works
        // after the feed, Map and this screen share an effective market.
        const response = await fetch("/api/restaurants", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Could not load the discovery catalogue.");
        const { restaurants } = await response.json() as { restaurants?: Restaurant[] };
        if (!Array.isArray(restaurants)) throw new Error("Missing discovery catalogue.");
        if (!controller.signal.aborted) {
          if (retryButton.current && retryButton.current === document.activeElement) {
            preferenceSection.current?.focus({ preventScroll: true });
          }
          setCatalogue({ status: "ready", restaurants: restaurants.filter((restaurant) => restaurant.market === market) });
        }
      } catch {
        if (!controller.signal.aborted) setCatalogue({ status: "error" });
      }
    }

    void loadOptions();
    return () => controller.abort();
  }, [market, reload]);

  const restaurants = catalogue.status === "ready" ? catalogue.restaurants : [];
  const cuisines = CRAVING_OPTIONS.filter(({ value }) =>
    value !== "halal" && value !== "vegan" && restaurants.some((place) => place.cuisineTags.includes(value)),
  );
  const occasions = VIBE_OPTIONS.filter(({ value }) => restaurants.some((place) => place.vibeTags.includes(value)));
  const optionStatus = !market ? "Cuisine and occasion choices are unavailable."
    : catalogue.status === "loading" ? "Loading cuisine and occasion choices…"
      : catalogue.status === "error" ? "Cuisine and occasion choices couldn’t load."
        : cuisines.length < 2 && occasions.length === 0 ? "Cuisine and occasion choices are unavailable for this market."
          : null;
  const canRetry = Boolean(market) && (catalogue.status === "error" || (catalogue.status === "loading" && reload > 0));

  return (
    <div className="editorial-canvas tune">
      <a className="tune-skip" href="#tune-preferences">Skip to preferences</a>
      <header className="tune-masthead">
        <Link className="editorial-wordmark" href="/feed" prefetch={false} aria-label="FoodSwipe, Discover">
          Food<span>Swipe</span>
        </Link>
        <BottomNav />
      </header>

      <main className="tune-layout">
        <DiscoveryCity market={market} />
        <section ref={preferenceSection} className="tune-preferences" id="tune-preferences" tabIndex={-1} aria-labelledby="recommendations-heading">
          <h2 id="recommendations-heading" className="editorial-section-title">Your recommendations</h2>
          <p className="tune-description">These preferences guide what you see first. Other restaurants can still show up.</p>

          <SegmentedPreference
            legend="Price preference"
            description="Approximate price tier"
            options={BUDGET_OPTIONS}
            value={preferences.budget}
            onChange={(budget) => setPreferences((previous) => ({ ...previous, budget }))}
          />
          {cuisines.length > 1 && (
            <fieldset className="editorial-field">
              <legend>Cuisine</legend>
              <div className="editorial-checklist editorial-checklist-cuisine">
                {cuisines.map(({ value, label }) => (
                  <PreferenceCheck
                    key={value}
                    label={label}
                    checked={preferences.cravings.includes(value)}
                    onChange={(checked) => setPreferences((previous) => ({
                      ...previous, cravings: updateChoice(previous.cravings, value, checked),
                    }))}
                  />
                ))}
              </div>
            </fieldset>
          )}
          {occasions.length > 0 && (
            <fieldset className="editorial-field">
              <legend>Occasion &amp; vibe</legend>
              <div className="editorial-checklist">
                {occasions.map(({ value, label }) => (
                  <PreferenceCheck
                    key={value}
                    label={label}
                    checked={preferences.vibes.includes(value)}
                    onChange={(checked) => setPreferences((previous) => ({
                      ...previous, vibes: updateChoice(previous.vibes, value, checked),
                    }))}
                  />
                ))}
              </div>
            </fieldset>
          )}
          <p className="tune-option-status" role="status" data-visible={optionStatus ? "" : undefined}>
            {optionStatus ?? (reload > 0 ? <span className="sr-only">Preference choices loaded.</span> : null)}
          </p>
          {canRetry && (
            <button
              ref={retryButton}
              className="editorial-action editorial-action-secondary"
              type="button"
              aria-disabled={catalogue.status === "loading" || undefined}
              onClick={() => {
                if (catalogue.status !== "error") return;
                setCatalogue({ status: "loading" });
                setReload((attempt) => attempt + 1);
              }}
            >{catalogue.status === "loading" ? "Retrying…" : "Retry"}</button>
          )}
          <Link className="editorial-action tune-explore" href="/feed" prefetch={false}>
            Explore restaurants <MaterialIcon name="arrow_forward" />
          </Link>
        </section>
      </main>
    </div>
  );
}
