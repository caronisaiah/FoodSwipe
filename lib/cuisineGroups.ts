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

/** Tags that only the broad choice can reach: no specific Tune choice exists for them. */
export function hasBroadOnlyAsianTag(cuisineTags: readonly string[]): boolean {
  return cuisineTags.some((tag) => {
    const lower = tag.toLowerCase();
    return lower === "asian" || lower === "laotian";
  });
}

export type CuisineRow<Option> = { option: Option } | { group: true };

/**
 * Split cuisine options into the Asian members present in this market and everything
 * else, and decide whether the market shows the "Asian" group row. It does when
 *  - two or more members are present, or one member plus a broad-only Asian tag (so
 *    "All Asian" has something the single member does not), or
 *  - the user already holds Asian intent that must stay visible and clearable: "All
 *    Asian", or a selected specific this market no longer carries.
 * Otherwise (including one ordinary member, selected or not) the list is returned
 * as-is. The group replaces the first member's slot, so unrelated ordering is
 * untouched; with no member to replace it goes last.
 *
 * `canChooseAll` says whether "All Asian" can match anything here.
 */
export function groupAsianOptions<Option extends { value: Craving }>(
  options: readonly Option[],
  { selected = [], allAsian = false, broadOnly = false, pinned = false }: {
    /** The user's specific cravings (any market). */
    selected?: readonly Craving[];
    allAsian?: boolean;
    /** The market has restaurants only the broad choice reaches (asian / laotian tags). */
    broadOnly?: boolean;
    /** Keep the row while its sheet is open, so clearing the last selection cannot unmount it. */
    pinned?: boolean;
  } = {},
): { members: Option[]; rows: CuisineRow<Option>[]; canChooseAll: boolean } {
  const members = options.filter(({ value }) => isAsianChoice(value));
  const canChooseAll = members.length > 0 || broadOnly;
  const holdsHiddenIntent = pinned || allAsian || unavailableAsianChoices(selected, members).length > 0;
  const grouped = members.length >= 2 || (members.length === 1 && broadOnly) || holdsHiddenIntent;
  if (!grouped) return { members: [], rows: options.map((option) => ({ option })), canChooseAll };
  const rows: CuisineRow<Option>[] = options.flatMap((option): CuisineRow<Option>[] => {
    if (option === members[0]) return [{ group: true }];
    return isAsianChoice(option.value) ? [] : [{ option }];
  });
  if (members.length === 0) rows.push({ group: true });
  return { members, rows, canChooseAll };
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
