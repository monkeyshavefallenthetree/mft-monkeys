/**
 * HR-POL-2026 policy engine (لائحة السياسات الداخلية وإجراءات العمل — الإصدار V2.0)
 * -------------------------------------------------------------------------------
 * Pure, framework-free calculations shared by:
 *   - mft-admin         → src/lib/admin/hrPolicy2026.ts
 *   - mft-monkeys-main  → src/lib/worker/hrPolicy2026.ts
 *
 * ⚠️ KEEP BOTH COPIES IDENTICAL. Edit one, then copy it over the other.
 * No Firestore / React imports are allowed here so the file can also be run
 * directly by `node scripts/verify-hrPolicy2026.mts`.
 *
 * All clock maths use *whole minutes* (seconds are truncated) — V2.0 clause 1:
 * 11:00:59 is on time, 11:01:00 is late.
 */

/* ────────────────────────────── Config ────────────────────────────── */

export interface Policy2026Config {
  /** Earliest counted start of the flexible shift window, "HH:MM". */
  shiftStartTime: string;
  /** Last on-time minute. Clock-in strictly after this minute is late. */
  lateCutoffTime: string;
  /** Legacy tier-2 cutoff (0.5 day fallback penalty when lateness is uncovered). */
  veryLateCutoffTime: string;
  standardHours: number;

  permissionMaxCount: number;
  permissionMaxMinutes: number;
  permissionMinMinutes: number;
  permissionMaxSingleMinutes: number;
  /** Lateness / early-leave minutes are rounded up to this block (after the 30 min floor). */
  permissionRoundingBlock: number;

  dayOtMultiplier: number;
  nightOtMultiplier: number;
  /** Start of the day-rate window, "HH:MM" (default 06:00). */
  dayWindowStart: string;
  /** Start of the night-rate window, "HH:MM" (default 18:00). */
  nightWindowStart: string;
  /** Flat EGP added once per day that contains any approved night overtime. */
  nightShiftAllowance: number;

  probationMonths: number;
  /** Number of post-probation months accrued at the year-1 rate (12 → 15 days). */
  year1AccrualMonths: number;
  leaveRateYear1: number;
  leaveRateYear2: number;
  maxCarryOverDays: number;

  /** Allowed % above the approved purchase amount before the invoice is flagged. */
  invoiceTolerancePct: number;
}

export const POLICY_2026_DEFAULTS: Policy2026Config = {
  shiftStartTime: "10:00",
  lateCutoffTime: "11:00",
  veryLateCutoffTime: "12:00",
  standardHours: 8,

  permissionMaxCount: 4,
  permissionMaxMinutes: 240,
  permissionMinMinutes: 30,
  permissionMaxSingleMinutes: 120,
  permissionRoundingBlock: 15,

  dayOtMultiplier: 1.35,
  nightOtMultiplier: 1.7,
  dayWindowStart: "06:00",
  nightWindowStart: "18:00",
  nightShiftAllowance: 0,

  probationMonths: 6,
  year1AccrualMonths: 12,
  leaveRateYear1: 1.25,
  leaveRateYear2: 1.75,
  maxCarryOverDays: 7,

  invoiceTolerancePct: 0,
};

/** Settings fields (stored in Firestore `settings/hr`) that drive the engine. */
export interface Policy2026SettingsFields {
  policy2026Enabled?: boolean;
  /** YYYY-MM-DD — sessions on/after this date use HR-POL-2026 payroll maths. */
  policy2026EffectiveFrom?: string;
  shiftStartTime?: string;
  gracePeriodMinutes?: number;
  secondThresholdMinutes?: number;
  standardHours?: number;
  permissionMaxCount?: number;
  permissionMaxMinutes?: number;
  permissionMinMinutes?: number;
  permissionMaxSingleMinutes?: number;
  permissionRoundingBlock?: number;
  dayOtMultiplier?: number;
  nightOtMultiplier?: number;
  dayWindowStart?: string;
  nightWindowStart?: string;
  nightShiftAllowance?: number;
  probationMonths?: number;
  leaveRateYear1?: number;
  leaveRateYear2?: number;
  maxCarryOverDays?: number;
  invoiceTolerancePct?: number;
}

export const POLICY_2026_SETTINGS_DEFAULTS: Required<
  Pick<
    Policy2026SettingsFields,
    | "policy2026Enabled"
    | "policy2026EffectiveFrom"
    | "permissionMaxCount"
    | "permissionMaxMinutes"
    | "permissionMinMinutes"
    | "permissionMaxSingleMinutes"
    | "permissionRoundingBlock"
    | "dayOtMultiplier"
    | "nightOtMultiplier"
    | "dayWindowStart"
    | "nightWindowStart"
    | "nightShiftAllowance"
    | "probationMonths"
    | "leaveRateYear1"
    | "leaveRateYear2"
    | "maxCarryOverDays"
    | "invoiceTolerancePct"
  >
> = {
  policy2026Enabled: true,
  policy2026EffectiveFrom: "2026-01-01",
  permissionMaxCount: POLICY_2026_DEFAULTS.permissionMaxCount,
  permissionMaxMinutes: POLICY_2026_DEFAULTS.permissionMaxMinutes,
  permissionMinMinutes: POLICY_2026_DEFAULTS.permissionMinMinutes,
  permissionMaxSingleMinutes: POLICY_2026_DEFAULTS.permissionMaxSingleMinutes,
  permissionRoundingBlock: POLICY_2026_DEFAULTS.permissionRoundingBlock,
  dayOtMultiplier: POLICY_2026_DEFAULTS.dayOtMultiplier,
  nightOtMultiplier: POLICY_2026_DEFAULTS.nightOtMultiplier,
  dayWindowStart: POLICY_2026_DEFAULTS.dayWindowStart,
  nightWindowStart: POLICY_2026_DEFAULTS.nightWindowStart,
  nightShiftAllowance: POLICY_2026_DEFAULTS.nightShiftAllowance,
  probationMonths: POLICY_2026_DEFAULTS.probationMonths,
  leaveRateYear1: POLICY_2026_DEFAULTS.leaveRateYear1,
  leaveRateYear2: POLICY_2026_DEFAULTS.leaveRateYear2,
  maxCarryOverDays: POLICY_2026_DEFAULTS.maxCarryOverDays,
  invoiceTolerancePct: POLICY_2026_DEFAULTS.invoiceTolerancePct,
};

/**
 * Builds the engine config from the HR settings document. The late cutoff is
 * derived from `shiftStartTime + gracePeriodMinutes` (10:00 + 60 → 11:00) so
 * there is a single source of truth shared with the legacy reports.
 */
export function policyConfigFromSettings(s: Policy2026SettingsFields | null | undefined): Policy2026Config {
  const src = s ?? {};
  const shiftStart = src.shiftStartTime || POLICY_2026_DEFAULTS.shiftStartTime;
  const startMin = parseHm(shiftStart);
  const grace = numOr(src.gracePeriodMinutes, 60);
  const second = numOr(src.secondThresholdMinutes, 120);
  return {
    ...POLICY_2026_DEFAULTS,
    shiftStartTime: shiftStart,
    lateCutoffTime: formatHm(startMin + grace),
    veryLateCutoffTime: formatHm(startMin + Math.max(second, grace)),
    standardHours: numOr(src.standardHours, POLICY_2026_DEFAULTS.standardHours),
    permissionMaxCount: numOr(src.permissionMaxCount, POLICY_2026_DEFAULTS.permissionMaxCount),
    permissionMaxMinutes: numOr(src.permissionMaxMinutes, POLICY_2026_DEFAULTS.permissionMaxMinutes),
    permissionMinMinutes: numOr(src.permissionMinMinutes, POLICY_2026_DEFAULTS.permissionMinMinutes),
    permissionMaxSingleMinutes: numOr(src.permissionMaxSingleMinutes, POLICY_2026_DEFAULTS.permissionMaxSingleMinutes),
    permissionRoundingBlock: numOr(src.permissionRoundingBlock, POLICY_2026_DEFAULTS.permissionRoundingBlock),
    dayOtMultiplier: numOr(src.dayOtMultiplier, POLICY_2026_DEFAULTS.dayOtMultiplier),
    nightOtMultiplier: numOr(src.nightOtMultiplier, POLICY_2026_DEFAULTS.nightOtMultiplier),
    dayWindowStart: src.dayWindowStart || POLICY_2026_DEFAULTS.dayWindowStart,
    nightWindowStart: src.nightWindowStart || POLICY_2026_DEFAULTS.nightWindowStart,
    nightShiftAllowance: numOr(src.nightShiftAllowance, POLICY_2026_DEFAULTS.nightShiftAllowance),
    probationMonths: numOr(src.probationMonths, POLICY_2026_DEFAULTS.probationMonths),
    leaveRateYear1: numOr(src.leaveRateYear1, POLICY_2026_DEFAULTS.leaveRateYear1),
    leaveRateYear2: numOr(src.leaveRateYear2, POLICY_2026_DEFAULTS.leaveRateYear2),
    maxCarryOverDays: numOr(src.maxCarryOverDays, POLICY_2026_DEFAULTS.maxCarryOverDays),
    invoiceTolerancePct: numOr(src.invoiceTolerancePct, POLICY_2026_DEFAULTS.invoiceTolerancePct),
  };
}

