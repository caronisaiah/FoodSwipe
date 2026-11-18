import AppShell from "@/components/AppShell";
import FeedClient from "@/components/FeedClient";
import { getDiscoveryMarket } from "@/lib/discoveryMarket";

export default async function FeedPage() {
  const { market } = await getDiscoveryMarket();

  return (
    <AppShell>
      <FeedClient key={market} market={market} />
    </AppShell>
  );
}
