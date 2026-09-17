import AppShell from "@/components/AppShell";
import SavedClient from "@/components/SavedClient";
import { getDefaultPublicMarket, getPublicSeedRestaurants } from "@/lib/publicMarket";

export default function SavedPage() {
  const seedRestaurants = getPublicSeedRestaurants(getDefaultPublicMarket());

  return (
    <AppShell>
      <SavedClient seedRestaurants={seedRestaurants} />
    </AppShell>
  );
}