/** True when HR-POL-2026 payroll maths apply to a given YYYY-MM-DD date. */
export function isPolicy2026Active(s: Policy2026SettingsFields | null | undefined, dateYmd: string): boolean {
  if (s?.policy2026Enabled === false) return false;
  const rawFrom = s?.policy2026EffectiveFrom;
  const from =
    !rawFrom || rawFrom === "2026-10-21"
      ? POLICY_2026_SETTINGS_DEFAULTS.policy2026EffectiveFrom
      : rawFrom;
  return !!dateYmd && dateYmd >= from;
}

/**
 * Date the worker's `priorUsedLeaveDays` figure refers to: their MFT start date, else the
 * policy effective date. Used as `priorUsedAsOf` in computeLeaveAccrual on every screen.
 */
export function priorUsedRecordedOn(
  worker: { attendanceStartDate?: string | null } | null | undefined,
  s?: Policy2026SettingsFields | null,
): string {
  return (
    worker?.attendanceStartDate ||
    s?.policy2026EffectiveFrom ||
    POLICY_2026_SETTINGS_DEFAULTS.policy2026EffectiveFrom
  );
}

/* ────────────────────────────── Time helpers ────────────────────────────── */

function numOr(v: unknown, d: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}

/** "11:05" → 665 (minutes after midnight). */
export function parseHm(hm: string): number {
  const [h, m] = String(hm || "0:0").split(":");
  return (parseInt(h || "0", 10) || 0) * 60 + (parseInt(m || "0", 10) || 0);
}

/** 665 → "11:05" (wraps past midnight). */
export function formatHm(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Minutes after local midnight, seconds truncated. */
export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** Copy of `d` at local midnight + `minutes`. Handles overflow past midnight. */
export function atMinutes(d: Date, minutes: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, minutes, 0, 0);
}

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Parses "YYYY-MM-DD" as a local date at noon (DST-safe). */
export function parseYmd(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "");
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
}

/** Adds calendar months, clamping the day to the target month's last day (Jan 31 + 1 → Feb 28/29). */
export function addMonthsClamped(d: Date, months: number): Date {
  const y = d.getFullYear();
  const m = d.getMonth() + months;
  const lastDay = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(d.getDate(), lastDay), 12, 0, 0, 0);
}

/** Whole service months completed between `from` and `to` (anniversary-based, day-clamped). */
export function completedMonthsBetween(from: Date, to: Date): number {
  if (to < from) return 0;
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  while (months > 0 && addMonthsClamped(from, months) > endOfDay(to)) months--;
  while (addMonthsClamped(from, months + 1) <= endOfDay(to)) months++;
  return Math.max(0, months);
}

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/** Arabic-Indic digits for display (٣٠ دقيقة). */
export function toArabicDigits(v: number | string): string {
  return String(v).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]!);
}

/* ────────────────────────────── Permissions ────────────────────────────── */

export type PermissionKind = "late" | "early_leave" | "manual";

/** Shape of a `permissionLedger` document (subset used by calculations). */
export interface PermissionLedgerEntry {
  id?: string;
  workerId: string;
  cycleId?: string;
  date: string; // YYYY-MM-DD
  kind: PermissionKind;
  actualMinutes: number;
  chargedMinutes: number;
  /** false = could not be covered (quota exhausted / over 120) → fallback deduction applies. */
  covered: boolean;
  fallbackPenaltyDays?: number;
  status: "applied" | "reversed";
  source?: "auto" | "worker" | "admin" | "simulator";
  reason?: string;
}

export interface CycleUsage {
  count: number;
  minutes: number;
}

export const EMPTY_USAGE: CycleUsage = { count: 0, minutes: 0 };

/** Quota consumed by applied + covered ledger entries (admin-approved 0m excuses do not consume quota). */
export function usageFromLedger(entries: PermissionLedgerEntry[]): CycleUsage {
  let count = 0;
  let minutes = 0;
  for (const e of entries) {
    if (e.status !== "applied" || !e.covered) continue;
    if ((e.chargedMinutes || 0) <= 0) continue;
    count += 1;
    minutes += e.chargedMinutes || 0;
  }
  return { count, minutes };
}

export function remainingQuota(usage: CycleUsage, cfg: Policy2026Config = POLICY_2026_DEFAULTS): CycleUsage {
  return {
    count: Math.max(0, cfg.permissionMaxCount - usage.count),
    minutes: Math.max(0, cfg.permissionMaxMinutes - usage.minutes),
  };
}

/**
 * Minutes deducted from the quota for `actual` minutes of lateness / early leave.
 * V2.0: floor of 30, then round UP to the configured block (default 15):
 *   1 → 30, 30 → 30, 31 → 45, 35 → 45, 46 → 60, 106 → 120.
 */
export function chargeableMinutes(actual: number, cfg: Policy2026Config = POLICY_2026_DEFAULTS): number {
  if (!(actual > 0)) return 0;
  const block = Math.max(1, cfg.permissionRoundingBlock || 1);
  const rounded = Math.ceil(actual / block) * block;
  return Math.max(cfg.permissionMinMinutes, rounded);
}

export type UncoveredReason = "over_single_cap" | "count_exhausted" | "minutes_exhausted";

export const UNCOVERED_REASON_AR: Record<UncoveredReason, string> = {
  over_single_cap: "تتجاوز المدة الحد الأقصى للإذن الواحد (ساعتان)",
  count_exhausted: "تم استنفاد عدد الأذونات الشهرية (٤ أذونات)",
  minutes_exhausted: "رصيد الدقائق المتبقي لا يكفي لتغطية الإذن (لا تغطية جزئية)",
};

/** Checks whether a permission of `charged` minutes (from `actual`) fits the quota. */
export function checkCoverage(
  actual: number,
  charged: number,
  usage: CycleUsage,
  cfg: Policy2026Config = POLICY_2026_DEFAULTS,
): { covered: true } | { covered: false; reason: UncoveredReason } {
  if (actual > cfg.permissionMaxSingleMinutes || charged > cfg.permissionMaxSingleMinutes) {
    return { covered: false, reason: "over_single_cap" };
  }
  if (usage.count >= cfg.permissionMaxCount) return { covered: false, reason: "count_exhausted" };
  if (usage.minutes + charged > cfg.permissionMaxMinutes) return { covered: false, reason: "minutes_exhausted" };
  return { covered: true };
}

export interface DailyPermissionContext {
  /** Charged minutes already used/booked on the same calendar day (`YYYY-MM-DD`). */
  dailyUsedMinutes?: number;
  /** Number of permissions already used/booked on the same calendar day. */
  dailyUsedCount?: number;
  /** True if a permission of the exact same kind (late or early_leave) is already booked on that day. */
  sameKindAlreadyBooked?: boolean;
}

export interface PermissionRequestVerdict {
  ok: boolean;
  requestedMinutes: number;
  chargedMinutes: number;
  remainingCount: number;
  remainingMinutes: number;
  remainingDailyMinutes: number;
  allowedDurations: number[];
  reasonCode: UncoveredReason | "below_min" | null;
  reasonAr: string;
}

/**
 * Validates a worker's request for a monthly permission:
 * - Eligible for all employees starting from Month 1 (including first 6 months).
 * - Monthly cap: 4 permissions max, 4 hours (240 minutes) max per month.
 * - Single permission & daily cap: min 30 minutes, max 120 minutes (2 hours) total per day.
 * - First-minute rule: any lateness >= 1 minute is rounded up to at least 30 minutes (and 15-min steps above 30).
 */
