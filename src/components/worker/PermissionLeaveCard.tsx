"use client";

import { useState } from "react";
import {
  computeLeaveAccrual,
  formatHm,
  leavePhaseLabelAr,
  leavePhaseLabelEn,
  minutesOfDay,
  toArabicDigits,
  validatePermissionRequest,
  ymd,
  type CycleUsage,
  type LeaveAccrualResult,
  type LeaveLawType,
  type Policy2026Config,
} from "@/lib/worker/hrPolicy2026";
import type { WorkerLedgerDoc } from "@/lib/worker/permissions";

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
  leaveLawType,
  usedLeave,
  priorUsedLeaveDays = 0,
  priorUsedAsOf,
  carriedOver,
  cycleLabel,
  onRequestLeave,
  onRequestUnpaidLeave,
  onRequestAdvanceLate,
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
  leaveLawType?: LeaveLawType;
  usedLeave: { date: string; days: number }[];
  priorUsedLeaveDays?: number;
  /** Date the prior-used figure refers to (see priorUsedRecordedOn). */
  priorUsedAsOf?: string;
  carriedOver: number;
  cycleLabel: string;
  onRequestLeave?: () => void;
  onRequestUnpaidLeave?: () => void;
  onRequestAdvanceLate?: () => void;
  onRequestOvertime?: () => void;
  onOpenExpenses?: () => void;
}) {
  const [lang, setLang] = useState<"ar" | "en">("ar");
  const isAr = lang === "ar";
  const t = (arText: string, enText: string) => (isAr ? arText : enText);
  const fmt = (v: string | number) => (isAr ? toArabicDigits(v) : String(v));

  const remainingCount = Math.max(0, cfg.permissionMaxCount - usage.count);
  const remainingMinutes = Math.max(0, cfg.permissionMaxMinutes - usage.minutes);
  const minPermCheck = validatePermissionRequest(cfg.permissionMinMinutes, usage, cfg);
  const effectiveHireDate = hireDate || ymd(now);
  const acc: LeaveAccrualResult = computeLeaveAccrual(
    effectiveHireDate,
    now,
    { leaveLawType, usedLeave, carriedOverApproved: carriedOver, priorUsedLeaveDays, priorUsedAsOf },
    cfg,
  );
  const canBookPaidLeave = acc.phase !== "probation" && acc.requestableDays > 0;
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
      {(onRequestLeave || onRequestUnpaidLeave || onRequestAdvanceLate || onRequestOvertime || onOpenExpenses) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 bg-zinc-50/70 px-5 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
          <span className="text-[11px] font-bold text-zinc-500 me-1">
            {t("إجراءات سريعة:", "Quick Actions:")}
          </span>
          {onRequestAdvanceLate && (
            <button
              type="button"
              onClick={onRequestAdvanceLate}
              className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-800 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300 cursor-pointer"
            >
              ⏰ {t("طلب إذن شهري (حسب الرصيد المتاح)", "Request Monthly Permission")}
            </button>
          )}
          {onRequestUnpaidLeave && (
            <button
              type="button"
              onClick={onRequestUnpaidLeave}
              className="inline-flex items-center gap-1.5 rounded-lg border border-teal-300 bg-teal-50 px-3 py-1.5 text-xs font-bold text-teal-800 hover:bg-teal-100 dark:border-teal-800 dark:bg-teal-950/50 dark:text-teal-300 cursor-pointer"
            >
              📅 {t("طلب إجازة بدون مرتب (متاحة أول ٦ شهور)", "Request Unpaid Leave")}
            </button>
          )}
          {onRequestLeave && (
            <button
              type="button"
              disabled={!canBookPaidLeave}
              onClick={() => {
                if (canBookPaidLeave) onRequestLeave();
              }}
              title={
                canBookPaidLeave
                  ? t(`رصيد إجازاتك المتاح: ${fmt(acc.requestableDays)} يوم`, `Available leave balance: ${acc.requestableDays}d`)
                  : t("لا يمكنك طلب إجازة سنوية مدفوعة لعدم وجود رصيد متاح", "Cannot request paid annual leave with 0 available balance")
              }
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-all ${
                canBookPaidLeave
                  ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 cursor-pointer"
                  : "border-zinc-200 bg-zinc-100 text-zinc-400 opacity-75 cursor-not-allowed dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-500"
              }`}
            >
              {canBookPaidLeave ? "🌴" : "🔒"}{" "}
              {canBookPaidLeave
                ? t(`طلب إجازة سنوية (رصيدك: ${fmt(acc.requestableDays)} يوم)`, `Request Annual Leave (${acc.requestableDays}d left)`)
                : t(`إجازة سنوية غير متاحة (رصيدك: ${fmt(acc.requestableDays)} يوم)`, `Annual Leave Unavailable (${acc.requestableDays}d balance)`)}
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
            label={t("عدد الأذونات المعتمدة المستخدمة", "Approved Permissions Used (Count)")}
            used={usage.count}
            max={cfg.permissionMaxCount}
            isAr={isAr}
          />
          <Meter
            label={t("دقائق الأذونات المعتمدة المستخدمة", "Approved Permission Minutes Used")}
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
              `. الأذونات متاحة بدءاً من الشهر الأول (بما في ذلك أول 6 أشهر)، بحد أقصى ${fmt(cfg.permissionMaxCount)} أذونات و${fmt(cfg.permissionMaxMinutes)} دقيقة شهرياً. الإذن الواحد من ${fmt(cfg.permissionMinMinutes)} إلى ${fmt(cfg.permissionMaxSingleMinutes)} دقيقة (قاعدة الدقيقة الأولى: أي تأخير ولو دقيقة يُحتسب بحد أدنى 30 دقيقة)، ولا يُعتمد أي إذن إلا بعد موافقة الأدمن.`,
              `. Available from Month 1 (including probation), max ${cfg.permissionMaxCount} permissions / ${cfg.permissionMaxMinutes} mins/month (${cfg.permissionMinMinutes}–${cfg.permissionMaxSingleMinutes} mins each). Requires Admin approval.`,
            )}
          </p>

          {!minPermCheck.ok && (
            <div className="rounded-xl border border-red-200 bg-red-50/90 p-3 text-xs leading-5 text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              <b className="block text-red-800 dark:text-red-300">
                ❌ {t("سبب عدم إمكانية أخذ إذن جديد هذا الشهر:", "Why you cannot take a new permission:")}
              </b>
              <span>{minPermCheck.reasonAr}</span>
            </div>
          )}

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
                      (e.chargedMinutes || 0) === 0 ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                          {t("استثناء معتمد (بدون خصم)", "Excused (0m)")}
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                          −{fmt(e.chargedMinutes)} {t("د", "m")}
                        </span>
                      )
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
                {isAr ? leavePhaseLabelAr(acc) : leavePhaseLabelEn(acc)}
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
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div className="flex items-end gap-2">
                  <span className="font-mono text-4xl font-black tabular-nums text-zinc-900 dark:text-white">
                    {fmt(acc.requestableDays)}
                  </span>
                  <span className="pb-1 text-xs text-zinc-500">
                    {t("يوم متاح للطلب", "days available")}
                    {acc.balance !== acc.requestableDays ? ` (${t("الرصيد الصافي:", "net:")} ${fmt(acc.balance)})` : ""}
                  </span>
                </div>
                {onRequestLeave && canBookPaidLeave && (
                  <button
                    type="button"
                    onClick={onRequestLeave}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-500 cursor-pointer"
                  >
                    + {t(`طلب إجازة سنوية (${fmt(acc.requestableDays)} يوم متاح)`, `Book Leave (${acc.requestableDays}d left)`)}
                  </button>
                )}
                {!canBookPaidLeave && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                      🔒 {t("لا يوجد رصيد متاح للإجازة السنوية", "0d Annual Leave Available")}
                    </span>
                    {onRequestUnpaidLeave && (
                      <button
                        type="button"
                        onClick={onRequestUnpaidLeave}
                        className="rounded-lg bg-teal-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-teal-500 cursor-pointer"
                      >
                        + {t("طلب إجازة بدون مرتب", "Request Unpaid Leave")}
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-[11px]">
                <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-800/60">
                  <div className="font-mono font-bold text-zinc-900 dark:text-white">
                    {fmt(acc.accruedDays)}
                  </div>
                  <div className="text-zinc-500">{t("مستحق", "Accrued")}</div>
                </div>
                <div className="rounded-lg bg-emerald-50/70 p-2 dark:bg-emerald-950/30">
                  <div className="font-mono font-bold text-emerald-800 dark:text-emerald-300">
                    +{fmt(acc.totalCarryOverDays)}
                  </div>
                  <div className="text-emerald-700 dark:text-emerald-400">{t("مُرحّل ومعتمد", "Carried Over")}</div>
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
              <div className="rounded-xl bg-zinc-50/80 p-2.5 text-[11px] leading-5 text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-300 space-y-1">
                {acc.phase === "probation" ? (
                  <p>
                    {acc.leaveLawType === "legacy_21"
                      ? t(
                          `فترة الاختبار تنتهي ${fmt(acc.probationEndsOn)} (قانون عمل قديم — ٢١ يوم أول سنة) — بمجرد إتمام أول ٦ شهور ينزل في رصيدك ١٠٫٥ يوم، ثم يزيد بمعدل ${fmt(cfg.leaveRateYear2)} يوم/شهر ليكتمل ٢١ يوماً بنهاية السنة الأولى. (خلال أول ٦ شهور يمكنك طلب إجازة بدون مرتب).`,
                          `Probation ends on ${acc.probationEndsOn} (Old Labor Law — 21d in Year 1) — upon completing 6 months, 10.5 days drop into your balance, then +${cfg.leaveRateYear2} days/month to reach 21 days at the end of Year 1. (Unpaid Leave is available during the first 6 months).`,
                        )
                      : t(
                          `فترة الاختبار تنتهي ${fmt(acc.probationEndsOn)} — بمجرد إتمام أول ٦ شهور ينزل في رصيدك ٧٫٥ يوم، ثم يزيد بمعدل ${fmt(cfg.leaveRateYear1)} يوم/شهر ليكتمل ١٥ يوماً بنهاية السنة الأولى. (خلال أول ٦ شهور يمكنك طلب إجازة بدون مرتب).`,
                          `Probation ends on ${acc.probationEndsOn} — upon completing 6 months, 7.5 days drop into your balance, then +${cfg.leaveRateYear1} days/month to reach 15 days at the end of Year 1. (Unpaid Leave is available during the first 6 months).`,
                        )}
                  </p>
                ) : acc.phase === "year1" ? (
                  <>
                    <p>
                      {acc.leaveLawType === "legacy_21"
                        ? t(
                            `استحقاق السنة الأولى (قانون عمل قديم — ٢١ يوم): بعد أول ٦ شهور نزل لك ١٠٫٥ يوم، ويزيد الرصيد بمعدل ${fmt(cfg.leaveRateYear2)} يوم/شهر ليكتمل ٢١ يوماً بنهاية السنة الأولى (${fmt(acc.tier2StartsOn)})${acc.totalCarryOverDays > 0 ? ` + رصيد مُرحّل ومعتمد (${fmt(acc.totalCarryOverDays)} يوم)` : ""}.`,
                            `First Year Entitlement (Old Labor Law — 21d): 10.5 days after 6 months + ${cfg.leaveRateYear2} days/month to reach 21 days at the end of Year 1 (${acc.tier2StartsOn})${acc.totalCarryOverDays > 0 ? ` + carried-over & approved (${acc.totalCarryOverDays}d)` : ""}.`,
                          )
                        : t(
                            `استحقاق السنة الأولى: بعد أول ٦ شهور نزل لك ٧٫٥ يوم، ويزيد الرصيد بمعدل ${fmt(cfg.leaveRateYear1)} يوم/شهر ليكتمل ١٥ يوماً بنهاية السنة الأولى (${fmt(acc.tier2StartsOn)})${acc.totalCarryOverDays > 0 ? ` + رصيد مُرحّل ومعتمد (${fmt(acc.totalCarryOverDays)} يوم)` : ""}.`,
                            `First Year Entitlement: 7.5 days after 6 months + ${cfg.leaveRateYear1} days/month to reach 15 days at the end of Year 1 (${acc.tier2StartsOn})${acc.totalCarryOverDays > 0 ? ` + carried-over & approved (${acc.totalCarryOverDays}d)` : ""}.`,
                          )}
                    </p>
                    <p className="text-zinc-500 dark:text-zinc-400">
                      {t(
                        `استحقاق ما بعد السنة الأولى: يرتفع الرصيد إلى ٢١ يوماً في السنة (بواقع ${fmt(cfg.leaveRateYear2)} يوم شهرياً)، ويُضاف إليه الرصيد المُرحّل قانونياً والمُعتمد من الإدارة.`,
                        `Entitlement after the First Year: Balance rises to 21 days/year (at ${cfg.leaveRateYear2} days/month), plus legally carried-over and management-approved balance.`,
                      )}
                    </p>
                  </>
                ) : (
                  <p>
                    {t(
                      `استحقاق ما بعد السنة الأولى: يرتفع الرصيد إلى ٢١ يوماً في السنة (بواقع ${fmt(cfg.leaveRateYear2)} يوم شهرياً)، ويُضاف إليه الرصيد المُرحّل قانونياً (${fmt(acc.legalCarryOverDays)} يوم) والمُعتمد من الإدارة (${fmt(acc.carriedOverApproved)} يوم) — إجمالي المرحّل المضاف: ${fmt(acc.totalCarryOverDays)} يوم.`,
                      `Entitlement after the First Year: Balance rises to 21 days/year (at ${cfg.leaveRateYear2} days/month), plus legally carried-over (${acc.legalCarryOverDays}d) and management-approved (${acc.carriedOverApproved}d) balance — total carried over: ${acc.totalCarryOverDays}d.`,
                    )}
                  </p>
                )}
              </div>
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
