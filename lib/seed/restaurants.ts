import type {
  LegalDisplayStatus,
  MatchConfidence,
  Platform,
  Restaurant,
  Video,
  VideoSourceType,
} from "@/lib/types";
import { enforceVideoInvariants } from "@/lib/video";

/**
 * Seed dataset — Washington, DC.
 *
 * Stands in for the future aggregation pipeline (TikTok / Instagram / YouTube /
 * web). Real DC restaurants & neighborhoods for believability; creator handles,
 * captions and metrics are illustrative.
 *
 * HONESTY RULES baked into the data:
 *  - We never fabricate a specific real post URL. Clips default to a
 *    `placeholder` (clearly labelled "Source placeholder", no external link).
 *  - "source-link-only" entries point at a REAL, working discovery search
 *    (e.g. a YouTube search for the restaurant) — honest "here's where reviews
 *    live", not a fake post.
 *  - `real-post` / `embeddable` is reserved for content added via the admin
 *    demo tool, where a tester pastes a genuine URL.
 * See `components/VideoEmbed.tsx` for how each status renders.
 */

interface VideoOpts {
  sourceType?: VideoSourceType;
  matchConfidence?: MatchConfidence;
  legalDisplayStatus?: LegalDisplayStatus;
  embedUrl?: string;
  /** Override the source URL (used for real discovery-search links). */
  sourceUrl?: string;
  creatorDisplayName?: string;
  publishedAt?: string;
  discoveredAt?: string;
  isRealSource?: boolean;
}

