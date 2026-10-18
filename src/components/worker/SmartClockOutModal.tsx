"use client";

import { useEffect, useState } from "react";
import {
  evaluateEarlyLeave,
  formatHm,
  minutesOfDay,
  toArabicDigits,
  type CycleUsage,
  type EarlyLeaveEvaluation,
  type Policy2026Config,
} from "@/lib/worker/hrPolicy2026";

export type SmartClockOutChoice = "permission" | "break" | "deduct" | "normal" | "stay";

/**
 * HR-POL-2026 smart clock-out alert:
 * «متبقي X دقيقة على نهاية الشيفت؛ هل تريد استهلاك إذن انصراف مبكر؟»
 * Live countdown — re-evaluated every second against the worker's quota.
 */
export default function SmartClockOutModal({
  requiredEnd,
  usage,
  cfg,
  hourlyRate,
  mode,
  busy,
  onChoose,
}: {
  requiredEnd: Date;
  usage: CycleUsage;
  cfg: Policy2026Config;
  hourlyRate: number;
  mode: "clockout" | "logout";
  busy?: boolean;
  onChoose: (choice: SmartClockOutChoice, ev: EarlyLeaveEvaluation) => void;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const ev = evaluateEarlyLeave(now, requiredEnd, usage, cfg);
  const secsLeft = Math.max(0, Math.floor((requiredEnd.getTime() - now.getTime()) / 1000));
  const hh = Math.floor(secsLeft / 3600);
  const mm = Math.floor((secsLeft % 3600) / 60);
  const ss = secsLeft % 60;
  const pad = (n: number) => toArabicDigits(String(n).padStart(2, "0"));
  const deductEgp = Math.round((ev.remainingMinutes / 60) * hourlyRate * 100) / 100;
  const endHm = toArabicDigits(formatHm(minutesOfDay(requiredEnd)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onChoose("stay", ev);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-zinc-950/70 p-3 backdrop-blur-sm animate-fade-in sm:items-center"
      onMouseDown={(e) => e.target === e.currentTarget && onChoose("stay", ev)}
      dir="rtl"
      lang="ar"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="smart-out-title"
        id="worker-smart-clockout"
        className="w-full max-w-md overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl animate-scale-in dark:border-zinc-700 dark:bg-zinc-900"
      >
        <div className="relative bg-gradient-to-br from-red-600 via-red-500 to-orange-500 px-6 pb-6 pt-5 text-white">
          <div className="absolute inset-0 opacity-20 [background:radial-gradient(circle_at_20%_0%,white,transparent_55%)]" />
          <div className="relative flex items-center justify-between">
            <span className="rounded-full bg-white/20 px-3 py-1 text-[11px] font-bold">HR-POL-2026 · انصراف مبكر</span>
            <button type="button" id="worker-smart-out-close" onClick={() => onChoose("stay", ev)} className="rounded-full p-1.5 hover:bg-white/15 cursor-pointer" aria-label="إغلاق">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="relative mt-4 text-center">
            <div className="font-mono text-5xl font-black tabular-nums tracking-tight" dir="ltr">
              {pad(hh)}:{pad(mm)}:{pad(ss)}
            </div>
            <p className="mt-1 text-xs text-white/85">نهاية الشيفت المطلوبة {endHm}</p>
          </div>
        </div>

        <div className="space-y-3 p-5">
          {ev.isEarly ? (
            <>
              <h3 id="smart-out-title" className="text-center text-[15px] font-bold leading-7 text-zinc-900 dark:text-white">
                متبقي {toArabicDigits(ev.remainingMinutes)} دقيقة على نهاية الشيفت؛ هل تريد استهلاك إذن انصراف مبكر؟
              </h3>
              {!ev.canUsePermission && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-[13px] leading-6 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
                  {ev.messageAr}
                  <div className="mt-1 font-bold">أجر غير مدفوع ≈ {toArabicDigits(deductEgp.toFixed(2))} ج.م</div>
                </div>
              )}

              <button
                type="button"
                id="worker-smart-out-permission"
                disabled={!ev.canUsePermission || busy}
                onClick={() => onChoose("permission", ev)}
                className="flex w-full items-center gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-3.5 text-right transition hover:-translate-y-0.5 hover:shadow-md disabled:pointer-events-none disabled:opacity-45 dark:border-emerald-800 dark:bg-emerald-950/30 cursor-pointer"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white">✓</span>
                <span className="flex-1">
                  <b className="block text-sm text-emerald-900 dark:text-emerald-200">نعم، استخدم إذن انصراف مبكر</b>
                  <span className="text-xs text-emerald-800/80 dark:text-emerald-300/80">
                    {ev.canUsePermission
                      ? `يُخصم ${toArabicDigits(ev.chargedMinutes)} دقيقة · المتبقي بعده ${toArabicDigits(ev.remainingAfter.count)} أذونات / ${toArabicDigits(ev.remainingAfter.minutes)} دقيقة`
                      : "غير متاح"}
                  </span>
                </span>
              </button>

              <button
                type="button"
                id="worker-smart-out-break"
                disabled={busy}
                onClick={() => onChoose("break", ev)}
                className="flex w-full items-center gap-3 rounded-2xl border border-zinc-200 p-3.5 text-right transition hover:-translate-y-0.5 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">☕</span>
                <span className="flex-1">
                  <b className="block text-sm text-zinc-900 dark:text-white">{mode === "logout" ? "استراحة — سأعود لاحقًا" : "استراحة — سأعود"}</b>
                  <span className="text-xs text-zinc-500">بدون استهلاك إذن. إن لم تعد وتكمل الساعات يُخصم الوقت المتبقي.</span>
                </span>
              </button>

              <button
                type="button"
                id="worker-smart-out-deduct"
                disabled={busy}
                onClick={() => onChoose("deduct", ev)}
                className="flex w-full items-center gap-3 rounded-2xl border border-red-200 p-3.5 text-right transition hover:-translate-y-0.5 hover:bg-red-50 dark:border-red-900/60 dark:hover:bg-red-950/30 cursor-pointer"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">⇥</span>
                <span className="flex-1">
                  <b className="block text-sm text-red-800 dark:text-red-200">انصراف بدون إذن</b>
                  <span className="text-xs text-red-700/80 dark:text-red-300/80">الدقائق المتبقية لن تُدفع ≈ {toArabicDigits(deductEgp.toFixed(2))} ج.م</span>
                </span>
              </button>
            </>
          ) : (
            <>
              <h3 id="smart-out-title" className="text-center text-[15px] font-bold leading-7 text-zinc-900 dark:text-white">
                انتهى الشيفت الرسمي — يمكنك تسجيل الخروج بدون أي خصم.
              </h3>
              <button type="button" id="worker-smart-out-normal" disabled={busy} onClick={() => onChoose("normal", ev)} className="w-full rounded-2xl bg-red-600 py-3 text-sm font-bold text-white shadow-lg shadow-red-600/25 transition hover:bg-red-700 cursor-pointer">
                {mode === "logout" ? "تسجيل الخروج من النظام" : "تسجيل الانصراف"}
              </button>
            </>
          )}
          <button type="button" id="worker-smart-out-stay" onClick={() => onChoose("stay", ev)} className="w-full rounded-2xl py-2.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer">
            البقاء في العمل
          </button>
        </div>
      </div>
    </div>
  );
}
