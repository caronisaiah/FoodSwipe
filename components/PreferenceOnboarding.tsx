"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { selectDiscoveryMarket } from "@/app/discoveryMarketActions";
import EditorialHeader from "@/components/editorial/EditorialHeader";
import MaterialIcon from "@/components/MaterialIcon";
import DiscoveryCity from "@/components/editorial/DiscoveryCity";
import AsianCuisineSheet from "@/components/editorial/AsianCuisineSheet";
import { PreferenceCheck, SegmentedPreference } from "@/components/editorial/PreferenceControls";
import {
  groupAsianOptions, hasBroadOnlyAsianTag, isAsianChoice, selectedAsianChoices, setAllAsian, setAsianChoice,
  unavailableAsianChoices, wantsAllAsian,
} from "@/lib/cuisineGroups";
import type { Market } from "@/lib/markets";
import { BUDGET_OPTIONS, CRAVING_OPTIONS, VIBE_OPTIONS } from "@/lib/options";
import { usePreferences } from "@/lib/storage";
import { useDiscoveryCatalogue } from "@/lib/useDiscoveryCatalogue";

function updateChoice<Value>(values: Value[], value: Value, checked: boolean) {
  return checked ? [...values.filter((item) => item !== value), value] : values.filter((item) => item !== value);
}

export default function PreferenceOnboarding({ market, selectableMarkets, resetSelection }: {
  market: Market | null;
  selectableMarkets: Market[];
  resetSelection: boolean;
}) {
  const { preferences, setPreferences } = usePreferences();
  const preferenceSection = useRef<HTMLElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const { catalogue, retry, retried } = useDiscoveryCatalogue(market, () => {
    if (retryButton.current === document.activeElement) preferenceSection.current?.focus({ preventScroll: true });
  });
  const [switching, startSwitch] = useTransition();
  const [switchError, setSwitchError] = useState(false);
  const [asianSheetOpen, setAsianSheetOpen] = useState(false);

  const restaurants = catalogue.status === "ready" ? catalogue.restaurants : [];
  // Only cuisines this market actually has, most-represented first (ties keep the editorial order).
  const cuisines = CRAVING_OPTIONS
    .filter(({ value }) => value !== "halal" && value !== "vegan")
    .map((option) => ({ ...option, count: restaurants.filter((place) => place.cuisineTags.includes(option.value)).length }))
    .filter(({ count }) => count > 0)
    .sort((a, b) => b.count - a.count);
  const asian = groupAsianOptions(cuisines, {
    selected: preferences.cravings,
    allAsian: wantsAllAsian(preferences),
    broadOnly: restaurants.some((place) => hasBroadOnlyAsianTag(place.cuisineTags)),
    pinned: asianSheetOpen,
  });
  const hasAsianRow = asian.rows.some((row) => "group" in row);
  const hadAsianRow = useRef(false);
  useEffect(() => {
    // If the row goes away (its last hidden selection was cleared), keep focus on the page.
    if (hadAsianRow.current && !hasAsianRow && (!document.activeElement || document.activeElement === document.body)) {
      preferenceSection.current?.focus({ preventScroll: true });
    }
    hadAsianRow.current = hasAsianRow;
  }, [hasAsianRow]);
  const selectedAsian = selectedAsianChoices(preferences.cravings);
  const unavailableAsian = unavailableAsianChoices(preferences.cravings, asian.members)
    .map((value) => ({ value, label: CRAVING_OPTIONS.find((option) => option.value === value)?.label ?? value }));
  const occasions = VIBE_OPTIONS.filter(({ value }) => restaurants.some((place) => place.vibeTags.includes(value)));
  const optionStatus = !market ? "Cuisine and occasion choices are unavailable."
    : catalogue.status === "loading" ? "Loading cuisine and occasion choices…"
      : catalogue.status === "error" ? "Cuisine and occasion choices couldn’t load."
        : cuisines.length < 2 && occasions.length === 0 ? "Cuisine and occasion choices are unavailable for this market."
          : null;
  const canRetry = Boolean(market) && (catalogue.status === "error" || (catalogue.status === "loading" && retried));

  return (
    <div className="editorial-canvas tune">
      <EditorialHeader skipTo="tune-preferences" skipLabel="Skip to preferences" />

      <main className="tune-layout">
        <DiscoveryCity
          market={market}
          selectableMarkets={selectableMarkets}
          resetSelection={resetSelection}
          switching={switching}
          switchError={switchError}
          onSelect={(next, close) => {
            if (switching) return;
            setSwitchError(false);
            startSwitch(async () => {
              try {
                if (await selectDiscoveryMarket(next)) {
                  close();
                  return;
                }
              } catch {
                // The existing selected market remains in place on failure.
              }
              setSwitchError(true);
            });
          }}
        />
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
          {(cuisines.length > 1 || (catalogue.status === "ready" && hasAsianRow)) && (
            <fieldset className="editorial-field">
              <legend>Cuisine</legend>
              <div className="editorial-checklist editorial-checklist-cuisine">
                {asian.rows.map((row) => "group" in row ? (
                  <AsianCuisineSheet
                    key="asian"
                    choices={asian.members}
                    unavailable={unavailableAsian}
                    canChooseAll={asian.canChooseAll}
                    allAsian={wantsAllAsian(preferences)}
                    onOpenChange={setAsianSheetOpen}
                    selected={selectedAsian}
                    onAll={(checked) => setPreferences((previous) => setAllAsian(previous, checked))}
                    onChoice={(choice, checked) => setPreferences((previous) => setAsianChoice(previous, choice, checked))}
                  />
                ) : (
                  <PreferenceCheck
                    key={row.option.value}
                    label={row.option.label}
                    checked={preferences.cravings.includes(row.option.value)}
                    onChange={(checked) => setPreferences((previous) => isAsianChoice(row.option.value)
                      // A lone Asian choice is still exclusive with "All Asian".
                      ? setAsianChoice(previous, row.option.value, checked)
                      : { ...previous, cravings: updateChoice(previous.cravings, row.option.value, checked) })}
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
            {optionStatus ?? (retried ? <span className="sr-only">Preference choices loaded.</span> : null)}
          </p>
          {canRetry && (
            <button
              ref={retryButton}
              className="editorial-action editorial-action-secondary"
              type="button"
              aria-disabled={catalogue.status === "loading" || undefined}
              onClick={() => {
                if (catalogue.status === "error") retry();
              }}
            >{catalogue.status === "loading" ? "Retrying…" : "Retry"}</button>
          )}
          <Link
            className="editorial-action tune-explore"
            href="/feed"
            prefetch={false}
            aria-disabled={switching || !market || undefined}
            onClick={(event) => { if (switching || !market) event.preventDefault(); }}
          >
            Explore restaurants <MaterialIcon name="arrow_forward" />
          </Link>
        </section>
      </main>
    </div>
  );
}
