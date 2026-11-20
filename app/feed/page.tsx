import AppShell from "@/components/AppShell";
import FeedClient from "@/components/FeedClient";
import { getDiscoveryMarket } from "@/lib/discoveryMarket";

export default async function FeedPage() {
  const { market } = await getDiscoveryMarket();

  return (
    <AppShell tone="media" wide>
      <FeedClient key={market} market={market} />
    </AppShell>
  );
}
