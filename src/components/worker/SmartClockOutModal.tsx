"use client";

import { useEffect, useState } from "react";
import {
  evaluateClockIn,
  evaluateEarlyLeave,
  formatHm,
  minutesOfDay,
  toArabicDigits,
  type CycleUsage,
  type EarlyLeaveEvaluation,
  type Policy2026Config,
} from "@/lib/worker/hrPolicy2026";

export type SmartClockOutChoice =
  | "permission"
  | "excuse"
  | "break"
  | "deduct"
  | "normal"
  | "stay";

/**
 * HR-POL-2026 smart clock-out alert:
 * Shows remaining shift time AND any unresolved lateness from today's clock-in,
 * giving the worker clear choices:
 *   1. Submit Exception / Excuse to HR (طلب استثناء / عذر)
 *   2. Accept Lateness / Early-Leave Deduction (خصم على التأخير / عدم استكمال الساعات)
 *   3. Use Monthly Permission (استخدام إذن من الرصيد الشهري — بدون خصم)
 *   4. Break — Return Later (استراحة — سأعود لاحقًا)
 */
export default function SmartClockOutModal({
  requiredEnd,
  firstClockIn,
  workedSoFarMs,
  lateCovered,
  usage,
  cfg,
  hourlyRate,
  mode,
  busy,
  onChoose,
}: {
  requiredEnd: Date;
  firstClockIn?: Date;
  workedSoFarMs?: number;
  lateCovered?: boolean;
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

  const rawEv = evaluateEarlyLeave(now, requiredEnd, usage, cfg);
  const stdMins = cfg.standardHours * 60;
  const workedMins =
    typeof workedSoFarMs === "number" ? Math.floor(workedSoFarMs / 60_000) : stdMins;
  const shortfallMins = Math.max(0, stdMins - workedMins);
  const effectiveRemainingMins = Math.max(rawEv.remainingMinutes, shortfallMins);

  // Re-evaluate early leave using effective target if shortfallMins > rawEv.remainingMinutes
  const effectiveEnd =
    effectiveRemainingMins > rawEv.remainingMinutes
      ? new Date(now.getTime() + effectiveRemainingMins * 60_000)
      : requiredEnd;
  const ev = evaluateEarlyLeave(now, effectiveEnd, usage, cfg);

  const lateEv =
    firstClockIn && !lateCovered ? evaluateClockIn(firstClockIn, usage, cfg) : null;
  const hasUnresolvedLate = Boolean(lateEv && lateEv.status !== "on-time");
  const latePenaltyDays = hasUnresolvedLate
    ? lateEv!.fallbackPenaltyDays || (lateEv!.lateMinutes > 60 ? 0.5 : 0.25)
    : 0;
  const latePenaltyEgp = hasUnresolvedLate
    ? Math.round(latePenaltyDays * cfg.standardHours * hourlyRate * 100) / 100
    : 0;

  const secsLeft = Math.max(
    0,
    Math.floor((effectiveEnd.getTime() - now.getTime()) / 1000),
  );
  const hh = Math.floor(secsLeft / 3600);
  const mm = Math.floor((secsLeft % 3600) / 60);
  const ss = secsLeft % 60;
  const pad = (n: number) => toArabicDigits(String(n).padStart(2, "0"));
  const earlyDeductEgp =
    Math.round((ev.remainingMinutes / 60) * hourlyRate * 100) / 100;
  const totalDeductEgp =
    Math.round((earlyDeductEgp + latePenaltyEgp) * 100) / 100;
  const endHm = toArabicDigits(formatHm(minutesOfDay(requiredEnd)));

  const needsAction = ev.isEarly || hasUnresolvedLate;

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
            <span className="rounded-full bg-white/20 px-3 py-1 text-[11px] font-bold">
              HR-POL-2026 · تنبيه الانصراف والتأخير
            </span>
            <button
              type="button"
              id="worker-smart-out-close"
              onClick={() => onChoose("stay", ev)}
              className="rounded-full p-1.5 hover:bg-white/15 cursor-pointer"
              aria-label="إغلاق"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="relative mt-4 text-center">
            {ev.isEarly ? (
              <>
                <div className="font-mono text-5xl font-black tabular-nums tracking-tight" dir="ltr">
                  {pad(hh)}:{pad(mm)}:{pad(ss)}
                </div>
                <p className="mt-1 text-xs text-white/85">
                  متبقي {toArabicDigits(ev.remainingMinutes)} دقيقة لاستكمال الشيفت (نهاية الشيفت {endHm})
                </p>
              </>
            ) : (
              <>
                <div className="text-2xl font-black">
                  تأخير مسجل اليوم: {toArabicDigits(lateEv?.lateMinutes ?? 0)} دقيقة
                </div>
                <p className="mt-1 text-xs text-white/85">
                  بعد الموعد المحدد ({toArabicDigits(cfg.lateCutoffTime)})
                </p>
              </>
            )}
          </div>
        </div>

        <div className="space-y-2.5 p-5">
          {needsAction ? (
            <>
              <h3
                id="smart-out-title"
                className="text-center text-[14px] font-bold leading-6 text-zinc-900 dark:text-white"
              >
                {ev.isEarly && hasUnresolvedLate
                  ? `لديك تأخير (${toArabicDigits(lateEv!.lateMinutes)} د) ومتبقي ${toArabicDigits(ev.remainingMinutes)} دقيقة على نهاية الشيفت — اختر الإجراء المناسب:`
                  : ev.isEarly
                    ? `متبقي ${toArabicDigits(ev.remainingMinutes)} دقيقة على نهاية الشيفت — هل تريد تقديم استثناء أو استهلاك إذن أو خصم التأخير؟`
                    : `لديك تأخير اليوم (${toArabicDigits(lateEv!.lateMinutes)} دقيقة) — هل تريد تقديم استثناء أو خصم على التأخير؟`}
              </h3>

              {hasUnresolvedLate && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/90 px-3.5 py-2.5 text-xs leading-5 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                  <b>تنبيه تأخير الحضور:</b> تأخرت {toArabicDigits(lateEv!.lateMinutes)} دقيقة (خصم{" "}
                  {toArabicDigits(latePenaltyDays * cfg.standardHours)} ساعة ≈ {toArabicDigits(latePenaltyEgp.toFixed(2))} ج.م إن لم يُغطَّ بإذن أو استثناء).
                </div>
              )}

              {/* Option 1: Submit Exception / Excuse to HR */}
              <button
                type="button"
                id="worker-smart-out-excuse"
                disabled={busy}
                onClick={() => onChoose("excuse", ev)}
                className="flex w-full items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-3.5 text-right transition hover:-translate-y-0.5 hover:shadow-md disabled:pointer-events-none disabled:opacity-45 dark:border-amber-800 dark:bg-amber-950/30 cursor-pointer"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-lg text-white">
                  📝
                </span>
                <span className="flex-1">
                  <b className="block text-sm text-amber-950 dark:text-amber-100">
                    تقديم طلب استثناء / عذر للموارد البشرية (Exception)
                  </b>
                  <span className="text-xs text-amber-800/85 dark:text-amber-300/80">
                    إرسال عذر للتأخير أو الانصراف المبكر لمراجعته وإلغاء الخصم عند الموافقة
                  </span>
                </span>
              </button>

              {/* Option 2: Accept Lateness / Shortfall Deduction */}
              <button
                type="button"
                id="worker-smart-out-deduct"
                disabled={busy}
                onClick={() => onChoose("deduct", ev)}
                className="flex w-full items-center gap-3 rounded-2xl border border-red-200 bg-red-50/60 p-3.5 text-right transition hover:-translate-y-0.5 hover:bg-red-50 dark:border-red-900/60 dark:bg-red-950/20 dark:hover:bg-red-950/40 cursor-pointer"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
                  💸
                </span>
                <span className="flex-1">
                  <b className="block text-sm text-red-800 dark:text-red-200">
                    خصم على التأخير / الانصراف بدون إذن
                  </b>
                  <span className="text-xs text-red-700/80 dark:text-red-300/80">
                    تسجيل الانصراف وتطبيق خصم التأخير / الساعات غير المكتملة ≈{" "}
                    {toArabicDigits(totalDeductEgp.toFixed(2))} ج.م
                  </span>
                </span>
              </button>

              {/* Option 3: Use Monthly Permission */}
              <button
                type="button"
                id="worker-smart-out-permission"
                disabled={(!ev.canUsePermission && !(lateEv?.covered)) || busy}
                onClick={() => onChoose("permission", ev)}
                className="flex w-full items-center gap-3 rounded-2xl border border-emerald-300 bg-emerald-50 p-3.5 text-right transition hover:-translate-y-0.5 hover:shadow-md disabled:pointer-events-none disabled:opacity-45 dark:border-emerald-800 dark:bg-emerald-950/30 cursor-pointer"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white">
                  ✓
                </span>
                <span className="flex-1">
                  <b className="block text-sm text-emerald-900 dark:text-emerald-200">
                    استخدام إذن من الرصيد الشهري (بدون خصم)
                  </b>
                  <span className="text-xs text-emerald-800/80 dark:text-emerald-300/80">
                    {ev.canUsePermission
                      ? `يُخصم ${toArabicDigits(ev.chargedMinutes)} دقيقة من رصيد الأذونات · المتبقي ${toArabicDigits(ev.remainingAfter.count)} أذونات`
                      : lateEv?.covered
                        ? `يُخصم ${toArabicDigits(lateEv.chargedMinutes)} دقيقة لتغطية التأخير من رصيد الأذونات`
                        : "لا يمكن التغطية من رصيد الأذونات (تجاوز الحد الأقصى للإذن الواحد أو الرصيد)"}
                  </span>
                </span>
              </button>

              {/* Option 4: Break - return later */}
              {ev.isEarly && (
                <button
                  type="button"
                  id="worker-smart-out-break"
                  disabled={busy}
                  onClick={() => onChoose("break", ev)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-zinc-200 p-3 text-right transition hover:-translate-y-0.5 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                    ☕
                  </span>
                  <span className="flex-1">
                    <b className="block text-xs text-zinc-900 dark:text-white">
                      {mode === "logout" ? "استراحة — سأعود لاحقًا" : "استراحة مؤقتة — سأعود لاستكمال الشيفت"}
                    </b>
                    <span className="text-[11px] text-zinc-500">
                      إيقاف مؤقت بدون إنهاء اليوم. عند العودة تستكمل ساعاتك.
                    </span>
                  </span>
                </button>
              )}
            </>
          ) : (
            <>
              <h3
                id="smart-out-title"
                className="text-center text-[15px] font-bold leading-7 text-zinc-900 dark:text-white"
              >
                انتهى الشيفت الرسمي — يمكنك تسجيل الانصراف بدون أي خصم.
              </h3>
              <button
                type="button"
                id="worker-smart-out-normal"
                disabled={busy}
                onClick={() => onChoose("normal", ev)}
                className="w-full rounded-2xl bg-red-600 py-3 text-sm font-bold text-white shadow-lg shadow-red-600/25 transition hover:bg-red-700 cursor-pointer"
              >
                {mode === "logout" ? "تسجيل الخروج من النظام" : "تسجيل الانصراف"}
              </button>
            </>
          )}
          <button
            type="button"
            id="worker-smart-out-stay"
            onClick={() => onChoose("stay", ev)}
            className="w-full rounded-2xl py-2.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer"
          >
            البقاء في العمل
          </button>
        </div>
      </div>
    </div>
  );
}

