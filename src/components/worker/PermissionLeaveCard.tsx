"use client";

import { useState } from "react";
import {
  computeLeaveAccrual,
  formatHm,
  LEAVE_PHASE_AR,
  minutesOfDay,
  toArabicDigits,
  type CycleUsage,
  type LeaveAccrualResult,
  type Policy2026Config,
} from "@/lib/worker/hrPolicy2026";
import type { WorkerLedgerDoc } from "@/lib/worker/permissions";

const LEAVE_PHASE_EN: Record<LeaveAccrualResult["phase"], string> = {
  probation: "Probation Period (6m)",
  year1: "Year 1 Tier (15d/yr)",
  year2plus: "2+ Years Tier (21d/yr)",
};

function Meter({
  label,
  used,
  max,
  isAr,
}: {
  label: string;
  used: number;
  max: number;
  isAr: boolean;
}) {
  const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;
  const tone =
    pct >= 100
      ? "from-red-600 to-red-500"
      : pct >= 75
      ? "from-amber-500 to-orange-500"
      : "from-emerald-500 to-teal-500";
  const fmt = (v: number) => (isAr ? toArabicDigits(v) : String(v));
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-semibold text-zinc-700 dark:text-zinc-300">{label}</span>
        <span className="font-mono tabular-nums text-zinc-500">
          <b className="text-zinc-900 dark:text-white">{fmt(used)}</b> / {fmt(max)}
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className={`h-full rounded-full ${isAr ? "bg-gradient-to-l" : "bg-gradient-to-r"} ${tone} transition-[width] duration-700 ease-out`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** Time tab card: monthly permission quota, today's required shift end, cycle ledger, leave balance, and 1-click HR actions. */
export default function PermissionLeaveCard({
  cfg,
  policyActive,
  effectiveFrom,
  usage,
  ledger,
  requiredEnd,
  now,
  hireDate,
  hireDateIsFallback,
  usedLeave,
  priorUsedLeaveDays = 0,
  priorUsedAsOf,
  carriedOver,
  cycleLabel,
  onRequestLeave,
  onRequestOvertime,
  onOpenExpenses,
}: {
  cfg: Policy2026Config;
  policyActive: boolean;
  effectiveFrom: string;
  usage: CycleUsage;
  ledger: WorkerLedgerDoc[];
  requiredEnd: Date | null;
  now: Date;
  hireDate: string | null;
  hireDateIsFallback: boolean;
  usedLeave: { date: string; days: number }[];
  priorUsedLeaveDays?: number;
  /** Date the prior-used figure refers to (see priorUsedRecordedOn). */
  priorUsedAsOf?: string;
  carriedOver: number;
  cycleLabel: string;
  onRequestLeave?: () => void;
  onRequestOvertime?: () => void;
  onOpenExpenses?: () => void;
}) {
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const isAr = lang === "ar";
  const t = (arText: string, enText: string) => (isAr ? arText : enText);
  const fmt = (v: string | number) => (isAr ? toArabicDigits(v) : String(v));

  const remainingCount = Math.max(0, cfg.permissionMaxCount - usage.count);
  const remainingMinutes = Math.max(0, cfg.permissionMaxMinutes - usage.minutes);
  const acc = hireDate
    ? computeLeaveAccrual(
        hireDate,
        now,
        { usedLeave, carriedOverApproved: carriedOver, priorUsedLeaveDays, priorUsedAsOf },
        cfg,
      )
    : null;
  const leftMin = requiredEnd ? Math.ceil((requiredEnd.getTime() - now.getTime()) / 60000) : null;

  return (
    <div
      className="ui-card overflow-hidden"
      dir={isAr ? "rtl" : "ltr"}
      lang={lang}
      id="worker-permission-card"
    >
      {/* Header + AR/EN Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 bg-gradient-to-l from-red-50 via-white to-white px-5 py-4 dark:border-zinc-800 dark:from-red-950/30 dark:via-zinc-900 dark:to-zinc-900">
        <div>
          <h3 className="text-sm font-bold text-zinc-900 dark:text-white">
            {t("الأذونات الشهرية ورصيد الإجازات", "Monthly Permissions & Annual Leave")}
          </h3>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            {t(
              `لائحة HR-POL-2026 · الدورة ${cycleLabel}`,
              `Policy HR-POL-2026 · Cycle ${cycleLabel}`,
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLang(isAr ? "en" : "ar")}
            className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-bold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 cursor-pointer"
          >
            🌐 {isAr ? "English" : "العربية"}
          </button>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${
              policyActive
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
            }`}
          >
            {policyActive
              ? t("مفعّلة", "Active")
              : t(`تبدأ ${fmt(effectiveFrom)}`, `Starts ${effectiveFrom}`)}
          </span>
        </div>
      </div>

      {/* 1-Click Quick HR Actions Bar */}
      {(onRequestLeave || onRequestOvertime || onOpenExpenses) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 bg-zinc-50/70 px-5 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
          <span className="text-[11px] font-bold text-zinc-500 me-1">
            {t("إجراءات سريعة:", "Quick Actions:")}
          </span>
          {onRequestLeave && (
            <button
              type="button"
              onClick={onRequestLeave}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 cursor-pointer"
            >
              🌴 {t("طلب إجازة سنوية", "Request Annual Leave")}
            </button>
          )}
          {onRequestOvertime && (
            <button
              type="button"
              onClick={onRequestOvertime}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300 cursor-pointer"
            >
              🌙{" "}
              {t(
                `طلب عمل إضافي (${fmt(cfg.dayOtMultiplier)}x / ${fmt(cfg.nightOtMultiplier)}x)`,
                `Request Overtime (${cfg.dayOtMultiplier}x / ${cfg.nightOtMultiplier}x)`,
              )}
            </button>
          )}
          {onOpenExpenses && (
            <button
              type="button"
              onClick={onOpenExpenses}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-800 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300 cursor-pointer"
            >
              🚕 {t("تسجيل مصروف / مأمورية", "Submit Expense / Ride")}
            </button>
          )}
        </div>
      )}

      <div className="grid gap-5 p-5 md:grid-cols-2">
        {/* Left: Permissions Quota & Ledger */}
        <div className="space-y-4">
          <Meter
            label={t("عدد الأذونات المستخدمة", "Permissions Used (Count)")}
            used={usage.count}
            max={cfg.permissionMaxCount}
            isAr={isAr}
          />
          <Meter
            label={t("دقائق الأذونات المستخدمة", "Permission Minutes Used")}
            used={usage.minutes}
            max={cfg.permissionMaxMinutes}
            isAr={isAr}
          />
          <p className="text-[11px] leading-5 text-zinc-500">
            {t("المتبقي ", "Remaining: ")}
            <b className="text-zinc-800 dark:text-zinc-200">
              {t(
                `${fmt(remainingCount)} أذونات / ${fmt(remainingMinutes)} دقيقة`,
                `${remainingCount} permissions / ${remainingMinutes} mins`,
              )}
            </b>
            {t(
              `. الإذن الواحد من ${fmt(cfg.permissionMinMinutes)} إلى ${fmt(cfg.permissionMaxSingleMinutes)} دقيقة، والتأخير بعد ${fmt(cfg.lateCutoffTime)} ولو دقيقة يُحتسب إذنًا تلقائيًا.`,
              `. Each permission covers ${cfg.permissionMinMinutes}–${cfg.permissionMaxSingleMinutes} mins. Clock-ins after ${cfg.lateCutoffTime} auto-deduct from this quota first.`,
            )}
          </p>

          {requiredEnd && (
            <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 dark:border-zinc-700 dark:bg-zinc-800/60">
              <span className="text-xs text-zinc-600 dark:text-zinc-300">
                {t("نهاية شيفت اليوم المطلوبة (٨ ساعات)", "Today's Required Shift End (8h)")}
              </span>
              <span className="font-mono text-sm font-bold tabular-nums text-zinc-900 dark:text-white">
                {fmt(formatHm(minutesOfDay(requiredEnd)))}
                {leftMin != null && leftMin > 0 && (
                  <span className="ms-2 text-[11px] font-medium text-zinc-500">
                    ({t(`متبقي ${fmt(leftMin)} د`, `${leftMin}m left`)})
                  </span>
                )}
              </span>
            </div>
          )}

          <div>
            <p className="mb-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              {t("سجل أذونات هذه الدورة", "Current Cycle Permission Log")}
            </p>
            {ledger.length === 0 ? (
              <p className="text-[11px] text-zinc-400">
                {t("لا توجد أذونات مسجلة في هذه الدورة.", "No permissions recorded in this cycle.")}
              </p>
            ) : (
              <ul className="max-h-44 space-y-1.5 overflow-y-auto">
                {ledger.map((e) => (
                  <li
                    key={e.id}
                    className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] ${
                      e.status === "reversed"
                        ? "border-zinc-100 opacity-50 dark:border-zinc-800"
                        : "border-zinc-200 dark:border-zinc-700"
                    }`}
                  >
                    <span className="font-mono text-zinc-500" dir="ltr">
                      {e.date.slice(5)}
                    </span>
                    <span className="flex-1 text-zinc-800 dark:text-zinc-200">
                      {e.kind === "late"
                        ? t("تأخير صباحي", "Late Arrival")
                        : e.kind === "early_leave"
                        ? t("انصراف مبكر", "Early Leave")
                        : t("إذن", "Permission")}{" "}
                      · {fmt(e.actualMinutes)} {t("د", "m")}
                    </span>
                    {e.status === "reversed" ? (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-bold text-zinc-500 dark:bg-zinc-800">
                        {t("ملغى", "Reversed")}
                      </span>
                    ) : e.covered ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        −{fmt(e.chargedMinutes)} {t("د", "m")}
                      </span>
                    ) : (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 font-bold text-red-700 dark:bg-red-950 dark:text-red-300">
                        {t("خصم غير مغطى", "Uncovered")}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right: Annual Leave Balance & Joining Date */}
        <div className="space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-700">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              {t("رصيد الإجازة السنوية", "Annual Leave Balance")}
            </p>
            {acc && (
              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-800 dark:bg-sky-950 dark:text-sky-300">
                {isAr ? LEAVE_PHASE_AR[acc.phase] : LEAVE_PHASE_EN[acc.phase]}
              </span>
            )}
          </div>

          {hireDate && (
            <div className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-1.5 text-[11px] dark:bg-zinc-800/60">
              <span className="text-zinc-500">
                {t("تاريخ التعيين المسجل:", "Recorded Joining Date:")}
              </span>
              <span className="font-mono font-bold text-zinc-800 dark:text-zinc-200" dir="ltr">
                🗓️ {hireDate}
              </span>
            </div>
          )}

          {acc ? (
            <>
              <div className="flex items-end justify-between gap-2">
                <div className="flex items-end gap-2">
                  <span className="font-mono text-4xl font-black tabular-nums text-zinc-900 dark:text-white">
                    {fmt(acc.balance)}
                  </span>
                  <span className="pb-1 text-xs text-zinc-500">
                    {t("يوم متاح للطلب", "days available")}
                  </span>
                </div>
                {onRequestLeave && acc.phase !== "probation" && acc.balance > 0 && (
                  <button
                    type="button"
                    onClick={onRequestLeave}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-500 cursor-pointer"
                  >
                    + {t("طلب إجازة", "Book Leave")}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800/60">
                  <div className="font-mono font-bold text-zinc-900 dark:text-white">
                    {fmt(acc.accruedDays)}
                  </div>
                  <div className="text-zinc-500">{t("مستحق", "Accrued")}</div>
                </div>
                <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800/60">
                  <div className="font-mono font-bold text-zinc-900 dark:text-white">
                    {fmt(acc.usedDays)}
                  </div>
                  <div className="text-zinc-500">{t("مستخدم", "Used")}</div>
                </div>
                <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800/60">
                  <div className="font-mono font-bold text-zinc-900 dark:text-white">
                    {fmt(acc.monthlyRate)}
                  </div>
                  <div className="text-zinc-500">{t("يوم/شهر", "Days/mo")}</div>
                </div>
              </div>
              <p className="text-[11px] leading-5 text-zinc-500">
                {acc.phase === "probation"
                  ? t(
                      `فترة الاختبار تنتهي ${fmt(acc.probationEndsOn)} — لا يحق طلب إجازة سنوية قبلها (الأذونات الشهرية متاحة).`,
                      `Probation ends on ${acc.probationEndsOn} — annual leave unlocks after probation (monthly permissions are active now).`,
                    )
                  : acc.phase === "year1"
                  ? t(
                      `تستحق ${fmt(cfg.leaveRateYear1)} يوم عن كل شهر عمل حتى ${fmt(acc.tier2StartsOn)}، ثم ${fmt(cfg.leaveRateYear2)} يوم/شهر.`,
                      `Accruing ${cfg.leaveRateYear1} days/month until ${acc.tier2StartsOn}, then ${cfg.leaveRateYear2} days/month.`,
                    )
                  : t(
                      `تستحق ${fmt(cfg.leaveRateYear2)} يوم/شهر (٢١ يومًا سنويًا). الحد الأقصى للترحيل ${fmt(cfg.maxCarryOverDays)} أيام.`,
                      `Accruing ${cfg.leaveRateYear2} days/month (21 days/yr). Max carry-over is ${cfg.maxCarryOverDays} days.`,
                    )}
              </p>
              {hireDateIsFallback && (
                <p className="text-[10px] text-amber-600">
                  {t(
                    "* محسوب مؤقتًا من تاريخ التسجيل — تواصل مع HR لتأكيد تاريخ تعيينك الفعلي في الشركة.",
                    "* Calculated from registration date — contact HR to set your official company joining date.",
                  )}
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-zinc-500">
              {t("لم يتم تسجيل تاريخ التعيين بعد.", "Company joining date not set yet.")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
