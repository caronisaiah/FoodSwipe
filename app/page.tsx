import type { Viewport } from "next";
import PreferenceOnboarding from "@/components/PreferenceOnboarding";
import { getDiscoveryMarket } from "@/lib/discoveryMarket";

export const viewport: Viewport = {
  themeColor: "#f8f1e5",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

export default async function Home() {
  const discovery = await getDiscoveryMarket();
  return <PreferenceOnboarding {...discovery} />;
}
