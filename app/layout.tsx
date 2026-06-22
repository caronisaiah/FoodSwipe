import type { Metadata, Viewport } from "next";
import { Inter, Montserrat } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// Display face: Montserrat — needs 900 + italic for the "Midnight Luxe" wordmark.
const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "900"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "FoodSwipe — Swipe through restaurants powered by real food videos",
  description:
    "Discover restaurants the way you discover everything else: by swiping through real short-form food-review videos.",
};

export const viewport: Viewport = {
  themeColor: "#0e0e0e",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // let the app paint into the iOS safe-area / notch region
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${montserrat.variable} h-full antialiased`}
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        {/* Material Symbols (icon font) — loaded once in the document head (the
            correct place for the whole app), not inside any component. next/font
            doesn't handle this variable ligature icon font, so a <link> is right. */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- app-wide icon font, loaded once in the root layout head */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
        />
      </head>
      <body className="ambient-glow min-h-full">{children}</body>
    </html>
  );
}
