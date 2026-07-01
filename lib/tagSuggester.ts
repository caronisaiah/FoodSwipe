import type { Cuisine, Vibe } from "@/lib/types";
import type { Market } from "@/lib/markets";
import { CUISINES, DIETARY, VIBES } from "@/lib/vocab";
import {
  DIETARY_RULES,
  DINNER_TYPES,
  NAME_RULES,
  QUICK_TYPES,
  TYPE_RULES,
  matchesAny,
} from "@/lib/candidateTagger";

/**
 * Tag Automation B2 — shared, deterministic, PURE tag-suggestion engine.
 *
 * Generalizes the candidate-import tagger (lib/candidateTagger.ts, whose
 * suggestCandidateTags export is unchanged) so the SAME conservative rules can
 * suggest tags for BOTH candidate and published restaurants, on demand. It writes
 * nothing, calls nothing external, and only ever proposes — humans approve.
 *
 * Hard rules baked in:
 *  - cuisine/dietary/vibe/bestFor values are emitted ONLY from the controlled
 *    vocab (lib/vocab.ts); out-of-vocab values can never be produced.
 *  - dishHighlights are literally supported (name/type implied, or a known dish
 *    keyword present in a caption / admin text) — never free-form invented.
 *  - dietary requires EXPLICIT evidence.
 *  - reasonText is shown publicly verbatim, so the engine NEVER generates it
 *    (no marketing / "best" / "#1" claims) — it only warns the admin to write it.
 *  - caption-derived hints are ALWAYS reviewOnly + not autoFillSafe + low
 *    confidence + attributed; one caption can never silently define a restaurant.
 *  - existing tags are CONTEXT (dedupe), not re-emitted as new claims.
 */

export type TagSuggestionField =
  | "cuisineTags"
  | "dietaryTags"
  | "vibeTags"
  | "bestFor"
  | "dishHighlights"
  | "reasonText";

export type TagSuggestionConfidence = "high" | "medium" | "low";

export type TagSuggestionEvidenceSource =
  | "google_primary_type"
  | "google_type"
  | "name"
  | "price_level"
  | "existing_tag"
  | "video_candidate_caption"
  | "attached_video_caption"
  | "admin_text"
  | "neutral_template"
  // Official-website evidence (B4) — the doc's section type.
  | "website_homepage"
  | "website_menu"
  | "website_about"
  | "website_events"
  | "website_unknown";

export interface TagSuggestion {
  field: TagSuggestionField;
  value: string;
  confidence: TagSuggestionConfidence;
  reason: string;
  evidenceSource: TagSuggestionEvidenceSource;
  /** The raw text that justified this suggestion (e.g. the caption), if useful. */
  evidenceText?: string;
  /** True = a human must review before this can be applied (caption hints, etc.). */
  reviewOnly: boolean;
  /** True only when it is safe to pre-fill without review (high-confidence facts). */
  autoFillSafe: boolean;
}

/** One review-only caption hint source (collected server-side, bounded). */
export interface CaptionSource {
  caption: string;
  creatorHandle?: string | null;
  creatorName?: string | null;
  platform?: string | null;
  sourceUrl?: string | null;
  origin: "video_candidate_caption" | "attached_video_caption";
}

export interface TagSuggestionContext {
  name?: string | null;
  market?: Market | null;
  neighborhood?: string | null;
  priceLevel?: number | null;
  /** Google import context — present only at import time, absent on-demand. */
  googlePrimaryType?: string | null;
  googleTypes?: string[] | null;
  query?: string | null;
  /** Current curated tags — used as context (dedupe), never re-emitted as claims. */
  existing?: {
    cuisineTags?: string[] | null;
    dietaryTags?: string[] | null;
    vibeTags?: string[] | null;
    bestFor?: string[] | null;
    dishHighlights?: string[] | null;
  } | null;
  /** Admin's OWN words (reasonText/reviewNotes) — evidence, never new claims. */
  adminText?: string | null;
  /** Review-only caption hints (bounded, attributed). */
  captions?: CaptionSource[] | null;
}

