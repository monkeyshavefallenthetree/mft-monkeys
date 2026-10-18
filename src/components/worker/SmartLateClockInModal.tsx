"use client";

import { useState } from "react";
import {
  evaluateClockIn,
  parseHm,
  remainingQuota,
  toArabicDigits,
  UNCOVERED_REASON_AR,
  type ClockInEvaluation,
  type CycleUsage,
  type Policy2026Config,
  type UncoveredReason,
} from "@/lib/worker/hrPolicy2026";

export type SmartLateClockInChoice = "permission" | "deduct" | "excuse";

const UNCOVERED_REASON_EN: Record<UncoveredReason, string> = {
  over_single_cap: "Exceeds the 2-hour maximum per single permission",
  count_exhausted: "All 4 monthly permissions have been used",
  minutes_exhausted: "Remaining permission minutes are not enough (no partial coverage)",
};

/**
 * HR-POL-2026 Smart Late Clock-In Choice Modal:
 * Lets the worker choose whether to cover today's morning lateness using their
 * monthly permission quota (no salary deduction) OR keep their permission quota
 * and accept the lateness salary deduction (or submit an excuse to HR).
 */
export default function SmartLateClockInModal({
  clockIn,
  usage,
  cfg,
  hourlyRate,
  busy,
  currentCoveredChoice,
  onChoose,
  onClose,
}: {
  clockIn: Date;
  usage: CycleUsage;
  cfg: Policy2026Config;
  hourlyRate: number;
  busy?: boolean;
  /** If the worker already made a choice today and opened the modal to change it. */
  currentCoveredChoice?: boolean | null;
  onChoose: (
    choice: SmartLateClockInChoice,
    ev: ClockInEvaluation,
    penaltyDays: 0.25 | 0.5,
  ) => void;
  onClose?: () => void;
}) {
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const isAr = lang === "ar";
  const t = (arText: string, enText: string) => (isAr ? arText : enText);
  const fmt = (v: number | string) => (isAr ? toArabicDigits(v) : String(v));

  const ev = evaluateClockIn(clockIn, usage, cfg);
  const remNow = remainingQuota(usage, cfg);
  const isVeryLate = parseHm(ev.clockInHm) > parseHm(cfg.veryLateCutoffTime);
  const penaltyDays: 0.25 | 0.5 =
    ev.fallbackPenaltyDays === 0.5 || isVeryLate ? 0.5 : 0.25;
  const dailyPay = (cfg.standardHours || 8) * (hourlyRate || 31.25);
  const deductEgp = Math.round(penaltyDays * dailyPay * 100) / 100;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-zinc-950/70 p-3 backdrop-blur-sm animate-fade-in sm:items-center"
      dir={isAr ? "rtl" : "ltr"}
      lang={lang}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="smart-late-title"
        id="worker-smart-late-clockin"
        className="w-full max-w-md overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl animate-scale-in dark:border-zinc-700 dark:bg-zinc-900"
      >
        {/* Top Gradient Banner */}
        <div className="relative bg-gradient-to-br from-amber-600 via-orange-500 to-red-600 px-6 pb-6 pt-5 text-white">
          <div className="absolute inset-0 opacity-20 [background:radial-gradient(circle_at_20%_0%,white,transparent_55%)]" />
          <div className="relative flex items-center justify-between gap-2">
            <span className="rounded-full bg-white/20 px-3 py-1 text-[11px] font-bold">
              {t("HR-POL-2026 · تنبيه تأخير صباحي", "HR-POL-2026 · Late Arrival Choice")}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setLang(isAr ? "en" : "ar")}
                className="rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-bold hover:bg-white/30 cursor-pointer"
              >
                🌐 {isAr ? "EN" : "عربي"}
              </button>
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full p-1.5 hover:bg-white/15 cursor-pointer"
                  aria-label={t("إغلاق", "Close")}
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          <div className="relative mt-4 text-center">
            <div className="font-mono text-4xl font-black tabular-nums tracking-tight" dir="ltr">
              +{fmt(ev.lateMinutes)} {t("دقيقة تأخير", "min late")}
            </div>
            <p className="mt-1.5 text-xs text-white/90">
              {t(
                `وقت الحضور ${fmt(ev.clockInHm)} (بعد موعد السماح ${fmt(cfg.lateCutoffTime)}) · نهاية الشيفت ${fmt(ev.requiredEndHm)}`,
                `Clocked in at ${ev.clockInHm} (cutoff ${cfg.lateCutoffTime}) · Shift ends ${ev.requiredEndHm}`,
              )}
            </p>
          </div>
        </div>

        {/* Body & Choices */}
        <div className="space-y-3 p-5">
          <h3
            id="smart-late-title"
            className="text-center text-[15px] font-bold leading-7 text-zinc-900 dark:text-white"
          >
            {t(
              "كيف تريد معالجة تأخير اليوم؟ اختر استخدام إذن أو تطبيق الخصم:",
              "How would you like to handle today's late arrival?",
            )}
          </h3>

          {!ev.covered && ev.uncoveredReason && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-[12px] leading-6 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
              ⚠️{" "}
              {isAr
                ? UNCOVERED_REASON_AR[ev.uncoveredReason]
                : UNCOVERED_REASON_EN[ev.uncoveredReason]}
            </div>
          )}

          {/* Option 1: Use a Monthly Permission */}
          <button
            type="button"
            id="worker-smart-late-permission"
            disabled={!ev.covered || busy}
            onClick={() => onChoose("permission", ev, penaltyDays)}
            className={`flex w-full items-center gap-3 rounded-2xl border p-3.5 text-start transition hover:-translate-y-0.5 hover:shadow-md disabled:pointer-events-none disabled:opacity-45 cursor-pointer ${
              currentCoveredChoice === true
                ? "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500/30 dark:border-emerald-500 dark:bg-emerald-950/40"
                : "border-emerald-300 bg-emerald-50/80 dark:border-emerald-800 dark:bg-emerald-950/30"
            }`}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-lg font-bold text-white">
              ✓
            </span>
            <span className="flex-1">
              <span className="flex items-center justify-between gap-2">
                <b className="text-sm text-emerald-900 dark:text-emerald-200">
                  {t("استخدام إذن تأخير من رصيدي", "Use a Monthly Permission")}
                </b>
                <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">
                  {t("٠ ج.م خصم", "0 EGP deduct")}
                </span>
              </span>
              <span className="mt-0.5 block text-xs text-emerald-800/85 dark:text-emerald-300/85">
                {ev.covered
                  ? t(
                      `يُخصم ${fmt(ev.chargedMinutes)} دقيقة من رصيد الأذونات · يتبقى لك ${fmt(ev.remainingAfter.count)} أذونات / ${fmt(ev.remainingAfter.minutes)} دقيقة`,
                      `Uses ${ev.chargedMinutes} mins from quota · Leaves ${ev.remainingAfter.count} permissions / ${ev.remainingAfter.minutes} mins`,
                    )
                  : t("غير متاح (رصيد الأذونات لا يغطي هذه المدة)", "Unavailable (quota cannot cover this duration)")}
              </span>
            </span>
          </button>

          {/* Option 2: Accept Salary Deduction & Keep Permission Quota */}
          <button
            type="button"
            id="worker-smart-late-deduct"
            disabled={busy}
            onClick={() => onChoose("deduct", ev, penaltyDays)}
            className={`flex w-full items-center gap-3 rounded-2xl border p-3.5 text-start transition hover:-translate-y-0.5 hover:bg-red-50/80 dark:hover:bg-red-950/30 cursor-pointer ${
              currentCoveredChoice === false
                ? "border-red-500 bg-red-50 ring-2 ring-red-500/30 dark:border-red-500 dark:bg-red-950/40"
                : "border-red-200 bg-white dark:border-red-900/60 dark:bg-zinc-900"
            }`}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-100 text-lg text-red-700 dark:bg-red-950 dark:text-red-300">
              💸
            </span>
            <span className="flex-1">
              <span className="flex items-center justify-between gap-2">
                <b className="text-sm text-red-800 dark:text-red-200">
                  {t("خصم من الراتب (وتوفير رصيد الأذونات)", "Deduct from Salary (Save Permission)")}
                </b>
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-800 dark:bg-red-950 dark:text-red-300">
                  −{fmt(penaltyDays === 0.5 ? "٠.٥" : "٠.٢٥")} {t("يوم", "day")}
                </span>
              </span>
              <span className="mt-0.5 block text-xs text-red-700/85 dark:text-red-300/85">
                {t(
                  `لا يُستهلك أي إذن (يبقى لك ${fmt(remNow.count)} أذونات / ${fmt(remNow.minutes)} د) · خصم ${penaltyDays === 0.5 ? "نصف يوم" : "ربع يوم"} ≈ ${fmt(deductEgp.toFixed(2))} ج.م`,
                  `Keeps all ${remNow.count} permissions (${remNow.minutes}m) · Deducts ${penaltyDays} day ≈ ${deductEgp.toFixed(2)} EGP`,
                )}
              </span>
            </span>
          </button>

          {/* Option 3: Submit Excuse to HR */}
          <button
            type="button"
            id="worker-smart-late-excuse"
            disabled={busy}
            onClick={() => onChoose("excuse", ev, penaltyDays)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-zinc-200 py-2.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer"
          >
            📝 {t("لدي عذر قهري — تقديم طلب استثناء للموارد البشرية", "I have an emergency — Submit excuse to HR")}
          </button>
        </div>
      </div>
    </div>
  );
}