/** A real, working "where reviews live" search link — not a fabricated post. */
function youtubeSearch(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

/** Build a Video with honest v1 defaults (illustrative placeholder) + overrides. */
function video(
  id: string,
  platform: Platform,
  handle: string,
  caption: string,
  opts: VideoOpts = {},
): Video {
  const user = handle.replace(/^@/, "");
  const sourceType = opts.sourceType ?? "placeholder";
  const isRealSource = opts.isRealSource ?? sourceType === "real-post";
  const legalDisplayStatus =
    opts.legalDisplayStatus ??
    (opts.embedUrl
      ? "embeddable"
      : sourceType === "placeholder"
        ? "placeholder-only"
        : "source-link-only");
  const matchConfidence = opts.matchConfidence ?? "manual";

  const profileUrl =
    platform === "TikTok"
      ? `https://www.tiktok.com/@${user}`
      : platform === "Instagram"
        ? `https://www.instagram.com/${user}`
        : platform === "YouTube"
          ? `https://www.youtube.com/@${user}`
          : `https://www.google.com/search?q=${encodeURIComponent(handle)}`;
  // Placeholders carry NO source URL — don't fabricate one just to satisfy the
  // type. Linked entries pass a real discovery/search/profile URL via opts.
  const sourceUrl =
    sourceType === "placeholder" ? opts.sourceUrl : (opts.sourceUrl ?? profileUrl);

  const credit = opts.creatorDisplayName
    ? `${opts.creatorDisplayName} (${handle})`
    : handle;
  const attributionText =
    sourceType === "real-post"
      ? `Original post by ${credit} on ${platform}`
      : sourceType === "creator-profile"
        ? `Review source: ${credit} on ${platform}`
        : sourceType === "manual-seed"
          ? `${credit} on ${platform} (added for demo)`
          : `Illustrative ${platform} preview — not a real post`;

  // Run through the same enforcement the runtime uses, so seed data is provably
  // consistent with the legal-safe invariants (idempotent for honest input).
  return enforceVideoInvariants({
    id,
    platform,
    sourceUrl,
    embedUrl: opts.embedUrl,
    creatorHandle: handle,
    creatorDisplayName: opts.creatorDisplayName,
    caption,
    attributionText,
    publishedAt: opts.publishedAt,
    discoveredAt: opts.discoveredAt,
    isRealSource,
    sourceType,
    matchConfidence,
    legalDisplayStatus,
  });
}

export const RESTAURANTS: Restaurant[] = [
  {
    id: "bad-saint",
    name: "Bad Saint",
    neighborhood: "Columbia Heights",
    address: "3226 11th St NW, Washington, DC",
    lat: 38.928,
    lng: -77.027,
    distanceMiles: 2.4,
    priceLevel: 3,
    cuisineTags: ["filipino", "asian", "dinner"],
    dietaryTags: ["no pork"],
    vibeTags: ["hidden gem", "date night", "aesthetic"],
    dishHighlights: ["Kinilaw", "Crispy pata", "Sizzling sisig", "Ube halaya"],
    bestFor: ["date night", "hidden gem"],
    reasonText:
      "A tiny, no-reservations Filipino spot people line up for — perfect if you love discovering places before everyone else does.",
    trendScore: 88,
    vibeScore: 94,
    videoCount: 64,
    recentVideoCount: 6,
    saveCount: 1840,
    videos: [
      video("bad-saint-1", "TikTok", "@districtbites", "the sisig that broke my brain 🤯 #dcfood", {
        creatorDisplayName: "District Bites",
      }),
      video("bad-saint-2", "Instagram", "@dc.eats", "16 seats. worth every minute of the wait.", {
        creatorDisplayName: "DC Eats",
      }),
      video("bad-saint-3", "YouTube", "@capitalcravings", "Bad Saint review: is the hype real?", {
        sourceType: "creator-profile",
        matchConfidence: "high",
        creatorDisplayName: "Capital Cravings",
        sourceUrl: youtubeSearch("Bad Saint DC Filipino review"),
        publishedAt: "2026-05-12",
        discoveredAt: "2026-06-01",
      }),
    ],
  },
  {
    id: "maydan",
    name: "Maydan",
    neighborhood: "Logan Circle",
    address: "1346 Florida Ave NW, Washington, DC",
    lat: 38.92,
    lng: -77.031,
    distanceMiles: 1.6,
    priceLevel: 3,
    cuisineTags: ["mediterranean", "middle eastern", "halal"],
    dietaryTags: ["halal", "vegetarian"],
    vibeTags: ["group dinner", "date night", "aesthetic"],
    dishHighlights: ["Live-fire kebabs", "Fresh-baked bread", "Hummus", "Whole grilled fish"],
    bestFor: ["group dinner", "date night"],
    reasonText:
      "Everything's cooked over an open fire around a central hearth — a showpiece dinner that's made for sharing with a crowd.",
    trendScore: 81,
    vibeScore: 96,
    videoCount: 112,
    recentVideoCount: 9,
    saveCount: 3120,
    videos: [
      video("maydan-1", "Instagram", "@firefeasts", "this open-fire dinner is unreal 🔥", {
        creatorDisplayName: "Fire Feasts",
      }),
      video("maydan-2", "TikTok", "@dc.eats", "best group dinner in DC? making my case.", {
        creatorDisplayName: "DC Eats",
      }),
      video("maydan-3", "YouTube", "@capitalcravings", "Maydan: the live-fire feast walkthrough", {
        sourceType: "creator-profile",
        matchConfidence: "high",
        creatorDisplayName: "Capital Cravings",
        sourceUrl: youtubeSearch("Maydan DC restaurant review"),
        publishedAt: "2026-05-28",
        discoveredAt: "2026-06-05",
      }),
    ],
  },
  {
    id: "le-diplomate",
    name: "Le Diplomate",
    neighborhood: "Logan Circle",
    address: "1601 14th St NW, Washington, DC",
    // Verified via Google Maps + Waze (single location). v1.5 photo proof.
    googlePlaceId: "ChIJgYIki-m3t4kRZImvuN_pp9Q",
    lat: 38.911,
    lng: -77.032,
    distanceMiles: 1.3,
    priceLevel: 3,
    cuisineTags: ["french", "brunch", "dinner"],
    dietaryTags: ["vegetarian"],
    vibeTags: ["date night", "aesthetic", "group dinner"],
    dishHighlights: ["Steak frites", "Onion soup gratinée", "Warm bread basket", "Profiteroles"],
    bestFor: ["date night", "group dinner"],
    reasonText:
      "A Parisian-bistro fantasy with a patio that's pure people-watching — the move when you want dinner to feel like an occasion.",
    trendScore: 72,
    vibeScore: 92,
    videoCount: 98,
    recentVideoCount: 4,
    saveCount: 2670,
    videos: [
      video("le-dip-1", "TikTok", "@brunchsohard", "the bread basket alone… 🥖", {
        creatorDisplayName: "Brunch So Hard",
      }),
      video("le-dip-2", "Instagram", "@districtbites", "DC's most photogenic patio, no notes", {
        creatorDisplayName: "District Bites",
      }),
      video("le-dip-3", "YouTube", "@capitalcravings", "Le Diplomate: brunch + steak frites", {
        sourceType: "creator-profile",
        matchConfidence: "medium",
        creatorDisplayName: "Capital Cravings",
        sourceUrl: youtubeSearch("Le Diplomate DC review"),
        publishedAt: "2026-04-30",
        discoveredAt: "2026-05-20",
      }),
    ],
  },
  {
    id: "roses-luxury",
    name: "Rose's Luxury",
    neighborhood: "Capitol Hill",
    address: "717 8th St SE, Washington, DC",
    lat: 38.881,
    lng: -76.995,
    distanceMiles: 3.1,
    priceLevel: 3,
    cuisineTags: ["american", "new american", "dinner"],
    dietaryTags: ["vegetarian"],
    vibeTags: ["date night", "hidden gem", "casual"],
    dishHighlights: ["Pork & lychee salad", "Smoked brisket", "Family-style pasta", "Caramel cake"],
    bestFor: ["date night", "hidden gem"],
    reasonText:
      "Playful, genre-bending small plates that put Barracks Row on the map — cozy and surprising in equal measure.",
    trendScore: 70,
    vibeScore: 90,
    videoCount: 57,
    recentVideoCount: 3,
    saveCount: 1490,
    videos: [
      video("roses-1", "YouTube", "@capitalcravings", "Rose's Luxury: the pork lychee salad explained"),
      video("roses-2", "Instagram", "@dc.eats", "still one of the best meals in the city"),
    ],
  },
  {
    id: "the-red-hen",
    name: "The Red Hen",
    neighborhood: "Bloomingdale",
    address: "1822 1st St NW, Washington, DC",
    lat: 38.917,
    lng: -77.012,
    distanceMiles: 2.0,
    priceLevel: 2,
    cuisineTags: ["italian", "pasta", "dinner"],
    dietaryTags: ["vegetarian"],
    vibeTags: ["date night", "hidden gem", "casual"],
    dishHighlights: ["Rigatoni with fennel sausage ragù", "House focaccia", "Burrata", "Tiramisu"],
    bestFor: ["date night", "casual"],
    reasonText:
      "The rigatoni alone has a cult following — warm, neighborhood-y Italian that nails the cozy date-night brief.",
    trendScore: 66,
    vibeScore: 88,
    videoCount: 43,
    recentVideoCount: 5,
    saveCount: 1210,
    videos: [
      video("red-hen-1", "TikTok", "@pastaprincessdc", "the rigatoni that lives in my head rent-free 🍝"),
      video("red-hen-2", "Instagram", "@districtbites", "neighborhood Italian done right"),
    ],
  },
  {
    id: "daikaya",
    name: "Daikaya Ramen",
    neighborhood: "Chinatown",
    address: "705 6th St NW, Washington, DC",
    lat: 38.899,
    lng: -77.02,
    distanceMiles: 0.9,
    priceLevel: 2,
    cuisineTags: ["ramen", "japanese", "noodles"],
    dietaryTags: ["vegetarian"],
    vibeTags: ["casual", "late night", "group dinner"],
    dishHighlights: ["Shoyu ramen", "Mugi miso ramen", "Veggie ramen", "Chashu bowl"],
    bestFor: ["late night", "quick bite"],
    reasonText:
      "Sapporo-style ramen that hits late on a cold night — quick, comforting, and open when most kitchens have closed.",
    trendScore: 75,
    vibeScore: 84,
    videoCount: 71,
    recentVideoCount: 7,
    saveCount: 1660,
    videos: [
      video("daikaya-1", "TikTok", "@noodlenights", "post-bar ramen run, every time 🍜", {
        creatorDisplayName: "Noodle Nights",
      }),
      video("daikaya-2", "Instagram", "@dc.eats", "the mugi miso is criminally underrated", {
        creatorDisplayName: "DC Eats",
      }),
      video("daikaya-3", "YouTube", "@capitalcravings", "Daikaya ramen taste test", {
        sourceType: "creator-profile",
        matchConfidence: "medium",
        creatorDisplayName: "Capital Cravings",
        sourceUrl: youtubeSearch("Daikaya ramen DC review"),
        publishedAt: "2026-05-22",
        discoveredAt: "2026-06-03",
      }),
    ],
  },
  {
    id: "bens-chili-bowl",
    name: "Ben's Chili Bowl",
    neighborhood: "U Street",
    address: "1213 U St NW, Washington, DC",
    // Verified via Waze (single location). v1.5 photo proof.
    googlePlaceId: "ChIJM_l-a-a3t4kRQa_lW1A7W8k",
    lat: 38.917,
    lng: -77.029,
    distanceMiles: 1.5,
    priceLevel: 1,
    cuisineTags: ["soul food", "american", "diner"],
    dietaryTags: ["vegetarian"],
    vibeTags: ["late night", "casual"],
    dishHighlights: ["Original half-smoke", "Chili cheese fries", "Veggie chili dog", "Milkshakes"],
    bestFor: ["late night", "quick bite"],
    reasonText:
      "A DC institution since 1958 — the half-smoke is basically a rite of passage, and it's open late when you need it most.",
    trendScore: 62,
    vibeScore: 80,
    videoCount: 130,
    recentVideoCount: 4,
    saveCount: 2980,
    videos: [
      video("bens-1", "YouTube", "@capitalcravings", "Why Ben's Chili Bowl is a DC legend", {
        sourceType: "creator-profile",
        matchConfidence: "high",
        creatorDisplayName: "Capital Cravings",
        sourceUrl: youtubeSearch("Ben's Chili Bowl half-smoke review"),
        publishedAt: "2026-03-15",
        discoveredAt: "2026-05-30",
      }),
      video("bens-2", "TikTok", "@districtbites", "the half-smoke >>> any hot dog 🌭", {
        creatorDisplayName: "District Bites",
      }),
      video("bens-3", "Web", "@washingtonianmag", "An ode to the U Street icon", {
        sourceType: "creator-profile",
        matchConfidence: "medium",
        creatorDisplayName: "Washingtonian",
        sourceUrl:
          "https://www.google.com/search?q=Ben%27s+Chili+Bowl+Washingtonian",
        publishedAt: "2026-02-10",
        discoveredAt: "2026-05-30",
      }),
    ],
  },
  {
    id: "oohhs-aahhs",
    name: "Oohh's & Aahh's",
    neighborhood: "U Street",
    address: "1005 U St NW, Washington, DC",
    lat: 38.917,
    lng: -77.026,
    distanceMiles: 1.5,
    priceLevel: 2,
    cuisineTags: ["soul food", "southern", "american"],
    dietaryTags: [],
    vibeTags: ["hidden gem", "casual"],
    dishHighlights: ["Fried catfish", "Shrimp & grits", "Mac & cheese", "Candied yams"],
    bestFor: ["casual", "hidden gem"],
    reasonText:
      "Unassuming storefront, soul food that locals swear by — the kind of plate that tastes like somebody's grandmother cooked it.",
    trendScore: 64,
    vibeScore: 86,
    videoCount: 38,
    recentVideoCount: 6,
    saveCount: 990,
    videos: [
      video("oohhs-1", "TikTok", "@soulfoodsundays", "the shrimp & grits had me speechless 😮‍💨"),
      video("oohhs-2", "Instagram", "@dc.eats", "best mac in the city, fight me"),
    ],
  },
  {
    id: "taqueria-habanero",
    name: "Taquería Habanero",
    neighborhood: "Columbia Heights",
    address: "3710 14th St NW, Washington, DC",
    lat: 38.935,
    lng: -77.033,
    distanceMiles: 2.7,
    priceLevel: 1,
    cuisineTags: ["tacos", "mexican", "street food"],
    dietaryTags: ["vegetarian"],
    vibeTags: ["casual", "quick bite", "hidden gem"],
    dishHighlights: ["Al pastor tacos", "Tlayuda", "Birria quesadilla", "Horchata"],
    bestFor: ["quick bite", "casual"],
    reasonText:
      "Puebla-style tacos and tlayudas that punch way above the price tag — a cheap-eats hero for a fast, great meal.",
    trendScore: 78,
    vibeScore: 82,
    videoCount: 52,
    recentVideoCount: 8,
    saveCount: 1380,
    videos: [
      video("habanero-1", "TikTok", "@tacotuesdaydc", "$3 al pastor that beats spots 4x the price 🌮", {
        creatorDisplayName: "Taco Tuesday DC",
      }),
      video("habanero-2", "Instagram", "@districtbites", "the tlayuda is the size of my torso", {
        creatorDisplayName: "District Bites",
      }),
      video("habanero-3", "YouTube", "@capitalcravings", "Taquería Habanero taco crawl", {
        sourceType: "creator-profile",
        matchConfidence: "medium",
        creatorDisplayName: "Capital Cravings",
        sourceUrl: youtubeSearch("Taqueria Habanero DC tacos"),
        publishedAt: "2026-05-18",
        discoveredAt: "2026-06-04",
      }),
    ],
  },
  {
    id: "lucky-buns",
    name: "Lucky Buns",
    neighborhood: "Adams Morgan",
    address: "2000 18th St NW, Washington, DC",
    lat: 38.917,
    lng: -77.042,
    distanceMiles: 1.9,
    priceLevel: 2,
    cuisineTags: ["burgers", "american", "bar food"],
    dietaryTags: ["vegetarian"],
    vibeTags: ["late night", "casual", "group dinner"],
    dishHighlights: ["The Old Bay burger", "Korean BBQ burger", "Crispy fries", "Spiked shakes"],
    bestFor: ["late night", "casual"],
    reasonText:
      "Smashed-patty burgers and a rooftop that turns rowdy late — exactly the vibe for a fun, low-key night out.",
    trendScore: 74,
    vibeScore: 83,
    videoCount: 47,
    recentVideoCount: 7,
    saveCount: 1120,
    videos: [
      video("lucky-1", "TikTok", "@burgerquestdc", "the Old Bay burger is so DC and I love it 🍔"),
      video("lucky-2", "Instagram", "@dc.eats", "rooftop burgers > everything"),
    ],
  },
  {
    id: "dukes-grocery",
    name: "Duke's Grocery",
    neighborhood: "Dupont Circle",
    address: "1513 17th St NW, Washington, DC",
    lat: 38.911,
    lng: -77.038,
    distanceMiles: 1.2,
    priceLevel: 2,
    cuisineTags: ["burgers", "british", "american"],
    dietaryTags: ["vegetarian"],
    vibeTags: ["casual", "quick bite", "late night"],
    dishHighlights: ["Proper Burger", "Salt-beef sandwich", "Truffle fries", "Flat white"],
    bestFor: ["quick bite", "casual"],
    reasonText:
      "The 'Proper Burger' is a perennial best-of list regular — a scruffy-cool East London vibe right off the circle.",
    trendScore: 69,
    vibeScore: 81,
    videoCount: 55,
    recentVideoCount: 3,
    saveCount: 1340,
    videos: [
      video("dukes-1", "Instagram", "@burgerquestdc", "the Proper Burger lives up to the name"),
      video("dukes-2", "TikTok", "@districtbites", "scruffy cool & exactly my type of spot"),
    ],
  },
  {
    id: "sushi-taro",
    name: "Sushi Taro",
    neighborhood: "Dupont Circle",
    address: "1503 17th St NW, Washington, DC",
    // Verified via Google Maps (single location). v1.5 photo proof.
    googlePlaceId: "ChIJxSAeOsG3t4kR0DMcgNu5kVQ",
    lat: 38.911,
    lng: -77.038,
    distanceMiles: 1.2,
    priceLevel: 4,
    cuisineTags: ["sushi", "japanese", "omakase"],
    dietaryTags: ["gluten-free"],
    vibeTags: ["date night", "aesthetic"],
    dishHighlights: ["Omakase tasting", "Toro nigiri", "Chawanmushi", "Seasonal sashimi"],
    bestFor: ["date night"],
    reasonText:
      "A serious omakase counter for when you want to go all-out — pristine fish, quiet luxury, special-occasion energy.",
    trendScore: 58,
    vibeScore: 89,
    videoCount: 29,
    recentVideoCount: 2,
    saveCount: 820,
    videos: [
      video("taro-1", "YouTube", "@capitalcravings", "Inside DC's most serious omakase", {
        sourceType: "creator-profile",
        matchConfidence: "high",
        creatorDisplayName: "Capital Cravings",
        sourceUrl: youtubeSearch("Sushi Taro omakase Washington DC"),
        publishedAt: "2026-04-18",
        discoveredAt: "2026-05-29",
      }),
      video("taro-2", "Instagram", "@dc.eats", "splurge-worthy. that toro 🥹", {
        creatorDisplayName: "DC Eats",
      }),
    ],
  },
  {
    id: "tatte-georgetown",
    name: "Tatte Bakery & Café",
    neighborhood: "Georgetown",
    address: "1426 Wisconsin Ave NW, Washington, DC",
    lat: 38.907,
    lng: -77.063,
    distanceMiles: 2.2,
    priceLevel: 2,
    cuisineTags: ["coffee", "cafe", "bakery", "brunch", "dessert"],
    dietaryTags: ["vegetarian"],
    vibeTags: ["aesthetic", "quick bite", "casual"],
    dishHighlights: ["Shakshuka", "Pistachio croissant", "Halloumi sandwich", "Nutella latte"],
    bestFor: ["quick bite", "aesthetic"],
    reasonText:
      "Marble counters, golden pastries, and a latte you'll want to photograph — peak aesthetic for a coffee or light bite.",
    trendScore: 71,
    vibeScore: 91,
    videoCount: 84,
    recentVideoCount: 10,
    saveCount: 2110,
    videos: [
      video("tatte-1", "Instagram", "@coffeeandcrumbs", "the prettiest café in Georgetown ✨", {
        creatorDisplayName: "Coffee & Crumbs",
      }),
      video("tatte-2", "TikTok", "@brunchsohard", "pistachio croissant >>> everything", {
        creatorDisplayName: "Brunch So Hard",
      }),
      video("tatte-3", "YouTube", "@capitalcravings", "Tatte Georgetown pastry tour", {
        sourceType: "creator-profile",
        matchConfidence: "medium",
        creatorDisplayName: "Capital Cravings",
        sourceUrl: youtubeSearch("Tatte Bakery Georgetown DC"),
        publishedAt: "2026-06-01",
        discoveredAt: "2026-06-09",
      }),
    ],
  },
  {
    id: "compass-coffee",
    name: "Compass Coffee",
    neighborhood: "Shaw",
    address: "1535 7th St NW, Washington, DC",
    lat: 38.91,
    lng: -77.022,
    distanceMiles: 1.0,
    priceLevel: 1,
    cuisineTags: ["coffee", "cafe"],
    dietaryTags: ["vegan", "vegetarian"],
    vibeTags: ["quick bite", "casual", "aesthetic"],
    dishHighlights: ["Cold brew", "Oat milk latte", "Drip flights", "Breakfast sandwich"],
    bestFor: ["quick bite", "casual"],
    reasonText:
      "DC-roasted beans and big communal tables — a dependable, laptop-friendly caffeine stop in the heart of Shaw.",
    trendScore: 54,
    vibeScore: 78,
    videoCount: 33,
    recentVideoCount: 4,
    saveCount: 610,
    videos: [
      video("compass-1", "TikTok", "@coffeeandcrumbs", "DC-roasted and actually good ☕"),
      video("compass-2", "Web", "@washingtonianmag", "Where to work from with great coffee"),
    ],
  },
  {
    id: "fancy-radish",
    name: "Fancy Radish",
    neighborhood: "H Street NE",
    address: "600 H St NE, Washington, DC",
    lat: 38.9,
    lng: -76.998,
    distanceMiles: 2.6,
    priceLevel: 3,
    cuisineTags: ["vegan", "vegetarian", "new american"],
    dietaryTags: ["vegan", "vegetarian", "gluten-free"],
    vibeTags: ["date night", "aesthetic"],
    dishHighlights: ["Rutabaga fondue", "Dan dan noodles", "Carrot bratwurst", "Avocado tartare"],
    bestFor: ["date night", "group dinner"],
    reasonText:
      "Plant-based food that even devout carnivores rave about — a sleek, grown-up date spot that happens to be fully vegan.",
    trendScore: 67,
    vibeScore: 90,
    videoCount: 41,
    recentVideoCount: 5,
    saveCount: 980,
    videos: [
      video("radish-1", "Instagram", "@plantbaseddc", "vegan food that converts skeptics 🌱", {
        creatorDisplayName: "Plant-Based DC",
      }),
      video("radish-2", "TikTok", "@dc.eats", "the dan dan noodles are insane", {
        creatorDisplayName: "DC Eats",
      }),
      video("radish-3", "YouTube", "@capitalcravings", "Fancy Radish vegan tasting menu", {
        sourceType: "creator-profile",
        matchConfidence: "medium",
        creatorDisplayName: "Capital Cravings",
        sourceUrl: youtubeSearch("Fancy Radish DC vegan review"),
        publishedAt: "2026-05-05",
        discoveredAt: "2026-05-25",
      }),
    ],
  },
  {
    id: "shouk",
    name: "Shouk",
    neighborhood: "Mount Vernon Triangle",
    address: "655 K St NW, Washington, DC",
    lat: 38.902,
    lng: -77.021,
    distanceMiles: 0.7,
    priceLevel: 2,
    cuisineTags: ["mediterranean", "vegan", "middle eastern", "street food"],
    dietaryTags: ["vegan", "vegetarian", "no pork"],
    vibeTags: ["quick bite", "casual", "aesthetic"],
    dishHighlights: ["Shouk burger", "Loaded hummus", "Cauliflower pita", "Tahini shake"],
    bestFor: ["quick bite", "casual"],
    reasonText:
      "Plant-based Israeli street food built for a fast, feel-good lunch — the pita-wrapped 'burger' is the move.",
    trendScore: 73,
    vibeScore: 85,
    videoCount: 46,
    recentVideoCount: 9,
    saveCount: 1040,
    videos: [
      video("shouk-1", "TikTok", "@plantbaseddc", "the vegan pita burger that hits 🥙"),
      video("shouk-2", "Instagram", "@districtbites", "fast, fresh, and accidentally vegan"),
    ],
  },
  {
    id: "moby-dick",
    name: "Moby Dick House of Kabob",
    neighborhood: "Dupont Circle",
    address: "1070 31st St NW, Washington, DC",
    lat: 38.904,
    lng: -77.06,
    distanceMiles: 1.4,
    priceLevel: 2,
    cuisineTags: ["halal", "persian", "mediterranean", "kebab"],
    dietaryTags: ["halal", "no pork"],
    vibeTags: ["quick bite", "casual"],
    dishHighlights: ["Chicken koobideh", "Barg kabob", "Fresh barbari bread", "Shirazi salad"],
    bestFor: ["quick bite", "casual"],
    reasonText:
      "Charcoal-grilled Persian kabobs and pillowy fresh bread — a reliable, generous halal plate at an everyday price.",
    trendScore: 56,
    vibeScore: 79,
    videoCount: 27,
    recentVideoCount: 3,
    saveCount: 540,
    videos: [
      video("moby-1", "TikTok", "@halaleatsdc", "the koobideh + fresh bread combo 🧆"),
      video("moby-2", "Instagram", "@dc.eats", "underrated halal kabob spot"),
    ],
  },
  {
    id: "ice-cream-jubilee",
    name: "Ice Cream Jubilee",
    neighborhood: "Navy Yard",
    address: "301 Water St SE, Washington, DC",
    lat: 38.876,
    lng: -77.0,
    distanceMiles: 3.4,
    priceLevel: 1,
    cuisineTags: ["dessert", "ice cream"],
    dietaryTags: ["vegetarian", "vegan"],
    vibeTags: ["casual", "aesthetic", "quick bite"],
    dishHighlights: ["Thai iced tea ice cream", "Banana bourbon caramel", "Vegan sorbets", "Waffle cones"],
    bestFor: ["quick bite", "casual"],
    reasonText:
      "Inventive scoops (Thai iced tea, banana-bourbon-caramel) near the waterfront — a sweet, photogenic post-dinner detour.",
    trendScore: 60,
    vibeScore: 87,
    videoCount: 36,
    recentVideoCount: 6,
    saveCount: 760,
    videos: [
      video("jubilee-1", "Instagram", "@sweettoothdc", "thai iced tea ice cream?? yes. 🍦"),
      video("jubilee-2", "TikTok", "@dc.eats", "the flavor list is unreal"),
    ],
  },
];

/** O(1) lookup by id for the profile route and saved page. */
export const RESTAURANTS_BY_ID: Record<string, Restaurant> = Object.fromEntries(
  RESTAURANTS.map((r) => [r.id, r]),
);

export function getRestaurantById(id: string): Restaurant | undefined {
  return RESTAURANTS_BY_ID[id];
}
