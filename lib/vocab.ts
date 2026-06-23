import type { Cuisine, Dietary, Vibe } from "@/lib/types";

/**
 * Runtime mirrors of the controlled vocab defined as TYPES in `lib/types.ts`.
 *
 * The type unions give compile-time safety in code; these arrays give RUNTIME
 * validation for untrusted data (DB rows, admin PATCH bodies) so we can drop any
 * value that isn't in the vocab rather than persisting "impossible" tags. Keep
 * these in sync with `lib/types.ts` (a value present here but not in the union —
 * or vice-versa — is a bug).
 */

export const CUISINES = [
  "burgers", "sushi", "tacos", "pasta", "soul food", "ramen", "coffee", "dessert",
  "mediterranean", "halal", "vegan", "filipino", "asian", "dinner", "middle eastern",
  "french", "brunch", "american", "new american", "italian", "japanese", "noodles",
  "southern", "diner", "mexican", "street food", "bar food", "british", "omakase",
  "cafe", "bakery", "vegetarian", "persian", "kebab", "ice cream", "indian", "korean",
  "ethiopian", "laotian", "seafood", "pizza", "bagels",
] as const satisfies readonly Cuisine[];

export const DIETARY = [
  "vegetarian", "vegan", "halal", "gluten-free", "no pork",
] as const satisfies readonly Dietary[];

export const VIBES = [
  "quick bite", "date night", "group dinner", "late night", "aesthetic",
  "hidden gem", "casual",
] as const satisfies readonly Vibe[];

const CUISINE_SET = new Set<string>(CUISINES);
const DIETARY_SET = new Set<string>(DIETARY);
const VIBE_SET = new Set<string>(VIBES);

/** Keep only valid, de-duplicated cuisine tags (trimmed); drop anything else. */
export function filterCuisines(v: unknown): Cuisine[] {
  return filterVocab(v, CUISINE_SET) as Cuisine[];
}
export function filterDietary(v: unknown): Dietary[] {
  return filterVocab(v, DIETARY_SET) as Dietary[];
}
export function filterVibes(v: unknown): Vibe[] {
  return filterVocab(v, VIBE_SET) as Vibe[];
}

function filterVocab(v: unknown, set: Set<string>): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== "string") continue;
    const t = raw.trim();
    if (t && set.has(t) && !out.includes(t)) out.push(t);
  }
  return out;
}

/** True iff every provided tag is in the given vocab (for strict PATCH checks). */
export function allInVocab(v: unknown, kind: "cuisine" | "dietary" | "vibe"): boolean {
  if (!Array.isArray(v)) return false;
  const set = kind === "cuisine" ? CUISINE_SET : kind === "dietary" ? DIETARY_SET : VIBE_SET;
  return v.every((x) => typeof x === "string" && set.has(x.trim()));
}
