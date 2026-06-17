import type { Craving, Dietary, PriceLevel, Vibe } from "./types";

/**
 * Display metadata for the controlled vocabularies. Keeping label + emoji
 * next to the canonical value lets the onboarding UI stay declarative and
 * guarantees the values match the ranking vocab exactly.
 */

export interface Option<T> {
  value: T;
  label: string;
  emoji: string;
}

export const CRAVING_OPTIONS: Option<Craving>[] = [
  { value: "burgers", label: "Burgers", emoji: "🍔" },
  { value: "sushi", label: "Sushi", emoji: "🍣" },
  { value: "tacos", label: "Tacos", emoji: "🌮" },
  { value: "pasta", label: "Pasta", emoji: "🍝" },
  { value: "soul food", label: "Soul food", emoji: "🍗" },
  { value: "ramen", label: "Ramen", emoji: "🍜" },
  { value: "coffee", label: "Coffee", emoji: "☕" },
  { value: "dessert", label: "Dessert", emoji: "🍰" },
  { value: "mediterranean", label: "Mediterranean", emoji: "🥙" },
  { value: "halal", label: "Halal", emoji: "🧆" },
  { value: "vegan", label: "Vegan", emoji: "🥗" },
];

export const VIBE_OPTIONS: Option<Vibe>[] = [
  { value: "quick bite", label: "Quick bite", emoji: "⚡" },
  { value: "date night", label: "Date night", emoji: "🌹" },
  { value: "group dinner", label: "Group dinner", emoji: "🥂" },
  { value: "late night", label: "Late night", emoji: "🌙" },
  { value: "aesthetic", label: "Aesthetic", emoji: "✨" },
  { value: "hidden gem", label: "Hidden gem", emoji: "💎" },
  { value: "casual", label: "Casual", emoji: "😎" },
];

export const DIETARY_OPTIONS: Option<Dietary>[] = [
  { value: "vegetarian", label: "Vegetarian", emoji: "🥦" },
  { value: "vegan", label: "Vegan", emoji: "🌱" },
  { value: "halal", label: "Halal", emoji: "🕌" },
  { value: "gluten-free", label: "Gluten-free", emoji: "🌾" },
  { value: "no pork", label: "No pork", emoji: "🚫" },
];

export const DISTANCE_OPTIONS: { value: 1 | 3 | 5 | 10; label: string }[] = [
  { value: 1, label: "1 mi" },
  { value: 3, label: "3 mi" },
  { value: 5, label: "5 mi" },
  { value: 10, label: "10 mi" },
];

export const BUDGET_OPTIONS: { value: PriceLevel; label: string; hint: string }[] = [
  { value: 1, label: "$", hint: "Cheap eats" },
  { value: 2, label: "$$", hint: "Everyday" },
  { value: 3, label: "$$$", hint: "Treat" },
  { value: 4, label: "$$$$", hint: "Splurge" },
];

/** "$$" string for a numeric price level — used across cards & profiles. */
export function priceLabel(level: PriceLevel): string {
  return "$".repeat(level);
}