export function validatePermissionRequest(
  requestedMinutes: number,
  usage: CycleUsage = EMPTY_USAGE,
  cfg: Policy2026Config = POLICY_2026_DEFAULTS,
  dailyCtx?: DailyPermissionContext,
): PermissionRequestVerdict {
  const rem = remainingQuota(usage, cfg);
  const dailyUsed = Math.max(0, dailyCtx?.dailyUsedMinutes ?? 0);
  const remDaily = Math.max(0, cfg.permissionMaxSingleMinutes - dailyUsed);
  const presets = [30, 45, 60, 75, 90, 105, 120];
  const allowedDurations =
    rem.count > 0 && !dailyCtx?.sameKindAlreadyBooked && remDaily >= cfg.permissionMinMinutes
      ? presets.filter(
          (m) =>
            m >= cfg.permissionMinMinutes &&
            m <= cfg.permissionMaxSingleMinutes &&
            m <= rem.minutes &&
            m <= remDaily,
        )
      : [];

  if (rem.count <= 0) {
    return {
      ok: false,
      requestedMinutes,
      chargedMinutes: 0,
      remainingCount: rem.count,
      remainingMinutes: rem.minutes,
      remainingDailyMinutes: remDaily,
      allowedDurations: [],
      reasonCode: "count_exhausted",
      reasonAr: `لا يمكنك طلب إذن جديد لأنك استهلكت الحد الأقصى الشهري لعدد الأذونات (${toArabicDigits(cfg.permissionMaxCount)} من ${toArabicDigits(cfg.permissionMaxCount)} أذونات مستخدمة هذا الشهر).`,
    };
  }

  if (rem.minutes < cfg.permissionMinMinutes) {
    return {
      ok: false,
      requestedMinutes,
      chargedMinutes: 0,
      remainingCount: rem.count,
      remainingMinutes: rem.minutes,
      remainingDailyMinutes: remDaily,
      allowedDurations: [],
      reasonCode: "minutes_exhausted",
      reasonAr: `لا يمكنك طلب إذن جديد لأن الرصيد المتبقي لك من الساعات هذا الشهر (${toArabicDigits(rem.minutes)} دقيقة) أقل من الحد الأدنى للإذن الواحد (${toArabicDigits(cfg.permissionMinMinutes)} دقيقة من إجمالي ٤ ساعات شهريًا).`,
    };
  }

  if (dailyCtx?.sameKindAlreadyBooked) {
    return {
      ok: false,
      requestedMinutes,
      chargedMinutes: 0,
      remainingCount: rem.count,
      remainingMinutes: rem.minutes,
      remainingDailyMinutes: remDaily,
      allowedDurations: [],
      reasonCode: "over_single_cap",
      reasonAr: `لديك بالفعل طلب إذن مسجل من نفس النوع في هذا اليوم (${toArabicDigits(dailyUsed)} دقيقة) — لا يمكن إرسال أكثر من إذن من نفس النوع في اليوم الواحد، ولا يجوز أن يتجاوز إجمالي الأذونات في اليوم الواحد ساعتين (${toArabicDigits(cfg.permissionMaxSingleMinutes)} دقيقة).`,
    };
  }

  if (remDaily < cfg.permissionMinMinutes) {
    return {
      ok: false,
      requestedMinutes,
      chargedMinutes: 0,
      remainingCount: rem.count,
      remainingMinutes: rem.minutes,
      remainingDailyMinutes: remDaily,
      allowedDurations: [],
      reasonCode: "over_single_cap",
      reasonAr: `لا يمكنك طلب إذن إضافي في هذا اليوم لأن الحد الأقصى المسموح به للأذونات في اليوم الواحد هو ساعتان (${toArabicDigits(cfg.permissionMaxSingleMinutes)} دقيقة)، وقد استهلكت/حجزت بالفعل ${toArabicDigits(dailyUsed)} دقيقة في هذا اليوم.`,
    };
  }

  if (!(requestedMinutes > 0)) {
    return {
      ok: false,
      requestedMinutes,
      chargedMinutes: 0,
      remainingCount: rem.count,
      remainingMinutes: rem.minutes,
      remainingDailyMinutes: remDaily,
      allowedDurations,
      reasonCode: "below_min",
      reasonAr: `يرجى اختيار مدة الإذن المطلوبة (الحد الأدنى للإذن الواحد ${toArabicDigits(cfg.permissionMinMinutes)} دقيقة والحد الأقصى ساعتان).`,
    };
  }

  const charged = chargeableMinutes(requestedMinutes, cfg);

  if (requestedMinutes > cfg.permissionMaxSingleMinutes || charged > cfg.permissionMaxSingleMinutes) {
    return {
      ok: false,
      requestedMinutes,
      chargedMinutes: charged,
      remainingCount: rem.count,
      remainingMinutes: rem.minutes,
      remainingDailyMinutes: remDaily,
      allowedDurations,
      reasonCode: "over_single_cap",
      reasonAr: `لا يمكن قبول هذا الإذن لأن المدة المطلوبة (${toArabicDigits(requestedMinutes)} دقيقة) تتجاوز الحد الأقصى المسموح به للإذن الواحد وهو ساعتان (${toArabicDigits(cfg.permissionMaxSingleMinutes)} دقيقة).`,
    };
  }

  if (dailyUsed + charged > cfg.permissionMaxSingleMinutes) {
    return {
      ok: false,
      requestedMinutes,
      chargedMinutes: charged,
      remainingCount: rem.count,
      remainingMinutes: rem.minutes,
      remainingDailyMinutes: remDaily,
      allowedDurations,
      reasonCode: "over_single_cap",
      reasonAr: `لا يمكن إرسال هذا الإذن لأن إجمالي الأذونات في اليوم الواحد لا يجوز أن يتجاوز ساعتين (${toArabicDigits(cfg.permissionMaxSingleMinutes)} دقيقة) — لديك بالفعل إذن في هذا اليوم بمدة ${toArabicDigits(dailyUsed)} دقيقة، وأقصى مدة متبقية مسموحة لك في هذا اليوم هي ${toArabicDigits(remDaily)} دقيقة فقط.`,
    };
  }

  if (charged > rem.minutes) {
    return {
      ok: false,
      requestedMinutes,
      chargedMinutes: charged,
      remainingCount: rem.count,
      remainingMinutes: rem.minutes,
      remainingDailyMinutes: remDaily,
      allowedDurations,
      reasonCode: "minutes_exhausted",
      reasonAr: `لا يمكنك أخذ إذن بمدة ${toArabicDigits(charged)} دقيقة لأن المتبقي في رصيد ساعاتك الشهري هو ${toArabicDigits(rem.minutes)} دقيقة فقط (من أصل ${toArabicDigits(cfg.permissionMaxMinutes)} دقيقة / ٤ ساعات شهريًا). أقصى مدة يمكنك اختيارها الآن هي ${toArabicDigits(Math.min(rem.minutes, remDaily))} دقيقة.`,
    };
  }

  return {
    ok: true,
    requestedMinutes,
    chargedMinutes: charged,
    remainingCount: rem.count,
    remainingMinutes: rem.minutes,
    remainingDailyMinutes: remDaily,
    allowedDurations,
    reasonCode: null,
    reasonAr: "",
  };
}

/* ────────────────────────────── Shift / clock-in ────────────────────────────── */

/**
 * Required end of the flexible 8h shift: clamp(firstClockIn, 10:00, 11:00) + 8h.
 *   in 09:00 → 18:00 · in 10:30 → 18:30 · in 11:20 (late) → 19:00.
 */
export function requiredShiftEnd(firstClockIn: Date, cfg: Policy2026Config = POLICY_2026_DEFAULTS): Date {
  const start = parseHm(cfg.shiftStartTime);
  const cutoff = parseHm(cfg.lateCutoffTime);
  const m = minutesOfDay(firstClockIn);
  const effective = Math.min(Math.max(m, start), cutoff);
  return atMinutes(firstClockIn, effective + Math.round(cfg.standardHours * 60));
}

export type ClockInStatus = "on-time" | "late-covered" | "late-uncovered";

export interface ClockInEvaluation {
  status: ClockInStatus;
  clockInHm: string;
  lateMinutes: number;
  chargedMinutes: number;
  covered: boolean;
  uncoveredReason: UncoveredReason | null;
  /** Legacy tier penalty (day units) applied ONLY when lateness is uncovered. */
  fallbackPenaltyDays: 0 | 0.25 | 0.5;
  usageAfter: CycleUsage;
  remainingAfter: CycleUsage;
  requiredEnd: Date;
  requiredEndHm: string;
  /** Human-readable Arabic explanation. */
  messageAr: string;
}

