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

/** Map cuisine tags to a Material Symbols icon name for the feed hero placeholder. */
const CUISINE_ICON: Record<string, string> = {
  ramen: "ramen_dining",
  noodles: "ramen_dining",
  japanese: "ramen_dining",
  sushi: "set_meal",
  omakase: "set_meal",
  seafood: "set_meal",
  pizza: "local_pizza",
  italian: "local_pizza",
  pasta: "local_pizza",
  "ice cream": "icecream",
  dessert: "icecream",
  coffee: "local_cafe",
  cafe: "local_cafe",
  bakery: "bakery_dining",
  bagels: "bakery_dining",
  brunch: "bakery_dining",
  burgers: "lunch_dining",
  american: "lunch_dining",
  diner: "lunch_dining",
  "bar food": "sports_bar",
  tacos: "local_dining",
  mexican: "local_dining",
  "street food": "local_dining",
  "middle eastern": "kebab_dining",
  mediterranean: "kebab_dining",
  halal: "kebab_dining",
  kebab: "kebab_dining",
  persian: "kebab_dining",
};

export function cuisineIcon(tags: string[]): string {
  for (const t of tags) {
    const i = CUISINE_ICON[t.toLowerCase()];
    if (i) return i;
  }
  return "restaurant";
}
