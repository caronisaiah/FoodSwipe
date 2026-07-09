import type { Cuisine, Dietary, Vibe } from "@/lib/types";

/**
 * Deterministic, conservative tag suggester for imported restaurant candidates.
 *
 * Pure + side-effect-free. Given Google import context (name, primaryType, types,
 * priceLevel, query, …) it proposes review fields drawn ONLY from the controlled
 * vocab in `lib/types.ts`. It is intentionally cautious:
 *   - cuisine/dish only when the Google type or the name clearly implies it;
 *   - dietary tags ONLY when explicit in name/types/query (never assumed);
 *   - vibe/bestFor only from price + an obviously-matching service style;
 *   - dish highlights stay empty unless the dish is directly implied by the
 *     name/type (Tacos / Ramen / Pizza / Pastries / Ice cream) — never invented.
 *
 * Every suggestion is explained in `suggestionReasons`. The deterministic import
 * pass does NOT generate `reasonText` because that field is public profile copy.
 * Output remains a STARTING POINT for a human reviewer; it is never
 * auto-approved or directly published to `/feed`.
 */

export type SuggestionConfidence = "low" | "medium" | "high";

export interface CandidateTagInput {
  name?: string | null;
  /** Google Places (New) primaryType, e.g. "mexican_restaurant". */
  primaryType?: string | null;
  /** Google Places (New) types[]. */
  types?: string[] | null;
  /** Mapped FoodSwipe price level 1–4 (or null). */
  priceLevel?: number | null;
  /** The Text Search query that surfaced this result. */
  query?: string | null;
  websiteDomain?: string | null;
  reviewLikelihoodScore?: number | null;
}

export interface CandidateSuggestion {
  cuisineTags: Cuisine[];
  dietaryTags: Dietary[];
  vibeTags: Vibe[];
  bestFor: Vibe[];
  dishHighlights: string[];
  reasonText: string;
  suggestionConfidence: SuggestionConfidence;
  suggestionReasons: string[];
}

export interface TypeRule {
  cuisines: Cuisine[];
  /** Dish only when the type unambiguously implies one. */
  dish?: string;
}

// Google Places (New) type → controlled-vocab cuisines (conservative).
// Exported so the shared engine (lib/tagSuggester.ts) reuses the SAME rule data
// without changing this module's behavior.
export const TYPE_RULES: Record<string, TypeRule> = {
  mexican_restaurant: { cuisines: ["mexican", "tacos", "street food"] },
  taco_restaurant: { cuisines: ["mexican", "tacos", "street food"], dish: "Tacos" },
  ramen_restaurant: { cuisines: ["ramen", "japanese", "noodles"], dish: "Ramen" },
  japanese_restaurant: { cuisines: ["japanese"] },
  sushi_restaurant: { cuisines: ["sushi", "japanese"] },
  bakery: { cuisines: ["bakery"], dish: "Pastries" },
  cafe: { cuisines: ["cafe"] },
  coffee_shop: { cuisines: ["coffee", "cafe"] },
  ice_cream_shop: { cuisines: ["dessert", "ice cream"], dish: "Ice cream" },
  american_restaurant: { cuisines: ["american"] },
  italian_restaurant: { cuisines: ["italian", "pasta", "dinner"] },
  pizza_restaurant: { cuisines: ["pizza"], dish: "Pizza" },
  indian_restaurant: { cuisines: ["indian"] },
  korean_restaurant: { cuisines: ["korean"] },
  ethiopian_restaurant: { cuisines: ["ethiopian"] },
  seafood_restaurant: { cuisines: ["seafood"] },
  french_restaurant: { cuisines: ["french"] },
  mediterranean_restaurant: { cuisines: ["mediterranean"] },
  middle_eastern_restaurant: { cuisines: ["middle eastern"] },
  hamburger_restaurant: { cuisines: ["burgers"] },
  vegan_restaurant: { cuisines: ["vegan"] },
  vegetarian_restaurant: { cuisines: ["vegetarian"] },
  brunch_restaurant: { cuisines: ["brunch"] },
  breakfast_restaurant: { cuisines: ["brunch"] },
  steak_house: { cuisines: ["american", "dinner"] },
  bagel_shop: { cuisines: ["bagels"] },
};

export interface NameRule {
  kw: string[];
  cuisines: Cuisine[];
  dish?: string;
}