export function evaluateClockIn(
  clockIn: Date,
  usage: CycleUsage = EMPTY_USAGE,
  cfg: Policy2026Config = POLICY_2026_DEFAULTS,
): ClockInEvaluation {
  const m = minutesOfDay(clockIn);
  const cutoff = parseHm(cfg.lateCutoffTime);
  const veryLate = parseHm(cfg.veryLateCutoffTime);
  const requiredEnd = requiredShiftEnd(clockIn, cfg);
  const lateMinutes = Math.max(0, m - cutoff);
  const base = {
    clockInHm: formatHm(m),
    lateMinutes,
    requiredEnd,
    requiredEndHm: formatHm(minutesOfDay(requiredEnd)),
  };

  if (lateMinutes === 0) {
    return {
      ...base,
      status: "on-time",
      chargedMinutes: 0,
      covered: true,
      uncoveredReason: null,
      fallbackPenaltyDays: 0,
      usageAfter: usage,
      remainingAfter: remainingQuota(usage, cfg),
      messageAr: `حضور في الموعد (${toArabicDigits(formatHm(m))}). نهاية الشيفت المطلوبة ${toArabicDigits(base.requiredEndHm)}.`,
    };
  }

  const charged = chargeableMinutes(lateMinutes, cfg);
  const cov = checkCoverage(lateMinutes, charged, usage, cfg);
  if (cov.covered) {
    const usageAfter = { count: usage.count + 1, minutes: usage.minutes + charged };
    const rem = remainingQuota(usageAfter, cfg);
    return {
      ...base,
      status: "late-covered",
      chargedMinutes: charged,
      covered: true,
      uncoveredReason: null,
      fallbackPenaltyDays: 0,
      usageAfter,
      remainingAfter: rem,
      messageAr:
        `تأخير ${toArabicDigits(lateMinutes)} دقيقة — تم احتساب إذن تأخير ${toArabicDigits(charged)} دقيقة تلقائيًا. ` +
        `المتبقي ${toArabicDigits(rem.count)} أذونات / ${toArabicDigits(rem.minutes)} دقيقة.`,
    };
  }

  const fallback: 0.25 | 0.5 = m > veryLate || cov.reason === "over_single_cap" ? 0.5 : 0.25;
  return {
    ...base,
    status: "late-uncovered",
    chargedMinutes: 0,
    covered: false,
    uncoveredReason: cov.reason,
    fallbackPenaltyDays: fallback,
    usageAfter: usage,
    remainingAfter: remainingQuota(usage, cfg),
    messageAr:
      `تأخير ${toArabicDigits(lateMinutes)} دقيقة غير مغطى: ${UNCOVERED_REASON_AR[cov.reason]}. ` +
      `يطبق خصم ${fallback === 0.5 ? "نصف يوم" : "ربع يوم"} من الراتب.`,
  };
}

/* ────────────────────────────── Early leave ────────────────────────────── */

export interface EarlyLeaveEvaluation {
  isEarly: boolean;
  remainingMinutes: number;
  chargedMinutes: number;
  canUsePermission: boolean;
  uncoveredReason: UncoveredReason | null;
  /** Minutes deducted from pay if the worker leaves without (or beyond) a permission. */
  payrollDeductionMinutes: number;
  remainingAfter: CycleUsage;
  messageAr: string;
}

export function evaluateEarlyLeave(
  now: Date,
  requiredEnd: Date,
  usage: CycleUsage = EMPTY_USAGE,
  cfg: Policy2026Config = POLICY_2026_DEFAULTS,
): EarlyLeaveEvaluation {
  const diffMs = requiredEnd.getTime() - now.getTime();
  const remaining = diffMs > 0 ? Math.ceil(diffMs / 60000) : 0;
  if (remaining <= 0) {
    return {
      isEarly: false,
      remainingMinutes: 0,
      chargedMinutes: 0,
      canUsePermission: false,
      uncoveredReason: null,
      payrollDeductionMinutes: 0,
      remainingAfter: remainingQuota(usage, cfg),
      messageAr: "انتهى الشيفت الرسمي — يمكنك تسجيل الخروج بدون أي خصم.",
    };
  }
  const charged = chargeableMinutes(remaining, cfg);
  const cov = checkCoverage(remaining, charged, usage, cfg);
  const rem = cov.covered
    ? remainingQuota({ count: usage.count + 1, minutes: usage.minutes + charged }, cfg)
    : remainingQuota(usage, cfg);
  return {
    isEarly: true,
    remainingMinutes: remaining,
    chargedMinutes: cov.covered ? charged : 0,
    canUsePermission: cov.covered,
    uncoveredReason: cov.covered ? null : cov.reason,
    payrollDeductionMinutes: cov.covered ? 0 : remaining,
    remainingAfter: rem,
    messageAr: cov.covered
      ? `متبقي ${toArabicDigits(remaining)} دقيقة على نهاية الشيفت؛ هل تريد استهلاك إذن انصراف مبكر؟ (سيُخصم ${toArabicDigits(charged)} دقيقة من رصيدك)`
      : `متبقي ${toArabicDigits(remaining)} دقيقة على نهاية الشيفت. لا يمكن استخدام إذن: ${UNCOVERED_REASON_AR[cov.reason]}. الانصراف الآن يعني أن الدقائق المتبقية لن تُدفع.`,
  };
}

/* ────────────────────────────── Annual leave ────────────────────────────── */

export type LeavePhase = "probation" | "year1" | "year2plus";

/**
 * Year-1 Annual Leave Labor Law mode:
 * - `"new_15"` (Default — قانون العمل الجديد): 15 days in Year 1 (7.5d after 6 months + 1.25/month for months 7..12), then 21 days/year from Month 13+.
 * - `"legacy_21"` (قانون عمل قديم): 21 days from Year 1 (10.5d after 6 months + 1.75/month for months 7..12), continuing at 21 days/year from Month 13+.
 */
export type LeaveLawType = "new_15" | "legacy_21";

export const LEAVE_PHASE_AR: Record<LeavePhase, string> = {
  probation: "فترة الاختبار",
  year1: "السنة الأولى (١٥ يوم / ١٫٢٥ شهرياً)",
  year2plus: "ما بعد السنة الأولى (٢١ يوم / ١٫٧٥ شهرياً)",
};

export function leavePhaseLabelAr(accrual: Pick<LeaveAccrualResult, "phase" | "leaveLawType">): string {
  if (accrual.phase === "year1" && accrual.leaveLawType === "legacy_21") {
    return "السنة الأولى — قانون قديم (٢١ يوم / ١٫٧٥ شهرياً)";
  }
  return LEAVE_PHASE_AR[accrual.phase];
}

export function leavePhaseLabelEn(accrual: Pick<LeaveAccrualResult, "phase" | "leaveLawType">): string {
  if (accrual.phase === "probation") return "Probation Period (6m)";
  if (accrual.phase === "year1") {
    return accrual.leaveLawType === "legacy_21"
      ? "Year 1 — Old Law (21d / 1.75/mo)"
      : "Year 1 (15d / 1.25/mo)";
  }
  return "Post-Year 1 (21d / 1.75/mo)";
}

export interface AccrualRow {
  /** 1-based service month number. */
  month: number;
  periodStart: string;
  periodEnd: string;
  phase: LeavePhase;
  accrued: number;
  /** Carry-over cap applied at the start of this month (leave-year boundary), if any. */
  forfeited: number;
  used: number;
  balance: number;
  excluded: boolean;
}

export interface LeaveAccrualResult {
  hireDate: string;
  asOf: string;
  phase: LeavePhase;
  /** Whether the worker is on the default 15d Year-1 law ("new_15") or Old Labor Law 21d in Year 1 ("legacy_21"). */
  leaveLawType: LeaveLawType;
  serviceMonths: number;
  probationEndsOn: string;
  /** Date the post-Year-1 tier starts (Month 13). */
  tier2StartsOn: string;
  /** Annual entitlement for the current tier (0 in probation, 15 or 21 in year1, 21 in year2plus). */
  annualEntitlementDays: number;
  /** Days accrued within the current leave year. */
  currentYearAccruedDays: number;
  accruedDays: number;
  usedDays: number;
  priorUsedLeaveDays: number;
  forfeitedDays: number;
  /** Unused balance legally carried over at the start of the current leave year (capped at maxCarryOverDays). */
  legalCarryOverDays: number;
  /** Management-approved carried-over balance added on top (worker.carriedOverLeaveDays). */
  carriedOverApproved: number;
  /** Total carried-over balance (legalCarryOverDays + carriedOverApproved). */
  totalCarryOverDays: number;
  balance: number;
  /** Balance rounded down to the 0.5-day request step. */
  requestableDays: number;
  monthlyRate: number;
  schedule: AccrualRow[];
}