export interface TagSuggestionResult {
  suggestionsByField: Record<TagSuggestionField, TagSuggestion[]>;
  overallConfidence: TagSuggestionConfidence;
  reasons: string[];
  warnings: string[];
}

// Known dish keyword (lowercase) → canonical display. Captions/admin-text dishes
// are suggested ONLY from this curated lexicon (or a directly-implied type/name
// dish) — we never extract arbitrary noun phrases, so a noisy caption like
// "this place is INSANE 🔥" yields NO dish.
const DISH_KEYWORDS: Record<string, string> = {
  tacos: "Tacos",
  taco: "Tacos",
  ramen: "Ramen",
  pizza: "Pizza",
  burger: "Burger",
  burgers: "Burgers",
  sushi: "Sushi",
  omakase: "Omakase",
  pho: "Pho",
  dumplings: "Dumplings",
  bagel: "Bagels",
  bagels: "Bagels",
  croissant: "Croissant",
  croissants: "Croissant",
  pastries: "Pastries",
  brunch: "Brunch",
  pasta: "Pasta",
  "steak frites": "Steak frites",
  "fried chicken": "Fried chicken",
  "ice cream": "Ice cream",
  gelato: "Gelato",
  pancakes: "Pancakes",
  wings: "Wings",
  kebab: "Kebab",
  shawarma: "Shawarma",
  bbq: "BBQ",
  noodles: "Noodles",
};

const MAX_DISH_LEN = 40;

