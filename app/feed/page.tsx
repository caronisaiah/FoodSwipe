import AppShell from "@/components/AppShell";
import FeedClient from "@/components/FeedClient";
import { shouldIncludeSeedRestaurants } from "@/lib/contentMode";
import { RESTAURANTS } from "@/lib/seed/restaurants";

export default function FeedPage() {
  const initialRestaurants = shouldIncludeSeedRestaurants() ? RESTAURANTS : [];

  return (
    <AppShell>
      <FeedClient initialRestaurants={initialRestaurants} />
    </AppShell>
  );
}
