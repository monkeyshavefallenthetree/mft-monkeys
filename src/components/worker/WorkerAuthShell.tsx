"use client";

import Link from "next/link";
import { useTheme } from "@/lib/worker/theme";

const MARKETING =
  process.env.NEXT_PUBLIC_MARKETING_SITE_URL?.replace(/\/$/, "") ?? "";

type Props = {
  children: React.ReactNode;
  /** Narrower card (login) vs wider (register) */
  variant?: "narrow" | "wide";
  footer?: React.ReactNode;
};

export default function WorkerAuthShell({ children, variant = "narrow", footer }: Props) {
  const { isDark, toggleTheme } = useTheme();

  return (
    <div className="relative min-h-[100dvh] overflow-x-hidden bg-[var(--mft-bg)] text-zinc-900 dark:text-white font-sans flex flex-col justify-between">
      {/* Background decoration */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-red-600/10 blur-3xl dark:bg-red-600/15" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-red-500/5 blur-3xl dark:bg-red-950/20" />
      </div>

      {/* Top Header */}
      <header className="relative z-10 mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-600 font-bold text-white shadow-md shadow-red-900/30">
            M
          </div>
          <div>
            <span className="text-base font-bold text-zinc-900 dark:text-white tracking-tight">MFT Monkeys</span>
            <p className="text-[11px] text-zinc-500">Worker &amp; Team Portal</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Theme switcher */}
          <button
            type="button"
            onClick={toggleTheme}
            className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white transition-colors cursor-pointer"
            title={`Switch to ${isDark ? "light" : "dark"} mode`}
            aria-label="Toggle theme"
          >
            {isDark ? (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>

          {MARKETING ? (
            <Link
              href={MARKETING}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
            >
              ← Return to Website
            </Link>
          ) : (
            <span className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-semibold text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
              Secure Terminal
            </span>
          )}
        </div>
      </header>

      {/* Center Auth Card */}
      <main className="relative z-10 mx-auto w-full px-4 py-8 flex flex-1 items-center justify-center">
        <div className={`w-full ${variant === "wide" ? "max-w-2xl" : "max-w-md"} animate-slide-up`}>
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 sm:p-8 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
            {children}
          </div>
          {footer ? <div className="mt-6 text-center text-xs text-zinc-500">{footer}</div> : null}
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 py-4 text-center text-xs text-zinc-400">
        © {new Date().getFullYear()} Monkeys From The Trees · All rights reserved
      </footer>
    </div>
  );
}