export interface LeaveAccrualOptions {
  /** Year-1 Labor Law option: `"new_15"` (15 days first year, default) or `"legacy_21"` (Old Labor Law: 21 days first year). */
  leaveLawType?: LeaveLawType;
  /** Approved annual leave taken (each item: date + days, supports 0.5). */
  usedLeave?: { date: string; days: number }[];
  /** Leave days already consumed before the MFT system launched (for existing workers). */
  priorUsedLeaveDays?: number;
  /**
   * YYYY-MM-DD the prior-used figure was recorded (the worker's MFT start date or the policy
   * effective date). The days are deducted in the leave year containing this date, i.e. BEFORE
   * that year's carry-over cap. Omitted / in the future → deducted from the current balance.
   */
  priorUsedAsOf?: string | null;
  /** Management-approved extra carry-over (worker.carriedOverLeaveDays). */
  carriedOverApproved?: number;
  /** YYYY-MM months (e.g. "2027-03") excluded as not "actually worked" (mostly unpaid leave). */
  excludedMonths?: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * HR-POL-2026 Annual Leave Accrual:
 *   - First 6 months (months 1..6, while serviceMonths < 6): probation → 0 paid annual leave (unpaid leave allowed).
 *   - Upon completing 6 months (serviceMonths >= 6):
 *     • Default (`"new_15"`): 7.5 days drop retroactively for the first 6 months (6 × 1.25), then +1.25/month in months 7..12 → 15 days in Year 1.
 *     • Old Labor Law (`"legacy_21"`): 10.5 days drop retroactively for the first 6 months (6 × 1.75), then +1.75/month in months 7..12 → 21 days in Year 1.
 *   - Post-Year 1 (month 13 onwards — استحقاق ما بعد السنة الأولى): rate is 1.75 days / completed month
 *     (= 21 days / year), plus legally carried-over balance (capped at `maxCarryOverDays`) and
 *     management-approved carry-over (`carriedOverApproved`).
 */
export function computeLeaveAccrual(
  hireDateYmd: string,
  asOf: Date = new Date(),
  opts: LeaveAccrualOptions = {},
  cfg: Policy2026Config = POLICY_2026_DEFAULTS,
): LeaveAccrualResult {
  const hire = parseYmd(hireDateYmd) ?? new Date(asOf);
  const serviceMonths = completedMonthsBetween(hire, asOf);
  const prob = cfg.probationMonths; // 6
  const year1TotalMonths = Math.max(prob, cfg.year1AccrualMonths); // 12 months total for Year 1
  const tier2From = year1TotalMonths + 1; // 13 (Month 13 onwards = 1.75/month, 21 days/year)
  const leaveLawType: LeaveLawType = opts.leaveLawType === "legacy_21" ? "legacy_21" : "new_15";
  const year1Rate = leaveLawType === "legacy_21" ? cfg.leaveRateYear2 : cfg.leaveRateYear1;
  const used = [...(opts.usedLeave ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const excluded = new Set(opts.excludedMonths ?? []);
  const carried = Math.max(0, opts.carriedOverApproved ?? 0);
  const priorUsed = Math.max(0, opts.priorUsedLeaveDays ?? 0);
  const rawPriorAsOf = opts.priorUsedAsOf && /^\d{4}-\d{2}-\d{2}/.test(opts.priorUsedAsOf) ? opts.priorUsedAsOf.slice(0, 10) : null;
  const asOfYmd = ymd(asOf);
  const priorAsOf = rawPriorAsOf && rawPriorAsOf > asOfYmd ? asOfYmd : rawPriorAsOf;
  let priorPending = priorUsed;

  const schedule: AccrualRow[] = [];
  let balance = 0;
  let accruedTotal = 0;
  let currentYearAccrued = 0;
  let legalCarryOver = 0;
  let forfeitedTotal = 0;
  let usedTotal = 0;
  let usedIdx = 0;
  let probationEligibleMonths = 0;

  // Simulate every completed month plus the current (in-progress) month for usage attribution.
  const lastMonth = serviceMonths + 1;
  for (let k = 1; k <= lastMonth; k++) {
    const pStart = addMonthsClamped(hire, k - 1);
    const pEndExclusive = addMonthsClamped(hire, k);
    const isCompleted = k <= serviceMonths;
    const monthKey = ymd(pStart).slice(0, 7);
    const isExcluded = excluded.has(monthKey);
    const phase: LeavePhase =
      k < prob || (k === prob && !isCompleted)
        ? "probation"
        : k < tier2From
          ? "year1"
          : "year2plus";

    // Leave-year boundary carry-over cap (start of month 13, 25, 37 … when that month completes).
    let forfeited = 0;
    if (isCompleted && k >= tier2From && (k - tier2From) % 12 === 0) {
      if (balance > cfg.maxCarryOverDays) {
        forfeited = round2(balance - cfg.maxCarryOverDays);
        balance = cfg.maxCarryOverDays;
        forfeitedTotal += forfeited;
      }
      legalCarryOver = round2(Math.max(0, balance));
      currentYearAccrued = 0;
    }

    let usedThis = 0;
    const pEndYmd = ymd(pEndExclusive);
    while (usedIdx < used.length && used[usedIdx]!.date < pEndYmd) {
      usedThis += used[usedIdx]!.days;
      usedIdx++;
    }
    // Pre-system leave belongs to the leave year that contains the recording date.
    // If recorded on the exact anniversary day ending a leave year (e.g. month 12), deduct before next month's cap.
    const nextIsCapBoundary = k + 1 >= tier2From && (k + 1 - tier2From) % 12 === 0;
    let priorThis = 0;
    if (
      priorPending > 0 &&
      priorAsOf &&
      (priorAsOf < pEndYmd || (nextIsCapBoundary && priorAsOf === pEndYmd))
    ) {
      priorThis = priorPending;
      priorPending = 0;
    }
    balance -= usedThis + priorThis;
    usedTotal += usedThis;

    if (k <= prob && isCompleted && !isExcluded) {
      probationEligibleMonths++;
    }

    let accrued = 0;
    if (isCompleted) {
      if (k < prob) {
        // Months 1..5: still inside the 6-month probation window; retroactive drop occurs at completion of month 6.
        accrued = 0;
      } else if (k === prob) {
        // Completion of month 6: retroactive 7.5d ("new_15") or 10.5d ("legacy_21"), excluding unpaid/excluded months in 1..6.
        accrued = round2(probationEligibleMonths * year1Rate);
      } else if (!isExcluded) {
        // Months 7..12 accrue at year1Rate (1.25/mo → 15d or 1.75/mo → 21d); Month 13+ accrues at 1.75/mo (21d/year).
        accrued = k < tier2From ? year1Rate : cfg.leaveRateYear2;
      }
      balance += accrued;
      accruedTotal += accrued;
      currentYearAccrued += accrued;
    }

    if (isCompleted || usedThis > 0 || priorThis > 0) {
      schedule.push({
        month: k,
        periodStart: ymd(pStart),
        periodEnd: ymd(new Date(pEndExclusive.getTime() - 86400000)),
        phase,
        accrued,
        forfeited,
        used: round2(usedThis + priorThis),
        balance: round2(balance),
        excluded: isExcluded,
      });
    }
  }
  // Any leave dated after the current month is still deducted (booked in advance).
  while (usedIdx < used.length) {
    usedTotal += used[usedIdx]!.days;
    balance -= used[usedIdx]!.days;
    usedIdx++;
  }

  usedTotal = round2(usedTotal + priorUsed);
  balance = round2(balance + carried - priorPending);
  const phase: LeavePhase =
    serviceMonths < prob ? "probation" : serviceMonths < year1TotalMonths ? "year1" : "year2plus";
  const annualEntitlementDays =
    phase === "probation"
      ? 0
      : phase === "year1"
        ? round2(year1Rate * year1TotalMonths)
        : round2(cfg.leaveRateYear2 * 12);
  const totalCarryOverDays = round2(legalCarryOver + carried);
  return {
    hireDate: ymd(hire),
    asOf: ymd(asOf),
    phase,
    leaveLawType,
    serviceMonths,
    probationEndsOn: ymd(addMonthsClamped(hire, prob)),
    tier2StartsOn: ymd(addMonthsClamped(hire, year1TotalMonths)),
    annualEntitlementDays,
    currentYearAccruedDays: round2(currentYearAccrued),
    accruedDays: round2(accruedTotal),
    usedDays: usedTotal,
    priorUsedLeaveDays: round2(priorUsed),
    forfeitedDays: round2(forfeitedTotal),
    legalCarryOverDays: legalCarryOver,
    carriedOverApproved: carried,
    totalCarryOverDays,
    balance,
    requestableDays: Math.max(0, Math.floor(balance * 2) / 2),
    monthlyRate: phase === "probation" ? 0 : phase === "year1" ? year1Rate : cfg.leaveRateYear2,
    schedule,
  };
}

/** Validates an annual-leave request against the computed balance. */
export function validateLeaveRequest(
  accrual: LeaveAccrualResult,
  requestedDays: number,
): { ok: true } | { ok: false; reasonAr: string } {
  if (accrual.phase === "probation") {
    return {
      ok: false,
      reasonAr: `لا يحق الحصول على إجازة سنوية خلال فترة الاختبار (رصيدك المتاح حالياً: ٠ يوم — تنتهي فترة الاختبار في ${accrual.probationEndsOn}).`,
    };
  }
  if (accrual.requestableDays <= 0) {
    return {
      ok: false,
      reasonAr: `لا يمكنك إرسال طلب إجازة سنوية لأن رصيدك المتاح حالياً هو (٠ يوم) — لا يُسمح بالرصيد السالب.`,
    };
  }
  if (!(requestedDays > 0)) {
    return {
      ok: false,
      reasonAr: "الأيام المختارة تقع بالكامل في عطلة نهاية الأسبوع الرسمية (الجمعة والسبت) أو إجازة رسمية ولا تُخصم من رصيد الإجازات.",
    };
  }
  if (Math.round(requestedDays * 2) !== requestedDays * 2) {
    return { ok: false, reasonAr: "يجب أن تكون مدة الإجازة بمضاعفات نصف يوم." };
  }
  if (requestedDays > accrual.requestableDays) {
    return {
      ok: false,
      reasonAr: `الرصيد المتاح لك حالياً ${toArabicDigits(accrual.requestableDays)} يوم فقط (طلبت ${toArabicDigits(requestedDays)} يوم) — لا يُسمح بطلب إجازة تتجاوز رصيدك أو بالرصيد السالب.`,
    };
  }
  return { ok: true };
}

export interface WorkingLeaveRangeSummary {
  totalCalendarDays: number;
  workingDays: number;
  weekendDaysCount: number;
  holidayDaysCount: number;
  excludedDaysCount: number;
}

/**
 * Counts working days inside [startYmd, endYmd] (inclusive), automatically excluding
 * weekly rest days (default Friday=5 & Saturday=6) and official holidays so official
 * off-days are NEVER deducted from a worker's leave balance.
 */
export function countWorkingLeaveDaysInRange(
  startYmd: string,
  endYmd: string,
  weekendDays: number[] = [5, 6],
  holidays: Array<string | { date: string; endDate?: string }> = [],
): WorkingLeaveRangeSummary {
  if (!startYmd || !endYmd) {
    return { totalCalendarDays: 0, workingDays: 0, weekendDaysCount: 0, holidayDaysCount: 0, excludedDaysCount: 0 };
  }
  const s = parseYmd(startYmd);
  const e = parseYmd(endYmd);
  if (!s || !e || e < s) {
    return { totalCalendarDays: 0, workingDays: 0, weekendDaysCount: 0, holidayDaysCount: 0, excludedDaysCount: 0 };
  }
  const holidaySet = new Set<string>();
  for (const h of holidays) {
    if (typeof h === "string") {
      holidaySet.add(h);
    } else if (h && h.date) {
      if (!h.endDate || h.endDate === h.date) {
        holidaySet.add(h.date);
      } else {
        const curH = parseYmd(h.date);
        const endH = parseYmd(h.endDate);
        if (curH && endH) {
          while (curH <= endH) {
            holidaySet.add(ymd(curH));
            curH.setDate(curH.getDate() + 1);
          }
        }
      }
    }
  }

  let totalCalendarDays = 0;
  let workingDays = 0;
  let weekendDaysCount = 0;
  let holidayDaysCount = 0;
  const cur = new Date(s.getFullYear(), s.getMonth(), s.getDate(), 12, 0, 0);
  const endAt = new Date(e.getFullYear(), e.getMonth(), e.getDate(), 12, 0, 0);

  while (cur <= endAt) {
    totalCalendarDays++;
    const curStr = ymd(cur);
    const isWknd = weekendDays.includes(cur.getDay());
    const isHol = holidaySet.has(curStr);
    if (isWknd) {
      weekendDaysCount++;
    } else if (isHol) {
      holidayDaysCount++;
    } else {
      workingDays++;
    }
    cur.setDate(cur.getDate() + 1);
  }

  return {
    totalCalendarDays,
    workingDays,
    weekendDaysCount,
    holidayDaysCount,
    excludedDaysCount: weekendDaysCount + holidayDaysCount,
  };
}

/**
 * Advances from `startYmd` by `workingDaysNeeded` working days (skipping Fridays, Saturdays, and official holidays)
 * and returns the resulting `endYmd`.
 */
export function addWorkingLeaveDaysYmd(
  startYmd: string,
  workingDaysNeeded: number,
  weekendDays: number[] = [5, 6],
  holidays: Array<string | { date: string; endDate?: string }> = [],
): string {
  const s = parseYmd(startYmd);
  if (!s) return startYmd;
  const target = Math.max(1, Math.ceil(workingDaysNeeded));
  const holidaySet = new Set<string>();
  for (const h of holidays) {
    if (typeof h === "string") {
      holidaySet.add(h);
    } else if (h && h.date) {
      if (!h.endDate || h.endDate === h.date) {
        holidaySet.add(h.date);
      } else {
        const curH = parseYmd(h.date);
        const endH = parseYmd(h.endDate);
        if (curH && endH) {
          while (curH <= endH) {
            holidaySet.add(ymd(curH));
            curH.setDate(curH.getDate() + 1);
          }
        }
      }
    }
  }
  const cur = new Date(s.getFullYear(), s.getMonth(), s.getDate(), 12, 0, 0);
  let counted = 0;
  let safety = 0;
  while (safety < 366) {
    safety++;
    const curStr = ymd(cur);
    const isOff = weekendDays.includes(cur.getDay()) || holidaySet.has(curStr);
    if (!isOff) {
      counted++;
      if (counted >= target) return curStr;
    }
    cur.setDate(cur.getDate() + 1);
  }
  return ymd(cur);
}

/**
 * Computes the effective chargeable leave days for a stored/pending leave request,
 * ensuring Fridays, Saturdays, and official holidays in [exceptionDate, endDate] are never charged.
 */
export function effectiveLeaveDaysForRequest(
  req: { exceptionDate?: string; endDate?: string | null; leaveDays?: number | null },
  weekendDays: number[] = [5, 6],
  holidays: Array<string | { date: string; endDate?: string }> = [],
): number {
  const start = String(req.exceptionDate || "");
  const end = String(req.endDate || start);
  const rawDays = Number(req.leaveDays);
  if (!start) return rawDays > 0 ? rawDays : 1;
  if (end > start) {
    const summary = countWorkingLeaveDaysInRange(start, end, weekendDays, holidays);
    if (summary.workingDays === 0) return 0;
    if (rawDays > 0 && rawDays < summary.workingDays) return rawDays;
    return summary.workingDays;
  }
  const singleSummary = countWorkingLeaveDaysInRange(start, start, weekendDays, holidays);
  if (singleSummary.workingDays === 0) return 0;
  if (!req.endDate && rawDays > 1) return rawDays;
  if (rawDays === 0.5) return 0.5;
  return 1;
}

/* ────────────────────────────── Overtime ────────────────────────────── */

export interface OvertimeSplit {
  totalMinutes: number;
  dayMinutes: number;
  nightMinutes: number;
  dayPay: number;
  nightPay: number;
  nightAllowance: number;
  total: number;
  segments: { from: string; to: string; kind: "day" | "night"; minutes: number }[];
}

/**
 * Splits `minutes` of approved overtime starting at `start` across the day
 * (06:00–18:00 → 1.35x) and night (18:00–06:00 → 1.70x) windows, minute by minute.
 */
export function splitOvertimePay(
  start: Date,
  minutes: number,
  hourlyRate: number,
  cfg: Policy2026Config = POLICY_2026_DEFAULTS,
): OvertimeSplit {
  const total = Math.max(0, Math.round(minutes));
  const dayStart = parseHm(cfg.dayWindowStart);
  const nightStart = parseHm(cfg.nightWindowStart);
  const isDay = (t: number) =>
    dayStart <= nightStart ? t >= dayStart && t < nightStart : t >= dayStart || t < nightStart;

  let dayMin = 0;
  let nightMin = 0;
  const segments: OvertimeSplit["segments"] = [];
  const s0 = minutesOfDay(start);
  let segKind: "day" | "night" | null = null;
  let segStart = s0;
  for (let i = 0; i < total; i++) {
    const t = (s0 + i) % 1440;
    const kind: "day" | "night" = isDay(t) ? "day" : "night";
    if (kind === "day") dayMin++;
    else nightMin++;
    if (kind !== segKind) {
      if (segKind) segments.push({ from: formatHm(segStart), to: formatHm(s0 + i), kind: segKind, minutes: s0 + i - segStart });
      segKind = kind;
      segStart = s0 + i;
    }
  }
  if (segKind) segments.push({ from: formatHm(segStart), to: formatHm(s0 + total), kind: segKind, minutes: s0 + total - segStart });

  const dayPay = (dayMin / 60) * hourlyRate * cfg.dayOtMultiplier;
  const nightPay = (nightMin / 60) * hourlyRate * cfg.nightOtMultiplier;
  const nightAllowance = nightMin > 0 ? cfg.nightShiftAllowance : 0;
  return {
    totalMinutes: total,
    dayMinutes: dayMin,
    nightMinutes: nightMin,
    dayPay: round2(dayPay),
    nightPay: round2(nightPay),
    nightAllowance,
    total: round2(dayPay + nightPay + nightAllowance),
    segments,
  };
}

/**
 * Payable overtime for one day (V2.0 clause 15): min(approved, actual).
 * Workday actual = minutes worked after the required shift end (by last logout).
 * Off-day (weekend / holiday) actual = all worked minutes, starting from first clock-in.
 */
export function payableOvertimeForDay(p: {
  firstClockIn: Date;
  lastClockOut: Date | null;
  workedMinutes: number;
  approvedMinutes: number;
  isOffDay: boolean;
  hourlyRate: number;
  cfg?: Policy2026Config;
}): OvertimeSplit & { actualMinutes: number; approvedMinutes: number; startHm: string } {
  const cfg = p.cfg ?? POLICY_2026_DEFAULTS;
  let actual = 0;
  let start: Date;
  if (p.isOffDay) {
    actual = Math.max(0, Math.round(p.workedMinutes));
    start = p.firstClockIn;
  } else {
    start = requiredShiftEnd(p.firstClockIn, cfg);
    if (p.lastClockOut) actual = Math.max(0, Math.floor((p.lastClockOut.getTime() - start.getTime()) / 60000));
    else actual = Math.max(0, Math.round(p.workedMinutes - cfg.standardHours * 60));
  }
  const payable = Math.min(Math.max(0, p.approvedMinutes), actual);
  const split = splitOvertimePay(start, payable, p.hourlyRate, cfg);
  return { ...split, actualMinutes: actual, approvedMinutes: p.approvedMinutes, startHm: formatHm(minutesOfDay(start)) };
}

/* ────────────────────────────── Reimbursements ────────────────────────────── */

export type ReimbursementType = "outdoor" | "purchase";
export type ReimbursementStage = "pre_approval" | "pending_invoice" | "review" | "approved" | "rejected";

export const REIMBURSEMENT_STAGE_AR: Record<ReimbursementStage, string> = {
  pre_approval: "بانتظار الموافقة المسبقة",
  pending_invoice: "بانتظار رفع الفاتورة",
  review: "قيد المراجعة",
  approved: "معتمد — يضاف للراتب",
  rejected: "مرفوض",
};

export interface ReimbursementLike {
  type: ReimbursementType;
  stage?: ReimbursementStage;
  amount?: number | null;
  routeFrom?: string;
  routeTo?: string;
  quoteLink?: string | null;
  approvedAmount?: number | null;
  invoiceAmount?: number | null;
  attachmentKinds?: string[];
  imageHashes?: string[];
}

export interface ReimbursementFlag {
  code: string;
  severity: "error" | "warning";
  messageAr: string;
}

/** Validates a reimbursement against HR-POL-2026 clause 5 (+ V2.0 18/19). */
export function validateReimbursement(
  r: ReimbursementLike,
  ctx: { knownHashes?: Set<string> | string[]; cfg?: Policy2026Config } = {},
): ReimbursementFlag[] {
  const cfg = ctx.cfg ?? POLICY_2026_DEFAULTS;
  const flags: ReimbursementFlag[] = [];
  const kinds = new Set(r.attachmentKinds ?? []);
  const known = ctx.knownHashes instanceof Set ? ctx.knownHashes : new Set(ctx.knownHashes ?? []);

  if (r.type === "outdoor") {
    if (!kinds.has("ride_screenshot")) flags.push({ code: "missing_screenshot", severity: "error", messageAr: "لقطة شاشة تطبيق النقل (أوبر) مطلوبة." });
    if (!r.routeFrom?.trim() || !r.routeTo?.trim()) flags.push({ code: "missing_route", severity: "error", messageAr: "يجب تحديد نقطة البداية والنهاية." });
    if (!(Number(r.amount) > 0)) flags.push({ code: "missing_amount", severity: "error", messageAr: "يجب إدخال السعر النهائي الظاهر في اللقطة." });
  } else {
    if (!kinds.has("quote") && !r.quoteLink?.trim()) flags.push({ code: "missing_quote", severity: "error", messageAr: "مطلوب لقطة عرض سعر أو رابط الشراء قبل الموافقة." });
    if (!(Number(r.amount) > 0)) flags.push({ code: "missing_amount", severity: "error", messageAr: "يجب إدخال المبلغ التقديري." });
    const needsInvoice = r.stage === "review" || r.stage === "approved";
    if (needsInvoice && !kinds.has("invoice") && !kinds.has("proforma")) {
      flags.push({ code: "missing_invoice", severity: "error", messageAr: "مطلوب فاتورة مبدئية أو نهائية رسمية." });
    }
    if (needsInvoice && Number(r.approvedAmount) > 0 && Number(r.invoiceAmount) > 0) {
      const limit = Number(r.approvedAmount) * (1 + (cfg.invoiceTolerancePct || 0) / 100);
      if (Number(r.invoiceAmount) > limit + 0.001) {
        flags.push({
          code: "invoice_over_approval",
          severity: "warning",
          messageAr: `قيمة الفاتورة (${r.invoiceAmount}) تتجاوز المبلغ المعتمد مسبقًا (${r.approvedAmount}) — تتطلب موافقة استثنائية.`,
        });
      }
    }
  }
  for (const h of r.imageHashes ?? []) {
    if (known.has(h)) {
      flags.push({ code: "duplicate_image", severity: "error", messageAr: "تم استخدام نفس الصورة في طلب سابق." });
      break;
    }
  }
  return flags;
}

/* ────────────────────────────── Auditor console ────────────────────────────── */

export interface ParsedLogRow {
  line: number;
  raw: string;
  date: string;
  clockIn: string;
  clockOut: string | null;
  approvedOtMinutes: number;
  error?: string;
}

/**
 * Lenient log parser. Accepts one day per line, e.g.:
 *   2026-10-18, 11:35, 18:20
 *   2026-10-19 | in 10:40 | out 20:30 | ot=90
 *   2026-10-20\t11:01\t19:00\t60
 */
export function parseAuditLog(text: string): ParsedLogRow[] {
  const rows: ParsedLogRow[] = [];
  const lines = String(text || "").split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const date = /(\d{4}-\d{2}-\d{2})/.exec(line)?.[1] ?? "";
    const rest = line.replace(date, " ");
    const times = Array.from(rest.matchAll(/(?:^|[^\d])(\d{1,2}):(\d{2})(?!\d)/g)).map(
      (m) => `${m[1]!.padStart(2, "0")}:${m[2]}`,
    );
    const otTag = /ot\s*[=:]\s*(\d+)/i.exec(rest)?.[1];
    let ot = otTag ? parseInt(otTag, 10) : 0;
    if (!otTag) {
      const leftovers = Array.from(
        rest.replace(/(\d{1,2}):(\d{2})/g, " ").matchAll(/(?:^|[^\d.])(\d{1,3})(?![\d.])/g),
      ).map((m) => m[1]!);
      if (leftovers.length) ot = parseInt(leftovers[leftovers.length - 1]!, 10) || 0;
    }
    const row: ParsedLogRow = {
      line: i + 1,
      raw,
      date,
      clockIn: times[0] ?? "",
      clockOut: times[1] ?? null,
      approvedOtMinutes: ot,
    };
    if (!date) row.error = "لم يتم العثور على تاريخ بصيغة YYYY-MM-DD";
    else if (!row.clockIn) row.error = "لم يتم العثور على وقت الحضور";
    rows.push(row);
  });
  return rows;
}

export interface AuditDayResult {
  row: ParsedLogRow;
  isOffDay: boolean;
  clockIn: ClockInEvaluation | null;
  earlyLeave: EarlyLeaveEvaluation | null;
  /** True when the auditor assumed the employee confirmed the early-leave permission. */
  earlyLeavePermissionUsed: boolean;
  overtime: (OvertimeSplit & { actualMinutes: number; approvedMinutes: number; startHm: string }) | null;
  workedMinutes: number;
  latePenaltyEgp: number;
  shortfallDeductionEgp: number;
  usageAfter: CycleUsage;
  notesAr: string[];
}

export interface AuditReport {
  days: AuditDayResult[];
  totals: {
    permissionsUsed: number;
    permissionMinutesUsed: number;
    remaining: CycleUsage;
    uncoveredLateDays: number;
    latePenaltyEgp: number;
    shortfallMinutes: number;
    shortfallDeductionEgp: number;
    otDayMinutes: number;
    otNightMinutes: number;
    otPay: number;
    netEffectEgp: number;
  };
  errors: ParsedLogRow[];
}

/** Runs a full HR-POL-2026 audit over parsed attendance rows (chronological). */
export function auditAttendanceLog(
  rows: ParsedLogRow[],
  ctx: {
    hourlyRate: number;
    startingUsage?: CycleUsage;
    weekendDays?: number[];
    holidays?: string[];
    cfg?: Policy2026Config;
  },
): AuditReport {
  const cfg = ctx.cfg ?? POLICY_2026_DEFAULTS;
  const weekend = ctx.weekendDays ?? [5, 6];
  const holidays = new Set(ctx.holidays ?? []);
  const dailyPay = cfg.standardHours * ctx.hourlyRate;
  let usage: CycleUsage = { ...(ctx.startingUsage ?? EMPTY_USAGE) };
  const valid = rows.filter((r) => !r.error).sort((a, b) => (a.date + a.clockIn).localeCompare(b.date + b.clockIn));
  const days: AuditDayResult[] = [];

  const t = {
    permissionsUsed: 0,
    permissionMinutesUsed: 0,
    uncoveredLateDays: 0,
    latePenaltyEgp: 0,
    shortfallMinutes: 0,
    shortfallDeductionEgp: 0,
    otDayMinutes: 0,
    otNightMinutes: 0,
    otPay: 0,
  };

  for (const row of valid) {
    const d = parseYmd(row.date)!;
    const inAt = atMinutes(d, parseHm(row.clockIn));
    let outAt: Date | null = row.clockOut ? atMinutes(d, parseHm(row.clockOut)) : null;
    if (outAt && outAt <= inAt) outAt = new Date(outAt.getTime() + 86400000); // overnight
    const isOffDay = weekend.includes(d.getDay()) || holidays.has(row.date);
    const worked = outAt ? Math.round((outAt.getTime() - inAt.getTime()) / 60000) : 0;
    const notes: string[] = [];
    let ci: ClockInEvaluation | null = null;
    let el: EarlyLeaveEvaluation | null = null;
    let elUsed = false;
    let latePenaltyEgp = 0;
    let shortfallEgp = 0;

    if (isOffDay) {
      notes.push("يوم راحة / عطلة رسمية — لا ينطبق التأخير، وكل الوقت المعتمد يحتسب إضافيًا.");
    } else {
      ci = evaluateClockIn(inAt, usage, cfg);
      notes.push(ci.messageAr);
      if (ci.status === "late-covered") {
        usage = ci.usageAfter;
        t.permissionsUsed++;
        t.permissionMinutesUsed += ci.chargedMinutes;
      } else if (ci.status === "late-uncovered") {
        t.uncoveredLateDays++;
        latePenaltyEgp = ci.fallbackPenaltyDays * dailyPay;
      }
      if (outAt) {
        el = evaluateEarlyLeave(outAt, ci.requiredEnd, usage, cfg);
        if (el.isEarly) {
          if (el.canUsePermission) {
            elUsed = true;
            usage = { count: usage.count + 1, minutes: usage.minutes + el.chargedMinutes };
            t.permissionsUsed++;
            t.permissionMinutesUsed += el.chargedMinutes;
            notes.push(
              `انصراف مبكر قبل ${toArabicDigits(el.remainingMinutes)} دقيقة — تم افتراض تأكيد إذن انصراف (${toArabicDigits(el.chargedMinutes)} دقيقة).`,
            );
          } else {
            shortfallEgp = (el.payrollDeductionMinutes / 60) * ctx.hourlyRate;
            t.shortfallMinutes += el.payrollDeductionMinutes;
            notes.push(
              `انصراف مبكر ${toArabicDigits(el.remainingMinutes)} دقيقة غير مغطى (${UNCOVERED_REASON_AR[el.uncoveredReason!]}) — خصم مباشر ${round2(shortfallEgp)} ج.م.`,
            );
          }
        }
      } else {
        notes.push("لا يوجد تسجيل خروج — يجب مراجعة البصمة يدويًا.");
      }
    }

    let ot: AuditDayResult["overtime"] = null;
    if (outAt && (row.approvedOtMinutes > 0 || isOffDay)) {
      ot = payableOvertimeForDay({
        firstClockIn: inAt,
        lastClockOut: outAt,
        workedMinutes: worked,
        approvedMinutes: row.approvedOtMinutes,
        isOffDay,
        hourlyRate: ctx.hourlyRate,
        cfg,
      });
      if (ot.totalMinutes > 0) {
        t.otDayMinutes += ot.dayMinutes;
        t.otNightMinutes += ot.nightMinutes;
        t.otPay += ot.total;
        notes.push(
          `إضافي معتمد ${toArabicDigits(ot.totalMinutes)} دقيقة (نهاري ${toArabicDigits(ot.dayMinutes)} × ${cfg.dayOtMultiplier} / ليلي ${toArabicDigits(ot.nightMinutes)} × ${cfg.nightOtMultiplier}) = ${ot.total} ج.م.`,
        );
      } else if (row.approvedOtMinutes === 0 && isOffDay && worked > 0) {
        notes.push("عمل في يوم راحة بدون تكليف إداري مسبق — لا يصرف إضافي.");
      }
      if (ot.actualMinutes > ot.approvedMinutes && ot.approvedMinutes > 0) {
        notes.push(`تم العمل ${toArabicDigits(ot.actualMinutes)} دقيقة إضافية لكن المعتمد ${toArabicDigits(ot.approvedMinutes)} فقط.`);
      }
    } else if (outAt && ci && !isOffDay) {
      const extra = Math.floor((outAt.getTime() - ci.requiredEnd.getTime()) / 60000);
      if (extra >= 15) notes.push(`بقاء ${toArabicDigits(extra)} دقيقة بعد الشيفت بدون تكليف إضافي معتمد — لا يصرف.`);
    }

    t.latePenaltyEgp += latePenaltyEgp;
    t.shortfallDeductionEgp += shortfallEgp;
    days.push({
      row,
      isOffDay,
      clockIn: ci,
      earlyLeave: el,
      earlyLeavePermissionUsed: elUsed,
      overtime: ot,
      workedMinutes: worked,
      latePenaltyEgp: round2(latePenaltyEgp),
      shortfallDeductionEgp: round2(shortfallEgp),
      usageAfter: { ...usage },
      notesAr: notes,
    });
  }

  return {
    days,
    totals: {
      ...t,
      latePenaltyEgp: round2(t.latePenaltyEgp),
      shortfallDeductionEgp: round2(t.shortfallDeductionEgp),
      otPay: round2(t.otPay),
      remaining: remainingQuota(usage, cfg),
      netEffectEgp: round2(t.otPay - t.latePenaltyEgp - t.shortfallDeductionEgp),
    },
    errors: rows.filter((r) => r.error),
  };
}