// Name keywords → cuisines (used when the type is generic/absent, or to reinforce
// and to attach a directly-implied dish like a taqueria's "Tacos").
export const NAME_RULES: NameRule[] = [
  { kw: ["taqueria", "taquería", "taco"], cuisines: ["mexican", "tacos", "street food"], dish: "Tacos" },
  { kw: ["ramen"], cuisines: ["ramen", "japanese", "noodles"], dish: "Ramen" },
  { kw: ["sushi"], cuisines: ["sushi", "japanese"] },
  { kw: ["omakase"], cuisines: ["omakase", "sushi", "japanese"] },
  { kw: ["pizzeria", "pizza"], cuisines: ["pizza"], dish: "Pizza" },
  { kw: ["patisserie", "pâtisserie", "boulangerie", "bakery", "bakehouse"], cuisines: ["bakery"], dish: "Pastries" },
  { kw: ["coffee", "espresso", "roasters", "roastery", "café", "cafe"], cuisines: ["coffee", "cafe"] },
  { kw: ["gelato", "gelateria", "ice cream", "creamery"], cuisines: ["dessert", "ice cream"], dish: "Ice cream" },
  { kw: ["noodle", "noodles"], cuisines: ["noodles", "asian"] },
  { kw: ["pho"], cuisines: ["noodles", "asian"] },
  { kw: ["kebab", "shawarma", "doner", "döner"], cuisines: ["kebab", "middle eastern"] },
  { kw: ["burger"], cuisines: ["burgers"] },
  { kw: ["bagel"], cuisines: ["bagels"] },
  { kw: ["trattoria", "osteria", "ristorante"], cuisines: ["italian", "pasta", "dinner"] },
  { kw: ["cantina"], cuisines: ["mexican"] },
  { kw: ["diner"], cuisines: ["diner", "american"] },
];

// Dietary is added ONLY when explicit. Each entry: keyword → dietary tag.
export const DIETARY_RULES: { kw: string[]; tag: Dietary }[] = [
  { kw: ["vegan"], tag: "vegan" },
  { kw: ["vegetarian", "veggie"], tag: "vegetarian" },
  { kw: ["halal"], tag: "halal" },
  { kw: ["gluten-free", "gluten free"], tag: "gluten-free" },
  { kw: ["no pork", "pork-free", "pork free"], tag: "no pork" },
];

// Quick-service signals (paired with price 1–2) → "quick bite" / "casual".
export const QUICK_TYPES = new Set([
  "fast_food_restaurant",
  "cafe",
  "coffee_shop",
  "bakery",
  "ice_cream_shop",
  "sandwich_shop",
  "meal_takeaway",
  "pizza_restaurant",
  "ramen_restaurant",
  "hamburger_restaurant",
  "bagel_shop",
  "taco_restaurant",
]);

// Sit-down dinner signals (paired with price 3–4) → "date night" / "group dinner".
export const DINNER_TYPES = new Set([
  "italian_restaurant",
  "french_restaurant",
  "steak_house",
  "seafood_restaurant",
  "sushi_restaurant",
  "japanese_restaurant",
  "american_restaurant",
  "fine_dining_restaurant",
  "mediterranean_restaurant",
]);

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Match a keyword as a whole word / phrase (boundary-aware), NOT a raw substring,
 * so "Whalala Cafe" never yields "halal" and "Vegano Pizza" never yields "vegan".
 * Boundaries are any non-[a-z0-9] char (so "vegan_restaurant" still matches
 * "vegan", and multi-word phrases like "ice cream"/"no pork" still match).
 */
export function matchesAny(haystack: string, needles: string[]): string | null {
  for (const n of needles) {
    if (!n) continue;
    const re = new RegExp(`(?:^|[^a-z0-9])${escapeRe(n)}(?:[^a-z0-9]|$)`, "i");
    if (re.test(haystack)) return n;
  }
  return null;
}

/**
 * Suggest conservative review tags for an imported candidate. Pure: same input →
 * same output. All tag values are from the controlled vocab in `lib/types.ts`.
 */
