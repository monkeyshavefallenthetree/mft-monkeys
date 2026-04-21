"use client";

import Link from "next/link";

const MARKETING =
  process.env.NEXT_PUBLIC_MARKETING_SITE_URL?.replace(/\/$/, "") ?? "";

type Props = {
  children: React.ReactNode;
  /** Narrower card (login) vs wider (register) */
  variant?: "narrow" | "wide";
  footer?: React.ReactNode;
};

/**
 * Brutalist Terminal Shell
 */
export default function WorkerAuthShell({ children, variant = "narrow", footer }: Props) {
  return (
    <div className="worker-auth-root relative min-h-[100dvh] overflow-x-hidden text-white font-mono">
      <div className="relative z-10 mx-auto flex min-h-[100dvh] flex-col px-4 py-10 sm:py-14">
        {/* Terminal Header */}
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between border-b border-[var(--mft-border)] pb-4">
          <div className="flex flex-col gap-2">
            <h1 className="text-xl font-bold uppercase tracking-wider text-[var(--mft-primary)] font-oswald flex items-center gap-2">
              <span className="inline-block w-3 h-3 bg-[var(--mft-primary)]" aria-hidden />
              SYS.PORTAL
            </h1>
            <p className="text-xs uppercase text-[var(--mft-muted)]">Terminal // Access Protocol</p>
          </div>
          {MARKETING ? (
            <Link
              href={MARKETING}
              className="brutal-btn-outline py-1.5 px-3 text-xs"
            >
              [ RETURN TO MAIN SITE ]
            </Link>
          ) : (
            <span className="text-xs uppercase text-[var(--mft-muted)] px-3 py-1.5 border border-[var(--mft-border)]">MFT-SECURE-NODE</span>
          )}
        </div>

        {/* Content Box */}
        <div
          className={`mx-auto w-full ${variant === "wide" ? "max-w-2xl" : "max-w-md"} flex-1 flex flex-col justify-center`}
        >
          <div className="brutal-card p-8 sm:p-10 relative">
            <div className="absolute top-0 left-0 w-full h-1 bg-[var(--mft-primary)]" aria-hidden />
            <div className="relative">{children}</div>
          </div>
          {footer ? <div className="mt-6 text-center text-xs uppercase text-[var(--mft-muted)]">{footer}</div> : null}
        </div>
      </div>
    </div>
  );
}
