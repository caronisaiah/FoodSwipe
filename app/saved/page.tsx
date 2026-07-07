import AppShell from "@/components/AppShell";
import SavedClient from "@/components/SavedClient";
import { shouldIncludeSeedRestaurants } from "@/lib/contentMode";
import { RESTAURANTS } from "@/lib/seed/restaurants";

export default function SavedPage() {
  const seedRestaurants = shouldIncludeSeedRestaurants() ? RESTAURANTS : [];

  return (
    <AppShell>
      <SavedClient seedRestaurants={seedRestaurants} />
    </AppShell>
  );
}
