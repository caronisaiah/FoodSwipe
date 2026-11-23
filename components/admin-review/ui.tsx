"use client";

import MaterialIcon from "@/components/MaterialIcon";
import type { ChecklistState, StageState } from "@/lib/adminReview";

export type Tone = "mint" | "saffron" | "chili" | "haze" | "tan";

const TONE_CLASS: Record<Tone, string> = {
  mint: "bg-mint/15 text-mint ring-mint/30",
  saffron: "bg-saffron/15 text-saffron ring-saffron/30",
  chili: "bg-chili/15 text-chili-soft ring-chili/30",
  haze: "bg-white/5 text-haze ring-white/10",
  tan: "bg-white/10 text-tan ring-white/15",
};

export function Chip({ tone = "haze", children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

/** A titled block of the workspace. `id` is the in-page anchor used by the jump links. */
export function Section({ id, title, icon, chip, children }: { id: string; title: string; icon: string; chip?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-28 rounded-xl bg-surface-1 p-3 ring-1 ring-inset ring-white/10 sm:p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-title`} className="flex items-center gap-2 font-display text-base font-bold text-cream">
          <MaterialIcon name={icon} className="text-lg text-saffron" />
          {title}
        </h2>
        {chip}
      </header>
      {children}
    </section>
  );
}

const CHECK_ICON: Record<ChecklistState, { icon: string; cls: string; label: string }> = {
  complete: { icon: "check_circle", cls: "text-mint", label: "Complete" },
  missing: { icon: "radio_button_unchecked", cls: "text-saffron", label: "Missing" },
  invalid: { icon: "error", cls: "text-chili-soft", label: "Invalid" },
  human: { icon: "person_alert", cls: "text-saffron", label: "Needs a person" },
  info: { icon: "info", cls: "text-haze", label: "Note" },
};

export function CheckIcon({ state }: { state: ChecklistState }) {
  const c = CHECK_ICON[state];
  return (
    <span className={`inline-flex shrink-0 ${c.cls}`} role="img" aria-label={c.label} title={c.label}>
      <MaterialIcon name={c.icon} className="text-base" />
    </span>
  );
}

const STAGE_ICON: Record<StageState, { icon: string; cls: string; label: string }> = {
  yes: { icon: "check_circle", cls: "text-mint", label: "Yes" },
  partial: { icon: "timelapse", cls: "text-saffron", label: "Partly" },
  declared: { icon: "edit_note", cls: "text-saffron", label: "Declared by a reviewer, not verified by the system" },
  no: { icon: "cancel", cls: "text-chili-soft", label: "No" },
  not_recorded: { icon: "help", cls: "text-haze", label: "Not recorded" },
};

export function StageIcon({ state }: { state: StageState }) {
  const c = STAGE_ICON[state];
  return (
    <span className={`inline-flex shrink-0 ${c.cls}`} role="img" aria-label={c.label} title={c.label}>
      <MaterialIcon name={c.icon} className="text-base" />
    </span>
  );
}

export const inputClass = "w-full rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs text-cream outline-none ring-1 ring-inset ring-white/10 placeholder:text-haze/50 focus:ring-saffron/60 disabled:opacity-50";

export const primaryButton = "rounded-md bg-brand-gradient px-3 py-1.5 text-xs font-bold text-ink transition active:scale-[0.98] disabled:opacity-40";
export const quietButton = "inline-flex items-center gap-1 rounded-md bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-cream ring-1 ring-inset ring-white/15 transition hover:bg-white/20 disabled:opacity-40";

export function shortDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 10);
}

/** "restaurant_video.restored" becomes "Restaurant video restored". */
export function humanAction(action: string): string {
  const text = action.replace(/[._]/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
