import type { BroadCuisine, Craving, Cuisine, UserPreferences } from "./types";

/**
 * Tune groups the Asian specifics under one "Asian" row. This module is the single
 * definition of that grouping, shared by the Tune UI and the ranking so they cannot
 * drift apart. It is pure (no React, no storage).
 *
 * Only cuisines the vocabulary already supports as specific choices are grouped.
 * Generic tags (noodles, street food, omakase) are deliberately NOT members.
 */

/** The specific Tune choices that belong under "Asian". */
export const ASIAN_CHOICES: readonly Craving[] = [
  "chinese", "filipino", "indian", "japanese", "korean", "thai", "vietnamese",
  "dim sum", "sushi", "ramen",
];

/**
 * Restaurant tags that make a place a match for the broad "All Asian" choice: every
 * choice above, the literal `asian` tag, and `laotian` (a supported tag with no Tune
 * choice of its own, so a Laotian place would otherwise be invisible to a broad pick).
 */
const ASIAN_TAGS: ReadonlySet<string> = new Set<Cuisine>([...ASIAN_CHOICES, "asian", "laotian"]);
const ASIAN_CHOICE_SET: ReadonlySet<string> = new Set(ASIAN_CHOICES);

export function isAsianChoice(value: string): value is Craving {
  return ASIAN_CHOICE_SET.has(value);
}

/** Does a restaurant's cuisine list make it an Asian match? */
export function hasAsianTag(cuisineTags: readonly string[]): boolean {
  return cuisineTags.some((tag) => ASIAN_TAGS.has(tag.toLowerCase()));
}

/** True when the preferences carry the broad Asian intent. */
export function wantsAllAsian(prefs: Pick<UserPreferences, "broadCuisines">): boolean {
  return prefs.broadCuisines.includes("asian");
}

/**
 * Split cuisine options into the Asian members present in this market and everything
 * else. The group replaces the first member in the list (the first grouped slot), so
 * unrelated ordering is untouched. Fewer than two members means there is nothing worth
 * grouping, so the list is returned as-is.
 */
export function groupAsianOptions<Option extends { value: Craving }>(options: readonly Option[]): {
  members: Option[];
  rows: { option: Option; group?: true }[];
} {
  const members = options.filter(({ value }) => isAsianChoice(value));
  if (members.length < 2) return { members: [], rows: options.map((option) => ({ option })) };
  return {
    members,
    rows: options.flatMap((option) => {
      if (option === members[0]) return [{ option, group: true as const }];
      return isAsianChoice(option.value) ? [] : [{ option }];
    }),
  };
}

/** Specific Asian choices the user holds, in stored order. */
export function selectedAsianChoices(cravings: readonly Craving[]): Craving[] {
  return cravings.filter(isAsianChoice);
}

/** Selected Asian specifics the active market does not carry (kept, and shown, so they can be cleared). */
export function unavailableAsianChoices(cravings: readonly Craving[], available: readonly { value: Craving }[]): Craving[] {
  return selectedAsianChoices(cravings).filter((value) => !available.some((option) => option.value === value));
}

/** "All Asian" on/off. Turning it on replaces the specific Asian choices; other cuisines stay. */
export function setAllAsian(prefs: UserPreferences, on: boolean): UserPreferences {
  const broad: BroadCuisine[] = prefs.broadCuisines.filter((value) => value !== "asian");
  return {
    ...prefs,
    broadCuisines: on ? [...broad, "asian"] : broad,
    cravings: on ? prefs.cravings.filter((value) => !isAsianChoice(value)) : prefs.cravings,
  };
}

/** Pick or clear one Asian specific. Picking one ends "All Asian" (they are exclusive). */
export function setAsianChoice(prefs: UserPreferences, value: Craving, on: boolean): UserPreferences {
  const others = prefs.cravings.filter((craving) => craving !== value);
  return {
    ...prefs,
    broadCuisines: on ? prefs.broadCuisines.filter((broad) => broad !== "asian") : prefs.broadCuisines,
    cravings: on ? [...others, value] : others,
  };
}
