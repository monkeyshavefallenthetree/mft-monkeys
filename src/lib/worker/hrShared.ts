import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  type Firestore,
} from "firebase/firestore";

export interface HrSettings {
  monthStartDay: number; // 1 - 28 (e.g. 21 for 21st to 20th cycle)
  weekendDays: number[]; // e.g. [5, 6] for Friday & Saturday
  standardHours: number; // e.g. 8
  shiftStartTime: string; // "10:00"
  gracePeriodMinutes: number; // 30
  secondThresholdMinutes: number; // 60
  defaultHourlyRate: number; // 100
  overtimeMultiplier: number; // 1.5
  absencePenaltyMultiplier: number; // 2.0
}

export const DEFAULT_HR_SETTINGS: HrSettings = {
  monthStartDay: 1,
  weekendDays: [5, 6], // Friday & Saturday (standard Egypt / MENA)
  standardHours: 8,
  shiftStartTime: "10:00",
  gracePeriodMinutes: 30,
  secondThresholdMinutes: 60,
  defaultHourlyRate: 100,
  overtimeMultiplier: 1.5,
  absencePenaltyMultiplier: 2.0,
};

export interface HolidayItem {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  type?: "national" | "religious" | "company" | "emergency";
  isPaid?: boolean;
  notes?: string;
}

export interface PayrollAdjustment {
  id: string;
  workerId: string;
  workerName?: string;
  type: "advance" | "allowance" | "bonus" | "deduction";
  amount: number;
  date: string; // YYYY-MM-DD
  reason?: string;
  status?: "applied" | "cancelled" | "pending";
}

/**
 * Checks whether a given YYYY-MM-DD date is an official holiday.
 */
export function isDateHoliday(dateYmd: string, holidays: HolidayItem[]): HolidayItem | undefined {
  if (!dateYmd || !holidays || holidays.length === 0) return undefined;
  return holidays.find((h) => {
    if (h.date === dateYmd) return true;
    if (h.endDate && h.date && dateYmd >= h.date && dateYmd <= h.endDate) return true;
    return false;
  });
}

/**
 * Formats "09:00" or "10:30" to friendly AM/PM notation ("9:00 AM", "10:30 AM").
 */
export function formatTimeAmPm(timeStr: string): string {
  if (!timeStr) return "10:00 AM";
  const [hStr, mStr] = timeStr.split(":");
  let h = parseInt(hStr || "10", 10);
  const m = parseInt(mStr || "0", 10);
  const ampm = h >= 12 ? "PM" : "AM";
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  const mm = m < 10 ? `0${m}` : `${m}`;
  return `${h}:${mm} ${ampm}`;
}

/**
 * Calculates whether a clock-in time is late based on configured shift start time + grace period.
 */
export function evaluateWorkerLateness(
  clockInDate: Date,
  settings: HrSettings = DEFAULT_HR_SETTINGS,
): { isLate: boolean; lateMinutes: number; graceEndTimeStr: string; shiftStartTimeStr: string } {
  const [shiftHStr, shiftMStr] = (settings.shiftStartTime || "10:00").split(":");
  const shiftH = parseInt(shiftHStr || "10", 10);
  const shiftM = parseInt(shiftMStr || "0", 10);

  const shiftStartMin = shiftH * 60 + shiftM;
  const graceEndMin = shiftStartMin + (settings.gracePeriodMinutes || 0);

  const clockInMin = clockInDate.getHours() * 60 + clockInDate.getMinutes();

  const isLate = clockInMin > graceEndMin;
  const lateMinutes = isLate ? clockInMin - graceEndMin : 0;

  // Format grace end time for display
  let gh = Math.floor(graceEndMin / 60);
  const gm = graceEndMin % 60;
  const gampm = gh >= 12 ? "PM" : "AM";
  if (gh > 12) gh -= 12;
  if (gh === 0) gh = 12;
  const graceEndTimeStr = `${gh}:${gm < 10 ? `0${gm}` : gm} ${gampm}`;

  return {
    isLate,
    lateMinutes,
    graceEndTimeStr,
    shiftStartTimeStr: formatTimeAmPm(settings.shiftStartTime),
  };
}

