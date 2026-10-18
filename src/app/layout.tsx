import type { Metadata, Viewport } from "next";
import { Oswald, IBM_Plex_Mono, Inter } from "next/font/google";
import "./globals.css";
import { FeedbackHost } from "@/lib/worker/feedback";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const oswald = Oswald({
  subsets: ["latin"],
  variable: "--font-heading",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const viewport: Viewport = {
  themeColor: "#dc2626",
};

export const metadata: Metadata = {
  title: "MFT Monkeys · Worker Portal",
  description: "Worker portal, task management, and time tracking for Monkeys from Trees",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "MFT Worker",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
};

const themeScript = `(function(){try{var t=localStorage.getItem("mft.theme");var isDark=t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(isDark){document.documentElement.classList.add("dark");}else{document.documentElement.classList.remove("dark");}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${oswald.variable} ${plexMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-[100dvh] bg-[var(--mft-bg)] text-[var(--mft-text)] font-sans antialiased selection:bg-red-600 selection:text-white">
        {children}
        <FeedbackHost />
      </body>
    </html>
  );
}
