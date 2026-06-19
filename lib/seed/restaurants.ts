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
    id: "maydan",
    name: "Maydan",
    neighborhood: "Shaw",
    address: "1346 Florida Ave NW, Washington, DC",
    lat: 38.92,
    lng: -77.031,
    distanceMiles: 1.6,
    priceLevel: 3,
    cuisineTags: ["mediterranean", "middle eastern", "halal"],
    dietaryTags: ["halal", "vegetarian"],
    vibeTags: ["group dinner", "date night", "aesthetic"],
    dishHighlights: ["Live-fire kebabs", "Fresh-baked bread", "Whole roasted cauliflower", "Lamb shoulder"],
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
    id: "daikaya",
    name: "Daikaya Ramen",
    neighborhood: "Chinatown",
    address: "705 6th St NW, Washington, DC",
    // Verified high-confidence in v1.5.1 candidate workflow (query_place_id URL match).
    googlePlaceId: "ChIJF2yEqzq3t4kRbnlXNGcKUmQ",
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
    id: "roses-luxury",
    name: "Rose's Luxury",
    neighborhood: "Capitol Hill",
    address: "717 8th St SE, Washington, DC",
    // Verified high-confidence in v1.5.1 candidate workflow (Place ID decoded + CID match).
    googlePlaceId: "ChIJUZM20My5t4kRnhgopk_e4YA",
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
    id: "taqueria-habanero",
    name: "Taquería Habanero",
    neighborhood: "Columbia Heights",
    address: "3710 14th St NW, Washington, DC",
    // Verified high-confidence in v1.5.1 candidate workflow (query_place_id URL, DC branch).
    googlePlaceId: "ChIJgbx54xfIt4kR-Ic0a2lGYkQ",
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
    dishHighlights: ["The Lucky Bun", "El Jefe bun", "Mumbo fried chicken sandwich", "Spiked shakes"],
    bestFor: ["late night", "casual"],
    reasonText:
      "Smashed-patty burgers and a rooftop that turns rowdy late — exactly the vibe for a fun, low-key night out.",
    trendScore: 74,
    vibeScore: 83,
    videoCount: 47,
    recentVideoCount: 7,
    saveCount: 1120,
    videos: [
      video("lucky-1", "TikTok", "@burgerquestdc", "the El Jefe bun is so DC and I love it 🍔"),
      video("lucky-2", "Instagram", "@dc.eats", "rooftop burgers > everything"),
    ],
  },
  {
    id: "ice-cream-jubilee",
    name: "Ice Cream Jubilee",
    neighborhood: "Navy Yard",
    address: "301 Water St SE #105, Washington, DC",
    lat: 38.876,
    lng: -77.0,
    distanceMiles: 3.4,
    priceLevel: 1,
    cuisineTags: ["dessert", "ice cream"],
    dietaryTags: ["vegetarian", "vegan"],
    vibeTags: ["casual", "aesthetic", "quick bite"],
    dishHighlights: ["Thai iced tea ice cream", "Banana bourbon caramel", "Mango habanero", "Waffle cones"],
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
    id: "rasika",
    name: "Rasika",
    neighborhood: "Penn Quarter",
    address: "633 D St NW, Washington, DC",
    lat: 38.894,
    lng: -77.021,
    distanceMiles: 0.6,
    priceLevel: 3,
    cuisineTags: ["indian", "dinner"],
    dietaryTags: ["vegetarian"],
    vibeTags: ["date night", "group dinner", "aesthetic"],
    dishHighlights: ["Palak chaat", "Black cod", "Dal makhani", "Lamb biryani"],
    bestFor: ["date night", "group dinner"],
    reasonText:
      "Vikram Sunderam's modern Indian landmark — the crispy palak chaat is a certified internet obsession, and the room still feels special-occasion.",
    trendScore: 79,
    vibeScore: 90,
    videoCount: 76,
    recentVideoCount: 8,
    saveCount: 1980,
    videos: [
      video("rasika-1", "Instagram", "@districtbites", "the palak chaat actually shatters 🤯", {
        creatorDisplayName: "District Bites",
      }),
      video("rasika-2", "TikTok", "@dc.eats", "modern Indian that earns the hype", {
        creatorDisplayName: "DC Eats",
      }),
      video("rasika-3", "YouTube", "@capitalcravings", "Rasika: palak chaat + black cod", {
        sourceType: "creator-profile",
        matchConfidence: "high",
        creatorDisplayName: "Capital Cravings",
        sourceUrl: youtubeSearch("Rasika DC palak chaat review"),
        publishedAt: "2026-05-20",
        discoveredAt: "2026-06-08",
      }),
    ],
  },
  {
    id: "old-ebbitt-grill",
    name: "Old Ebbitt Grill",
    neighborhood: "Downtown",
    address: "675 15th St NW, Washington, DC",
    lat: 38.898,
    lng: -77.033,
    distanceMiles: 0.5,
    priceLevel: 3,
    cuisineTags: ["seafood", "american"],
    dietaryTags: [],
    vibeTags: ["group dinner", "date night", "late night"],
    dishHighlights: ["Oysters on the half shell", "Jumbo lump crab cakes", "Trout Parmesan", "Raw bar tower"],
    bestFor: ["group dinner", "date night"],
    reasonText:
      "DC's grand old oyster saloon steps from the White House — towering raw bars and gilded booths make every visit feel like an event.",
    trendScore: 70,
    vibeScore: 88,
    videoCount: 90,
    recentVideoCount: 5,
    saveCount: 2400,
    videos: [
      video("ebbitt-1", "TikTok", "@districtbites", "oyster tower in the prettiest old saloon 🦪", {
        creatorDisplayName: "District Bites",
      }),
      video("ebbitt-2", "Instagram", "@dc.eats", "the raw bar near the White House hits"),
      video("ebbitt-3", "YouTube", "@capitalcravings", "Old Ebbitt Grill oyster riot walkthrough", {
        sourceType: "creator-profile",
        matchConfidence: "medium",
        creatorDisplayName: "Capital Cravings",
        sourceUrl: youtubeSearch("Old Ebbitt Grill DC oysters review"),
        publishedAt: "2026-04-22",
        discoveredAt: "2026-06-08",
      }),
    ],
  },
  {
    id: "anju",
    name: "Anju",
    neighborhood: "Dupont Circle",
    address: "1805 18th St NW, Washington, DC",
    lat: 38.915,
    lng: -77.043,
    distanceMiles: 1.8,
    priceLevel: 3,
    cuisineTags: ["korean", "dinner"],
    dietaryTags: ["vegetarian"],
    vibeTags: ["date night", "group dinner", "casual"],
    dishHighlights: ["Korean fried chicken", "Pork mandu", "Dolsot bibimbap", "Banchan"],
    bestFor: ["date night", "group dinner"],
    reasonText:
      "Crave-bait Korean fried chicken in Alabama-white sauce, plus pillowy mandu and sizzling dolsot bibimbap — a Michelin-recognized Dupont favorite.",
    trendScore: 80,
    vibeScore: 89,
    videoCount: 84,
    recentVideoCount: 9,
    saveCount: 2050,
    videos: [
      video("anju-1", "TikTok", "@districtbites", "the Korean fried chicken with white sauce 😮‍💨", {
        creatorDisplayName: "District Bites",
      }),
      video("anju-2", "Instagram", "@dc.eats", "mandu + bibimbap, every single time"),
      video("anju-3", "YouTube", "@capitalcravings", "Anju Korean fried chicken taste test", {
        sourceType: "creator-profile",
        matchConfidence: "high",
        creatorDisplayName: "Capital Cravings",
        sourceUrl: youtubeSearch("Anju DC Korean fried chicken review"),
        publishedAt: "2026-05-15",
        discoveredAt: "2026-06-08",
      }),
    ],
  },
  {
    id: "ethiopic",
    name: "Ethiopic",
    neighborhood: "H Street NE",
    address: "401 H St NE, Washington, DC",
    lat: 38.9,
    lng: -76.998,
    distanceMiles: 2.6,
    priceLevel: 2,
    cuisineTags: ["ethiopian", "vegetarian"],
    dietaryTags: ["vegetarian", "vegan"],
    vibeTags: ["group dinner", "casual", "hidden gem"],
    dishHighlights: ["Doro wat", "Kitfo", "Veggie combo", "Tibs"],
    bestFor: ["group dinner", "casual"],
    reasonText:
      "Communal injera platters and deeply spiced stews on H Street — hands-in, shareable eating that's as fun as it is delicious.",
    trendScore: 66,
    vibeScore: 86,
    videoCount: 40,
    recentVideoCount: 4,
    saveCount: 880,
    videos: [
      video("ethiopic-1", "Instagram", "@districtbites", "one giant injera platter, all hands in 🫓", {
        creatorDisplayName: "District Bites",
      }),
      video("ethiopic-2", "TikTok", "@dc.eats", "doro wat that warms your soul"),
      video("ethiopic-3", "YouTube", "@capitalcravings", "Ethiopic on H Street: the combo platter", {
        sourceType: "creator-profile",
        matchConfidence: "medium",
        creatorDisplayName: "Capital Cravings",
        sourceUrl: youtubeSearch("Ethiopic restaurant DC review"),
        publishedAt: "2026-05-02",
        discoveredAt: "2026-06-08",
      }),
    ],
  },
  {
    id: "thip-khao",
    name: "Thip Khao",
    neighborhood: "Columbia Heights",
    address: "3462 14th St NW, Washington, DC",
    lat: 38.932,
    lng: -77.033,
    distanceMiles: 2.6,
    priceLevel: 2,
    cuisineTags: ["laotian", "asian", "street food"],
    dietaryTags: ["vegetarian"],
    vibeTags: ["group dinner", "hidden gem", "casual"],
    dishHighlights: ["Naem khao (crispy rice salad)", "Sai oua sausage", "Green papaya salad", "Jungle Menu"],
    bestFor: ["group dinner", "hidden gem"],
    reasonText:
      "Fiery, herb-packed Laotian cooking from chef Seng Luangrath — order the crispy rice salad, then dare the off-menu 'Jungle Menu'.",
    trendScore: 72,
    vibeScore: 88,
    videoCount: 44,
    recentVideoCount: 6,
    saveCount: 1010,
    videos: [
      video("thipkhao-1", "TikTok", "@districtbites", "the crispy rice salad is unreal 🌿", {
        creatorDisplayName: "District Bites",
      }),
      video("thipkhao-2", "Instagram", "@dc.eats", "ask for the jungle menu 👀"),
      video("thipkhao-3", "YouTube", "@capitalcravings", "Thip Khao Laotian deep dive", {
        sourceType: "creator-profile",
        matchConfidence: "medium",
        creatorDisplayName: "Capital Cravings",
        sourceUrl: youtubeSearch("Thip Khao DC Laotian review"),
        publishedAt: "2026-05-10",
        discoveredAt: "2026-06-08",
      }),
    ],
  },
  {
    id: "call-your-mother",
    name: "Call Your Mother Deli",
    neighborhood: "Park View",
    address: "3301 Georgia Ave NW, Washington, DC",
    lat: 38.93,
    lng: -77.023,
    distanceMiles: 2.5,
    priceLevel: 2,
    cuisineTags: ["bagels", "brunch"],
    dietaryTags: ["vegetarian"],
    vibeTags: ["quick bite", "casual", "aesthetic"],
    dishHighlights: ["The Sun City bagel", "Pastrami on rye", "Lox bagel", "Loaded cream cheeses"],
    bestFor: ["quick bite", "casual"],
    reasonText:
      "DC's cult 'Jewish-ish' deli — the Sun City bacon-egg-and-hot-honey bagel is pure swipe bait, and yes, the line is worth it.",
    trendScore: 83,
    vibeScore: 90,
    videoCount: 95,
    recentVideoCount: 11,
    saveCount: 2300,
    videos: [
      video("cym-1", "TikTok", "@brunchsohard", "the Sun City bagel is a personality trait 🥯", {
        creatorDisplayName: "Brunch So Hard",
      }),
      video("cym-2", "Instagram", "@dc.eats", "worth the line, every time"),
      video("cym-3", "YouTube", "@capitalcravings", "Call Your Mother bagel rundown", {
        sourceType: "creator-profile",
        matchConfidence: "high",
        creatorDisplayName: "Capital Cravings",
        sourceUrl: youtubeSearch("Call Your Mother Deli DC bagels"),
        publishedAt: "2026-06-02",
        discoveredAt: "2026-06-09",
      }),
    ],
  },
  {
    id: "timber-pizza",
    name: "Timber Pizza Co.",
    neighborhood: "Petworth",
    address: "809 Upshur St NW, Washington, DC",
    lat: 38.942,
    lng: -77.024,
    distanceMiles: 3.0,
    priceLevel: 2,
    cuisineTags: ["pizza", "italian"],
    dietaryTags: ["vegetarian"],
    vibeTags: ["casual", "group dinner", "quick bite"],
    dishHighlights: ["The Green Monster", "Hot-honey Bentley", "Wood-fired pies", "Seasonal salads"],
    bestFor: ["casual", "group dinner"],
    reasonText:
      "Blistered wood-fired pies with hot-honey heat in Petworth — a Bib Gourmand pizza joint that turned a corner shop into a destination.",
    trendScore: 68,
    vibeScore: 85,
    videoCount: 50,
    recentVideoCount: 5,
    saveCount: 1080,
    videos: [
      video("timber-1", "TikTok", "@districtbites", "hot honey on a wood-fired pie 🍕🍯", {
        creatorDisplayName: "District Bites",
      }),
      video("timber-2", "Instagram", "@dc.eats", "the Green Monster is the order"),
      video("timber-3", "YouTube", "@capitalcravings", "Timber Pizza Petworth slice test", {
        sourceType: "creator-profile",
        matchConfidence: "medium",
        creatorDisplayName: "Capital Cravings",
        sourceUrl: youtubeSearch("Timber Pizza Petworth DC review"),
        publishedAt: "2026-05-08",
        discoveredAt: "2026-06-08",
      }),
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
