import type { Viewport } from "next";
import { connection } from "next/server";
import PreferenceOnboarding from "@/components/PreferenceOnboarding";
import { getDefaultPublicMarket } from "@/lib/publicMarket";

export const viewport: Viewport = {
  themeColor: "#f8f1e5",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

export default async function Home() {
  await connection();
  return <PreferenceOnboarding market={getDefaultPublicMarket()} />;
}
