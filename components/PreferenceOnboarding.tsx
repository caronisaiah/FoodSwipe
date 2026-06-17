"use client";

import { useRouter } from "next/navigation";
import type { Craving, Dietary, PriceLevel, Vibe } from "@/lib/types";
import {
  BUDGET_OPTIONS,
  CRAVING_OPTIONS,
  DIETARY_OPTIONS,
  DISTANCE_OPTIONS,
  VIBE_OPTIONS,
} from "@/lib/options";
import { usePreferences } from "@/lib/storage";

/**
 * Landing + onboarding. Edits persist live (this screen doubles as the "Tune"
 * settings screen), so the CTA just sends the user to the feed.
 */
export default function PreferenceOnboarding() {
  const router = useRouter();
  const { preferences: draft, setPreferences: setDraft } = usePreferences();

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value)
      ? list.filter((v) => v !== value)
      : [...list, value];
  }

  function start() {
    router.push("/feed");
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <div className="no-scrollbar flex-1 overflow-y-auto px-5 pb-40 pt-12">
        {/* Hero */}
        <header className="mb-8">
          <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-white/8 px-3 py-1 text-xs font-medium text-haze ring-1 ring-inset ring-white/10">
            🎬 Powered by real food videos
          </p>
          <h1 className="font-display text-5xl font-bold leading-none tracking-tight">
            <span className="text-gradient">Food</span>
            <span className="text-cream">Swipe</span>
          </h1>
          <p className="mt-3 max-w-xs text-lg leading-snug text-haze">
            Swipe through restaurants powered by real food-review videos.
          </p>
        </header>

        {/* Location */}
        <Section title="Where are you?" hint="We start you in the District.">
          <input
            value={draft.location}
            onChange={(e) => setDraft({ ...draft, location: e.target.value })}
            className="w-full rounded-2xl bg-surface px-4 py-3 text-cream outline-none ring-1 ring-inset ring-white/10 placeholder:text-haze focus:ring-coral/60"
            placeholder="Washington, DC"
            aria-label="Location"
          />
        </Section>

        {/* Distance */}
        <Section title="How far will you go?">
          <Segmented
            options={DISTANCE_OPTIONS}
            value={draft.maxDistanceMiles}
            onChange={(v) => setDraft({ ...draft, maxDistanceMiles: v })}
          />
        </Section>

        {/* Budget */}
        <Section title="What's the budget?">
          <Segmented
            options={BUDGET_OPTIONS}
            value={draft.budget}
            onChange={(v: PriceLevel) => setDraft({ ...draft, budget: v })}
            renderHint={(o) => o.hint}
          />
        </Section>

        {/* Cravings */}
        <Section title="What are you craving?" hint="Pick as many as you like.">
          <ChipGrid>
            {CRAVING_OPTIONS.map((o) => (
              <Chip
                key={o.value}
                active={draft.cravings.includes(o.value)}
                onClick={() =>
                  setDraft({ ...draft, cravings: toggle<Craving>(draft.cravings, o.value) })
                }
              >
                {o.emoji} {o.label}
              </Chip>
            ))}
          </ChipGrid>
        </Section>

        {/* Vibe */}
        <Section title="Set the vibe">
          <ChipGrid>
            {VIBE_OPTIONS.map((o) => (
              <Chip
                key={o.value}
                active={draft.vibes.includes(o.value)}
                onClick={() =>
                  setDraft({ ...draft, vibes: toggle<Vibe>(draft.vibes, o.value) })
                }
              >
                {o.emoji} {o.label}
              </Chip>
            ))}
          </ChipGrid>
        </Section>

        {/* Dietary */}
        <Section title="Any dietary needs?" hint="Optional.">
          <ChipGrid>
            {DIETARY_OPTIONS.map((o) => (
              <Chip
                key={o.value}
                active={draft.dietary.includes(o.value)}
                onClick={() =>
                  setDraft({ ...draft, dietary: toggle<Dietary>(draft.dietary, o.value) })
                }
              >
                {o.emoji} {o.label}
              </Chip>
            ))}
          </ChipGrid>
        </Section>
      </div>

      {/* Sticky CTA */}
      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto max-w-md border-t border-white/10 bg-ink/85 px-5 pb-[max(env(safe-area-inset-bottom),1rem)] pt-4 backdrop-blur-lg">
        <button
          type="button"
          onClick={start}
          className="w-full rounded-full bg-brand-gradient py-4 text-center text-lg font-bold text-ink shadow-lg shadow-coral/25 transition active:scale-[0.98]"
        >
          Start swiping →
        </button>
      </div>
    </div>
  );
}

/* ----- local presentational helpers ----- */

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-7">
      <div className="mb-2.5">
        <h2 className="font-display text-base font-semibold text-cream">{title}</h2>
        {hint && <p className="text-xs text-haze">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function ChipGrid({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3.5 py-2 text-sm font-medium ring-1 ring-inset transition active:scale-95 ${
        active
          ? "bg-brand-gradient text-ink ring-transparent"
          : "bg-surface text-cream/90 ring-white/10 hover:ring-white/25"
      }`}
    >
      {children}
    </button>
  );
}

/** Single-select segmented control for distance / budget. */
function Segmented<
  V extends string | number,
  O extends { value: V; label: string; hint?: string },
>({
  options,
  value,
  onChange,
  renderHint,
}: {
  options: readonly O[];
  value: V;
  onChange: (v: V) => void;
  renderHint?: (o: O) => string;
}) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`flex flex-col items-center rounded-2xl py-3 ring-1 ring-inset transition active:scale-95 ${
              active
                ? "bg-brand-gradient text-ink ring-transparent"
                : "bg-surface text-cream/90 ring-white/10 hover:ring-white/25"
            }`}
          >
            <span className="font-display text-base font-bold">{o.label}</span>
            {renderHint && (
              <span
                className={`mt-0.5 text-[10px] ${active ? "text-ink/70" : "text-haze"}`}
              >
                {renderHint(o)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
