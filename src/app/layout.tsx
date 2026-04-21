import type { Metadata } from "next";
import { Oswald, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const oswald = Oswald({
  subsets: ["latin"],
  variable: "--font-oswald",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MFT Worker Terminal",
  description: "Worker login, registration, and dashboard for Monkeys from Trees",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${oswald.variable} ${plexMono.variable}`}>
      <body className="antialiased min-h-[100dvh] bg-[#000000] text-white font-mono selection:bg-[#FF5500] selection:text-black">
        {children}
      </body>
    </html>
  );
}