export function suggestCandidateTags(input: CandidateTagInput): CandidateSuggestion {
  const name = (input.name ?? "").toLowerCase().trim();
  const query = (input.query ?? "").toLowerCase().trim();
  const primaryType = (input.primaryType ?? "").toLowerCase().trim();
  const types = (Array.isArray(input.types) ? input.types : []).map((t) => t.toLowerCase().trim());
  const priceLevel =
    typeof input.priceLevel === "number" && Number.isFinite(input.priceLevel)
      ? input.priceLevel
      : null;
  const nameAndQuery = `${name} ${query}`;
  const typeBlob = [primaryType, ...types].join(" ");

  const cuisines: Cuisine[] = [];
  const dishes: string[] = [];
  const reasons: string[] = [];
  let cuisineFromPrimary = false;
  let cuisineFromTypes = false;
  let cuisineFromName = false;

  // 1) Cuisine + dish from Google primaryType (strongest signal).
  const primaryRule = primaryType ? TYPE_RULES[primaryType] : undefined;
  if (primaryRule) {
    cuisines.push(...primaryRule.cuisines);
    cuisineFromPrimary = true;
    reasons.push(`Cuisine ${fmt(primaryRule.cuisines)} from Google primaryType "${primaryType}".`);
    if (primaryRule.dish) {
      dishes.push(primaryRule.dish);
      reasons.push(`Dish "${primaryRule.dish}" implied by Google type "${primaryType}".`);
    }
  }

  // 2) Cuisine from secondary Google types[].
  for (const t of types) {
    if (t === primaryType) continue;
    const rule = TYPE_RULES[t];
    if (!rule) continue;
    cuisines.push(...rule.cuisines);
    cuisineFromTypes = true;
    reasons.push(`Cuisine ${fmt(rule.cuisines)} from Google type "${t}".`);
    if (rule.dish && !dishes.includes(rule.dish)) {
      dishes.push(rule.dish);
      reasons.push(`Dish "${rule.dish}" implied by Google type "${t}".`);
    }
  }

  // 3) Cuisine + dish from name keywords (also attaches taqueria→Tacos etc.).
  for (const rule of NAME_RULES) {
    const hit = matchesAny(name, rule.kw);
    if (!hit) continue;
    cuisines.push(...rule.cuisines);
    cuisineFromName = true;
    reasons.push(`Cuisine ${fmt(rule.cuisines)} from name keyword "${hit}".`);
    if (rule.dish && !dishes.includes(rule.dish)) {
      dishes.push(rule.dish);
      reasons.push(`Dish "${rule.dish}" implied by name keyword "${hit}".`);
    }
  }

  // 4) "brunch" is a strong query/name signal (e.g. american_restaurant + brunch).
  if (matchesAny(nameAndQuery, ["brunch"])) {
    cuisines.push("brunch");
    if (!cuisineFromPrimary && !cuisineFromTypes) cuisineFromName = true;
    reasons.push(`Cuisine "brunch" from "brunch" in name/query.`);
  }

  // 5) Dietary — ONLY when explicit in name/types/query.
  const dietary: Dietary[] = [];
  const dietaryBlob = `${nameAndQuery} ${typeBlob}`;
  for (const rule of DIETARY_RULES) {
    const hit = matchesAny(dietaryBlob, rule.kw);
    if (!hit) continue;
    dietary.push(rule.tag);
    reasons.push(`Dietary "${rule.tag}" — "${hit}" found explicitly in name/type/query.`);
    // vegan/vegetarian are also cuisine vocab; reflect a dedicated type as cuisine.
    if (rule.tag === "vegan" && (primaryType === "vegan_restaurant" || types.includes("vegan_restaurant"))) {
      cuisines.push("vegan");
    }
    if (
      rule.tag === "vegetarian" &&
      (primaryType === "vegetarian_restaurant" || types.includes("vegetarian_restaurant"))
    ) {
      cuisines.push("vegetarian");
    }
  }

  // 6) Vibe / bestFor — price + an obviously-matching service style only.
  const vibeTags: Vibe[] = [];
  const bestFor: Vibe[] = [];
  const isQuickType =
    QUICK_TYPES.has(primaryType) ||
    types.some((t) => QUICK_TYPES.has(t)) ||
    matchesAny(name, ["taqueria", "taco", "pizza", "ramen", "bakery", "cafe", "coffee", "burger", "bagel", "ice cream"]) !==
      null;
  const isDinnerType =
    DINNER_TYPES.has(primaryType) ||
    types.some((t) => DINNER_TYPES.has(t)) ||
    matchesAny(name, ["trattoria", "osteria", "ristorante", "omakase"]) !== null;

  if (priceLevel !== null && priceLevel <= 2 && isQuickType) {
    bestFor.push("quick bite");
    vibeTags.push("casual");
    reasons.push(`bestFor "quick bite" + vibe "casual" from price level ${priceLevel} + quick-service type.`);
  } else if (priceLevel !== null && priceLevel >= 3 && isDinnerType) {
    bestFor.push("date night", "group dinner");
    reasons.push(`bestFor "date night"/"group dinner" from price level ${priceLevel} + sit-down dinner type.`);
  }

  // Very conservative extras — explicit signals only.
  if (matchesAny(nameAndQuery, ["late night", "open late", "24 hour", "24-hour"])) {
    vibeTags.push("late night");
    reasons.push(`vibe "late night" — explicit "late"/"24 hour" in name/query.`);
  }
  if (matchesAny(nameAndQuery, ["hidden gem"])) {
    vibeTags.push("hidden gem");
    reasons.push(`vibe "hidden gem" — explicit in query.`);
  }

  if (cuisines.length === 0) {
    reasons.push("No confident cuisine signal from Google type/name; left for human review.");
  }
  reasons.push("Reason text is public profile copy; deterministic import left it blank for human review.");

  const confidence: SuggestionConfidence = cuisineFromPrimary
    ? "high"
    : cuisineFromTypes || cuisineFromName
      ? "medium"
      : "low";

  return {
    cuisineTags: uniq(cuisines),
    dietaryTags: uniq(dietary),
    vibeTags: uniq(vibeTags),
    bestFor: uniq(bestFor),
    dishHighlights: uniq(dishes),
    reasonText: "",
    suggestionConfidence: confidence,
    suggestionReasons: reasons,
  };
}

function fmt(cuisines: Cuisine[]): string {
  return cuisines.map((c) => `"${c}"`).join(", ");
}