/** Strip leading emoji/hashtags/markup, collapse whitespace, cap length. */
function normalizeDish(raw: string): string | null {
  let d = raw
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, " ") // emoji
    .replace(/[#*_~`>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (d.length < 2) return null;
  if (d.length > MAX_DISH_LEN) d = d.slice(0, MAX_DISH_LEN).trim();
  return d;
}

/** Remove emoji/hashtags/handles/urls from a caption before keyword matching. */
function cleanCaptionText(raw: string): string {
  return raw
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[@#]\w+/g, " ")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

function attribution(c: CaptionSource): string {
  const who = c.creatorName || c.creatorHandle;
  const platform = c.platform ? ` ${c.platform}` : "";
  return who ? ` (${who}${platform ? ` on${platform}` : ""})` : platform ? ` (${platform.trim()})` : "";
}

/**
 * Suggest conservative, explainable tags for a candidate OR published restaurant.
 * Pure: same input → same output. Never emits out-of-vocab cuisine/dietary/vibe/
 * bestFor, never invents dishes, never generates reasonText.
 */
export function suggestTagsForRestaurant(ctx: TagSuggestionContext): TagSuggestionResult {
  const byField: Record<TagSuggestionField, TagSuggestion[]> = {
    cuisineTags: [],
    dietaryTags: [],
    vibeTags: [],
    bestFor: [],
    dishHighlights: [],
    reasonText: [],
  };
  const reasons: string[] = [];
  const warnings: string[] = [];

  const name = (ctx.name ?? "").toLowerCase().trim();
  const query = (ctx.query ?? "").toLowerCase().trim();
  const adminText = (ctx.adminText ?? "").toLowerCase().trim();
  const primaryType = (ctx.googlePrimaryType ?? "").toLowerCase().trim();
  const types = (Array.isArray(ctx.googleTypes) ? ctx.googleTypes : []).map((t) => String(t).toLowerCase().trim());
  const priceLevel =
    typeof ctx.priceLevel === "number" && Number.isFinite(ctx.priceLevel) ? ctx.priceLevel : null;
  const nameAndQuery = `${name} ${query}`;
  const typeBlob = [primaryType, ...types].join(" ");

  // Existing curated tags (context only — dedupe so we never re-emit them as claims).
  const have = {
    cuisine: new Set((ctx.existing?.cuisineTags ?? []).map((t) => t.toLowerCase())),
    dietary: new Set((ctx.existing?.dietaryTags ?? []).map((t) => t.toLowerCase())),
    vibe: new Set((ctx.existing?.vibeTags ?? []).map((t) => t.toLowerCase())),
    bestFor: new Set((ctx.existing?.bestFor ?? []).map((t) => t.toLowerCase())),
    dish: new Set((ctx.existing?.dishHighlights ?? []).map((t) => t.toLowerCase())),
  };

  // De-dupe per field across the whole run (case-insensitive), best evidence wins
  // by insertion order (high-confidence structured sources are pushed first).
  const emitted = {
    cuisineTags: new Set<string>(),
    dietaryTags: new Set<string>(),
    vibeTags: new Set<string>(),
    bestFor: new Set<string>(),
    dishHighlights: new Set<string>(),
    reasonText: new Set<string>(),
  };

  function emit(s: TagSuggestion) {
    const key = s.value.toLowerCase();
    if (emitted[s.field].has(key)) return;
    emitted[s.field].add(key);
    byField[s.field].push(s);
  }

  // ---- cuisine ----
  let cuisineHigh = false;
  let cuisineMed = false;

  function addCuisines(values: Cuisine[], conf: TagSuggestionConfidence, src: TagSuggestionEvidenceSource, why: string) {
    for (const c of values) {
      if (!CUISINES.includes(c)) continue; // vocab gate (defensive)
      if (have.cuisine.has(c.toLowerCase())) continue; // already curated
      emit({
        field: "cuisineTags",
        value: c,
        confidence: conf,
        reason: why,
        evidenceSource: src,
        reviewOnly: false,
        autoFillSafe: conf === "high",
      });
    }
  }
  function addDish(dish: string, conf: TagSuggestionConfidence, src: TagSuggestionEvidenceSource, why: string, evidenceText?: string) {
    const d = normalizeDish(dish);
    if (!d) return;
    if (have.dish.has(d.toLowerCase())) return;
    emit({
      field: "dishHighlights",
      value: d,
      confidence: conf,
      reason: why,
      evidenceSource: src,
      evidenceText,
      // Dishes are shown publicly verbatim → never auto-fill, always a human click.
      reviewOnly: src === "video_candidate_caption" || src === "attached_video_caption",
      autoFillSafe: false,
    });
  }

  // 1) Google primaryType (strongest).
  const primaryRule = primaryType ? TYPE_RULES[primaryType] : undefined;
  if (primaryRule) {
    cuisineHigh = true;
    addCuisines(primaryRule.cuisines, "high", "google_primary_type", `Google primaryType "${primaryType}".`);
    if (primaryRule.dish) addDish(primaryRule.dish, "medium", "google_primary_type", `Dish implied by Google type "${primaryType}".`);
  }
  // 2) Secondary Google types[].
  for (const t of types) {
    if (t === primaryType) continue;
    const rule = TYPE_RULES[t];
    if (!rule) continue;
    cuisineMed = true;
    addCuisines(rule.cuisines, "medium", "google_type", `Google type "${t}".`);
    if (rule.dish) addDish(rule.dish, "medium", "google_type", `Dish implied by Google type "${t}".`);
  }
  // 3) Name keywords.
  for (const rule of NAME_RULES) {
    const hit = matchesAny(name, rule.kw);
    if (!hit) continue;
    cuisineMed = true;
    addCuisines(rule.cuisines, "medium", "name", `Name keyword "${hit}".`);
    if (rule.dish) addDish(rule.dish, "medium", "name", `Dish implied by name keyword "${hit}".`);
  }
  // 4) "brunch" in name/query.
  if (matchesAny(nameAndQuery, ["brunch"]) && CUISINES.includes("brunch" as Cuisine)) {
    cuisineMed = true;
    addCuisines(["brunch"], "medium", "name", `"brunch" in name/query.`);
  }

  // ---- dietary (EXPLICIT only) ----
  const dietaryBlob = `${nameAndQuery} ${typeBlob} ${adminText}`;
  for (const rule of DIETARY_RULES) {
    const hit = matchesAny(dietaryBlob, rule.kw);
    if (!hit) continue;
    if (!DIETARY.includes(rule.tag)) continue;
    if (have.dietary.has(rule.tag.toLowerCase())) continue;
    const fromAdmin = matchesAny(adminText, rule.kw) !== null && matchesAny(`${nameAndQuery} ${typeBlob}`, rule.kw) === null;
    emit({
      field: "dietaryTags",
      value: rule.tag,
      confidence: "high",
      reason: `Explicit "${hit}" in ${fromAdmin ? "admin text" : "name/type/query"}.`,
      evidenceSource: fromAdmin ? "admin_text" : "name",
      reviewOnly: false,
      autoFillSafe: true,
    });
  }

  // ---- vibe / bestFor (price + service style only) ----
  const isQuickType =
    QUICK_TYPES.has(primaryType) ||
    types.some((t) => QUICK_TYPES.has(t)) ||
    matchesAny(name, ["taqueria", "taco", "pizza", "ramen", "bakery", "cafe", "coffee", "burger", "bagel", "ice cream"]) !== null;
  const isDinnerType =
    DINNER_TYPES.has(primaryType) ||
    types.some((t) => DINNER_TYPES.has(t)) ||
    matchesAny(name, ["trattoria", "osteria", "ristorante", "omakase"]) !== null;

  function addVibe(field: "vibeTags" | "bestFor", value: Vibe, why: string) {
    if (!VIBES.includes(value)) return;
    if (have[field === "vibeTags" ? "vibe" : "bestFor"].has(value.toLowerCase())) return;
    emit({ field, value, confidence: "medium", reason: why, evidenceSource: "price_level", reviewOnly: false, autoFillSafe: false });
  }
  if (priceLevel !== null && priceLevel <= 2 && isQuickType) {
    addVibe("bestFor", "quick bite", `Price ${priceLevel} + quick-service style.`);
    addVibe("vibeTags", "casual", `Price ${priceLevel} + quick-service style.`);
  } else if (priceLevel !== null && priceLevel >= 3 && isDinnerType) {
    addVibe("bestFor", "date night", `Price ${priceLevel} + sit-down dinner style.`);
    addVibe("bestFor", "group dinner", `Price ${priceLevel} + sit-down dinner style.`);
  }
  if (matchesAny(`${nameAndQuery} ${adminText}`, ["late night", "open late", "24 hour", "24-hour"])) {
    addVibe("vibeTags", "late night", `Explicit "late"/"24 hour" signal.`);
  }
  if (matchesAny(`${nameAndQuery} ${adminText}`, ["hidden gem"])) {
    addVibe("vibeTags", "hidden gem", `Explicit "hidden gem" signal.`);
  }

  // ---- caption-derived hints (ALWAYS review-only, low confidence, attributed) ----
  const captions = (Array.isArray(ctx.captions) ? ctx.captions : []).filter((c) => c && typeof c.caption === "string");
  if (captions.length > 0) {
    warnings.push(
      "Caption hints reflect creators' words and may mention other places — verify before applying. They are review-only and never auto-filled.",
    );
  }
  for (const c of captions) {
    const text = cleanCaptionText(c.caption);
    if (!text) continue;
    const evidence = c.caption.trim().slice(0, 160);
    const who = attribution(c);

    // cuisine — only vocab values literally present.
    for (const cuisine of CUISINES) {
      if (have.cuisine.has(cuisine)) continue;
      if (matchesAny(text, [cuisine])) {
        emit({
          field: "cuisineTags",
          value: cuisine,
          confidence: "low",
          reason: `Caption mentions "${cuisine}"${who}.`,
          evidenceSource: c.origin,
          evidenceText: evidence,
          reviewOnly: true,
          autoFillSafe: false,
        });
      }
    }
    // vibe — only vocab values literally present.
    for (const v of VIBES) {
      if (have.vibe.has(v)) continue;
      if (matchesAny(text, [v])) {
        emit({
          field: "vibeTags",
          value: v,
          confidence: "low",
          reason: `Caption mentions "${v}"${who}.`,
          evidenceSource: c.origin,
          evidenceText: evidence,
          reviewOnly: true,
          autoFillSafe: false,
        });
      }
    }
    // dietary — caption mention is a CREATOR claim → review-only, never autoFill.
    for (const rule of DIETARY_RULES) {
      if (have.dietary.has(rule.tag)) continue;
      const hit = matchesAny(text, rule.kw);
      if (hit && DIETARY.includes(rule.tag)) {
        emit({
          field: "dietaryTags",
          value: rule.tag,
          confidence: "low",
          reason: `Caption mentions "${hit}"${who} — verify (creator claim, not official).`,
          evidenceSource: c.origin,
          evidenceText: evidence,
          reviewOnly: true,
          autoFillSafe: false,
        });
      }
    }
    // dishes — ONLY known dish keywords (no free noun-phrase extraction).
    for (const [kw, canonical] of Object.entries(DISH_KEYWORDS)) {
      if (matchesAny(text, [kw])) {
        addDish(canonical, "low", c.origin, `Caption mentions "${kw}"${who} — verify.`, evidence);
      }
    }
  }

  // ---- reasonText — NEVER generated (public verbatim claim). ----
  if (byField.reasonText.length === 0) {
    warnings.push(
      "reasonText is shown publicly verbatim — the engine does not generate it. Write a short, honest description by hand (no 'best/#1/authentic' claims).",
    );
  }

  // ---- summary ----
  if (!cuisineHigh && !cuisineMed && have.cuisine.size === 0) {
    warnings.push("No confident cuisine signal from type/name — review manually.");
  }
  const totalNew = Object.values(byField).reduce((n, arr) => n + arr.length, 0);
  reasons.push(`${totalNew} suggestion(s) across ${Object.values(byField).filter((a) => a.length).length} field(s).`);

  const overallConfidence: TagSuggestionConfidence = cuisineHigh ? "high" : cuisineMed ? "medium" : "low";

  return { suggestionsByField: byField, overallConfidence, reasons, warnings };
}

/*
 * Worked examples (documented; no test framework in this repo).
 *
 * 1) DC Google-type case:
 *    ctx = { name:"Anafre", market:"dc", priceLevel:2, googlePrimaryType:"taco_restaurant" }
 *    → cuisineTags: ["mexican","tacos","street food"] (high, google_primary_type, autoFillSafe)
 *      dishHighlights: ["Tacos"] (medium, not autoFill)
 *      bestFor: ["quick bite"], vibeTags: ["casual"] (medium, price+type)
 *      overallConfidence: "high".
 *
 * 2) NYC name/neighborhood case:
 *    ctx = { name:"Lucali", market:"nyc", neighborhood:"Carroll Gardens", priceLevel:3,
 *            googleTypes:["pizza_restaurant"] }
 *    → cuisineTags: ["pizza"] (medium, google_type); dishHighlights: ["Pizza"]; no Washington/DC.
 *      overallConfidence: "medium".
 *
 * 3) Noisy caption (NO hallucinated dish):
 *    captions=[{caption:"this place is INSANE 🔥🔥 best vibes #foodie", origin:"attached_video_caption"}]
 *    → no DISH_KEYWORD present → dishHighlights: [] (engine invents nothing).
 *
 * 4) Explicit dietary:
 *    ctx = { name:"HipCityVeg", googlePrimaryType:"vegan_restaurant" }
 *    → dietaryTags: ["vegan"] (high, explicit, autoFillSafe); cuisineTags includes "vegan".
 *
 * 5) Caption-derived dish (review-only):
 *    captions=[{caption:"their birria tacos are unreal 🌮", creatorName:"DC Eats",
 *               platform:"TikTok", origin:"video_candidate_caption"}]
 *    → dishHighlights: [{ value:"Tacos", confidence:"low", reviewOnly:true, autoFillSafe:false,
 *                         evidenceSource:"video_candidate_caption", evidenceText:"their birria tacos…" }]
 *      (canonical "Tacos" — never the invented phrase "birria tacos").
 */