/**
 * Calculates current payroll cycle date range given a month start cutoff day (e.g. 21st, 25th, or 1st).
 */
export function getPayrollCycleRange(
  targetDate: Date = new Date(),
  monthStartDay: number = 1,
): {
  start: Date;
  end: Date;
  startYmd: string;
  endYmd: string;
  label: string;
} {
  const cutoff = Math.max(1, Math.min(28, monthStartDay));
  const year = targetDate.getFullYear();
  const month = targetDate.getMonth(); // 0-indexed
  const day = targetDate.getDate();

  let startYear = year;
  let startMonth = month;
  let endYear = year;
  let endMonth = month;

  if (cutoff === 1) {
    // Normal calendar month: 1st of month to last day of month
    const start = new Date(year, month, 1, 0, 0, 0, 0);
    const end = new Date(year, month + 1, 0, 23, 59, 59, 999);
    return {
      start,
      end,
      startYmd: formatYmd(start),
      endYmd: formatYmd(end),
      label: start.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    };
  }

  // Custom cutoff day (e.g. 21st - 20th)
  if (day >= cutoff) {
    // Currently on or after cutoff: cycle started this month on cutoff day, ends next month on cutoff - 1
    startYear = year;
    startMonth = month;
    endYear = month === 11 ? year + 1 : year;
    endMonth = month === 11 ? 0 : month + 1;
  } else {
    // Currently before cutoff: cycle started previous month on cutoff day, ends this month on cutoff - 1
    startYear = month === 0 ? year - 1 : year;
    startMonth = month === 0 ? 11 : month - 1;
    endYear = year;
    endMonth = month;
  }

  const start = new Date(startYear, startMonth, cutoff, 0, 0, 0, 0);
  const end = new Date(endYear, endMonth, cutoff - 1, 23, 59, 59, 999);

  const startFormatted = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const endFormatted = end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return {
    start,
    end,
    startYmd: formatYmd(start),
    endYmd: formatYmd(end),
    label: `${startFormatted} â€“ ${endFormatted}`,
  };
}

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Real-time subscription to HR settings from Firestore (`settings/hr`).
 */
export function subscribeHrSettings(
  db: Firestore,
  callback: (settings: HrSettings) => void,
): () => void {
  const ref = doc(db, "settings", "hr");
  return onSnapshot(
    ref,
    (snap) => {
      if (snap.exists()) {
        callback({
          ...DEFAULT_HR_SETTINGS,
          ...snap.data(),
        });
      } else {
        callback(DEFAULT_HR_SETTINGS);
      }
    },
    (err) => {
      console.warn("[hrShared] Error subscribing to hr settings:", err);
      callback(DEFAULT_HR_SETTINGS);
    },
  );
}

/**
 * Real-time subscription to official holidays collection.
 */
export function subscribeHolidays(
  db: Firestore,
  callback: (holidays: HolidayItem[]) => void,
): () => void {
  const ref = collection(db, "holidays");
  return onSnapshot(
    ref,
    (snap) => {
      const list: HolidayItem[] = [];
      snap.forEach((d) => {
        list.push({ id: d.id, ...d.data() } as HolidayItem);
      });
      list.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      callback(list);
    },
    (err) => {
      console.warn("[hrShared] Error subscribing to holidays:", err);
      callback([]);
    },
  );
}

/**
 * Real-time subscription to worker's payroll adjustments (advances, allowances, bonuses).
 */
export function subscribeWorkerPayrollAdjustments(
  db: Firestore,
  workerId: string,
  callback: (adjustments: PayrollAdjustment[]) => void,
): () => void {
  const q = query(
    collection(db, "payrollAdjustments"),
    where("workerId", "==", workerId),
  );
  return onSnapshot(
    q,
    (snap) => {
      const list: PayrollAdjustment[] = [];
      snap.forEach((d) => {
        list.push({ id: d.id, ...d.data() } as PayrollAdjustment);
      });
      list.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      callback(list);
    },
    (err) => {
      console.warn("[hrShared] Error subscribing to worker payroll adjustments:", err);
      callback([]);
    },
  );
}
