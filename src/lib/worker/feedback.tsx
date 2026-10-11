"use client";

/**
 * Lightweight feedback system for the MFT Worker Portal.
 * Matches mft-admin toasts and confirmation dialogs.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

type ToastKind = "success" | "error" | "info" | "warning";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
  action?: ToastAction;
  duration: number;
}

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
}

interface ConfirmItem extends ConfirmOptions {
  id: number;
  resolve: (ok: boolean) => void;
}

interface State {
  toasts: ToastItem[];
  confirm: ConfirmItem | null;
}

let state: State = { toasts: [], confirm: null };
const listeners = new Set<() => void>();
let seq = 1;

function emit(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function getSnapshot() {
  return state;
}

const SERVER_STATE: State = { toasts: [], confirm: null };
function getServerSnapshot() {
  return SERVER_STATE;
}

function push(kind: ToastKind, title: string, opts?: { description?: string; action?: ToastAction; duration?: number }) {
  const item: ToastItem = {
    id: seq++,
    kind,
    title,
    description: opts?.description,
    action: opts?.action,
    duration: opts?.duration ?? (opts?.action ? 6500 : kind === "error" ? 6000 : 3800),
  };
  emit({ ...state, toasts: [...state.toasts.slice(-4), item] });
  return item.id;
}

export function dismissToast(id: number) {
  emit({ ...state, toasts: state.toasts.filter((t) => t.id !== id) });
}

type ToastOpts = { description?: string; action?: ToastAction; duration?: number };

export const toast = Object.assign((title: string, opts?: ToastOpts) => push("info", title, opts), {
  success: (title: string, opts?: ToastOpts) => push("success", title, opts),
  error: (title: string, opts?: ToastOpts) => push("error", title, opts),
  info: (title: string, opts?: ToastOpts) => push("info", title, opts),
  warning: (title: string, opts?: ToastOpts) => push("warning", title, opts),
});

/** Promise-based replacement for window.confirm(). */
export function confirmDialog(opts: ConfirmOptions | string): Promise<boolean> {
  const o: ConfirmOptions = typeof opts === "string" ? { title: opts } : opts;
  if (typeof window === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    state.confirm?.resolve(false);
    emit({ ...state, confirm: { ...o, id: seq++, resolve } });
  });
}

function closeConfirm(ok: boolean) {
  const c = state.confirm;
  if (!c) return;
  emit({ ...state, confirm: null });
  c.resolve(ok);
}

const KIND_STYLE: Record<ToastKind, { ring: string; path: string }> = {
  success: { ring: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400", path: "M5 13l4 4L19 7" },
  error: { ring: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400", path: "M6 18L18 6M6 6l12 12" },
  warning: { ring: "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400", path: "M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" },
  info: { ring: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300", path: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
};

function ToastView({ t }: { t: ToastItem }) {
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = () => {
    setLeaving(true);
    setTimeout(() => dismissToast(t.id), 160);
  };

  const start = () => {
    timer.current = setTimeout(close, t.duration);
  };
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
  };

  useEffect(() => {
    start();
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s = KIND_STYLE[t.kind];
  return (
    <div
      role="status"
      onMouseEnter={stop}
      onMouseLeave={start}
      className={`pointer-events-auto flex w-[22rem] max-w-[calc(100vw-2rem)] items-start gap-3 rounded-xl border border-zinc-200 bg-white p-3.5 shadow-lg transition-all duration-150 dark:border-zinc-800 dark:bg-zinc-900 ${
        leaving ? "translate-x-4 opacity-0" : "animate-toast-in"
      }`}
    >
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${s.ring}`}>
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
          <path strokeLinecap="round" strokeLinejoin="round" d={s.path} />
        </svg>
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-[13px] font-semibold text-zinc-900 dark:text-white">{t.title}</p>
        {t.description && <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{t.description}</p>}
      </div>
      {t.action && (
        <button
          type="button"
          onClick={() => {
            t.action?.onClick();
            close();
          }}
          className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
        >
          {t.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={close}
        aria-label="Dismiss"
        className="shrink-0 rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 cursor-pointer"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

function ConfirmView({ c }: { c: ConfirmItem }) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const danger = c.tone === "danger";

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeConfirm(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-zinc-950/50 p-4 backdrop-blur-xs animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeConfirm(false);
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl animate-scale-in dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="flex items-start gap-4">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              danger ? "bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-400" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            }`}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d={danger ? KIND_STYLE.warning.path : "M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"}
              />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="confirm-title" className="text-base font-semibold text-zinc-900 dark:text-white">
              {c.title}
            </h2>
            {c.message && <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{c.message}</p>}
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => closeConfirm(false)}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-xs font-semibold text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-750 cursor-pointer"
          >
            {c.cancelLabel ?? "Cancel"}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => closeConfirm(true)}
            className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-xs font-semibold text-white transition-all cursor-pointer ${
              danger ? "bg-red-600 hover:bg-red-700 shadow-sm shadow-red-900/30" : "bg-zinc-900 hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
            }`}
          >
            {c.confirmLabel ?? (danger ? "Confirm" : "Continue")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function FeedbackHost() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return (
    <>
      <div className="pointer-events-none fixed bottom-24 right-4 z-[210] lg:bottom-4 flex flex-col items-end gap-2" aria-live="polite">
        {s.toasts.map((t) => (
          <ToastView key={t.id} t={t} />
        ))}
      </div>
      {s.confirm && <ConfirmView key={s.confirm.id} c={s.confirm} />}
    </>
  );
}
