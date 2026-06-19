import type { Metadata, Viewport } from "next";
import { Geist, Space_Grotesk } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Display face gives the brand its energetic, slightly editorial personality.
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "FoodSwipe — Swipe through restaurants powered by real food videos",
  description:
    "Discover restaurants the way you discover everything else: by swiping through real short-form food-review videos.",
};

export const viewport: Viewport = {
  themeColor: "#08080a",
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
      className={`${geistSans.variable} ${spaceGrotesk.variable} h-full antialiased`}
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
