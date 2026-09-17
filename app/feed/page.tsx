import AppShell from "@/components/AppShell";
import FeedClient from "@/components/FeedClient";
import { getDefaultPublicMarket, getPublicSeedRestaurants } from "@/lib/publicMarket";

export default function FeedPage() {
  const initialRestaurants = getPublicSeedRestaurants(getDefaultPublicMarket());

  return (
    <AppShell>
      <FeedClient initialRestaurants={initialRestaurants} />
    </AppShell>
  );
}
