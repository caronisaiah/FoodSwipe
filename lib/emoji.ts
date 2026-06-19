/** Map cuisine tags to a representative emoji for placeholder posters. */
const CUISINE_EMOJI: Record<string, string> = {
  burgers: "🍔",
  sushi: "🍣",
  tacos: "🌮",
  pasta: "🍝",
  "soul food": "🍗",
  ramen: "🍜",
  noodles: "🍜",
  coffee: "☕",
  cafe: "☕",
  dessert: "🍰",
  "ice cream": "🍦",
  bakery: "🥐",
  mediterranean: "🥙",
  "middle eastern": "🥙",
  halal: "🧆",
  kebab: "🧆",
  persian: "🧆",
  vegan: "🥗",
  filipino: "🍤",
  french: "🥖",
  italian: "🍝",
  japanese: "🍣",
  omakase: "🍣",
  mexican: "🌮",
  "street food": "🌮",
  korean: "🥢",
  american: "🍔",
  "new american": "🍽️",
  southern: "🍗",
  british: "🍔",
  diner: "🍳",
  brunch: "🍳",
  "bar food": "🍟",
  seafood: "🦞",
  dinner: "🍽️",
  // v1.5.1 launch-demo seed additions (korean + seafood already mapped above)
  indian: "🍛",
  ethiopian: "🍲",
  laotian: "🥘",
  pizza: "🍕",
  bagels: "🥯",
};

export function cuisineEmoji(tags: string[]): string {
  for (const t of tags) {
    const e = CUISINE_EMOJI[t.toLowerCase()];
    if (e) return e;
  }
  return "🍽️";
}
