"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc, updateDoc, onSnapshot, query, collection, where, serverTimestamp } from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";
import {
  playTerminalBeep,
  isSoundEnabled,
  setSoundEnabled,
  stopContinuousCheckInAlarm,
} from "@/lib/sound";
import { getFirebase, isFirebaseConfigured } from "@/lib/firebase";
import { markAlertRead, markAlertsRead, subscribeAlertsForWorker, type AlertRow } from "@/lib/worker/alerts";
import { subscribeChatNotifications, type ChatNotification } from "@/lib/worker/chatNotifications";
import {
  subscribeWorkerExceptions,
  submitException,
  type ExceptionRow,
} from "@/lib/worker/exceptions";
import {
  alertRelativeTime,
  formatRole,
  formatSessionDuration,
  formatWorkType,
  greetingFor,
  localYmd,
  toDate,
} from "@/lib/worker/format";
import {
  DEFAULT_HR_SETTINGS,
  evaluateWorkerGeofence,
  evaluateWorkerLateness,
  fetchClientPublicIp,
  formatTimeAmPm,
  getPayrollCycleRange,
  hasVerifiedOfficePinToday,
  isDateHoliday,
  isTrustedOfficePc,
  matchOfficeNetworkIp,
  subscribeHolidays,
  subscribeHrSettings,
  subscribeWorkerPayrollAdjustments,
  type GeofenceCheckResult,
  type HolidayItem,
  type HrSettings,
  type PayrollAdjustment,
} from "@/lib/worker/hrShared";
import {
  initWorkSession,
  syncWorkSession,
  endWorkSession,
  workedMs,
  confirmPresenceCheckIn,
  markSessionIdle,
  type WorkSessionState,
} from "@/lib/worker/session";
import type { TaskRow } from "@/lib/worker/tasks";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import TasksPanel from "./TasksPanel";
import ActiveCheckInModal from "./ActiveCheckInModal";
import { DashboardSkeleton } from "./Skeleton";
import FirebaseSetupWarning from "./FirebaseSetupWarning";
import { toast, confirmDialog } from "@/lib/worker/feedback";
import { useTheme, type Theme } from "@/lib/worker/theme";
import {
  addWorkingLeaveDaysYmd,
  chargeableMinutes,
  computeLeaveAccrual,
  countWorkingLeaveDaysInRange,
  effectiveLeaveDaysForRequest,
  evaluateClockIn,
  formatHm,
  isPolicy2026Active,
  LEAVE_PHASE_AR,
  leavePhaseLabelAr,
  minutesOfDay,
  policyConfigFromSettings,
  priorUsedRecordedOn,
  remainingQuota,
  requiredShiftEnd,
  toArabicDigits,
  usageFromLedger,
  validateLeaveRequest,
  validatePermissionRequest,
  type ClockInEvaluation,
  type CycleUsage,
  type EarlyLeaveEvaluation,
  type LeaveLawType,
  type Policy2026Config,
} from "@/lib/worker/hrPolicy2026";
import {
  chargeEarlyLeave,
  chargeLatePermission,
  reverseEarlyLeaveOnReturn,
  subscribeCycleLedger,
  type WorkerLedgerDoc,
} from "@/lib/worker/permissions";
import SmartClockOutModal, { type SmartClockOutChoice } from "./SmartClockOutModal";
import SmartLateClockInModal, { type SmartLateClockInChoice } from "./SmartLateClockInModal";
import OutsideLocationMissionModal from "./OutsideLocationMissionModal";
import PermissionLeaveCard from "./PermissionLeaveCard";
import ExpensesPanel from "./ExpensesPanel";
import PwaPushBanner from "./PwaPushBanner";
import { sendWebPushToWorkers, showBackgroundNotification } from "@/lib/worker/webPush";

const MARKETING =
  process.env.NEXT_PUBLIC_MARKETING_SITE_URL?.replace(/\/$/, "") ?? "";

type Tab = "tasks" | "time" | "alerts" | "exceptions" | "expenses" | "profile";

type WorkerDoc = {
  email?: string;
  firstName?: string;
  lastName?: string;
  status?: string;
  role?: string;
  phone?: string;
  experience?: string;
  department?: string;
  employmentType?: string;
  expectedSalary?: number;
  government?: string;
  city?: string;
  skills?: string[];
  portfolioLink?: string;
  netspend?: string;
  createdAt?: Timestamp;
  lastLogin?: Timestamp;
  /** HR-POL-2026 leave profile (set by admin). */
  hireDate?: string;
  attendanceStartDate?: string;
  leaveLawType?: LeaveLawType;
  priorUsedLeaveDays?: number;
  carriedOverLeaveDays?: number;
};

const SHIFT_MS = 8 * 60 * 60 * 1000;
/** 2-hour check-in cycle (120 minutes). */
const CHECKIN_CYCLE_MS = 2 * 60 * 60 * 1000;
/** 10-minute early check-in window at the end of every 2 hours (600 seconds). */
const CHECKIN_EARLY_WINDOW_SECONDS = 10 * 60;
/** Trigger point: 1h 50m into the 2h cycle (10 minutes before the 2 hours end). */
const CHECKIN_TRIGGER_MS = CHECKIN_CYCLE_MS - CHECKIN_EARLY_WINDOW_SECONDS * 1000;

const ICON = {
  tasks: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
  time: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  alerts: "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9",
  exceptions: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  profile: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
  play: "M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664zM21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  stop: "M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z",
  eye: "M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z",
  bolt: "M13 10V3L4 14h7v7l9-11h-7z",
  check: "M5 13l4 4L19 7",
  chart: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  sound: "M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z",
  logout: "M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1",
  wifiOff: "M18.364 5.636a9 9 0 010 12.728m-3.536-3.536a4 4 0 010-5.656M5.636 5.636l12.728 12.728M8.464 8.464a5 5 0 000 7.072",
  sun: "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z",
  moon: "M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z",
  monitor: "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
  calendar: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  cash: "M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z",
  sparkles: "M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z",
  shield: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z",
};

function Icon({ d, className = "h-4 w-4" }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

const TABS: { id: Tab; label: string; short: string; icon: string }[] = [
  { id: "tasks", label: "Tasks", short: "Tasks", icon: ICON.tasks },
  { id: "time", label: "Work Session", short: "Shift", icon: ICON.time },
  { id: "alerts", label: "HR Alerts", short: "Alerts", icon: ICON.alerts },
  { id: "exceptions", label: "Requests", short: "Requests", icon: ICON.exceptions },
  { id: "expenses", label: "Expenses", short: "Expenses", icon: ICON.cash },
  { id: "profile", label: "Profile", short: "Profile", icon: ICON.profile },
];
const TAB_IDS = TABS.map((t) => t.id);

/** "6h 12m" style duration. */
function formatHM(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function exceptionLabel(ex: ExceptionRow, weekendDays: number[] = [5, 6], holidays: HolidayItem[] = []): string {
  const mins = Number(ex.lateMinutes) || 0;
  const days = effectiveLeaveDaysForRequest(
    {
      exceptionDate: ex.exceptionDate ? String(ex.exceptionDate) : undefined,
      endDate: ex.endDate ? String(ex.endDate) : null,
      leaveDays: ex.leaveDays != null ? Number(ex.leaveDays) : null,
    },
    weekendDays,
    holidays,
  );
  switch (ex.type) {
    case "external_mission":
      return `🚗 مأمورية خارجية (External Mission · ${ex.missionHours ?? Math.round((mins || 60) / 60)}h)`;
    case "late":
      return `Late Excuse (استثناء تأخير) · ${mins}m`;
    case "advance_late":
      return `Late Permission (إذن تأخير شهري) · ${mins}m`;
    case "early_permission":
      return `Early Leave Permission (إذن انصراف مبكر) · ${mins}m`;
    case "overtime":
      return `Overtime · +${mins}m`;
    case "absent":
      return "Absence (غياب)";
    case "annual_leave":
      return `Annual Leave (إجازة سنوية · ${days}d)`;
    case "unpaid_leave":
      return `Unpaid Leave (إجازة بدون مرتب · ${days}d)`;
    case "sick_leave":
      return `Sick Leave (إجازة مرضية · ${days}d)`;
    case "emergency_leave":
      return `Emergency Leave (إجازة عارضة · ${days}d)`;
    case "advance_request":
      return `Salary Advance ($${ex.requestedAmount ?? "—"})`;
    default:
      return String(ex.type || "Request");
  }
}

function calcInclusiveDays(startYmd: string, endYmd: string): number {
  if (!startYmd || !endYmd) return 1;
  const s = new Date(startYmd + "T12:00:00");
  const e = new Date(endYmd + "T12:00:00");
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return 1;
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1);
}

function addDaysYmd(startYmd: string, daysToAdd: number): string {
  const d = new Date(startYmd + "T12:00:00");
  if (isNaN(d.getTime())) return startYmd;
  d.setDate(d.getDate() + Math.max(0, daysToAdd));
  return localYmd(d);
}

function formatSubmittedDateTime(ts: unknown): string {
  const d = toDate(ts as Timestamp | undefined);
  if (!d) return "—";
  const ymdStr = localYmd(d);
  const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${ymdStr} (${timeStr})`;
}

function alertBadgeClass(type: string | undefined): { cls: string; label: string } {
  switch ((type || "").toLowerCase()) {
    case "urgent":
      return { cls: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/60 dark:text-red-400 dark:border-red-900", label: "Urgent" };
    case "warning":
      return { cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-400 dark:border-amber-900", label: "Warning" };
    case "penalty":
      return { cls: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/60 dark:text-violet-400 dark:border-violet-900", label: "Penalty" };
    case "schedule":
      return { cls: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-400 dark:border-blue-900", label: "Schedule" };
    default:
      return { cls: "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700", label: type ? type.toUpperCase() : "Info" };
  }
}

export default function DashboardApp() {
  const router = useRouter();
  const { theme, isDark, setTheme, toggleTheme } = useTheme();
  const reducedMotion = useReducedMotion();
  const [authLoading, setAuthLoading] = useState(true);
  const [uid, setUid] = useState<string | null>(null);
  const [profile, setProfile] = useState<(WorkerDoc & { uid: string }) | null>(null);
  const [tab, setTabState] = useState<Tab>("tasks");
  const [session, setSession] = useState<WorkSessionState | null>(null);
  const [, bumpSessionRender] = useState(0);
  const [shiftMode, setShiftMode] = useState<"clocked-in" | "view-only" | null>(() => {
    if (typeof window !== "undefined") {
      return (sessionStorage.getItem("workerShiftMode") as "clocked-in" | "view-only" | null) ?? null;
    }
    return null;
  });
  const [showShiftChoiceModal, setShowShiftChoiceModal] = useState(false);
  const [shiftBusy, setShiftBusy] = useState(false);
  const [overtimeMinutes, setOvertimeMinutes] = useState(0);
  const [shiftCompletedModalOpen, setShiftCompletedModalOpen] = useState(false);
  const [autoLogoutSeconds, setAutoLogoutSeconds] = useState(120);
  const [showOvertimeForm, setShowOvertimeForm] = useState(false);
  const [overtimeRequestedMins, setOvertimeRequestedMins] = useState(60);
  const [overtimeReason, setOvertimeReason] = useState("");
  const [overtimeSubmitting, setOvertimeSubmitting] = useState(false);
  const [isProactiveOvertimeOpen, setIsProactiveOvertimeOpen] = useState(false);
  const shiftWarningGivenRef = useRef(false);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);
  const [exceptionsLoading, setExceptionsLoading] = useState(true);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);
  const [chatNotifications, setChatNotifications] = useState<ChatNotification[]>([]);
  const chatNotifCountRef = useRef(-1);
  const seenChatNotifIds = useRef<Set<string> | null>(null);
  const [salaryEdit, setSalaryEdit] = useState(false);
  const [salaryVal, setSalaryVal] = useState("");
  const [exceptionType, setExceptionType] = useState("late");
  const [advanceAmount, setAdvanceAmount] = useState<number>(500);
  const [hrSettings, setHrSettings] = useState<HrSettings>(DEFAULT_HR_SETTINGS);
  const [holidays, setHolidays] = useState<HolidayItem[]>([]);
  const [adjustments, setAdjustments] = useState<PayrollAdjustment[]>([]);
  const [exceptionSubmitting, setExceptionSubmitting] = useState(false);
  const [taskStats, setTaskStats] = useState({ total: 0, completed: 0, pending: 0, review: 0, rate: 0 });
  const [myActiveTasks, setMyActiveTasks] = useState<TaskRow[]>([]);
  const [selectedShiftTaskIds, setSelectedShiftTaskIds] = useState<string[]>([]);
  const [shiftTaskNote, setShiftTaskNote] = useState("");
  const [checkInModalOpen, setCheckInModalOpen] = useState(false);
  const [checkInSecondsRemaining, setCheckInSecondsRemaining] = useState(CHECKIN_EARLY_WINDOW_SECONDS);
  const [isWorkerIdle, setIsWorkerIdle] = useState(false);
  const lastCheckInTimeRef = useRef<number>(Date.now());
  const checkInNotifiedRef = useRef(false);
  const [online, setOnline] = useState(true);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const lastSyncRef = useRef(0);
  const sessionRef = useRef<WorkSessionState | null>(null);
  sessionRef.current = session;
  const loggingOutRef = useRef(false);

  // HR-POL-2026: permission ledger, smart clock-out, smart late clock-in, and leave balance
  const [ledger, setLedger] = useState<WorkerLedgerDoc[]>([]);
  const [ledgerLoaded, setLedgerLoaded] = useState(false);
  const [smartOut, setSmartOut] = useState<{ mode: "clockout" | "logout"; requiredEnd: Date } | null>(null);
  const [smartLateIn, setSmartLateIn] = useState<{ clockIn: Date; overwrite?: boolean } | null>(null);
  const [smartBusy, setSmartBusy] = useState(false);
  const [outsideLocationModalOpen, setOutsideLocationModalOpen] = useState(false);
  const [lastGeofenceResult, setLastGeofenceResult] = useState<GeofenceCheckResult | null>(null);
  const [lastGpsError, setLastGpsError] = useState<string | null>(null);
  const [lastWorkerCoords, setLastWorkerCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [leaveDays, setLeaveDays] = useState(1);
  const [leaveStartDate, setLeaveStartDate] = useState(() => localYmd());
  const [leaveEndDate, setLeaveEndDate] = useState(() => localYmd());
  const [permTargetDate, setPermTargetDate] = useState(() => localYmd());
  const [lateMinsInput, setLateMinsInput] = useState(30);
  const policyCfg = useMemo(() => policyConfigFromSettings(hrSettings), [hrSettings]);
  const policyActive = isPolicy2026Active(hrSettings, localYmd());
  const effectiveLedger = useMemo(() => {
    const range = getPayrollCycleRange(new Date(), hrSettings.monthStartDay);
    const curYm = localYmd().slice(0, 7);
    const out: WorkerLedgerDoc[] = ledger.map((e) => ({ ...e }));

    for (const x of exceptions) {
      const t = String(x.type || "");
      if (t !== "advance_late" && t !== "early_permission" && !(t === "late" && x.status === "approved")) {
        continue;
      }
      const status = String(x.status || "pending");
      if (status === "rejected") continue;

      const d = String(x.exceptionDate || localYmd());
      const inCycle = (d >= range.startYmd && d <= range.endYmd) || d.slice(0, 7) === curYm;
      if (!inCycle) continue;

      const kind: "late" | "early_leave" = t === "early_permission" ? "early_leave" : "late";
      const actualMins = Math.max(1, Number(x.lateMinutes) || 30);
      const chargedMins = t === "late" ? 0 : chargeableMinutes(actualMins, policyCfg);
      const reqState: "pending" | "approved" = status === "approved" ? "approved" : "pending";

      const existingIdx = out.findIndex(
        (row) =>
          row.date === d &&
          row.kind === kind &&
          row.status === "applied" &&
          !row.id.startsWith("req_") &&
          (!row.covered || status === "approved"),
      );
      if (existingIdx >= 0) {
        out[existingIdx] = {
          ...out[existingIdx]!,
          actualMinutes: actualMins,
          chargedMinutes: chargedMins,
          covered: true,
          requestStatus: reqState,
        };
      } else {
        out.push({
          id: `req_${x.id}`,
          workerId: String(x.workerId || uid || ""),
          date: d,
          kind,
          actualMinutes: actualMins,
          chargedMinutes: chargedMins,
          covered: true,
          status: "applied",
          source: status === "approved" ? "admin" : "worker",
          requestStatus: reqState,
        });
      }
    }

    out.sort((a, b) => b.date.localeCompare(a.date));
    return out;
  }, [ledger, exceptions, uid, hrSettings.monthStartDay, policyCfg]);
  const policyUsage = useMemo(() => usageFromLedger(effectiveLedger), [effectiveLedger]);
  const getDailyPermissionCtx = useCallback(
    (dateYmd: string, reqType: string) => {
      const targetDate = dateYmd || localYmd();
      const entriesOnDate = effectiveLedger.filter(
        (e) => e.date === targetDate && e.status === "applied" && e.covered && (e.chargedMinutes || 0) > 0,
      );
      const dailyUsedMinutes = entriesOnDate.reduce((sum, e) => sum + (e.chargedMinutes || 0), 0);
      const targetKind = reqType === "early_permission" ? "early_leave" : "late";
      const sameKindAlreadyBooked = entriesOnDate.some((e) => e.kind === targetKind);
      return {
        dailyUsedMinutes,
        dailyUsedCount: entriesOnDate.length,
        sameKindAlreadyBooked,
      };
    },
    [effectiveLedger],
  );
  const policyOffDay =
    (hrSettings.weekendDays || [5, 6]).includes(new Date().getDay()) || !!isDateHoliday(localYmd(), holidays);
  const policyRef = useRef<{ active: boolean; offDay: boolean; cfg: Policy2026Config; usage: CycleUsage }>({
    active: true,
    offDay: false,
    cfg: policyCfg,
    usage: policyUsage,
  });
  policyRef.current = { active: policyActive, offDay: policyOffDay, cfg: policyCfg, usage: policyUsage };

  /**
   * Required shift end if leaving now would be an early leave OR if the worker
   * clocked in late today under HR-POL-2026, so SmartClockOutModal always appears
   * with Exception / Lateness Deduction / Permission options.
   */
  const policyEarlyGate = useCallback((): Date | null => {
    const p = policyRef.current;
    const ws = sessionRef.current;
    if (!ws?.isActive || p.offDay) return null;
    const stdMs = (p.cfg.standardHours || 8) * 3_600_000;
    const worked = workedMs(ws);
    const officialEnd = requiredShiftEnd(ws.startTime, p.cfg);
    const dynamicEnd = new Date(Date.now() + Math.max(0, stdMs - worked));
    const effectiveEnd =
      dynamicEnd.getTime() > officialEnd.getTime() ? dynamicEnd : officialEnd;
    const lateEv = evaluateClockIn(ws.startTime, p.usage, p.cfg);
    const isEarly = Date.now() < effectiveEnd.getTime() || worked < stdMs - 60_000;
    const isLate = lateEv.status !== "on-time";
    return isEarly || isLate ? effectiveEnd : null;
  }, []);

  /** Tab is mirrored to `?tab=` so refreshes and shared links keep context. */
  const setTab = useCallback((next: Tab) => {
    setTabState(next);
    const url = new URL(window.location.href);
    if (next === "tasks") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  }, [reducedMotion]);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("tab") as Tab | null;
    if (fromUrl && TAB_IDS.includes(fromUrl)) setTabState(fromUrl);
    setSoundOn(isSoundEnabled());
    setOnline(navigator.onLine);
    const on = () => {
      setOnline(true);
      toast.success("Back online", { description: "Your changes will sync automatically." });
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // Collect Firestore listener unsubscribers
  const firestoreUnsubs = useRef<Array<() => void>>([]);
  const registerUnsub = useCallback((unsub: () => void) => {
    firestoreUnsubs.current.push(unsub);
    return unsub;
  }, []);
  const teardownListeners = useCallback(() => {
    firestoreUnsubs.current.forEach((fn) => { try { fn(); } catch {} });
    firestoreUnsubs.current = [];
  }, []);

  const loadDashboardData = useCallback(
    async (userId: string) => {
      if (loggingOutRef.current) return;
      const fb = getFirebase();
      if (!fb) return;

      const wref = doc(fb.db, "workers", userId);
      const snap = await getDoc(wref);
      if (!snap.exists()) {
        toast.error("Worker profile not found.");
        await signOut(fb.auth);
        router.replace("/");
        return;
      }
      const data = snap.data() as WorkerDoc;
      if (data.status === "rejected") {
        await signOut(fb.auth);
        router.replace("/");
        toast.error("Your account has been rejected.");
        return;
      }

      setProfile({ uid: userId, ...data });
      setSalaryVal(String(data.expectedSalary ?? ""));

      const storedMode = sessionStorage.getItem("workerShiftMode") as "clocked-in" | "view-only" | null;
      const storedOt = parseInt(sessionStorage.getItem("workerOvertimeMinutes") || "0", 10) || 0;
      setOvertimeMinutes(storedOt);

      if (storedMode === "clocked-in") {
        // Page refresh while on shift: resume today's record.
        setShiftMode("clocked-in");
        const ws = await initWorkSession(fb.db, {
          uid: userId,
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
        });
        setSession(ws);
        const storedLastCheckIn = parseInt(sessionStorage.getItem("workerLastCheckInTime") || "0", 10);
        const initialCheckInTs = storedLastCheckIn > 0 ? storedLastCheckIn : (ws?.segmentStart.getTime() ?? Date.now());
        lastCheckInTimeRef.current = initialCheckInTs;
        sessionStorage.setItem("workerLastCheckInTime", String(initialCheckInTs));
      } else {
        // Open task selection & shift start modal immediately upon entering the system
        setShiftMode(storedMode === "view-only" ? "view-only" : null);
        setSession(null);
        setShowShiftChoiceModal(true);
      }
    },
    [router],
  );

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setAuthLoading(false);
      return;
    }
    const fb = getFirebase();
    if (!fb) return;

    const unsub = onAuthStateChanged(fb.auth, async (user) => {
      if (loggingOutRef.current) return;
      if (!user) {
        setUid(null);
        setProfile(null);
        setAuthLoading(false);
        router.replace("/");
        return;
      }
      setUid(user.uid);
      await loadDashboardData(user.uid);
      setAuthLoading(false);
    });
    return () => unsub();
  }, [router, loadDashboardData]);

  const toggleShiftTaskSelection = useCallback((taskId: string) => {
    setSelectedShiftTaskIds((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId],
    );
  }, []);

  const startActiveShift = useCallback(async () => {
    const fb = getFirebase();
    if (!fb || !uid || !profile || shiftBusy) return;

    const chosenTasks = myActiveTasks
      .filter((t) => selectedShiftTaskIds.includes(t.id))
      .map((t) => ({
        id: t.id,
        title: t.title || "Untitled Task",
        projectName: t.projectName,
      }));

    if (myActiveTasks.length > 0 && chosenTasks.length === 0 && !shiftTaskNote.trim()) {
      toast.warning("يرجى اختيار المهام التي ستعمل عليها أولاً", {
        description: "حدد مهمة واحدة على الأقل من قائمتك لبدء الشيفت وإبلاغ الإدارة.",
      });
      return;
    }

    setShiftBusy(true);
    try {
      // Check Geofence (Work Locations) if Admin has configured active locations
      const activeWorkLocs = (hrSettings.workLocations ?? []).filter(
        (l) => l.active !== false && Number.isFinite(Number(l.lat)) && Number.isFinite(Number(l.lng)),
      );
      const geofenceEnforced = hrSettings.enforceGeofence !== false && activeWorkLocs.length > 0;
      const todayStr = localYmd();
      const hasApprovedTodayMission = exceptions.some(
        (x) =>
          x.type === "external_mission" &&
          String(x.exceptionDate || "") === todayStr &&
          x.status === "approved",
      );

      // Non-GPS Office Verification Channels (for desktop PCs & devices inside the company without GPS):
      // 1) Worker already verified today's Office PIN
      const verifiedByOfficePin = hasVerifiedOfficePinToday(uid, todayStr);
      // 2) This computer browser is authorized as a stationary Trusted Office PC
      const trustedPc = isTrustedOfficePc(hrSettings);
      // 3) Device is connected to an approved Company Wi-Fi / Public IP
      let verifiedByOfficeIp = false;
      if (
        geofenceEnforced &&
        !hasApprovedTodayMission &&
        !verifiedByOfficePin &&
        !trustedPc.trusted &&
        (hrSettings.officeNetworks ?? []).some((n) => n.active !== false && Boolean(n.ip?.trim()))
      ) {
        const clientIp = await fetchClientPublicIp();
        const matchedNet = matchOfficeNetworkIp(clientIp, hrSettings);
        if (matchedNet) {
          verifiedByOfficeIp = true;
        }
      }

      const bypassedByOfficeAuth =
        hasApprovedTodayMission || verifiedByOfficePin || trustedPc.trusted || verifiedByOfficeIp;

      if (geofenceEnforced && !bypassedByOfficeAuth) {
        if (typeof navigator === "undefined" || !navigator.geolocation) {
          setLastGpsError(
            "هذا الجهاز لا يدعم الـ GPS — إذا كنت داخل مقر الشركة استخدم «كود حضور المكتب» بالأسفل، أو أرسل طلب مأمورية خارجية.",
          );
          setLastGeofenceResult(null);
          setShowShiftChoiceModal(false);
          setOutsideLocationModalOpen(true);
          setShiftBusy(false);
          return;
        }

        const gpsPos = await new Promise<GeolocationPosition | null>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve(pos),
            (err) => {
              setLastGpsError(
                err.code === 1
                  ? "يرجى السماح بصلاحية الموقع الجغرافي (Location Permission)، أو إذا كنت على جهاز كمبيوتر داخل الشركة استخدم «كود حضور المكتب» بالأسفل."
                  : "تعذر تحديد موقعك عبر الـ GPS — إذا كنت داخل الشركة استخدم «كود حضور المكتب» بالأسفل، أو أرسل طلب مأمورية خارجية.",
              );
              resolve(null);
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 10000 },
          );
        });

        if (!gpsPos) {
          setLastGeofenceResult(null);
          setShowShiftChoiceModal(false);
          setOutsideLocationModalOpen(true);
          setShiftBusy(false);
          toast.warning("📍 أدخل كود حضور المكتب (إذا كنت داخل الشركة بدون GPS) أو أرسل طلب مأمورية خارجية");
          return;
        }

        const coords = { lat: gpsPos.coords.latitude, lng: gpsPos.coords.longitude };
        setLastWorkerCoords(coords);
        setLastGpsError(null);
        const geoCheck = evaluateWorkerGeofence(coords.lat, coords.lng, hrSettings);
        setLastGeofenceResult(geoCheck);

        if (!geoCheck.inside) {
          setShowShiftChoiceModal(false);
          setOutsideLocationModalOpen(true);
          setShiftBusy(false);
          toast.warning("📍 إذا كنت على كمبيوتر داخل الشركة أدخل «كود المكتب»، أو أرسل طلب مأمورية خارجية", {
            description: geoCheck.nearestLocation
              ? `أقرب موقع عمل (${geoCheck.nearestLocation.name}) يبعد عن موقع الـ GPS الحالي ${geoCheck.distanceMeters} متر.`
              : undefined,
          });
          return;
        }
      }

      setOutsideLocationModalOpen(false);
      const ws = await initWorkSession(
        fb.db,
        {
          uid,
          firstName: profile.firstName,
          lastName: profile.lastName,
          email: profile.email,
        },
        {
          selectedTasks: chosenTasks,
          note: shiftTaskNote.trim() || undefined,
          sendNotification: true,
        },
      );
      if (!ws) throw new Error("no session");

      // Mark any selected "assigned" tasks as "in-progress" automatically
      for (const t of myActiveTasks) {
        if (selectedShiftTaskIds.includes(t.id) && t.status === "assigned") {
          updateDoc(doc(fb.db, "tasks", t.id), {
            status: "in-progress",
            startedAt: serverTimestamp(),
          }).catch(() => {});
        }
      }

      const nowTs = Date.now();
      sessionStorage.setItem("workerShiftMode", "clocked-in");
      sessionStorage.setItem("workerLoginTime", ws.startTime.toISOString());
      sessionStorage.setItem("workerLastCheckInTime", String(nowTs));
      lastCheckInTimeRef.current = nowTs;
      checkInNotifiedRef.current = false;
      setCheckInModalOpen(false);
      setIsWorkerIdle(false);
      setCheckInSecondsRemaining(CHECKIN_EARLY_WINDOW_SECONDS);

      setSession(ws);
      setShiftMode("clocked-in");
      setShowShiftChoiceModal(false);
      shiftWarningGivenRef.current = false;
      lastSyncRef.current = nowTs;
      setLastSyncAt(new Date());
      playTerminalBeep();
      // Same-day return after an early leave → refund that early-leave permission.
      if (ws.priorMs > 0) void reverseEarlyLeaveOnReturn(fb.db, uid, localYmd());
      if (ws.priorMs > 60_000) {
        toast.success("تم استئناف الشيفت وإبلاغ الإدارة بالمهام ✓", {
          description: `تم تسجيل ${formatHM(ws.priorMs)} اليوم. التذكير القادم بعد ساعتين.`,
        });
      } else {
        toast.success("تم بدء الشيفت وإرسال المهام المختارة للإدارة ✓", {
          description: "سيظهر تنبيه تأكيد الحضور الدوري كل ساعتين (مع مهلة ١٠ دقائق قبل نهاية الساعتين).",
        });
      }
    } catch (e) {
      console.error("Failed to init work session", e);
      toast.error("Couldn't clock you in", { description: "Check your connection and try again." });
    } finally {
      setShiftBusy(false);
    }
  }, [uid, profile, shiftBusy, myActiveTasks, selectedShiftTaskIds, shiftTaskNote, hrSettings, exceptions]);

  const handleConfirmCheckIn = useCallback(
    async (data: { taskId?: string; taskTitle?: string; note?: string }) => {
      stopContinuousCheckInAlarm();
      const fb = getFirebase();
      const ws = sessionRef.current;
      const nowTs = Date.now();
      lastCheckInTimeRef.current = nowTs;
      sessionStorage.setItem("workerLastCheckInTime", String(nowTs));
      checkInNotifiedRef.current = false;
      setCheckInModalOpen(false);
      setIsWorkerIdle(false);
      setCheckInSecondsRemaining(CHECKIN_EARLY_WINDOW_SECONDS);

      if (fb && ws && uid && profile) {
        const wName =
          `${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim() || (profile.email ?? "Worker");
        await confirmPresenceCheckIn(fb.db, ws.id, uid, {
          ...data,
          workerName: wName,
        }).catch(() => {});
      }
      toast.success("تم تأكيد الحضور وتجديد الشيفت لساعتين كمان ✓", {
        description: "تم إيقاف صوت التنبيه وبدء دورة ساعتين جديدة.",
      });
    },
    [uid, profile],
  );

  const chooseBrowseMode = useCallback(() => {
    sessionStorage.setItem("workerShiftMode", "view-only");
    sessionStorage.removeItem("workerLoginTime");
    setShiftMode("view-only");
    setShowShiftChoiceModal(false);
    toast.info("وضع التصفح بدون بدء الشيفت", {
      description: "يمكنك اختيار المهام وبدء الشيفت في أي وقت من الشريط العلوي.",
    });
  }, []);

  /**
   * Ends the running work segment but keeps the worker signed in (browse mode).
   */
  const clockOut = useCallback(async (opts?: { silent?: boolean; reason?: string }) => {
    const fb = getFirebase();
    const ws = sessionRef.current;
    if (!opts?.silent) {
      // HR-POL-2026: leaving before completing shift or with unresolved lateness → smart modal.
      const gateEnd = policyEarlyGate();
      if (gateEnd) {
        setSmartOut({ mode: "clockout", requiredEnd: gateEnd });
        return;
      }
    }
    if (!opts?.silent) {
      const ok = await confirmDialog({
        title: "Clock out?",
        message: `You've logged ${formatHM(workedMs(ws))} today. You'll stay signed in and can clock back in later — break time won't be counted.`,
        confirmLabel: "Clock out",
      });
      if (!ok) return;
    }
    stopContinuousCheckInAlarm();
    setCheckInModalOpen(false);
    setIsWorkerIdle(false);
    setShiftBusy(true);
    try {
      let banked = ws;
      if (fb && ws) banked = await endWorkSession(fb.db, ws);
      sessionStorage.setItem("workerShiftMode", "view-only");
      sessionStorage.removeItem("workerLoginTime");
      sessionStorage.removeItem("workerLastCheckInTime");
      setSession(banked);
      setShiftMode("view-only");
      setShiftCompletedModalOpen(false);
      setShowOvertimeForm(false);
      playTerminalBeep();
      toast.success(opts?.reason ?? "Clocked out", {
        description: `${formatHM(workedMs(banked))} logged today. Nice work!`,
        duration: 6000,
      });
    } catch (e) {
      console.error(e);
      toast.error("Couldn't clock out", { description: "Check your connection and try again." });
    } finally {
      setShiftBusy(false);
    }
  }, [policyEarlyGate]);

  const handleLogout = useCallback(async (opts?: { silent?: boolean; reasonNotice?: string }) => {
    if (loggingOutRef.current) return;
    if (!opts?.silent) {
      const gateEnd = policyEarlyGate();
      if (gateEnd) {
        setSmartOut({ mode: "logout", requiredEnd: gateEnd });
        return;
      }
    }
    if (!opts?.silent) {
      const onShift = !!sessionRef.current?.isActive;
      const ok = await confirmDialog({
        title: onShift ? "Clock out and sign out?" : "Sign out?",
        message: onShift
          ? "You're still on shift. Signing out will also clock you out and save your hours."
          : "You'll need to sign in again to see your tasks.",
        confirmLabel: onShift ? "Clock out & sign out" : "Sign out",
        tone: "default",
      });
      if (!ok) return;
    }

    loggingOutRef.current = true;
    stopContinuousCheckInAlarm();
    teardownListeners();

    const fb = getFirebase();
    const ws = sessionRef.current;
    if (fb && ws?.isActive) {
      try {
        await endWorkSession(fb.db, ws);
      } catch (e) {
        console.error(e);
      }
    }
    if (fb && uid) {
      updateDoc(doc(fb.db, "workers", uid), { isOnline: false, presenceStatus: "offline" }).catch(() => {});
    }

    if (opts?.reasonNotice) {
      sessionStorage.setItem("shiftEndNotice", opts.reasonNotice);
    }
    sessionStorage.removeItem("workerLoginTime");
    sessionStorage.removeItem("workerShiftMode");
    sessionStorage.removeItem("workerOvertimeMinutes");
    sessionStorage.removeItem("workerLastCheckInTime");

    if (fb) {
      signOut(fb.auth).catch(() => {});
    }
    window.location.href = "/";
  }, [teardownListeners, uid, policyEarlyGate]);

  /** Resolves the HR-POL-2026 smart clock-out alert. */
  const onSmartChoice = useCallback(
    async (choice: SmartClockOutChoice, ev: EarlyLeaveEvaluation) => {
      const ctx = smartOut;
      if (!ctx) return;
      if (choice === "stay") {
        setSmartOut(null);
        return;
      }
      const fb = getFirebase();
      const ws = sessionRef.current;

      if (choice === "excuse") {
        setSmartOut(null);
        await clockOut({ silent: true, reason: "تم تسجيل الانصراف — أرسل طلب الاستثناء الآن" });
        setExceptionType("late");
        setTab("exceptions");
        toast.info("تم فتح نموذج طلب استثناء (Exception)", {
          description: "اكتب سبب التأخير أو الانصراف المبكر لإرساله إلى الموارد البشرية.",
          duration: 8000,
        });
        return;
      }

      if ((choice === "permission" || choice === "deduct") && fb && uid && ws) {
        setSmartBusy(true);
        try {
          const range = getPayrollCycleRange(ws.startTime, hrSettings.monthStartDay);
          const wName = `${profile?.firstName ?? ""} ${profile?.lastName ?? ""}`.trim() || (profile?.email ?? "Worker");
          const dateYmd = localYmd(ws.startTime);

          if (ev.isEarly) {
            if (choice === "permission" && ev.canUsePermission) {
              const alreadyBookedEarly = exceptions.some(
                (x) =>
                  x.type === "early_permission" &&
                  String(x.exceptionDate || "") === dateYmd &&
                  (!x.status || x.status === "pending" || x.status === "approved"),
              );
              if (!alreadyBookedEarly) {
                await submitException(fb.db, {
                  workerId: uid,
                  workerName: wName,
                  workerEmail: profile?.email ?? "",
                  type: "early_permission",
                  lateMinutes: ev.chargedMinutes,
                  exceptionDate: dateYmd,
                  reason: `[طلب إذن انصراف مبكر (${ev.remainingMinutes} د متبقية ← ${ev.chargedMinutes} د من الرصيد الشهري)] بانتظار موافقة الأدمن`,
                  supportingEvidence: null,
                });
              }
            }
            // Do NOT count permission automatically by itself — record covered: false until Admin approves
            await chargeEarlyLeave(
              fb.db,
              { uid, name: wName, email: profile?.email },
              dateYmd,
              range.startYmd,
              ev,
              false,
              formatHm(minutesOfDay(ctx.requiredEnd)),
            ).catch((err) => console.warn("[early leave ledger]", err));
          }

          // Also record late arrival decision if the worker clocked in late today and hasn't recorded it yet
          const hasLateEntry = effectiveLedger.some((e) => e.date === dateYmd && e.kind === "late" && e.status === "applied");
          const lateEv = evaluateClockIn(ws.startTime, policyRef.current.usage, policyRef.current.cfg);
          if (choice === "permission" && !ev.isEarly && lateEv.status !== "on-time" && lateEv.covered) {
            const alreadyBookedLate = exceptions.some(
              (x) =>
                x.type === "advance_late" &&
                String(x.exceptionDate || "") === dateYmd &&
                (!x.status || x.status === "pending" || x.status === "approved"),
            );
            if (!alreadyBookedLate) {
              await submitException(fb.db, {
                workerId: uid,
                workerName: wName,
                workerEmail: profile?.email ?? "",
                type: "advance_late",
                lateMinutes: lateEv.chargedMinutes,
                exceptionDate: dateYmd,
                reason: `[طلب إذن تأخير صباحي (${lateEv.lateMinutes} د فعلي ← ${lateEv.chargedMinutes} د من الرصيد الشهري)] بانتظار موافقة الأدمن`,
                supportingEvidence: null,
              });
            }
          }
          if (!hasLateEntry && lateEv.status !== "on-time") {
            const penaltyDays: 0.25 | 0.5 = lateEv.fallbackPenaltyDays === 0.5 ? 0.5 : 0.25;
            await chargeLatePermission(
              fb.db,
              { uid, name: wName, email: profile?.email },
              dateYmd,
              range.startYmd,
              lateEv,
              {
                usePermission: false,
                penaltyDays,
                overwrite: true,
              },
            ).catch(() => {});
          }
        } catch (e) {
          console.error("early leave ledger failed", e);
          toast.error("تعذر تسجيل الاختيار", { description: "تحقق من الاتصال وحاول مرة أخرى." });
          setSmartBusy(false);
          return;
        }
        setSmartBusy(false);
      }
      setSmartOut(null);
      const reason =
        choice === "permission"
          ? "تم الانصراف وإرسال طلب الإذن للأدمن للموافقة ⏳"
          : choice === "deduct"
            ? "تم الانصراف وتطبيق خصم التأخير / عدم استكمال الساعات 💸"
            : choice === "break"
              ? "Break started — clock back in when you return"
              : undefined;
      if (ctx.mode === "logout") void handleLogout({ silent: true });
      else void clockOut({ silent: true, reason });
    },
    [smartOut, uid, profile, hrSettings.monthStartDay, effectiveLedger, exceptions, handleLogout, clockOut, setTab],
  );

  /** Resolves the HR-POL-2026 smart late clock-in choice (request permission vs. salary deduction). */
  const onSmartLateChoice = useCallback(
    async (choice: SmartLateClockInChoice, ev: ClockInEvaluation, penaltyDays: 0.25 | 0.5) => {
      const ctx = smartLateIn;
      const fb = getFirebase();
      if (!ctx || !fb || !uid || !profile) return;
      const date = localYmd(ctx.clockIn);
      const storageKey = `mft_late_choice_${uid}_${date}`;

      if (choice === "excuse") {
        sessionStorage.setItem(storageKey, "excuse");
        setSmartLateIn(null);
        setExceptionType("late");
        setLateMinsInput(Math.min(180, Math.max(1, ev.lateMinutes || 30)));
        setTab("exceptions");
        playTerminalBeep();
        toast.info("تم فتح نموذج طلب استثناء", {
          description: "اكتب سبب التأخير القهري لإرساله إلى الموارد البشرية.",
        });
        const range = getPayrollCycleRange(ctx.clockIn, hrSettings.monthStartDay);
        const name = `${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim() || (profile.email ?? "Worker");
        void chargeLatePermission(fb.db, { uid, name, email: profile.email }, date, range.startYmd, ev, {
          usePermission: false,
          penaltyDays,
          overwrite: true,
        }).catch((err) => console.warn("[late choice excuse ledger]", err));
        return;
      }

      setSmartBusy(true);
      try {
        const range = getPayrollCycleRange(ctx.clockIn, hrSettings.monthStartDay);
        const name = `${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim() || (profile.email ?? "Worker");
        const wantsPermission = choice === "permission" && ev.covered;

        if (wantsPermission) {
          const alreadyBooked = exceptions.some(
            (x) =>
              x.type === "advance_late" &&
              String(x.exceptionDate || "") === date &&
              (!x.status || x.status === "pending" || x.status === "approved"),
          );
          if (!alreadyBooked) {
            await submitException(fb.db, {
              workerId: uid,
              workerName: name,
              workerEmail: profile.email ?? "",
              type: "advance_late",
              lateMinutes: ev.chargedMinutes,
              exceptionDate: date,
              reason: `[طلب إذن تأخير صباحي (${ev.lateMinutes} د فعلي ← ${ev.chargedMinutes} د من الرصيد الشهري)] بانتظار موافقة الأدمن`,
              supportingEvidence: null,
            });
          }
          // Record lateness with usePermission: false initially — permission is counted in live quota via exceptionRequests & confirmed by Admin
          await chargeLatePermission(fb.db, { uid, name, email: profile.email }, date, range.startYmd, ev, {
            usePermission: false,
            penaltyDays,
            overwrite: true,
          }).catch((err) => console.warn("[late choice permission ledger]", err));
        } else {
          await chargeLatePermission(fb.db, { uid, name, email: profile.email }, date, range.startYmd, ev, {
            usePermission: false,
            penaltyDays,
            overwrite: true,
          }).catch((err) => console.warn("[late choice deduct ledger]", err));
        }

        sessionStorage.setItem(storageKey, wantsPermission ? "permission" : "deduct");
        playTerminalBeep();
        setSmartLateIn(null);
        if (wantsPermission) {
          toast.success("تم إرسال طلب إذن التأخير للأدمن للموافقة ⏳", {
            description: `تم طلب خصم ${ev.chargedMinutes} دقيقة من رصيد الأذونات الشهري. لن يُحتسب الإذن تلقائياً إلا بعد موافقة الإدارة.`,
            duration: 8000,
          });
        } else {
          toast.warning("تم اختيار خصم التأخير من الراتب 💸", {
            description: `تم الاحتفاظ برصيد أذوناتك الشهري كاملًا وتطبيق خصم التأخير (${penaltyDays === 0.5 ? "نصف يوم" : "ربع يوم"}).`,
            duration: 8000,
          });
        }
      } catch (e) {
        console.error("late choice ledger failed", e);
        const msg = e instanceof Error ? e.message : "";
        const locked = /HR|same day/.test(msg);
        if (locked) setSmartLateIn(null);
        toast.error(locked ? "لا يمكن تغيير الاختيار" : "تعذر حفظ اختيار التأخير", {
          description: msg.includes("HR")
            ? "قامت الموارد البشرية بتعديل هذا السجل — تواصل معهم لأي تغيير."
            : msg.includes("same day")
              ? "يمكن تغيير اختيار التأخير في نفس اليوم فقط."
              : "تحقق من الاتصال وحاول مرة أخرى.",
        });
      } finally {
        setSmartBusy(false);
      }
    },
    [smartLateIn, uid, profile, hrSettings.monthStartDay, exceptions, setTab],
  );

  const handleOvertimeSubmit = useCallback(async (requestedMins: number, reasonText: string) => {
    const fb = getFirebase();
    if (!fb || !uid || !profile) return;
    if (!reasonText.trim()) {
      toast.warning("Please provide a brief justification for overtime.");
      return;
    }

    setOvertimeSubmitting(true);
    try {
      const todayStr = localYmd();
      await submitException(fb.db, {
        workerId: uid,
        workerName: `${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim() || (profile.email ?? "Worker"),
        workerEmail: profile.email ?? "",
        type: "overtime",
        lateMinutes: requestedMins,
        exceptionDate: todayStr,
        reason: `[Overtime +${requestedMins}m]: ${reasonText.trim()}`,
        supportingEvidence: null,
      });

      const newTotalOt = overtimeMinutes + requestedMins;
      setOvertimeMinutes(newTotalOt);
      sessionStorage.setItem("workerOvertimeMinutes", String(newTotalOt));

      // Reset warnings & close modals
      shiftWarningGivenRef.current = false;
      setShiftCompletedModalOpen(false);
      setShowOvertimeForm(false);
      setIsProactiveOvertimeOpen(false);
      setOvertimeReason("");

      playTerminalBeep();
      toast.success("Overtime request submitted!", {
        description: `Shift extended by ${requestedMins} minutes. Notification sent to management.`,
      });
    } catch (e) {
      console.error("Overtime submission failed", e);
      toast.error("Could not submit overtime request. Please try again.");
    } finally {
      setOvertimeSubmitting(false);
    }
  }, [uid, profile, overtimeMinutes]);

  /** Session duration display + Firebase sync + 8h shift limit + warning + 2h check-in (10m early window) */
  useEffect(() => {
    if (!uid || shiftMode !== "clocked-in") return;

    const id = window.setInterval(() => {
      if (loggingOutRef.current) return;
      bumpSessionRender((t) => t + 1);

      const fb = getFirebase();
      const ws = sessionRef.current;
      if (!ws?.isActive) return;
      const now = Date.now();
      if (fb) {
        if (now - lastSyncRef.current > 15000) {
          lastSyncRef.current = now;
          syncWorkSession(fb.db, ws).then(() => setLastSyncAt(new Date())).catch(() => {});
        }
      }

      // 2-hour check-in cycle: opens 10 minutes early before the end of the 2 hours (at 1h 50m)
      const elapsedSinceCheckIn = Math.max(0, now - lastCheckInTimeRef.current);
      if (elapsedSinceCheckIn >= CHECKIN_TRIGGER_MS) {
        const msUntilEnd = Math.max(0, CHECKIN_CYCLE_MS - elapsedSinceCheckIn);
        const secsLeft = Math.ceil(msUntilEnd / 1000);
        setCheckInModalOpen(true);
        setCheckInSecondsRemaining(secsLeft);

        if (!checkInNotifiedRef.current) {
          checkInNotifiedRef.current = true;
          void showBackgroundNotification({
            title: "🔔 موعد تأكيد الحضور الدوري (مهلة ١٠ دقائق)",
            body: "يتبقى ١٠ دقائق على نهاية الساعتين — ادخل الآن لتأكيد الحضور لساعتين كمان وإيقاف التنبيه.",
            tab: "time",
            urgent: true,
          });
          if (fb && uid) {
            void sendWebPushToWorkers(fb.db, {
              recipientUids: [uid],
              title: "🔔 موعد تأكيد الحضور الدوري (مهلة ١٠ دقائق)",
              body: "يتبقى ١٠ دقائق على نهاية الساعتين — ادخل الآن لتأكيد الحضور لساعتين كمان وإيقاف التنبيه.",
              tab: "time",
              urgent: true,
            });
          }
        }

        if (secsLeft <= 0 && !isWorkerIdle) {
          setIsWorkerIdle(true);
          if (fb && uid) {
            const wName =
              `${profile?.firstName ?? ""} ${profile?.lastName ?? ""}`.trim() || (profile?.email ?? uid);
            void markSessionIdle(fb.db, ws.id, uid, wName);
          }
        }
      }

      const elapsedMs = workedMs(ws);
      const allowedMs = SHIFT_MS + overtimeMinutes * 60 * 1000;

      // 15-minute advance warning
      const warningThresholdMs = allowedMs - 15 * 60 * 1000;
      if (elapsedMs >= warningThresholdMs && elapsedMs < allowedMs && !shiftWarningGivenRef.current) {
        shiftWarningGivenRef.current = true;
        playTerminalBeep();
        toast.warning("15 minutes left in your shift", {
          description: "Wrap up, or request overtime if you need to keep going.",
          duration: 9000,
          action: { label: "Request overtime", onClick: () => openOvertime() },
        });
        void showBackgroundNotification({
          title: "15 minutes left in your shift ⏰",
          body: "Wrap up, or request overtime if you need to keep going.",
          tab: "time",
          urgent: true,
        });
        if (fb && uid) {
          void sendWebPushToWorkers(fb.db, {
            recipientUids: [uid],
            title: "15 minutes left in your shift ⏰",
            body: "Wrap up, or request overtime if you need to keep going.",
            tab: "time",
            urgent: true,
          });
        }
      }

      // 8-hour / allowed limit reached!
      if (elapsedMs >= allowedMs && !shiftCompletedModalOpen) {
        playTerminalBeep();
        setShiftCompletedModalOpen(true);
        setAutoLogoutSeconds(120);
        void showBackgroundNotification({
          title: "Shift Complete — Clock Out Required 🏁",
          body: "Your shift has reached the limit. Open MFT to clock out or request overtime.",
          tab: "time",
          urgent: true,
        });
        if (fb && uid) {
          void sendWebPushToWorkers(fb.db, {
            recipientUids: [uid],
            title: "Shift Complete — Clock Out Required 🏁",
            body: "Your shift has reached the limit. Open MFT to clock out or request overtime.",
            tab: "time",
            urgent: true,
          });
        }
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [uid, profile, shiftMode, overtimeMinutes, shiftCompletedModalOpen, isWorkerIdle]);

  /** Best-effort save when the tab is hidden or closed so hours aren't lost. */
  useEffect(() => {
    if (shiftMode !== "clocked-in") return;
    const flush = () => {
      const fb = getFirebase();
      const ws = sessionRef.current;
      if (fb && ws?.isActive && !loggingOutRef.current) {
        lastSyncRef.current = Date.now();
        syncWorkSession(fb.db, ws).catch(() => {});
      }
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", flush);
    };
  }, [shiftMode]);

  /** Auto clock-out countdown when the shift-complete modal is up and ignored. */
  useEffect(() => {
    if (!shiftCompletedModalOpen || showOvertimeForm) return;

    const timer = window.setInterval(() => {
      setAutoLogoutSeconds((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          void clockOut({ silent: true, reason: "Shift complete — clocked out automatically" });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [shiftCompletedModalOpen, showOvertimeForm, clockOut]);

  /** Escape closes the overtime dialogs. */
  useEffect(() => {
    if (!isProactiveOvertimeOpen && !showOvertimeForm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (isProactiveOvertimeOpen) setIsProactiveOvertimeOpen(false);
      else setShowOvertimeForm(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isProactiveOvertimeOpen, showOvertimeForm]);

  function openOvertime() {
    setOvertimeRequestedMins(60);
    setOvertimeReason("");
    setIsProactiveOvertimeOpen(true);
  }

  /** Service Worker notification click routing + clear app badge when foregrounded */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onSwMessage = (ev: MessageEvent) => {
      const data = ev.data;
      if (data && data.type === "MFT_NOTIFICATION_CLICK") {
        if (data.tab && TAB_IDS.includes(data.tab as Tab)) {
          setTab(data.tab as Tab);
        }
      }
    };
    const clearBadge = () => {
      if (document.visibilityState === "visible") {
        const nav = navigator as Navigator & { clearAppBadge?: () => Promise<void> };
        nav.clearAppBadge?.().catch(() => {});
      }
    };
    navigator.serviceWorker?.addEventListener("message", onSwMessage);
    document.addEventListener("visibilitychange", clearBadge);
    clearBadge();
    return () => {
      navigator.serviceWorker?.removeEventListener("message", onSwMessage);
      document.removeEventListener("visibilitychange", clearBadge);
    };
  }, [setTab]);

  /** Live HR alerts — toast when a new one arrives. */
  useEffect(() => {
    if (!uid) return;
    const fb = getFirebase();
    if (!fb) return;
    let first = true;
    let known = new Set<string>();
    const unsub = registerUnsub(
      subscribeAlertsForWorker(
        fb.db,
        uid,
        (rows) => {
          if (!first) {
            const fresh = rows.filter((r) => !known.has(r.id) && !r.isRead);
            if (fresh[0]) {
              playTerminalBeep();
              toast.info(fresh[0].title || "New HR notice", {
                description: fresh.length > 1 ? `+${fresh.length - 1} more` : fresh[0].message?.slice(0, 120),
                action: { label: "View", onClick: () => setTab("alerts") },
              });
              void showBackgroundNotification({
                title: fresh[0].title || "New HR notice",
                body: fresh[0].message?.slice(0, 140) || "You have a new notice from HR.",
                tab: "alerts",
                urgent: fresh[0].priority === "high" || fresh[0].type === "urgent" || fresh[0].type === "penalty",
              });
            }
          }
          known = new Set(rows.map((r) => r.id));
          first = false;
          setAlerts(rows);
          setAlertsLoading(false);
        },
        (e) => {
          console.warn("[alerts listener]", e.message);
          setAlertsLoading(false);
        },
      ),
    );
    return () => unsub();
  }, [uid, registerUnsub, setTab]);

  /** Live exception requests — toast when admin approves/rejects one. */
  useEffect(() => {
    if (!uid) return;
    const fb = getFirebase();
    if (!fb) return;
    let prev = new Map<string, string>();
    let first = true;
    const unsub = registerUnsub(
      subscribeWorkerExceptions(
        fb.db,
        uid,
        (rows) => {
          if (!first) {
            rows.forEach((r) => {
              const before = prev.get(r.id);
              const now = String(r.status || "pending");
              if (before && before !== now && (now === "approved" || now === "rejected")) {
                playTerminalBeep();
                const fn = now === "approved" ? toast.success : toast.error;
                const desc = r.adminResponse ? String(r.adminResponse) : `For ${String(r.exceptionDate ?? "today")}`;
                fn(`${exceptionLabel(r)} ${now}`, {
                  description: desc,
                  action: { label: "View", onClick: () => setTab("exceptions") },
                });
                void showBackgroundNotification({
                  title: `${exceptionLabel(r)} ${now}`,
                  body: desc,
                  tab: "exceptions",
                });
              }
            });
          }
          prev = new Map(rows.map((r) => [r.id, String(r.status || "pending")]));
          first = false;
          setExceptions(rows);
          setExceptionsLoading(false);
        },
        (e) => {
          console.warn("[exceptions listener]", e.message);
          setExceptionsLoading(false);
        },
      ),
    );
    return () => unsub();
  }, [uid, registerUnsub, setTab]);

  /** Real-time HR Settings & Company Holidays */
  useEffect(() => {
    const fb = getFirebase();
    if (!fb) return;
    const unsubSettings = registerUnsub(subscribeHrSettings(fb.db, setHrSettings));
    const unsubHolidays = registerUnsub(subscribeHolidays(fb.db, setHolidays));
    return () => {
      unsubSettings();
      unsubHolidays();
    };
  }, [registerUnsub]);

  /** Real-time Worker Payroll Adjustments (advances, allowances) */
  useEffect(() => {
    if (!uid) return;
    const fb = getFirebase();
    if (!fb) return;
    let first = true;
    let known = new Set<string>();
    const unsubAdj = registerUnsub(
      subscribeWorkerPayrollAdjustments(fb.db, uid, (rows) => {
        if (!first) {
          const fresh = rows.filter((r) => !known.has(r.id));
          if (fresh[0]) {
            playTerminalBeep();
            const label = fresh[0].type === "allowance" ? "New Allowance / Bonus Added 💰" : "Payroll Adjustment Recorded";
            const desc = `${fresh[0].reason || fresh[0].type}: ${fresh[0].amount} EGP`;
            toast.info(label, {
              description: desc,
              action: { label: "View", onClick: () => setTab("profile") },
            });
            void showBackgroundNotification({ title: label, body: desc, tab: "profile" });
          }
        }
        known = new Set(rows.map((r) => r.id));
        first = false;
        setAdjustments(rows);
      }),
    );
    return () => unsubAdj();
  }, [uid, registerUnsub, setTab]);

  /** Real-time Reimbursements Listener (notify when HR pre-approves, approves, or rejects a claim) */
  useEffect(() => {
    if (!uid) return;
    const fb = getFirebase();
    if (!fb) return;
    const q = query(collection(fb.db, "reimbursements"), where("workerId", "==", uid));
    let first = true;
    let prevStages = new Map<string, string>();
    const unsub = registerUnsub(
      onSnapshot(
        q,
        (snap) => {
          const nextStages = new Map<string, string>();
          snap.docs.forEach((d) => {
            const data = d.data();
            const stg = String(data.stage || "");
            nextStages.set(d.id, stg);
            if (!first) {
              const before = prevStages.get(d.id);
              if (before && before !== stg) {
                const titleText = String(data.purpose || data.title || "مأمورية / مصروفات");
                if (stg === "pending_invoice") {
                  playTerminalBeep();
                  toast.success("Purchase Pre-Approved ✓", {
                    description: `"${titleText}" was pre-approved! Upload the invoice when ready.`,
                    action: { label: "Open", onClick: () => setTab("expenses") },
                  });
                  void showBackgroundNotification({
                    title: "Purchase Pre-Approved ✓",
                    body: `"${titleText}" was pre-approved! Upload the invoice when ready.`,
                    tab: "expenses",
                  });
                } else if (stg === "approved") {
                  playTerminalBeep();
                  const isInstant = data.payoutMethod === "instant_transfer";
                  const msgTitle = isInstant
                    ? "تم اعتماد المأمورية وتحويلها فوراً ⚡"
                    : "تم اعتماد المأمورية (تنزل مع المرتب) 📅";
                  const msgBody = isInstant
                    ? `تم اعتماد "${titleText}" كتحويل فوري الآن (لن يُضاف على مرتب أول الشهر).`
                    : `تم اعتماد "${titleText}" وسينزل أول الشهر مع المرتب.`;
                  toast.success(msgTitle, {
                    description: msgBody,
                    action: { label: "عرض", onClick: () => setTab("expenses") },
                  });
                  void showBackgroundNotification({
                    title: msgTitle,
                    body: msgBody,
                    tab: "expenses",
                  });
                } else if (stg === "rejected") {
                  playTerminalBeep({ urgent: true });
                  toast.error("Reimbursement Rejected", {
                    description: `"${titleText}": ${String(data.adminNote || data.rejectionReason || "See details in Expenses tab.")}`,
                    action: { label: "Open", onClick: () => setTab("expenses") },
                  });
                  void showBackgroundNotification({
                    title: "Reimbursement Rejected",
                    body: `"${titleText}": ${String(data.adminNote || data.rejectionReason || "See details in Expenses tab.")}`,
                    tab: "expenses",
                    urgent: true,
                  });
                }
              }
            }
          });
          prevStages = nextStages;
          first = false;
        },
        () => {},
      ),
    );
    return () => unsub();
  }, [uid, registerUnsub, setTab]);

  /** HR-POL-2026: live permission ledger for the current payroll cycle. */
  useEffect(() => {
    if (!uid) return;
    const fb = getFirebase();
    if (!fb) return;
    const range = getPayrollCycleRange(new Date(), hrSettings.monthStartDay);
    const unsub = registerUnsub(
      subscribeCycleLedger(fb.db, uid, range.startYmd, range.endYmd, (rows) => {
        setLedger(rows);
        setLedgerLoaded(true);
      }),
    );
    return () => unsub();
  }, [uid, hrSettings.monthStartDay, registerUnsub]);

  /**
   * HR-POL-2026 late arrival prompt: once today's first clock-in is known and late,
   * open SmartLateClockInModal so the worker chooses whether to use a monthly
   * permission or accept the salary deduction.
   */
  const lateCheckedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!uid || !profile || !session || !ledgerLoaded || exceptionsLoading || !policyActive || policyOffDay) return;
    const date = localYmd(session.startTime);
    if (date !== localYmd() || lateCheckedRef.current === date) return;
    const storageKey = `mft_late_choice_${uid}_${date}`;
    if (
      sessionStorage.getItem(storageKey) ||
      effectiveLedger.some((e) => e.date === date && e.kind === "late" && e.status === "applied") ||
      exceptions.some(
        (x) =>
          (x.type === "advance_late" || x.type === "late") &&
          String(x.exceptionDate || "") === date &&
          x.status !== "rejected",
      )
    ) {
      lateCheckedRef.current = date;
      return;
    }
    const ev = evaluateClockIn(session.startTime, policyUsage, policyCfg);
    if (ev.status === "on-time") {
      lateCheckedRef.current = date;
      return;
    }
    lateCheckedRef.current = date;
    playTerminalBeep();
    setSmartLateIn({ clockIn: session.startTime, overwrite: false });
  }, [uid, profile, session, ledgerLoaded, exceptionsLoading, effectiveLedger, exceptions, policyUsage, policyActive, policyOffDay, policyCfg]);

  /** Real-time Tasks Listener for Notifications (matches both single-string and array assignedTo) */
  useEffect(() => {
    if (!uid) return;
    const fb = getFirebase();
    if (!fb) return;

    const q = collection(fb.db, "tasks");

    let isInitialRender = true;
    let prevStatus = new Map<string, string>();

    const isTaskAssignedToUid = (data: Record<string, unknown>): boolean => {
      const assignedTo = data.assignedTo;
      if (typeof assignedTo === "string" && assignedTo === uid) return true;
      if (Array.isArray(assignedTo) && assignedTo.includes(uid)) return true;
      if (Array.isArray(data.assignedWorkerIds) && data.assignedWorkerIds.includes(uid)) return true;
      if (data.workerId === uid) return true;
      return false;
    };

    const unsub = registerUnsub(onSnapshot(q, (snap) => {
      let pendingCount = 0;
      let completedCount = 0;
      let reviewCount = 0;
      const nextStatus = new Map<string, string>();
      const myDocs = snap.docs.filter((d) => isTaskAssignedToUid(d.data() as Record<string, unknown>));

      const activeRows: TaskRow[] = [];
      myDocs.forEach((d) => {
        const data = d.data();
        const s = String(data.status ?? "assigned");
        nextStatus.set(d.id, s);
        if (s === "assigned" || s === "in-progress") {
          pendingCount++;
          activeRows.push({
            id: d.id,
            title: String(data.title ?? "Untitled Task"),
            description: String(data.description ?? ""),
            status: s,
            priority: String(data.priority ?? "medium"),
            projectName: data.projectName ? String(data.projectName) : undefined,
          });
        }
        if (s === "pending-approval") {
          reviewCount++;
        }
        if (s === "completed") {
          completedCount++;
        }
      });
      setMyActiveTasks(activeRows);
      setSelectedShiftTaskIds((prev) => {
        if (prev.length > 0) return prev.filter((id) => activeRows.some((r) => r.id === id));
        const inProg = activeRows.filter((r) => r.status === "in-progress").map((r) => r.id);
        if (inProg.length > 0) return inProg;
        return activeRows.length === 1 ? [activeRows[0]!.id] : [];
      });

      if (!isInitialRender) {
        const added = myDocs.filter((d) => !prevStatus.has(d.id) && d.data().createdBy !== uid);
        const approved = myDocs.filter((d) => prevStatus.get(d.id) === "pending-approval" && nextStatus.get(d.id) === "completed");
        const sentBack = myDocs.filter(
          (d) => prevStatus.get(d.id) === "pending-approval" && ["assigned", "in-progress"].includes(nextStatus.get(d.id) ?? ""),
        );
        const open = { label: "Open", onClick: () => setTab("tasks") };
        if (added.length) {
          playTerminalBeep();
          const title = added.length > 1 ? `${added.length} new tasks assigned` : "New task assigned 📋";
          const desc = added.length === 1 ? String(added[0]!.data().title ?? "") : "Check your Tasks tab.";
          toast.info(title, {
            description: desc,
            action: open,
          });
          void showBackgroundNotification({ title, body: desc, tab: "tasks" });
        }
        approved.forEach((d) => {
          playTerminalBeep();
          const desc = String(d.data().title ?? "");
          toast.success("Task approved 🎉", { description: desc, action: open });
          void showBackgroundNotification({ title: "Task approved 🎉", body: desc, tab: "tasks" });
        });
        sentBack.forEach((d) => {
          playTerminalBeep({ urgent: true });
          const desc = `${String(d.data().title ?? "A task")} was sent back for revisions.`;
          toast.warning("Changes requested", {
            description: desc,
            action: open,
            duration: 8000,
          });
          void showBackgroundNotification({ title: "Changes requested", body: desc, tab: "tasks", urgent: true });
        });
      }

      prevStatus = nextStatus;
      isInitialRender = false;

      const totalCount = myDocs.length;
      setTaskStats({
        total: totalCount,
        completed: completedCount,
        pending: pendingCount,
        review: reviewCount,
        rate: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0,
      });
    }, (err) => {
      console.warn("[tasks listener]", err.message);
    }));

    return () => unsub();
  }, [uid, registerUnsub, setTab]);

  /** Real-time Chat Notifications Listener */
  useEffect(() => {
    if (!uid) return;
    const fb = getFirebase();
    if (!fb) return;

    let unsub: (() => void) | undefined;
    try {
      unsub = registerUnsub(subscribeChatNotifications(fb.db, uid, (notifs) => {
        setChatNotifications(notifs);
        if (seenChatNotifIds.current === null) {
          seenChatNotifIds.current = new Set(notifs.map((n) => n.id));
        } else {
          for (const n of notifs) {
            if (!seenChatNotifIds.current.has(n.id)) {
              seenChatNotifIds.current.add(n.id);
              playTerminalBeep();
              toast.info(`💬 Message from ${n.senderName}`, {
                description: `${n.taskTitle}: ${n.messagePreview}`,
                action: { label: "View", onClick: () => setTab("tasks") },
              });
              void showBackgroundNotification({
                title: `Message from ${n.senderName}`,
                body: `${n.taskTitle}: ${n.messagePreview}`,
                tab: "tasks",
                taskId: n.taskId,
              });
            }
          }
        }
        chatNotifCountRef.current = notifs.length;
      }));
    } catch (e) {
      console.warn("[chat notifs]", e);
    }

    return () => unsub?.();
  }, [uid, registerUnsub, setTab]);

  const handleNewAdminMessage = useCallback(() => {
    playTerminalBeep();
  }, []);

  async function saveSalary() {
    const fb = getFirebase();
    if (!fb || !uid) return;
    const n = parseFloat(salaryVal);
    if (!n || n < 0) {
      toast.warning("Please enter a valid salary.");
      return;
    }
    try {
      await updateDoc(doc(fb.db, "workers", uid), { expectedSalary: n });
      setProfile((p) => (p ? { ...p, expectedSalary: n } : p));
      setSalaryEdit(false);
      toast.success("Expected salary updated");
    } catch {
      toast.error("Could not update salary");
    }
  }

  async function onMarkRead(alertId: string) {
    const fb = getFirebase();
    if (!fb || !uid) return;
    // Optimistic: the live listener will confirm.
    setAlerts((list) => list.map((a) => (a.id === alertId ? { ...a, isRead: true } : a)));
    try {
      await markAlertRead(fb.db, alertId, uid);
    } catch {
      setAlerts((list) => list.map((a) => (a.id === alertId ? { ...a, isRead: false } : a)));
      toast.error("Couldn't mark alert as read");
    }
  }

  async function onMarkAllRead() {
    const fb = getFirebase();
    if (!fb || !uid) return;
    const ids = alerts.filter((a) => !a.isRead).map((a) => a.id);
    if (!ids.length) return;
    setMarkingAll(true);
    try {
      await markAlertsRead(fb.db, ids, uid);
      setAlerts((list) => list.map((a) => ({ ...a, isRead: true })));
      toast.success(`${ids.length} alert${ids.length === 1 ? "" : "s"} acknowledged`);
    } catch {
      toast.error("Couldn't update alerts");
    } finally {
      setMarkingAll(false);
    }
  }

  function toggleSound() {
    const next = !soundOn;
    setSoundEnabled(next);
    setSoundOn(next);
    if (next) playTerminalBeep({ force: true });
  }

  async function onExceptionSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Capture the form now: React clears e.currentTarget once the handler yields.
    const form = e.currentTarget;
    const fb = getFirebase();
    if (!fb || !uid || !profile) return;
    const fd = new FormData(form);
    const type = String(fd.get("exceptionType") ?? "");
    const isLeave = ["annual_leave", "unpaid_leave", "sick_leave", "emergency_leave"].includes(type);
    const lateRaw = fd.get("lateMinutes");
    const lateMinutes = lateRaw ? parseInt(String(lateRaw), 10) : null;
    const requestedAmountRaw = fd.get("requestedAmount");
    const requestedAmount = requestedAmountRaw ? parseFloat(String(requestedAmountRaw)) : null;
    const exceptionDate = String(fd.get("exceptionDate") ?? "");
    const endDateRaw = fd.get("endDate") ? String(fd.get("endDate")) : "";
    const endDate = isLeave ? (endDateRaw || exceptionDate) : null;
    const reason = String(fd.get("exceptionReason") ?? "").trim();
    const supportingEvidence = String(fd.get("supportingEvidence") ?? "").trim() || null;

    if (isLeave && endDate && endDate < exceptionDate) {
      toast.warning("تاريخ نهاية الإجازة لا يمكن أن يكون قبل تاريخ البداية (End Date must be on or after Start Date).");
      return;
    }

    const isPermissionReq = type === "advance_late" || type === "early_permission";
    let effectiveMinutes = lateMinutes;

    if (isPermissionReq) {
      const dailyCtx = getDailyPermissionCtx(exceptionDate, type);
      const permVerdict = validatePermissionRequest(
        lateMinutes ?? 0,
        policyRef.current.usage,
        policyRef.current.cfg,
        dailyCtx,
      );
      if (!permVerdict.ok) {
        toast.error("لا يمكن تقديم طلب الإذن الشهري", {
          description: permVerdict.reasonAr,
          duration: 9000,
        });
        return;
      }
      effectiveMinutes = permVerdict.chargedMinutes;
    } else if (type === "late" && (!lateMinutes || lateMinutes < 1 || lateMinutes > 180)) {
      toast.warning("يرجى إدخال دقائق التأخير بين 1 و 180 دقيقة (1–180 mins).");
      return;
    }
    if (type === "overtime" && (!lateMinutes || lateMinutes < 15 || lateMinutes > 360)) {
      toast.warning("For overtime request, enter minutes between 15 and 360.");
      return;
    }
    if (type === "advance_request") {
      if (!requestedAmount || requestedAmount <= 0) {
        toast.warning("يرجى إدخال قيمة صحيحة للسلفة المطلوبة.");
        return;
      }
      const range = getPayrollCycleRange(new Date(), hrSettings.monthStartDay);
      const curYm = localYmd().slice(0, 7);
      const approvedAdv = adjustments
        .filter((a) => a.type === "advance" && a.status !== "cancelled" && a.date >= range.startYmd && a.date <= range.endYmd)
        .reduce((acc, a) => acc + (Number(a.amount) || 0), 0);
      const pendingAdv = exceptions
        .filter((x) => {
          const d = String(x.exceptionDate || localYmd());
          return (
            x.type === "advance_request" &&
            (!x.status || x.status === "pending") &&
            ((d >= range.startYmd && d <= range.endYmd) || d.slice(0, 7) === curYm)
          );
        })
        .reduce((acc, x) => acc + (Number(x.requestedAmount) || 0), 0);
      const monthlySalary = Number(profile.expectedSalary) || 0;
      if (monthlySalary > 0 && approvedAdv + pendingAdv + requestedAmount > monthlySalary) {
        const rem = Math.max(0, monthlySalary - approvedAdv - pendingAdv);
        toast.error("لا يمكن إرسال طلب السلفة — يتجاوز المتبقي من الراتب", {
          description: `الراتب المسجل: ${monthlySalary} — السلف المسجلة/المعلقة: ${approvedAdv + pendingAdv} — المتاح للسحب: ${rem}.`,
          duration: 9000,
        });
        return;
      }
    }
    const leaveDaysRaw = fd.get("leaveDays");
    const wkndDays = hrSettings.weekendDays || [5, 6];
    const leaveRangeSummary = isLeave
      ? countWorkingLeaveDaysInRange(exceptionDate, endDate || exceptionDate, wkndDays, holidays)
      : null;
    const computedRangeDays = isLeave && leaveRangeSummary ? leaveRangeSummary.workingDays : 1;
    const parsedInputDays = leaveDaysRaw ? parseFloat(String(leaveDaysRaw)) : computedRangeDays;
    const leaveDaysVal =
      isLeave && leaveRangeSummary
        ? leaveRangeSummary.workingDays === 0
          ? 0
          : exceptionDate === (endDate || exceptionDate) && parsedInputDays === 0.5
            ? 0.5
            : Math.min(parsedInputDays > 0 ? parsedInputDays : computedRangeDays, leaveRangeSummary.workingDays)
        : parsedInputDays;
    if (isLeave) {
      if (leaveRangeSummary && leaveRangeSummary.workingDays === 0) {
        toast.warning("الأيام المختارة تقع بالكامل في عطلة نهاية الأسبوع الرسمية (الجمعة والسبت) أو إجازة رسمية ولا تُحتسب من الإجازات.");
        return;
      }
      if (!leaveDaysVal || leaveDaysVal < 0.5 || leaveDaysVal > 30) {
        toast.warning("يرجى تحديد عدد أيام الإجازة بشكل صحيح (من نصف يوم إلى 30 يومًا).");
        return;
      }
    }
    if (type === "annual_leave" || type === "emergency_leave") {
      // HR-POL-2026: no paid annual/emergency leave during probation or when balance is 0, no negative balance, 0.5-day steps.
      const hire = profile.hireDate || (profile.createdAt?.toDate ? localYmd(profile.createdAt.toDate()) : localYmd());
      const booked = exceptions
        .filter(
          (x) =>
            (x.type === "annual_leave" || x.type === "emergency_leave") &&
            (!x.status || x.status === "pending" || x.status === "approved"),
        )
        .map((x) => ({
          date: String(x.exceptionDate ?? ""),
          days: effectiveLeaveDaysForRequest(
            {
              exceptionDate: x.exceptionDate ? String(x.exceptionDate) : undefined,
              endDate: x.endDate ? String(x.endDate) : null,
              leaveDays: x.leaveDays != null ? Number(x.leaveDays) : null,
            },
            wkndDays,
            holidays,
          ),
        }))
        .filter((b) => b.days > 0);
      const acc = computeLeaveAccrual(
        hire,
        new Date(),
        {
          leaveLawType: profile.leaveLawType,
          usedLeave: booked,
          carriedOverApproved: Number(profile.carriedOverLeaveDays) || 0,
          priorUsedLeaveDays: Number(profile.priorUsedLeaveDays) || 0,
          priorUsedAsOf: priorUsedRecordedOn(profile, hrSettings),
        },
        policyRef.current.cfg,
      );
      const verdict = validateLeaveRequest(acc, leaveDaysVal || 0);
      if (acc.requestableDays <= 0 || !verdict.ok) {
        toast.error("لا يمكن إرسال طلب الإجازة المدفوعة من الرصيد السنوي", {
          description: `${!verdict.ok ? verdict.reasonAr : "رصيدك المتاح حالياً هو (٠ يوم)."} — يمكنك اختيار «إجازة بدون مرتب (Unpaid Leave)».`,
          duration: 9000,
        });
        return;
      }
    }
    if (!reason) {
      toast.warning("Please add a short reason so HR can review it.");
      return;
    }

    const dateRangeLabel =
      isLeave && endDate && endDate !== exceptionDate ? `من ${exceptionDate} إلى ${endDate}` : `ليوم ${exceptionDate}`;

    setExceptionSubmitting(true);
    try {
      await submitException(fb.db, {
        workerId: uid,
        workerName: `${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim() || (profile.email ?? "Worker"),
        workerEmail: profile.email ?? "",
        type,
        lateMinutes: effectiveMinutes,
        exceptionDate,
        endDate,
        reason:
          type === "advance_request"
            ? `[Salary Advance $${requestedAmount}]: ${reason}`
            : type === "advance_late"
              ? `[طلب إذن تأخير شهري ليوم ${exceptionDate} (${effectiveMinutes} دقيقة من الرصيد - بانتظار موافقة الأدمن)]: ${reason}`
              : type === "early_permission"
                ? `[طلب إذن انصراف مبكر شهري ليوم ${exceptionDate} (${effectiveMinutes} دقيقة من الرصيد - بانتظار موافقة الأدمن)]: ${reason}`
                : type === "unpaid_leave"
                  ? `[إجازة بدون مرتب ${dateRangeLabel} (${leaveDaysVal || 1} يوم)]: ${reason}`
                  : isLeave
                    ? `[إجازة ${dateRangeLabel} (${leaveDaysVal || 1} يوم)]: ${reason}`
                    : reason,
        supportingEvidence,
        requestedAmount: type === "advance_request" ? requestedAmount : null,
        leaveDays: isLeave ? leaveDaysVal || 1 : null,
      });

      const extendsToday = type === "overtime" && !!effectiveMinutes && exceptionDate === localYmd();
      if (extendsToday && effectiveMinutes) {
        const newOt = overtimeMinutes + effectiveMinutes;
        setOvertimeMinutes(newOt);
        sessionStorage.setItem("workerOvertimeMinutes", String(newOt));
        shiftWarningGivenRef.current = false;
      }

      form.reset();
      setExceptionType("late");
      setAdvanceAmount(500);
      setLeaveDays(1);
      setLeaveStartDate(localYmd());
      setLeaveEndDate(localYmd());
      setLateMinsInput(30);
      const dateEl = form.elements.namedItem("exceptionDate") as HTMLInputElement | null;
      if (dateEl) dateEl.value = localYmd();
      toast.success(
        type === "overtime"
          ? "Overtime requested"
          : type === "advance_request"
          ? "Advance request sent"
          : type === "advance_late"
          ? "تم إرسال طلب إذن التأخير وتم حجزه في رصيد الأذونات ⏳"
          : type === "early_permission"
          ? "تم إرسال طلب إذن الانصراف المبكر وتم حجزه في رصيد الأذونات ⏳"
          : type === "unpaid_leave"
          ? "تم إرسال طلب الإجازة بدون مرتب ✓"
          : "Request sent to HR",
        {
          description: isPermissionReq
            ? `تم تسجيل وحجز إذن مدته ${effectiveMinutes} دقيقة ليوم ${exceptionDate} من رصيد أذوناتك الشهري (بانتظار اعتماد الأدمن).`
            : extendsToday
              ? `Today's shift extended by ${effectiveMinutes} minutes. You'll be notified when it's reviewed.`
              : "You'll get a notification here as soon as it's reviewed.",
        },
      );
    } catch {
      toast.error("Couldn't submit your request", { description: "Check your connection and try again." });
    } finally {
      setExceptionSubmitting(false);
    }
  }

  if (!isFirebaseConfigured()) {
    return (
      <div className="p-6">
        <FirebaseSetupWarning />
      </div>
    );
  }

  if (authLoading || !uid || !profile) {
    return <DashboardSkeleton />;
  }

  const firebaseClient = getFirebase();
  if (!firebaseClient) {
    return <DashboardSkeleton />;
  }

  const onShift = shiftMode === "clocked-in" && !!session?.isActive;
  const durationMs = workedMs(session);
  const allowedMs = (hrSettings.standardHours || 8) * 60 * 60 * 1000 + overtimeMinutes * 60 * 1000;
  const shiftPct = Math.min(100, Math.round((durationMs / allowedMs) * 100));
  const remainingMs = Math.max(0, allowedMs - durationMs);
  const firstClockIn = session?.startTime ?? null;

  // Real-time HR settings & policy evaluation
  const todayYmd = localYmd();
  const todayHoliday = isDateHoliday(todayYmd, holidays);
  const isTodayWeekend = (hrSettings.weekendDays || [5, 6]).includes(new Date().getDay());
  const latenessInfo = firstClockIn
    ? evaluateWorkerLateness(firstClockIn, hrSettings)
    : {
        isLate: false,
        lateMinutes: 0,
        graceEndTimeStr: formatTimeAmPm(hrSettings.shiftStartTime),
        shiftStartTimeStr: formatTimeAmPm(hrSettings.shiftStartTime),
      };
  const isLate = latenessInfo.isLate;
  const cycleRange = getPayrollCycleRange(new Date(), hrSettings.monthStartDay);

  const cycleAdjustments = adjustments.filter(
    (a) => a.date >= cycleRange.startYmd && a.date <= cycleRange.endYmd,
  );
  const cycleAdvances = cycleAdjustments
    .filter((a) => a.type === "advance" && a.status !== "cancelled")
    .reduce((acc, a) => acc + (Number(a.amount) || 0), 0);
  const pendingCycleAdvances = exceptions
    .filter((x) => {
      const d = String(x.exceptionDate || todayYmd);
      return (
        x.type === "advance_request" &&
        (!x.status || x.status === "pending") &&
        ((d >= cycleRange.startYmd && d <= cycleRange.endYmd) || d.slice(0, 7) === todayYmd.slice(0, 7))
      );
    })
    .reduce((acc, x) => acc + (Number(x.requestedAmount) || 0), 0);
  const cycleAllowances = cycleAdjustments
    .filter((a) => a.type === "allowance" && a.status !== "cancelled")
    .reduce((acc, a) => acc + (Number(a.amount) || 0), 0);
  const approvedCycleOtMins = exceptions
    .filter((x) => {
      const d = String(x.exceptionDate || todayYmd);
      return (
        x.type === "overtime" &&
        x.status === "approved" &&
        ((d >= cycleRange.startYmd && d <= cycleRange.endYmd) || d.slice(0, 7) === todayYmd.slice(0, 7))
      );
    })
    .reduce((acc, x) => acc + (Number(x.lateMinutes) || 0), 0);
  const pendingCycleOtMins = exceptions
    .filter((x) => {
      const d = String(x.exceptionDate || todayYmd);
      return (
        x.type === "overtime" &&
        (!x.status || x.status === "pending") &&
        ((d >= cycleRange.startYmd && d <= cycleRange.endYmd) || d.slice(0, 7) === todayYmd.slice(0, 7))
      );
    })
    .reduce((acc, x) => acc + (Number(x.lateMinutes) || 0), 0);

  // HR-POL-2026 derived values (Time tab card & Exceptions tab)
  const todayRequiredEnd = firstClockIn && localYmd(firstClockIn) === todayYmd ? requiredShiftEnd(firstClockIn, policyCfg) : null;
  const hireFromProfile = profile.hireDate || null;
  const hireFallback = !hireFromProfile && profile.createdAt?.toDate ? localYmd(profile.createdAt.toDate()) : null;
  const bookedLeave = exceptions
    .filter(
      (x) =>
        (x.type === "annual_leave" || x.type === "emergency_leave") &&
        (!x.status || x.status === "pending" || x.status === "approved"),
    )
    .map((x) => ({
      date: String(x.exceptionDate ?? ""),
      days: effectiveLeaveDaysForRequest(
        {
          exceptionDate: x.exceptionDate ? String(x.exceptionDate) : undefined,
          endDate: x.endDate ? String(x.endDate) : null,
          leaveDays: x.leaveDays != null ? Number(x.leaveDays) : null,
        },
        hrSettings.weekendDays || [5, 6],
        holidays,
      ),
    }))
    .filter((b) => b.days > 0);
  const effectiveHire = hireFromProfile ?? hireFallback ?? todayYmd;
  const leaveAccrual = computeLeaveAccrual(
    effectiveHire,
    new Date(),
    {
      leaveLawType: profile.leaveLawType,
      usedLeave: bookedLeave,
      carriedOverApproved: Number(profile.carriedOverLeaveDays) || 0,
      priorUsedLeaveDays: Number(profile.priorUsedLeaveDays) || 0,
      priorUsedAsOf: priorUsedRecordedOn(profile, hrSettings),
    },
    policyCfg,
  );
  const todayLateEntry = effectiveLedger.find((e) => e.date === todayYmd && e.kind === "late" && e.status === "applied") ?? null;
  const usageBeforeTodayLate = usageFromLedger(
    effectiveLedger.filter((e) => !(e.date === todayYmd && e.kind === "late")),
  );

  const firstName = profile.firstName || "there";

  const unreadAlerts = alerts.filter((a) => !a.isRead).length;
  const unreadChatMessages = chatNotifications.length;
  const pendingRequests = exceptions.filter((x) => !x.status || x.status === "pending").length;

  return (
    <div className="min-h-[100dvh] pb-24 lg:pb-12 bg-[var(--mft-bg)]">
      {/* ── Top Header Bar ── */}
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/95 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/95">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          {/* Logo & Identity */}
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-600 font-bold text-white shadow-md shadow-red-900/30">
              M
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-zinc-900 dark:text-white">MFT Monkeys</span>
                <span className="hidden sm:inline-block rounded-md border border-zinc-200 bg-zinc-100 px-1.5 py-0.2 text-[10px] font-semibold text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {profile.department || "Operations"}
                </span>
                {todayHoliday && (
                  <span className="hidden md:inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 animate-pulse">
                    🎉 Holiday: {todayHoliday.name}
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-500 font-medium">
                {profile.firstName ? `${profile.firstName} ${profile.lastName ?? ""}` : profile.email}
              </p>
            </div>
          </div>

          {/* Center: Work Session or Browse Mode Pill */}
          {onShift ? (
            <div className="hidden md:flex items-center gap-2">
              <button
                type="button"
                onClick={() => setTab("time")}
                title="Open work session"
                className="flex items-center gap-3 rounded-full border border-emerald-200 bg-emerald-50/80 py-1.5 pl-3.5 pr-4 transition-colors hover:bg-emerald-100/80 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:hover:bg-emerald-950/70 cursor-pointer"
              >
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                </span>
                <span className="text-xs font-semibold text-emerald-900 dark:text-emerald-200">
                  On shift ·{" "}
                  <span className="font-mono tabular-nums font-bold text-emerald-700 dark:text-emerald-300">{formatSessionDuration(durationMs)}</span>
                </span>
                <span className="h-1.5 w-16 overflow-hidden rounded-full bg-emerald-200/70 dark:bg-emerald-900/60" aria-hidden>
                  <span className="block h-full rounded-full bg-emerald-500 transition-all duration-700" style={{ width: `${shiftPct}%` }} />
                </span>
              </button>
            </div>
          ) : (
            <div className="hidden md:flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50/90 py-1 pl-3 pr-1 dark:border-amber-900/60 dark:bg-amber-950/40">
              <span className="inline-flex h-2 w-2 rounded-full bg-amber-500" />
              <span className="text-xs font-medium text-amber-800 dark:text-amber-200">
                Not clocked in{durationMs > 60_000 ? ` · ${formatHM(durationMs)} today` : ""}
              </span>
              <button
                type="button"
                onClick={() => setShowShiftChoiceModal(true)}
                disabled={shiftBusy}
                className="ml-1 inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1 text-[11px] font-bold text-white shadow-sm transition-colors hover:bg-emerald-500 disabled:opacity-60 cursor-pointer"
              >
                <Icon d={ICON.play} className="h-3.5 w-3.5" /> {shiftBusy ? "Starting…" : "Clock in"}
              </button>
            </div>
          )}

          {/* Right actions */}
          <div className="flex items-center gap-1.5">
            {/* Quick Clock In on mobile when not on shift */}
            {!onShift && (
              <button
                type="button"
                onClick={() => setShowShiftChoiceModal(true)}
                disabled={shiftBusy}
                className="md:hidden inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-500 disabled:opacity-60 transition-colors cursor-pointer"
              >
                <Icon d={ICON.play} className="h-3.5 w-3.5" /> Clock in
              </button>
            )}
            {onShift && (
              <button
                type="button"
                onClick={() => setTab("time")}
                className="md:hidden inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 font-mono text-xs font-bold tabular-nums text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300 cursor-pointer"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {formatHM(durationMs)}
              </button>
            )}

            {/* Theme switcher */}
            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white transition-colors cursor-pointer"
              title={`Switch to ${isDark ? "light" : "dark"} mode`}
              aria-label="Toggle theme"
            >
              <Icon d={isDark ? ICON.sun : ICON.moon} />
            </button>

            {/* Home link */}
            {MARKETING && (
              <Link
                href={MARKETING}
                className="hidden sm:inline-flex rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors"
              >
                Website
              </Link>
            )}

            {/* Sign Out */}
            <button
              type="button"
              onClick={() => void handleLogout()}
              title="Sign out"
              aria-label="Sign out"
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white p-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 hover:text-red-600 sm:px-3 sm:py-1.5 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 dark:hover:text-red-400 transition-colors cursor-pointer"
            >
              <Icon d={ICON.logout} className="h-4 w-4 sm:hidden" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>

        {/* ── Sub Navigation Tabs ── */}
        <nav
          className="mx-auto hidden max-w-6xl gap-1 px-4 sm:px-6 lg:flex overflow-x-auto"
          aria-label="Dashboard sections"
        >
          {TABS.map((t) => {
            const isActive = tab === t.id;
            const count =
              t.id === "alerts" ? unreadAlerts : t.id === "tasks" ? taskStats.pending : t.id === "exceptions" ? pendingRequests : 0;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={isActive ? "page" : undefined}
                className={`relative flex items-center gap-2 px-4 py-3 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  isActive
                    ? "text-red-600"
                    : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                }`}
              >
                <Icon d={t.icon} />
                <span>{t.label}</span>
                {t.id === "time" && onShift && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title="On shift" />}
                {count > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-px text-[10px] font-bold ${
                      t.id === "alerts" ? "bg-red-600 text-white" : "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
                    }`}
                  >
                    {count}
                  </span>
                )}
                {t.id === "tasks" && unreadChatMessages > 0 && (
                  <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" title={`${unreadChatMessages} unread messages`} />
                )}
                {isActive && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-red-600 rounded-full" />
                )}
              </button>
            );
          })}
        </nav>
      </header>

      {/* Offline banner */}
      {!online && (
        <div className="sticky top-[57px] z-20 border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/60 dark:text-amber-200 animate-fade-in" role="status">
          <span className="inline-flex items-center gap-2">
            <Icon d={ICON.wifiOff} className="h-4 w-4" />
            You&apos;re offline. Your shift timer keeps running and will sync when you reconnect.
          </span>
        </div>
      )}
      {/* Account Pending Notice */}
      {profile.status === "pending" && (
        <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6">
          <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
            <Icon d={ICON.time} className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Your account is awaiting approval</p>
              <p className="mt-0.5 text-xs leading-relaxed opacity-90">
                An administrator is reviewing your registration. You can look around, but some task actions are limited until you&apos;re approved.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Main Content Area ── */}
      <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
        <PwaPushBanner db={firebaseClient.db} uid={uid} workerName={firstName} />

        {/* ── Prominent HR Broadcast / Unread Alert Banner (Appears across all tabs until read) ── */}
        {unreadAlerts > 0 && tab !== "alerts" && (
          <div
            dir="rtl"
            className="rounded-2xl border-2 border-red-600 bg-gradient-to-br from-red-50 via-white to-amber-50/60 dark:from-red-950/60 dark:via-zinc-900 dark:to-zinc-900 p-4 sm:p-5 shadow-lg animate-fade-in space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-red-200 dark:border-red-900/60 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-red-600 text-white text-base shadow-sm">
                  📢
                </span>
                <div>
                  <h2 className="text-sm sm:text-base font-extrabold text-red-700 dark:text-red-300 flex items-center gap-2">
                    <span>رسالة / تنبيه هام من إدارة الموارد البشرية (HR Alert)</span>
                    <span className="inline-flex items-center rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white">
                      {unreadAlerts} غير مقروء
                    </span>
                  </h2>
                  <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
                    يرجى قراءة الرسالة والضغط على &quot;تم الاطلاع&quot; لإخفائها من الشاشة الرئيسية
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {unreadAlerts > 1 && (
                  <button
                    type="button"
                    onClick={() => void onMarkAllRead()}
                    disabled={markingAll}
                    className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50 dark:border-red-800 dark:bg-zinc-800 dark:text-red-300 cursor-pointer"
                  >
                    ✓ تأكيد قراءة الكل ({unreadAlerts})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setTab("alerts")}
                  className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 cursor-pointer"
                >
                  فتح سجل التنبيهات
                </button>
              </div>
            </div>

            <div className="space-y-2.5">
              {alerts
                .filter((a) => !a.isRead)
                .slice(0, 3)
                .map((a) => {
                  const date = a.sentAt?.toDate?.() ?? a.createdAt?.toDate?.() ?? null;
                  const isBroadcast = a.recipient === "all" || !a.workerId;
                  return (
                    <div
                      key={a.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-red-200/80 dark:border-red-900/50 bg-white/90 dark:bg-zinc-900/90 p-3.5 shadow-xs"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center rounded-md bg-red-100 dark:bg-red-950/70 px-2 py-0.5 text-[10px] font-bold text-red-700 dark:text-red-300">
                            {isBroadcast ? "🌐 تعميم للجميع" : "👤 تنبيه خاص"}
                          </span>
                          {(a.priority === "high" || a.type === "urgent_directive") && (
                            <span className="inline-flex items-center rounded-md bg-amber-100 dark:bg-amber-950/70 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:text-amber-300">
                              ⚡ عاجل وهام
                            </span>
                          )}
                          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                            {a.title || "رسالة من الإدارة"}
                          </h3>
                        </div>
                        <p className="text-xs sm:text-sm leading-relaxed text-zinc-700 dark:text-zinc-200 whitespace-pre-line">
                          {a.message}
                        </p>
                        <p className="text-[11px] text-zinc-400">
                          {date ? date.toLocaleString() : "الآن"}
                          {a.sentBy ? ` · بواسطة ${a.sentBy}` : ""}
                        </p>
                      </div>
                      <div className="shrink-0 flex items-center gap-2 self-end sm:self-center">
                        <button
                          type="button"
                          onClick={() => void onMarkRead(a.id)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 hover:bg-red-500 px-3.5 py-2 text-xs font-bold text-white shadow-xs transition cursor-pointer"
                        >
                          <span>✓ تم الاطلاع</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* TAB: TASKS (home) */}
        {tab === "tasks" && (
          <section aria-labelledby="tasks-heading" className="space-y-6">
            {/* Today summary */}
            <div className="relative overflow-hidden rounded-2xl border border-zinc-200 bg-gradient-to-br from-zinc-900 via-zinc-900 to-red-950 p-5 text-white sm:p-6 dark:border-zinc-800 animate-fade-in" style={{ boxShadow: "var(--mft-shadow-lg)" }}>
              <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-red-600/30 blur-3xl" />
              <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-zinc-400">
                    {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
                  </p>
                  <h1 id="tasks-heading" className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
                    {greetingFor()}, {firstName}
                  </h1>
                  <p className="mt-1 text-sm text-zinc-300">
                    {taskStats.pending > 0
                      ? <>You have <span className="font-semibold text-white">{taskStats.pending} open task{taskStats.pending === 1 ? "" : "s"}</span>{taskStats.review > 0 ? <> and {taskStats.review} waiting for review</> : null}.</>
                      : taskStats.review > 0
                        ? <>{taskStats.review} task{taskStats.review === 1 ? " is" : "s are"} waiting for admin review.</>
                        : <>You&apos;re all caught up — no open tasks right now.</>}
                  </p>
                </div>

                {/* Shift card */}
                <div className="flex shrink-0 items-center gap-4 rounded-xl bg-white/5 p-3 pr-4 ring-1 ring-white/10 backdrop-blur">
                  <div className="relative h-14 w-14 shrink-0">
                    <svg viewBox="0 0 36 36" className="h-14 w-14 -rotate-90" aria-hidden>
                      <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
                      <circle
                        cx="18" cy="18" r="15.5" fill="none"
                        stroke={onShift ? "#10b981" : "#f59e0b"} strokeWidth="3" strokeLinecap="round"
                        strokeDasharray={`${(shiftPct / 100) * 97.4} 97.4`}
                        className="transition-all duration-700"
                      />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold tabular-nums">{shiftPct}%</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-zinc-400">{onShift ? "On shift" : "Not clocked in"}</p>
                    <p className="font-mono text-lg font-bold tabular-nums leading-tight">{formatHM(durationMs)}</p>
                    <p className="text-[11px] text-zinc-400">{onShift ? `${formatHM(remainingMs)} left` : "logged today"}</p>
                  </div>
                  {onShift ? (
                    <button
                      type="button"
                      onClick={() => void clockOut()}
                      disabled={shiftBusy}
                      className="ml-1 inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold ring-1 ring-white/15 transition-colors hover:bg-white/20 disabled:opacity-60 cursor-pointer"
                    >
                      <Icon d={ICON.stop} /> Clock out
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void startActiveShift()}
                      disabled={shiftBusy}
                      className="ml-1 inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-white shadow-lg shadow-emerald-900/40 transition-colors hover:bg-emerald-400 disabled:opacity-60 cursor-pointer"
                    >
                      <Icon d={ICON.play} /> {shiftBusy ? "Starting…" : "Clock in"}
                    </button>
                  )}
                </div>
              </div>

              {/* Quick stats */}
              <div className="relative mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {([
                  { label: "Open tasks", value: taskStats.pending, onClick: undefined, hint: "To do & in progress" },
                  { label: "Completion", value: `${taskStats.rate}%`, onClick: undefined, hint: `${taskStats.completed} of ${taskStats.total} done` },
                  { label: "Unread alerts", value: unreadAlerts, onClick: () => setTab("alerts"), hint: unreadAlerts ? "Tap to review" : "All caught up", alert: unreadAlerts > 0 },
                  { label: "Pending requests", value: pendingRequests, onClick: () => setTab("exceptions"), hint: pendingRequests ? "Awaiting HR" : "None pending" },
                ] as { label: string; value: string | number; onClick?: () => void; hint: string; alert?: boolean }[]).map((s) => {
                  const inner = (
                    <>
                      <p className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                        {s.label}
                        {s.alert && <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />}
                      </p>
                      <p className="text-xl font-semibold tabular-nums">{s.value}</p>
                      <p className="truncate text-[10px] text-zinc-500">{s.hint}</p>
                    </>
                  );
                  return s.onClick ? (
                    <button key={s.label} type="button" onClick={s.onClick} className="rounded-xl bg-white/5 px-3.5 py-2.5 text-left ring-1 ring-white/10 transition-colors hover:bg-white/10 cursor-pointer">
                      {inner}
                    </button>
                  ) : (
                    <div key={s.label} className="rounded-xl bg-white/5 px-3.5 py-2.5 ring-1 ring-white/10">{inner}</div>
                  );
                })}
              </div>
            </div>

            {/* HR-POL-2026 Quick Access Bar (Permissions, Leave, Overtime & Expenses) */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setTab("time")}
                  className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 cursor-pointer"
                >
                  <span>⏱️</span>
                  <span>
                    الأذونات الشهرية:{" "}
                    <strong className="font-mono text-red-600 dark:text-red-400">
                      {Math.max(0, policyCfg.permissionMaxCount - policyUsage.count)}/{policyCfg.permissionMaxCount}
                    </strong>{" "}
                    ({Math.max(0, policyCfg.permissionMaxMinutes - policyUsage.minutes)}m left)
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setTab("time")}
                  className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 cursor-pointer"
                >
                  <span>🌴</span>
                  <span>
                    رصيد الإجازات السنوية:{" "}
                    <strong className="font-mono text-emerald-600 dark:text-emerald-400">
                      {leaveAccrual ? `${leaveAccrual.balance} يوم` : "عرض الرصيد"}
                    </strong>
                  </span>
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setExceptionType("advance_late");
                    setTab("exceptions");
                  }}
                  className="rounded-xl border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-800 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300 cursor-pointer"
                >
                  ⏰ إذن تأخير مسبق / Advance Late
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setExceptionType("unpaid_leave");
                    setTab("exceptions");
                  }}
                  className="rounded-xl border border-teal-300 bg-teal-50 px-3 py-1.5 text-xs font-bold text-teal-800 hover:bg-teal-100 dark:border-teal-800 dark:bg-teal-950/50 dark:text-teal-300 cursor-pointer"
                >
                  📅 إجازة بدون مرتب / Unpaid Leave
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setExceptionType("annual_leave");
                    setTab("exceptions");
                  }}
                  className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 cursor-pointer"
                >
                  🌴 طلب إجازة سنوية / Leave
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setExceptionType("overtime");
                    setTab("exceptions");
                  }}
                  className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300 cursor-pointer"
                >
                  🌙 طلب إضافي / Overtime
                </button>
                <button
                  type="button"
                  onClick={() => setOutsideLocationModalOpen(true)}
                  className="rounded-xl border border-purple-300 bg-purple-50 px-3 py-1.5 text-xs font-bold text-purple-800 hover:bg-purple-100 dark:border-purple-800 dark:bg-purple-950/50 dark:text-purple-300 cursor-pointer"
                >
                  🚗 مأمورية خارجية (بساعات وسكرين شوت)
                </button>
                <button
                  type="button"
                  onClick={() => setTab("expenses")}
                  className="rounded-xl border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-800 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300 cursor-pointer"
                >
                  🚕 مصروف أو مأمورية / Expense
                </button>
              </div>
            </div>

            <TasksPanel
              db={firebaseClient.db}
              uid={uid}
              workerName={`${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim() || uid}
              onNewAdminMessage={handleNewAdminMessage}
            />
          </section>
        )}

        {/* TAB: WORK SESSION / TIME */}
        {tab === "time" && (
          <section className="space-y-6 animate-fade-in" aria-labelledby="time-heading">
            {/* Holiday Protection Banner */}
            {todayHoliday && (
              <div className="rounded-2xl border-2 border-emerald-500 bg-gradient-to-r from-emerald-500/10 via-teal-500/10 to-amber-500/10 p-5 dark:border-emerald-500/40">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-md shadow-emerald-600/30">
                      <Icon d={ICON.sparkles} className="h-6 w-6" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                          Official Statutory Holiday
                        </span>
                        {todayHoliday.isPaid !== false && (
                          <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                            Paid Day Off 🏖️
                          </span>
                        )}
                      </div>
                      <h3 className="mt-1 text-base font-black text-zinc-900 dark:text-white">
                        🎉 {todayHoliday.name}
                      </h3>
                      <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-300">
                        Attendance penalty shield active today. Working is optional, and any clocked hours count as extra productivity!
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Weekend Rest Day Notice */}
            {!todayHoliday && isTodayWeekend && (
              <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 dark:border-blue-900/40 dark:bg-blue-950/20">
                <div className="flex items-center gap-3">
                  <span className="text-xl">☕</span>
                  <div>
                    <h4 className="text-xs font-bold text-blue-900 dark:text-blue-200">
                      Scheduled Weekend Rest Day ({new Date().toLocaleDateString("en-US", { weekday: "long" })})
                    </h4>
                    <p className="text-[11px] text-blue-700 dark:text-blue-300">
                      Today is an official weekly company rest day. Working today is optional.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {!onShift ? (
              <div className="ui-card p-8 text-center relative overflow-hidden">
                <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-amber-500/10 blur-3xl" />
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
                  <Icon d={ICON.time} className="h-7 w-7" />
                </div>
                <h2 id="time-heading" className="mt-4 text-xl font-bold text-zinc-900 dark:text-white">
                  {durationMs > 60_000 ? "You're on a break" : "You haven't clocked in yet"}
                </h2>
                <p className="mx-auto mt-2 max-w-md text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  {durationMs > 60_000
                    ? <>You&apos;ve logged <strong className="text-zinc-800 dark:text-zinc-200">{formatHM(durationMs)}</strong> today. Clock back in to continue — break time isn&apos;t counted.</>
                    : "You can browse tasks and notices freely. Clock in when you're ready to start your 8-hour shift."}
                </p>
                {durationMs > 0 && (
                  <div className="mx-auto mt-5 max-w-sm">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div className="h-full rounded-full bg-amber-500 transition-all duration-500" style={{ width: `${shiftPct}%` }} />
                    </div>
                    <p className="mt-1.5 text-[11px] font-medium text-zinc-500">{shiftPct}% of today&apos;s shift · {formatHM(remainingMs)} remaining</p>
                  </div>
                )}
                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setShowShiftChoiceModal(true)}
                    disabled={shiftBusy}
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-500 active:scale-95 disabled:opacity-60 transition-all cursor-pointer"
                  >
                    <Icon d={ICON.play} className="h-5 w-5" />
                    {shiftBusy ? "Starting…" : durationMs > 60_000 ? "Resume shift & select tasks" : "Clock in & select tasks"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="ui-card p-8 text-center relative overflow-hidden">
                <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl" />
                <p id="time-heading" className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /> On shift
                </p>
                <div className="mt-3 text-5xl font-black tracking-tight text-zinc-900 dark:text-white font-mono tabular-nums sm:text-6xl">
                  {formatSessionDuration(durationMs)}
                </div>

                {/* Progress toward 8 hours */}
                <div className="mx-auto mt-5 max-w-md">
                  <div className="flex items-center justify-between text-[11px] font-semibold text-zinc-500 mb-1.5">
                    <span>{shiftPct}% complete</span>
                    <span>{formatHM(remainingMs)} left{overtimeMinutes > 0 ? ` · incl. +${overtimeMinutes}m OT` : ""}</span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r transition-all duration-500 ${remainingMs < 15 * 60 * 1000 ? "from-amber-500 to-orange-500" : "from-emerald-500 to-teal-500"}`}
                      style={{ width: `${shiftPct}%` }}
                    />
                  </div>
                </div>

                {/* 2-Hour Check-In Cycle & 10-Minute Early Window Card */}
                {(() => {
                  const elapsedCheckIn = Math.max(0, Date.now() - lastCheckInTimeRef.current);
                  const msUntil2hEnd = Math.max(0, CHECKIN_CYCLE_MS - elapsedCheckIn);
                  const inEarly10mWindow = elapsedCheckIn >= CHECKIN_TRIGGER_MS;
                  return (
                    <div
                      dir="rtl"
                      className={`mx-auto mt-5 max-w-lg rounded-2xl border p-3.5 text-right transition-all ${
                        inEarly10mWindow
                          ? "border-red-500 bg-red-50/90 dark:border-red-700 dark:bg-red-950/40 animate-pulse"
                          : "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/50 dark:bg-emerald-950/20"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-extrabold text-zinc-900 dark:text-white">
                            {inEarly10mWindow
                              ? "🔔 حان موعد الشيك إن الدوري (آخر ١٠ دقائق في الساعتين)!"
                              : "⏱️ دورة تأكيد الحضور كل ساعتين (مهلة ١٠ دقائق في آخر الساعتين)"}
                          </div>
                          <div className="mt-0.5 text-[11px] text-zinc-600 dark:text-zinc-300">
                            المتبقي على نهاية الساعتين الحاليتين:{" "}
                            <b dir="ltr" className="font-mono text-emerald-700 dark:text-emerald-300">
                              {formatSessionDuration(msUntil2hEnd)}
                            </b>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const secs = Math.max(60, Math.min(CHECKIN_EARLY_WINDOW_SECONDS, Math.ceil(msUntil2hEnd / 1000)));
                            setCheckInSecondsRemaining(secs);
                            setCheckInModalOpen(true);
                          }}
                          className={`rounded-xl px-3.5 py-2 text-xs font-extrabold text-white shadow-sm transition cursor-pointer ${
                            inEarly10mWindow
                              ? "bg-red-600 hover:bg-red-700"
                              : "bg-emerald-600 hover:bg-emerald-700"
                          }`}
                        >
                          ✓ تأكيد الشيك إن لساعتين كمان
                        </button>
                      </div>
                    </div>
                  );
                })()}

                <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs">
                  <span className="inline-flex items-center rounded-full bg-zinc-100 px-3 py-1 font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    Started {firstClockIn ? firstClockIn.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-zinc-100 px-3 py-1 font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    Ends ~{new Date(Date.now() + remainingMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {overtimeMinutes > 0 && (
                    <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 font-bold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
                      +{overtimeMinutes}m overtime
                    </span>
                  )}
                </div>

                <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => void clockOut()}
                    disabled={shiftBusy}
                    className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 active:scale-95 disabled:opacity-60 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 transition-all cursor-pointer"
                  >
                    <Icon d={ICON.stop} /> Clock out
                  </button>
                  <button
                    type="button"
                    onClick={openOvertime}
                    className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-5 py-2.5 text-sm font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/60 transition-colors cursor-pointer"
                  >
                    <Icon d={ICON.bolt} /> Request overtime
                  </button>
                </div>
                <p className="mt-3 text-[11px] text-zinc-400">Clocking out keeps you signed in. You can clock back in after a break.</p>
              </div>
            )}

            {/* Policy, Cycle & Sync status */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {/* Attendance & Shift Policy */}
              <div className="ui-card p-5">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-bold text-zinc-900 dark:text-white">Attendance Policy</h3>
                  <span className="rounded bg-zinc-100 px-2 py-0.5 text-[10px] font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {hrSettings.standardHours}h Shift
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
                  Start: <strong className="text-zinc-700 dark:text-zinc-200">{formatTimeAmPm(hrSettings.shiftStartTime)}</strong> · Grace: <strong className="text-zinc-700 dark:text-zinc-200">{hrSettings.gracePeriodMinutes}m</strong> (until {latenessInfo.graceEndTimeStr}).
                </p>
                <div className="mt-4">
                  {!firstClockIn ? (
                    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300">
                      No check-in recorded yet today.
                    </div>
                  ) : isLate ? (
                    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>Checked in after {latenessInfo.graceEndTimeStr} (+{latenessInfo.lateMinutes}m late).</span>
                        {todayLateEntry && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              todayLateEntry.covered
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                                : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
                            }`}
                          >
                            {todayLateEntry.covered
                              ? `✓ مغطى بإذن (${todayLateEntry.chargedMinutes} د)`
                              : `💸 خصم من الراتب (${todayLateEntry.fallbackPenaltyDays || 0.25} يوم)`}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {policyActive && todayLateEntry?.source !== "admin" && (
                          <button
                            type="button"
                            onClick={() => setSmartLateIn({ clockIn: firstClockIn, overwrite: true })}
                            className="rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-amber-500 cursor-pointer"
                          >
                            🔄 {todayLateEntry ? "تغيير الاختيار (إذن / خصم)" : "اختيار: إذن أم خصم؟"}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setExceptionType("late");
                            setTab("exceptions");
                          }}
                          className="font-semibold underline underline-offset-2 cursor-pointer"
                        >
                          Submit excuse →
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                      On time today — checked in at {firstClockIn.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.
                    </div>
                  )}
                </div>
              </div>

              {/* Current Payroll Cycle */}
              <div className="ui-card p-5">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <Icon d={ICON.calendar} className="h-4 w-4 text-red-600 dark:text-red-400" />
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-white">Current Cycle</h3>
                  </div>
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    Cutoff: {hrSettings.monthStartDay === 1 ? "1st" : `${hrSettings.monthStartDay}th`}
                  </span>
                </div>
                <p className="mt-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  {cycleRange.label}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs border-t border-zinc-100 dark:border-zinc-800 pt-3">
                  <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-900/60">
                    <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Advances (سلف)</span>
                    <p className="mt-0.5 font-mono text-sm font-bold text-amber-700 dark:text-amber-400">
                      {cycleAdvances > 0 ? `$${cycleAdvances.toLocaleString()}` : "$0"}
                      {pendingCycleAdvances > 0 && (
                        <span className="block text-[10px] font-semibold text-amber-600">
                          +${pendingCycleAdvances.toLocaleString()} قيد المراجعة
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="rounded-lg bg-zinc-50 p-2 dark:bg-zinc-900/60">
                    <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Allowances (بدلات)</span>
                    <p className="mt-0.5 font-mono text-sm font-bold text-emerald-700 dark:text-emerald-400">
                      {cycleAllowances > 0 ? `+$${cycleAllowances.toLocaleString()}` : "$0"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Sync status */}
              <div className="ui-card p-5">
                <h3 className="text-sm font-bold text-zinc-900 dark:text-white">Sync status</h3>
                <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
                  Your hours save automatically every 15 seconds while you&apos;re on shift, and whenever you switch tabs.
                </p>
                <div className="mt-4 space-y-2 border-t border-zinc-100 pt-3 text-xs dark:border-zinc-800">
                  <div className="flex items-center justify-between text-zinc-500">
                    <span>Connection</span>
                    <span className={`inline-flex items-center gap-1.5 font-semibold ${online ? "text-emerald-600" : "text-amber-600"}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-emerald-500" : "bg-amber-500"}`} />
                      {online ? "Online" : "Offline — will retry"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-zinc-500">
                    <span>Last saved</span>
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">
                      {!onShift ? "Not on shift" : lastSyncAt ? lastSyncAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Saving…"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* HR-POL-2026 permissions & leave */}
            <PermissionLeaveCard
              cfg={policyCfg}
              policyActive={policyActive}
              effectiveFrom={hrSettings.policy2026EffectiveFrom ?? ""}
              usage={policyUsage}
              ledger={effectiveLedger}
              requiredEnd={todayRequiredEnd}
              now={new Date()}
              hireDate={hireFromProfile ?? hireFallback}
              hireDateIsFallback={!hireFromProfile && !!hireFallback}
              leaveLawType={profile.leaveLawType}
              usedLeave={bookedLeave}
              priorUsedLeaveDays={Number(profile.priorUsedLeaveDays) || 0}
              priorUsedAsOf={priorUsedRecordedOn(profile, hrSettings)}
              carriedOver={Number(profile.carriedOverLeaveDays) || 0}
              cycleLabel={cycleRange.label}
              onRequestLeave={() => {
                setExceptionType("annual_leave");
                setTab("exceptions");
              }}
              onRequestUnpaidLeave={() => {
                setExceptionType("unpaid_leave");
                setTab("exceptions");
              }}
              onRequestAdvanceLate={() => {
                setExceptionType("advance_late");
                setTab("exceptions");
              }}
              onRequestEarlyPermission={() => {
                setExceptionType("early_permission");
                setTab("exceptions");
              }}
              onRequestOvertime={() => {
                setExceptionType("overtime");
                setTab("exceptions");
              }}
              onOpenExpenses={() => setTab("expenses")}
            />
          </section>
        )}

        {/* TAB: HR ALERTS */}
        {tab === "alerts" && (
          <section className="space-y-4 animate-fade-in" aria-labelledby="alerts-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="alerts-heading" className="text-xl font-bold text-zinc-900 dark:text-white">HR Notifications &amp; Alerts</h2>
                <p className="text-xs text-zinc-500">Announcements, schedule notices, and penalty adjustments sent by admin. Updates appear live.</p>
              </div>
              {unreadAlerts > 0 && (
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700 dark:bg-red-950/60 dark:text-red-400">
                    {unreadAlerts} unread
                  </span>
                  <button
                    type="button"
                    onClick={() => void onMarkAllRead()}
                    disabled={markingAll}
                    className="brutal-btn-outline"
                  >
                    <Icon d={ICON.check} className="h-3.5 w-3.5" />
                    {markingAll ? "Updating…" : "Mark all as read"}
                  </button>
                </div>
              )}
            </div>

            {alertsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-24 rounded-xl mft-skeleton" />
                ))}
              </div>
            ) : alerts.length === 0 ? (
              <div className="ui-card flex flex-col items-center justify-center p-12 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-400 dark:bg-zinc-800">
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                </div>
                <h3 className="mt-3 text-sm font-semibold text-zinc-900 dark:text-white">No notifications</h3>
                <p className="mt-1 text-xs text-zinc-500">You are all caught up with administrative updates.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {alerts.map((a) => {
                  const b = alertBadgeClass(a.type);
                  return (
                    <div
                      key={a.id}
                      className={`ui-card p-5 transition-all ${
                        !a.isRead ? "ring-2 ring-red-500/20 bg-red-50/20 dark:bg-red-950/10" : ""
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${b.cls}`}>
                            {b.label}
                          </span>
                          {a.priority && (
                            <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">
                              · {a.priority}
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-zinc-400">
                          {alertRelativeTime(a.sentAt ?? a.createdAt)}
                        </span>
                      </div>

                      <h3 className="text-base font-bold text-zinc-900 dark:text-white">
                        {a.title || "HR Notice"}
                      </h3>
                      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap">
                        {a.message}
                      </p>

                      {a.hasPenalty && (
                        <div className="mt-3 inline-block rounded-md bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
                          {Number(a.penaltyApplied) > 0 ? `Deduction: -${a.penaltyApplied} day(s)` : `Bonus: +${Math.abs(Number(a.penaltyApplied))} day(s)`}
                        </div>
                      )}

                      <div className="mt-4 flex items-center justify-between border-t border-zinc-100 pt-3 dark:border-zinc-800 text-xs text-zinc-500">
                        <span>From: {String(a.sentBy || "HR Administration")}</span>
                        {!a.isRead && (
                          <button
                            type="button"
                            onClick={() => void onMarkRead(a.id)}
                            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 transition-colors cursor-pointer"
                          >
                            Mark as read
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* TAB: EXCEPTIONS */}
        {tab === "exceptions" && (
          <section className="space-y-6 animate-fade-in" aria-labelledby="ex-head">
            <div>
              <h2 id="ex-head" className="text-xl font-bold text-zinc-900 dark:text-white">Requests &amp; Permissions (الطلبات والأذونات)</h2>
              <p className="text-xs text-zinc-500">
                Submit advance late permissions for a specific day, unpaid leave, annual leave, overtime, or late arrival excuses.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Form */}
              <div className="ui-card p-6">
                {(() => {
                  const permRemTop = remainingQuota(policyUsage, policyCfg);
                  const hasPermBalance = permRemTop.count > 0 && permRemTop.minutes >= policyCfg.permissionMinMinutes;
                  return (
                    <div className="mb-4 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-bold text-zinc-900 dark:text-white">New request</h3>
                      </div>
                      <div dir="rtl" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div
                          className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs font-extrabold ${
                            hasPermBalance
                              ? "border-indigo-300 bg-indigo-50/80 text-indigo-950 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200"
                              : "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
                          }`}
                        >
                          <span>⏱️ رصيد الأذونات المتاح (تأخير/مبكر):</span>
                          <span className="rounded-lg bg-white px-2 py-0.5 font-mono text-xs font-black shadow-2xs dark:bg-zinc-900">
                            {toArabicDigits(permRemTop.count)}/{toArabicDigits(policyCfg.permissionMaxCount)} أذونات ·{" "}
                            {toArabicDigits(permRemTop.minutes)} د
                          </span>
                        </div>
                        <div
                          className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs font-extrabold ${
                            leaveAccrual.requestableDays > 0 && leaveAccrual.phase !== "probation"
                              ? "border-sky-300 bg-sky-50/80 text-sky-950 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200"
                              : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                          }`}
                        >
                          <span>🌴 رصيد الإجازات السنوية المتاح:</span>
                          <span className="rounded-lg bg-white px-2 py-0.5 font-mono text-xs font-black shadow-2xs dark:bg-zinc-900">
                            {toArabicDigits(leaveAccrual.requestableDays)} يوم ({leavePhaseLabelAr(leaveAccrual)})
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
                <form onSubmit={(e) => void onExceptionSubmit(e)} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5" htmlFor="exceptionType">
                      Request type *
                    </label>
                    <input type="hidden" id="exceptionType" name="exceptionType" value={exceptionType} />
                    {(() => {
                      const permRemBtn = remainingQuota(policyUsage, policyCfg);
                      return (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Request type">
                          {([
                            [
                              "advance_late",
                              `إذن تأخير شهري (${toArabicDigits(permRemBtn.count)} إذن / ${toArabicDigits(permRemBtn.minutes)} د)`,
                              ICON.time,
                            ],
                            [
                              "early_permission",
                              `إذن انصراف مبكر (${toArabicDigits(permRemBtn.count)} إذن / ${toArabicDigits(permRemBtn.minutes)} د)`,
                              ICON.time,
                            ],
                            ["unpaid_leave", "Unpaid Leave (إجازة بدون مرتب)", ICON.calendar],
                            ["late", "Late Excuse (استثناء تأخير)", ICON.time],
                            ["absent", "Absence Excuse (عذر غياب)", ICON.exceptions],
                            ["overtime", "Overtime (إضافي)", ICON.bolt],
                            [
                              "annual_leave",
                              `Annual Leave (إجازة سنوية — رصيدك: ${toArabicDigits(leaveAccrual.requestableDays)} يوم)`,
                              ICON.calendar,
                            ],
                            ["sick_leave", "Sick Leave (مرضية)", ICON.shield],
                            [
                              "emergency_leave",
                              `Emergency (إجازة عارضة — رصيدك: ${toArabicDigits(leaveAccrual.requestableDays)} يوم)`,
                              ICON.sparkles,
                            ],
                            ["advance_request", "Salary Advance (سلفة)", ICON.cash],
                          ] as const).map(([val, label, icon]) => (
                            <button
                              key={val}
                              type="button"
                              role="radio"
                              aria-checked={exceptionType === val}
                              onClick={() => {
                                setExceptionType(val);
                                if (["annual_leave", "unpaid_leave", "sick_leave", "emergency_leave"].includes(val)) {
                                  const wknd = hrSettings.weekendDays || [5, 6];
                                  const curSum = countWorkingLeaveDaysInRange(
                                    leaveStartDate,
                                    leaveEndDate || leaveStartDate,
                                    wknd,
                                    holidays,
                                  );
                                  if (curSum.workingDays === 0) {
                                    const nextWorkDay = addWorkingLeaveDaysYmd(leaveStartDate || localYmd(), 1, wknd, holidays);
                                    setLeaveStartDate(nextWorkDay);
                                    setLeaveEndDate(nextWorkDay);
                                    setLeaveDays(1);
                                  } else if (leaveEndDate > leaveStartDate) {
                                    setLeaveDays(curSum.workingDays);
                                  }
                                }
                              }}
                              className={`flex items-center gap-2 rounded-xl border p-2.5 text-xs font-semibold transition-all cursor-pointer ${
                                exceptionType === val
                                  ? "border-red-500 bg-red-50 text-red-700 ring-2 ring-red-500/15 dark:border-red-500 dark:bg-red-950/40 dark:text-red-300 font-bold"
                                  : "border-zinc-200 text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                              } ${val === "advance_request" ? "col-span-2 sm:col-span-3 border-amber-300 bg-amber-50/40 text-amber-900 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200" : ""}`}
                            >
                              <Icon d={icon} className="h-4 w-4 shrink-0" />
                              <span className="truncate">{label}</span>
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                  </div>

                  {(exceptionType === "advance_late" || exceptionType === "early_permission") && (() => {
                    const permRem = remainingQuota(policyUsage, policyCfg);
                    const dailyCtx = getDailyPermissionCtx(permTargetDate, exceptionType);
                    const permVerdict = validatePermissionRequest(lateMinsInput, policyUsage, policyCfg, dailyCtx);
                    const maxAllowedNow = Math.max(
                      1,
                      Math.min(
                        policyCfg.permissionMaxSingleMinutes,
                        permVerdict.remainingDailyMinutes || policyCfg.permissionMaxSingleMinutes,
                        permRem.minutes || policyCfg.permissionMaxSingleMinutes,
                      ),
                    );
                    const durationOptions: { mins: number; label: string }[] = [
                      { mins: 30, label: "30 د (نصف ساعة)" },
                      { mins: 45, label: "45 د" },
                      { mins: 60, label: "60 د (ساعة)" },
                      { mins: 75, label: "75 د (ساعة وربع)" },
                      { mins: 90, label: "90 د (ساعة ونصف)" },
                      { mins: 105, label: "105 د" },
                      { mins: 120, label: "120 د (ساعتان - الحد الأقصى)" },
                    ];
                    return (
                      <div dir="rtl" className="space-y-3 rounded-2xl border border-indigo-200 bg-indigo-50/50 p-4 dark:border-indigo-900/60 dark:bg-indigo-950/25">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-200/70 pb-2.5 dark:border-indigo-800/60">
                          <div>
                            <h4 className="text-xs font-extrabold text-indigo-950 dark:text-indigo-200">
                              ⏱️ {exceptionType === "advance_late" ? "طلب إذن تأخير من الرصيد الشهري" : "طلب إذن انصراف مبكر من الرصيد الشهري"}
                            </h4>
                            <p className="text-[11px] text-indigo-800/80 dark:text-indigo-300/80">
                              اختر مدة الإذن المطلوبة حسب رصيد أذوناتك المتاح (يتطلب موافقة الأدمن لاعتماده)
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            <div className="rounded-xl bg-white px-3 py-1.5 text-[11px] font-bold text-indigo-900 shadow-sm dark:bg-zinc-900 dark:text-indigo-200">
                              المتبقي شهرياً: {toArabicDigits(permRem.count)} من {toArabicDigits(policyCfg.permissionMaxCount)} أذونات ·{" "}
                              {toArabicDigits(permRem.minutes)} من {toArabicDigits(policyCfg.permissionMaxMinutes)} د
                            </div>
                            <div
                              className={`rounded-xl px-3 py-1.5 text-[11px] font-bold shadow-sm ${
                                permVerdict.remainingDailyMinutes > 0 && !dailyCtx.sameKindAlreadyBooked
                                  ? "bg-white text-emerald-900 dark:bg-zinc-900 dark:text-emerald-300"
                                  : "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300"
                              }`}
                            >
                              المتاح في يوم {permTargetDate}: {toArabicDigits(permVerdict.remainingDailyMinutes)} من {toArabicDigits(policyCfg.permissionMaxSingleMinutes)} د
                            </div>
                          </div>
                        </div>

                        {/* Policy Rules Box */}
                        <ul className="space-y-1 rounded-xl bg-white/80 p-3 text-[11px] leading-5 text-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300">
                          <li>• <b>أهلية التقديم:</b> الأذونات الشهرية متاحة لجميع الموظفين بشكل طبيعي بدءاً من الشهر الأول (بما في ذلك أول 6 أشهر).</li>
                          <li>• <b>الحد الأقصى الشهري:</b> 4 أذونات في الشهر فقط، بإجمالي لا يتجاوز 4 ساعات (240 دقيقة) شهرياً.</li>
                          <li>• <b>الحد الأقصى اليومي وللإذن الواحد:</b> الحد الأدنى للإذن الواحد 30 دقيقة، والحد الأقصى ساعتان (120 دقيقة) كإجمالي في اليوم الواحد.</li>
                          <li>• <b>احتساب تأخير البصمة (قاعدة الدقيقة الأولى):</b> أي تأخير ولو بدقيقة واحدة (مثل 11:01 بدلاً من 11:00) يُحتسب بحد أدنى نصف ساعة (30 دقيقة) وتُخصم من رصيد الساعات المتاح.</li>
                          <li>• <b>موافقة الإدارة:</b> يُحجز الإذن من رصيدك فور إرساله، ويُعتمد رسمياً بعد موافقة الأدمن (إذا رُفض يعود الرصيد تلقائياً).</li>
                        </ul>

                        {/* Duration Picker Based on Available Balance */}
                        <div>
                          <label className="block text-xs font-bold text-zinc-800 dark:text-zinc-200 mb-1.5" htmlFor="lateMinutes">
                            اختر مدة الإذن المطلوبة (أقصى متاح لليوم: {toArabicDigits(Math.min(permRem.minutes, permVerdict.remainingDailyMinutes))} دقيقة) *
                          </label>
                          <div className="flex flex-wrap gap-1.5">
                            {durationOptions.map((opt) => {
                              const allowed = permVerdict.allowedDurations.includes(opt.mins);
                              const active = lateMinsInput === opt.mins;
                              const overDaily = opt.mins > permVerdict.remainingDailyMinutes;
                              return (
                                <button
                                  key={opt.mins}
                                  type="button"
                                  onClick={() => setLateMinsInput(opt.mins)}
                                  className={`rounded-xl border px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                                    active
                                      ? allowed
                                        ? "border-indigo-600 bg-indigo-600 text-white shadow-sm"
                                        : "border-red-600 bg-red-600 text-white shadow-sm"
                                      : allowed
                                        ? "border-indigo-200 bg-white text-indigo-900 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-zinc-900 dark:text-indigo-200"
                                        : "border-red-200 bg-red-50/60 text-red-700 opacity-75 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
                                  }`}
                                >
                                  {opt.label}{" "}
                                  {!allowed
                                    ? dailyCtx.sameKindAlreadyBooked
                                      ? " (مسجل لهذا اليوم)"
                                      : overDaily
                                        ? " (يتجاوز ١٢٠ د باليوم)"
                                        : " (يتجاوز الرصيد)"
                                    : ""}
                                </button>
                              );
                            })}
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            <input
                              id="lateMinutes"
                              name="lateMinutes"
                              type="number"
                              min={1}
                              max={maxAllowedNow}
                              step={1}
                              value={lateMinsInput}
                              onChange={(e) => setLateMinsInput(Number(e.target.value) || 0)}
                              required
                              className="brutal-input bg-white dark:bg-zinc-900"
                            />
                            <span className="shrink-0 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                              دقيقة (يُحتسب: {toArabicDigits(permVerdict.chargedMinutes)} د)
                            </span>
                          </div>
                        </div>

                        {/* First-minute rule notice when input is 1..29 mins */}
                        {lateMinsInput > 0 && lateMinsInput < policyCfg.permissionMinMinutes && permVerdict.ok && (
                          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                            ℹ️ <b>تطبيق قاعدة الدقيقة الأولى:</b> المدة المدخلة ({toArabicDigits(lateMinsInput)} دقيقة) أقل من الحد الأدنى للإذن الواحد (30 دقيقة) — سيتم احتساب <b>{toArabicDigits(permVerdict.chargedMinutes)} دقيقة (نصف ساعة)</b> من رصيد الساعات المتاح عند موافقة الأدمن.
                          </div>
                        )}

                        {/* Explicit Reason Why Worker Cannot Take Permission */}
                        {!permVerdict.ok ? (
                          <div className="rounded-xl border border-red-300 bg-red-50 p-3.5 text-xs leading-6 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
                            <b className="block text-sm text-red-800 dark:text-red-300 mb-0.5">
                              ❌ سبب عدم إمكانية أخذ هذا الإذن:
                            </b>
                            <span>{permVerdict.reasonAr}</span>
                          </div>
                        ) : (
                          <div className="rounded-xl border border-emerald-300 bg-emerald-50/90 p-3 text-xs leading-5 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
                            ✓ <b>متاح للطلب ({toArabicDigits(permVerdict.chargedMinutes)} دقيقة):</b> سيتم إرسال الطلب للأدمن للموافقة وحجزه من رصيدك، ويتبقى لك في هذا اليوم{" "}
                            <b>{toArabicDigits(Math.max(0, permVerdict.remainingDailyMinutes - permVerdict.chargedMinutes))} دقيقة</b>، وفي الشهر{" "}
                            <b>{toArabicDigits(Math.max(0, permRem.count - 1))} أذونات</b> و{" "}
                            <b>{toArabicDigits(Math.max(0, permRem.minutes - permVerdict.chargedMinutes))} دقيقة</b>.
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {exceptionType === "late" && (
                    <div className="space-y-2.5">
                      <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1" htmlFor="lateMinutes">
                        Estimated Minutes Late (دقائق التأخير الفعلية 1–180) *
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {[15, 30, 60, 90, 120].map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setLateMinsInput(m)}
                            className={`rounded-lg border px-3 py-1 text-xs font-bold transition-all cursor-pointer ${
                              lateMinsInput === m
                                ? "border-red-600 bg-red-600 text-white"
                                : "border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                            }`}
                          >
                            {m} min ({m} د)
                          </button>
                        ))}
                      </div>
                      <input
                        id="lateMinutes"
                        name="lateMinutes"
                        type="number"
                        min={1}
                        max={180}
                        step={1}
                        value={lateMinsInput}
                        onChange={(e) => setLateMinsInput(Number(e.target.value) || 30)}
                        required
                        className="brutal-input"
                      />
                    </div>
                  )}

                  {exceptionType === "overtime" && (
                    <div className="space-y-2.5">
                      <div dir="rtl" className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-200">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-bold">🌙 رصيد العمل الإضافي المسجل في هذه الدورة:</span>
                          <span className="font-mono font-bold">
                            {toArabicDigits(approvedCycleOtMins)} د معتمد · {toArabicDigits(pendingCycleOtMins)} د قيد المراجعة
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] opacity-85">
                          يُحسب العمل الإضافي المعتمد بمعامل {toArabicDigits(policyCfg.dayOtMultiplier)}x نهاري و{toArabicDigits(policyCfg.nightOtMultiplier)}x ليلي ويُضاف تلقائياً للراتب.
                        </p>
                      </div>
                      <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1" htmlFor="lateMinutes">
                        Requested Overtime Minutes (15–360) *
                      </label>
                      <input
                        id="lateMinutes"
                        name="lateMinutes"
                        type="number"
                        min={15}
                        max={360}
                        step={15}
                        defaultValue={60}
                        required
                        className="brutal-input"
                      />
                    </div>
                  )}

                  {exceptionType === "advance_request" && (() => {
                    const monthlySalary = Number(profile.expectedSalary) || 0;
                    const totalBookedAdv = cycleAdvances + pendingCycleAdvances;
                    const remSalary = monthlySalary > 0 ? Math.max(0, monthlySalary - totalBookedAdv) : null;
                    const overSalary = remSalary !== null && advanceAmount > remSalary;
                    return (
                      <div className="rounded-xl border border-amber-300 bg-amber-50/70 p-4 dark:border-amber-900/60 dark:bg-amber-950/30 space-y-3">
                        <div dir="rtl" className="rounded-xl bg-white/80 p-3 text-xs dark:bg-zinc-900/70 space-y-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-2 font-bold text-amber-950 dark:text-amber-200">
                            <span>💰 رصيد السلف في هذه الدورة:</span>
                            <span className="font-mono">
                              معتمد: ${cycleAdvances.toLocaleString()} · معلق: ${pendingCycleAdvances.toLocaleString()}
                              {remSalary !== null ? ` · المتاح من الراتب: $${remSalary.toLocaleString()}` : ""}
                            </span>
                          </div>
                          {overSalary && (
                            <p className="text-red-700 dark:text-red-300 font-bold">
                              ❌ المبلغ المطلوب (${advanceAmount}) يتجاوز المتبقي من راتبك المسجل (${remSalary}) بعد خصم السلف الحالية.
                            </p>
                          )}
                        </div>
                        <div className="flex items-center justify-between">
                          <label className="block text-xs font-bold text-amber-900 dark:text-amber-200" htmlFor="requestedAmount">
                            Requested Advance Amount (EGP / $) *
                          </label>
                          <span className="text-[10px] font-medium text-amber-700 dark:text-amber-400">
                            Deducted from next payroll
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {[200, 500, 1000, 2000].map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => setAdvanceAmount(preset)}
                              className={`rounded-lg border px-3 py-1 text-xs font-bold transition-all cursor-pointer ${
                                advanceAmount === preset
                                  ? "border-amber-600 bg-amber-600 text-white shadow-sm"
                                  : "border-amber-300 bg-white text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-zinc-800 dark:text-amber-300"
                              }`}
                            >
                              ${preset}
                            </button>
                          ))}
                        </div>
                        <input
                          id="requestedAmount"
                          name="requestedAmount"
                          type="number"
                          min={50}
                          max={remSalary !== null && remSalary > 0 ? remSalary : undefined}
                          step={50}
                          value={advanceAmount}
                          onChange={(e) => setAdvanceAmount(Number(e.target.value) || 0)}
                          required
                          className="brutal-input bg-white dark:bg-zinc-900"
                          placeholder="Advance amount"
                        />
                      </div>
                    );
                  })()}

                  {["annual_leave", "unpaid_leave", "sick_leave", "emergency_leave"].includes(exceptionType) ? (
                    <div dir="rtl" className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
                      {(() => {
                        const leaveVerdict = validateLeaveRequest(leaveAccrual, leaveDays);
                        const noPaidLeaveBalance =
                          leaveAccrual.phase === "probation" || leaveAccrual.requestableDays <= 0;
                        const isPaidFromAnnualBalance =
                          exceptionType === "annual_leave" || exceptionType === "emergency_leave";
                        return (
                          <div className="space-y-2.5 rounded-xl border border-sky-200 bg-sky-50/50 p-3.5 text-xs dark:border-sky-900/60 dark:bg-sky-950/25">
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-200/70 pb-2 dark:border-sky-800/60">
                              <span className="font-extrabold text-sky-950 dark:text-sky-200">
                                🌴 رصيد إجازاتك السنوية · {leavePhaseLabelAr(leaveAccrual)}
                              </span>
                              <span className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-bold text-sky-900 shadow-xs dark:bg-zinc-900 dark:text-sky-200">
                                رصيدك المتاح للطلب: {toArabicDigits(leaveAccrual.requestableDays)} يوم (من إجمالي {toArabicDigits(leaveAccrual.balance)} يوم)
                              </span>
                            </div>

                            <ul className="space-y-1 rounded-lg bg-white/80 p-2.5 text-[11px] leading-5 text-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300">
                              {leaveAccrual.leaveLawType === "legacy_21" ? (
                                <li>• <b>استحقاق السنة الأولى (قانون عمل قديم — ٢١ يوم):</b> بعد إتمام أول ٦ شهور ينزل في رصيدك <b>١٠٫٥ يوم</b>، ثم يزيد بمعدل <b>{toArabicDigits(policyCfg.leaveRateYear2)} يوم شهرياً</b> ليكتمل <b>٢١ يوماً</b> بنهاية أول سنة.</li>
                              ) : (
                                <li>• <b>استحقاق السنة الأولى:</b> بعد إتمام أول ٦ شهور ينزل في رصيدك <b>٧٫٥ يوم</b>، ثم يزيد بمعدل <b>{toArabicDigits(policyCfg.leaveRateYear1)} يوم شهرياً</b> ليكتمل <b>١٥ يوماً</b> بنهاية أول سنة.</li>
                              )}
                              <li>• <b>استحقاق ما بعد السنة الأولى:</b> يرتفع الرصيد إلى <b>٢١ يوماً في السنة (بواقع {toArabicDigits(policyCfg.leaveRateYear2)} يوم شهرياً)</b>، ويُضاف إليه <b>الرصيد المُرحّل قانونياً والمُعتمد من الإدارة</b>.</li>
                            </ul>

                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-[11px]">
                              <div className="rounded-lg bg-white p-2 dark:bg-zinc-900">
                                <div className="font-mono font-bold text-zinc-900 dark:text-white">{toArabicDigits(leaveAccrual.accruedDays)}</div>
                                <div className="text-zinc-500">المستحق ({toArabicDigits(leaveAccrual.monthlyRate)}/ش)</div>
                              </div>
                              <div className="rounded-lg bg-emerald-50 p-2 dark:bg-emerald-950/40">
                                <div className="font-mono font-bold text-emerald-800 dark:text-emerald-300">+{toArabicDigits(leaveAccrual.totalCarryOverDays)}</div>
                                <div className="text-emerald-700 dark:text-emerald-400">مُرحّل ومعتمد</div>
                              </div>
                              <div className="rounded-lg bg-white p-2 dark:bg-zinc-900">
                                <div className="font-mono font-bold text-zinc-900 dark:text-white">{toArabicDigits(leaveAccrual.usedDays)}</div>
                                <div className="text-zinc-500">المستخدم والمعلق</div>
                              </div>
                              <div className="rounded-lg bg-sky-100/70 p-2 dark:bg-sky-950/50">
                                <div className="font-mono font-bold text-sky-900 dark:text-sky-200">{toArabicDigits(leaveAccrual.requestableDays)}</div>
                                <div className="text-sky-800 dark:text-sky-300">المتاح للطلب</div>
                              </div>
                            </div>

                            {leaveAccrual.totalCarryOverDays > 0 && (
                              <p className="text-[11px] text-emerald-800 dark:text-emerald-300">
                                ✓ يشمل رصيدك <b>{toArabicDigits(leaveAccrual.totalCarryOverDays)} يوم</b> رصيد مُرحّل (مُرحّل قانونياً: {toArabicDigits(leaveAccrual.legalCarryOverDays)} يوم + مُعتمد من الإدارة: {toArabicDigits(leaveAccrual.carriedOverApproved)} يوم).
                              </p>
                            )}

                            {isPaidFromAnnualBalance && (
                              leaveAccrual.phase === "probation" ? (
                                <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-xs text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200 space-y-2">
                                  <p className="font-bold">
                                    🚫 لا يمكنك إرسال طلب {exceptionType === "emergency_leave" ? "إجازة عارضة" : "إجازة سنوية"} حالياً (رصيدك المتاح للطلب: ٠ يوم)
                                  </p>
                                  <p>
                                    أنت حاليًا في <strong>فترة الاختبار (حتى {leaveAccrual.probationEndsOn})</strong> — رصيد الإجازات السنوية والعارضة يفتح بعد إتمام أول ٦ شهور. يمكنك طلب <strong>إجازة بدون مرتب</strong> الآن:
                                  </p>
                                  <button
                                    type="button"
                                    onClick={() => setExceptionType("unpaid_leave")}
                                    className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-teal-500 cursor-pointer"
                                  >
                                    📅 التبديل إلى طلب إجازة بدون مرتب (Unpaid Leave)
                                  </button>
                                </div>
                              ) : noPaidLeaveBalance ? (
                                <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-xs text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200 space-y-2">
                                  <p className="font-bold">
                                    🚫 لا يمكنك إرسال طلب {exceptionType === "emergency_leave" ? "إجازة عارضة" : "إجازة سنوية"} — رصيدك المتاح حالياً هو ٠ يوم
                                  </p>
                                  <p>
                                    لقد استنفدت كامل رصيد إجازاتك السنوية المستحق حتى الآن ({toArabicDigits(leaveAccrual.accruedDays + leaveAccrual.totalCarryOverDays)} يوم مستحق، تم استخدام/حجز {toArabicDigits(leaveAccrual.usedDays)} يوم). يمكنك التبديل إلى طلب إجازة بدون مرتب:
                                  </p>
                                  <button
                                    type="button"
                                    onClick={() => setExceptionType("unpaid_leave")}
                                    className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-teal-500 cursor-pointer"
                                  >
                                    📅 التبديل إلى طلب إجازة بدون مرتب (Unpaid Leave)
                                  </button>
                                </div>
                              ) : !leaveVerdict.ok ? (
                                <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-xs text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200 space-y-2">
                                  <p>
                                    ❌ <b>لا يمكن طلب {toArabicDigits(leaveDays)} يوم:</b> {leaveVerdict.reasonAr}
                                  </p>
                                  {leaveAccrual.requestableDays > 0 && leaveDays > leaveAccrual.requestableDays && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const capped = leaveAccrual.requestableDays;
                                        setLeaveDays(capped);
                                        if (capped >= 1 && leaveStartDate) {
                                          setLeaveEndDate(addDaysYmd(leaveStartDate, Math.ceil(capped) - 1));
                                        }
                                      }}
                                      className="rounded-lg bg-red-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-600 cursor-pointer"
                                    >
                                      ✓ ضبط عدد الأيام إلى رصيدك المتاح ({toArabicDigits(leaveAccrual.requestableDays)} يوم)
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <div className="rounded-xl border border-emerald-300 bg-emerald-50/90 p-2.5 text-xs text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
                                  ✓ <b>متاح للطلب ({toArabicDigits(leaveDays)} يوم):</b> رصيدك الحالي <b>{toArabicDigits(leaveAccrual.requestableDays)} يوم</b>، ويتبقى في رصيدك بعد الاعتماد <b>{toArabicDigits(Math.round((leaveAccrual.balance - leaveDays) * 100) / 100)} يوم</b>.
                                </div>
                              )
                            )}
                          </div>
                        );
                      })()}

                      {(() => {
                        const isPaidLeaveType =
                          exceptionType === "annual_leave" || exceptionType === "emergency_leave";
                        const disableAnnualInputs =
                          isPaidLeaveType &&
                          (leaveAccrual.phase === "probation" || leaveAccrual.requestableDays <= 0);
                        const wkndDays = hrSettings.weekendDays || [5, 6];
                        const rangeSummary = countWorkingLeaveDaysInRange(
                          leaveStartDate,
                          leaveEndDate || leaveStartDate,
                          wkndDays,
                          holidays,
                        );
                        return (
                          <>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                              <div>
                                <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1" htmlFor="exceptionDate">
                                  📅 تاريخ بداية الإجازة (Start Date) *
                                </label>
                                <input
                                  id="exceptionDate"
                                  name="exceptionDate"
                                  type="date"
                                  required
                                  disabled={disableAnnualInputs}
                                  value={leaveStartDate}
                                  onChange={(e) => {
                                    const nextStart = e.target.value;
                                    setLeaveStartDate(nextStart);
                                    const nextEnd = !leaveEndDate || leaveEndDate < nextStart ? nextStart : leaveEndDate;
                                    setLeaveEndDate(nextEnd);
                                    const sum = countWorkingLeaveDaysInRange(nextStart, nextEnd, wkndDays, holidays);
                                    setLeaveDays(sum.workingDays);
                                  }}
                                  className="brutal-input disabled:opacity-50 disabled:cursor-not-allowed"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1" htmlFor="endDate">
                                  📅 تاريخ نهاية الإجازة (End Date) *
                                </label>
                                <input
                                  id="endDate"
                                  name="endDate"
                                  type="date"
                                  required
                                  disabled={disableAnnualInputs}
                                  min={leaveStartDate}
                                  value={leaveEndDate}
                                  onChange={(e) => {
                                    const nextEnd = e.target.value;
                                    setLeaveEndDate(nextEnd);
                                    if (nextEnd >= leaveStartDate) {
                                      const sum = countWorkingLeaveDaysInRange(leaveStartDate, nextEnd, wkndDays, holidays);
                                      setLeaveDays(sum.workingDays);
                                    }
                                  }}
                                  className="brutal-input disabled:opacity-50 disabled:cursor-not-allowed"
                                />
                              </div>
                            </div>

                            <div>
                              <div className="flex flex-wrap items-center justify-between gap-1.5 mb-1">
                                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300" htmlFor="leaveDays">
                                  صافي أيام الإجازة المحتسبة (بدون الجمعة والسبت والإجازات الرسمية)
                                  {isPaidLeaveType
                                    ? ` — الحد الأقصى المتاح لك: ${toArabicDigits(leaveAccrual.requestableDays)} يوم *`
                                    : " *"}
                                </label>
                                {leaveStartDate === leaveEndDate && rangeSummary.workingDays > 0 && !disableAnnualInputs && (
                                  <div className="flex gap-1.5">
                                    {[0.5, 1]
                                      .filter(
                                        (dVal) =>
                                          !isPaidLeaveType || dVal <= leaveAccrual.requestableDays
                                      )
                                      .map((dVal) => (
                                        <button
                                          key={dVal}
                                          type="button"
                                          onClick={() => setLeaveDays(dVal)}
                                          className={`rounded-md border px-2 py-0.5 text-[11px] font-bold cursor-pointer ${
                                            leaveDays === dVal
                                              ? "border-emerald-600 bg-emerald-600 text-white"
                                              : "border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                                          }`}
                                        >
                                          {dVal === 0.5 ? "نصف يوم (0.5)" : "يوم كامل (1)"}
                                        </button>
                                      ))}
                                  </div>
                                )}
                              </div>
                              <input
                                id="leaveDays"
                                name="leaveDays"
                                type="number"
                                min={0}
                                max={
                                  isPaidLeaveType && leaveAccrual.requestableDays > 0
                                    ? leaveAccrual.requestableDays
                                    : 30
                                }
                                step={0.5}
                                disabled={disableAnnualInputs}
                                value={leaveDays}
                                onChange={(e) => {
                                  const val = Math.max(0.5, Number(e.target.value) || 1);
                                  setLeaveDays(val);
                                  if (val >= 1 && leaveStartDate) {
                                    setLeaveEndDate(addWorkingLeaveDaysYmd(leaveStartDate, Math.ceil(val), wkndDays, holidays));
                                  }
                                }}
                                required
                                className="brutal-input disabled:opacity-50 disabled:cursor-not-allowed"
                              />
                              <p className="mt-1 text-[11px] text-zinc-500">
                                الفترة المختارة: من <strong className="font-mono">{leaveStartDate}</strong> إلى <strong className="font-mono">{leaveEndDate}</strong> — صافي المحتسب: <strong>{toArabicDigits(leaveDays)} يوم عمل</strong>.
                              </p>
                              {rangeSummary.excludedDaysCount > 0 && rangeSummary.workingDays > 0 && (
                                <p dir="rtl" className="mt-1.5 rounded-lg border border-emerald-200 bg-emerald-50/70 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
                                  ✅ تم استبعاد <strong>{toArabicDigits(rangeSummary.excludedDaysCount)} يوم</strong> عطلة رسمية (الجمعة والسبت / إجازات رسمية) تلقائياً من الفترة ({toArabicDigits(rangeSummary.totalCalendarDays)} أيام تقويمية ← يُحسب <strong>{toArabicDigits(leaveDays)} يوم</strong> فقط من رصيد الإجازات).
                                </p>
                              )}
                              {rangeSummary.totalCalendarDays > 0 && rangeSummary.workingDays === 0 && (
                                <p dir="rtl" className="mt-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] font-bold text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                                  ⚠️ جميع الأيام المختارة تقع في العطلة الأسبوعية الرسمية (الجمعة والسبت) أو إجازة رسمية، لذلك لا تُحتسب ولا تُخصم من رصيد الإجازات — اختر أيام عمل فعلية.
                                </p>
                              )}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1" htmlFor="exceptionDate">
                        {exceptionType === "advance_late" || exceptionType === "early_permission"
                          ? "تاريخ الإذن المطلوب (Target Date for Permission) *"
                          : "Effective Date (التاريخ) *"}
                      </label>
                      <input
                        id="exceptionDate"
                        name="exceptionDate"
                        type="date"
                        required
                        value={permTargetDate}
                        onChange={(e) => setPermTargetDate(e.target.value || localYmd())}
                        className="brutal-input"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1" htmlFor="exceptionReason">
                      Detailed Reason *
                    </label>
                    <textarea
                      id="exceptionReason"
                      name="exceptionReason"
                      required
                      rows={3}
                      placeholder={
                        exceptionType === "advance_late"
                          ? "اكتب سبب طلب إذن التأخير والموعد المتوقع لوصولك…"
                          : exceptionType === "early_permission"
                            ? "اكتب سبب طلب إذن الانصراف المبكر…"
                            : exceptionType === "unpaid_leave"
                              ? "اكتب سبب طلب الإجازة بدون مرتب…"
                              : "Explain the reason for this exception request…"
                      }
                      className="brutal-input resize-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1" htmlFor="supportingEvidence">
                      Supporting Evidence / Document Link (optional)
                    </label>
                    <input
                      id="supportingEvidence"
                      name="supportingEvidence"
                      type="url"
                      placeholder="https://..."
                      className="brutal-input"
                    />
                  </div>

                  {(() => {
                    const isPerm = exceptionType === "advance_late" || exceptionType === "early_permission";
                    const permCheck = isPerm
                      ? validatePermissionRequest(
                          lateMinsInput,
                          policyUsage,
                          policyCfg,
                          getDailyPermissionCtx(permTargetDate, exceptionType),
                        )
                      : null;
                    const blockedByPerm = isPerm && permCheck && !permCheck.ok;

                    const isAnyLeave = ["annual_leave", "unpaid_leave", "sick_leave", "emergency_leave"].includes(exceptionType);
                    const leaveRangeSum = isAnyLeave
                      ? countWorkingLeaveDaysInRange(
                          leaveStartDate,
                          leaveEndDate || leaveStartDate,
                          hrSettings.weekendDays || [5, 6],
                          holidays,
                        )
                      : null;
                    const blockedByOfficialWeekend = Boolean(isAnyLeave && leaveRangeSum && leaveRangeSum.workingDays <= 0);

                    const isPaidLeave =
                      exceptionType === "annual_leave" || exceptionType === "emergency_leave";
                    const leaveCheck = isPaidLeave
                      ? validateLeaveRequest(leaveAccrual, leaveDays)
                      : null;
                    const blockedByLeave =
                      isPaidLeave &&
                      (leaveAccrual.phase === "probation" ||
                        leaveAccrual.requestableDays <= 0 ||
                        Boolean(leaveCheck && !leaveCheck.ok));

                    const isAdv = exceptionType === "advance_request";
                    const monthlySal = Number(profile.expectedSalary) || 0;
                    const blockedByAdv =
                      isAdv &&
                      monthlySal > 0 &&
                      cycleAdvances + pendingCycleAdvances + advanceAmount > monthlySal;

                    return (
                      <button
                        type="submit"
                        disabled={
                          exceptionSubmitting ||
                          Boolean(blockedByPerm) ||
                          Boolean(blockedByOfficialWeekend) ||
                          Boolean(blockedByLeave) ||
                          Boolean(blockedByAdv)
                        }
                        className="brutal-btn w-full disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {exceptionSubmitting
                          ? "Sending…"
                          : blockedByPerm
                            ? "🚫 لا يمكن إرسال طلب الإذن (راجع السبب والرصيد أعلاه)"
                            : blockedByOfficialWeekend
                              ? "🚫 الأيام المختارة عطلة رسمية (جمعة/سبت) لا تُحسب من الإجازات"
                              : blockedByLeave
                                ? leaveAccrual.requestableDays <= 0 || leaveAccrual.phase === "probation"
                                  ? `🚫 لا يمكن إرسال الطلب (رصيد إجازاتك المتاح: ٠ يوم)`
                                  : `🚫 المطلوب (${toArabicDigits(leaveDays)} يوم) يتجاوز رصيدك المتاح (${toArabicDigits(leaveAccrual.requestableDays)} يوم)`
                                : blockedByAdv
                                  ? "🚫 مبلغ السلفة يتجاوز المتبقي من راتبك المسجل"
                                  : isPerm
                                    ? `إرسال طلب الإذن (${permCheck?.chargedMinutes ?? 30} دقيقة من رصيد الأذونات) لموافقة الأدمن`
                                    : isPaidLeave
                                      ? `إرسال طلب الإجازة (${toArabicDigits(leaveDays)} يوم من رصيدك: ${toArabicDigits(leaveAccrual.requestableDays)} يوم)`
                                      : "Send request to HR"}
                      </button>
                    );
                  })()}
                </form>
              </div>

              {/* History */}
              <div className="ui-card p-6">
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-zinc-900 dark:text-white">History</h3>
                  {pendingRequests > 0 && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                      {pendingRequests} awaiting review
                    </span>
                  )}
                </div>
                {exceptionsLoading ? (
                  <div className="space-y-3">
                    {[1, 2].map((i) => (
                      <div key={i} className="h-20 rounded-xl mft-skeleton" />
                    ))}
                  </div>
                ) : exceptions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-8 text-center">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-400 dark:bg-zinc-800">
                      <Icon d={ICON.exceptions} className="h-5 w-5" />
                    </span>
                    <p className="mt-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">No requests yet</p>
                    <p className="mt-0.5 text-xs text-zinc-500">Requests you send will appear here with their status.</p>
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
                    {exceptions.map((ex) => {
                      const isLeaveEx = ["annual_leave", "unpaid_leave", "sick_leave", "emergency_leave"].includes(String(ex.type ?? ""));
                      const startStr = String(ex.exceptionDate ?? "—");
                      const endStr = ex.endDate ? String(ex.endDate) : startStr;
                      return (
                        <div key={ex.id} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-bold text-zinc-900 dark:text-white uppercase tracking-wider">
                                {exceptionLabel(ex)}
                              </span>
                              {Boolean(ex.requestedAmount) && (
                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                                  ${Number(ex.requestedAmount).toLocaleString()}
                                </span>
                              )}
                            </div>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                ex.status === "approved"
                                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-400"
                                  : ex.status === "rejected"
                                  ? "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-400"
                                  : "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-400"
                              }`}
                            >
                              {ex.status === "approved" ? "Approved" : ex.status === "rejected" ? "Declined" : "Pending"}
                            </span>
                          </div>
                          <p className="text-xs text-zinc-600 dark:text-zinc-300">
                            <strong className="font-semibold text-zinc-800 dark:text-zinc-200">Reason: </strong>
                            {String(ex.reason ?? "No reason specified")}
                          </p>
                          {Boolean(ex.adminResponse) && (
                            <div className="mt-2 rounded bg-white p-2 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border-l-2 border-red-500">
                              <strong>Admin feedback: </strong>{String(ex.adminResponse)}
                            </div>
                          )}
                          <div dir="rtl" className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-600 dark:text-zinc-300 border-t border-zinc-200/60 dark:border-zinc-800 pt-2.5">
                            <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-0.5 font-semibold dark:bg-zinc-800">
                              {isLeaveEx
                                ? `📅 الإجازة: من ${startStr} إلى ${endStr}`
                                : `📅 تاريخ الطلب: ${startStr}`}
                            </span>
                            <span className="inline-flex items-center gap-1 rounded-md bg-sky-50 px-2 py-0.5 font-semibold text-sky-800 dark:bg-sky-950/50 dark:text-sky-300">
                              📩 تاريخ تقديم الطلب: <span dir="ltr">{formatSubmittedDateTime(ex.createdAt)}</span>
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* TAB: EXPENSES (HR-POL-2026 clause 5) */}
        {tab === "expenses" && (
          <ExpensesPanel
            db={firebaseClient.db}
            worker={{
              uid,
              name: `${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim() || (profile.email ?? "Worker"),
              email: profile.email,
            }}
          />
        )}

        {/* TAB: PROFILE */}
        {tab === "profile" && (
          <section className="space-y-6 animate-fade-in" aria-labelledby="profile-heading">
            <div className="ui-card p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-zinc-200 pb-6 dark:border-zinc-800">
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-red-600 to-red-800 text-2xl font-bold text-white shadow-md shadow-red-900/20">
                    {profile.firstName ? profile.firstName[0].toUpperCase() : "M"}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-zinc-900 dark:text-white">
                      {profile.firstName ? `${profile.firstName} ${profile.lastName ?? ""}` : "Worker Profile"}
                    </h2>
                    <p className="text-xs text-zinc-500 mt-0.5">{profile.email}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                        {formatRole(profile.role)}
                      </span>
                      <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                        {profile.department || "General"}
                      </span>
                      <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400">
                        {profile.status === "approved" ? "Active Member" : profile.status || "Pending"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Profile Details Grid */}
              <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
                  <p className="text-[11px] font-medium text-zinc-500">Phone</p>
                  <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-white">{profile.phone || "Not set"}</p>
                </div>

                <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
                  <p className="text-[11px] font-medium text-zinc-500">Employment Type</p>
                  <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-white">{formatWorkType(profile.employmentType)}</p>
                </div>

                <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
                  <p className="text-[11px] font-medium text-zinc-500">Experience</p>
                  <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-white">{profile.experience || "Not set"}</p>
                </div>

                <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
                  <p className="text-[11px] font-medium text-zinc-500">Location</p>
                  <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-white">{profile.government ? `${profile.government}, ${profile.city ?? ""}` : "Not set"}</p>
                </div>

                <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
                  <p className="text-[11px] font-medium text-zinc-500">Member Since</p>
                  <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-white">
                    {profile.createdAt ? toDate(profile.createdAt)?.toLocaleDateString() : "—"}
                  </p>
                </div>

                <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
                  <p className="text-[11px] font-medium text-zinc-500">Expected Monthly Salary</p>
                  <div className="mt-1 flex items-center gap-2">
                    {!salaryEdit ? (
                      <>
                        <span className="text-sm font-semibold text-zinc-900 dark:text-white">
                          {profile.expectedSalary != null ? `EGP ${profile.expectedSalary}` : "Not set"}
                        </span>
                        <button
                          type="button"
                          onClick={() => setSalaryEdit(true)}
                          className="text-xs font-semibold text-red-600 hover:text-red-700 cursor-pointer"
                        >
                          Edit
                        </button>
                      </>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          value={salaryVal}
                          onChange={(e) => setSalaryVal(e.target.value)}
                          className="brutal-input w-28 py-1 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => void saveSalary()}
                          className="rounded bg-red-600 px-2.5 py-1 text-xs font-semibold text-white cursor-pointer"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setSalaryEdit(false)}
                          className="rounded bg-zinc-200 px-2 py-1 text-xs font-semibold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Skills and Portfolio */}
              <div className="mt-6 space-y-4">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">Skills &amp; Expertise</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {profile.skills?.length ? (
                      profile.skills.map((s, idx) => (
                        <span key={idx} className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                          {s}
                        </span>
                      ))
                    ) : (
                      <p className="text-xs text-zinc-400">No skills specified.</p>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-2">Portfolio</h3>
                  {profile.portfolioLink ? (
                    <a
                      href={profile.portfolioLink}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-600 hover:underline"
                    >
                      <span>🔗 {profile.portfolioLink}</span>
                      <span>↗</span>
                    </a>
                  ) : (
                    <p className="text-xs text-zinc-400">No portfolio link provided.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Preferences */}
            <div className="ui-card p-6">
              <h3 className="text-sm font-bold text-zinc-900 dark:text-white">Preferences</h3>
              <p className="mt-0.5 text-xs text-zinc-500">Saved on this device.</p>
              <div className="mt-5 divide-y divide-zinc-100 dark:divide-zinc-800">
                <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
                  <div>
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Appearance</p>
                    <p className="text-xs text-zinc-500">Choose light, dark, or follow your device.</p>
                  </div>
                  <div className="grid grid-cols-3 gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800" role="radiogroup" aria-label="Theme">
                    {([
                      ["light", "Light", ICON.sun],
                      ["dark", "Dark", ICON.moon],
                      ["system", "Auto", ICON.monitor],
                    ] as [Theme, string, string][]).map(([key, label, icon]) => (
                      <button
                        key={key}
                        type="button"
                        role="radio"
                        aria-checked={theme === key}
                        onClick={() => setTheme(key)}
                        className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                          theme === key
                            ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-white"
                            : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                        }`}
                      >
                        <Icon d={icon} className="h-3.5 w-3.5" /> {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
                  <div>
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">Notification sound</p>
                    <p className="text-xs text-zinc-500">Chime for new tasks, messages, alerts, and shift reminders.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => playTerminalBeep({ force: true })}
                      className="brutal-btn-outline"
                    >
                      <Icon d={ICON.sound} className="h-3.5 w-3.5" /> Test
                    </button>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={soundOn}
                      aria-label="Notification sound"
                      onClick={toggleSound}
                      className={`relative h-6 w-11 rounded-full transition-colors cursor-pointer ${soundOn ? "bg-red-600" : "bg-zinc-300 dark:bg-zinc-700"}`}
                    >
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${soundOn ? "left-[22px]" : "left-0.5"}`} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* ── MODAL: Session Start Mode Choice & Task Selection ── */}
      {showShiftChoiceModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shift-choice-title"
        >
          <div
            dir="rtl"
            className="w-full max-w-xl overflow-hidden rounded-2xl border-2 border-zinc-900 bg-white p-6 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900 animate-scale-in text-right"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">
                  🟢 بدء يوم العمل وتحديد المهام
                </span>
                <h2 id="shift-choice-title" className="mt-1.5 text-xl font-extrabold tracking-tight text-zinc-900 dark:text-white">
                  أهلاً بك يا {firstName}! اختر المهام التي ستعمل عليها اليوم
                </h2>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  {durationMs > 60_000
                    ? `لقد سجلت ${formatHM(durationMs)} اليوم. حدد المهام التي ستستكمل العمل عليها وسيتم إرسال إشعار فوري للأدمن والأكونت مانجر.`
                    : "حدد المهام التي ستشتغل عليها في هذا الشيفت، وبمجرد الضغط على (ابدأ الشيفت الآن) سيتم إرسال إشعار فوري للأدمن والأكونت مانجر."}
                </p>
              </div>
            </div>

            {/* Task Selection List */}
            <div className="mt-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-extrabold text-zinc-800 dark:text-zinc-200">
                  📋 المهام المسندة إليك ({myActiveTasks.length}):
                </label>
                {myActiveTasks.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedShiftTaskIds.length === myActiveTasks.length) {
                        setSelectedShiftTaskIds([]);
                      } else {
                        setSelectedShiftTaskIds(myActiveTasks.map((t) => t.id));
                      }
                    }}
                    className="text-[11px] font-bold text-emerald-600 hover:underline cursor-pointer"
                  >
                    {selectedShiftTaskIds.length === myActiveTasks.length ? "إلغاء تحديد الكل" : "تحديد كل المهام"}
                  </button>
                )}
              </div>

              {myActiveTasks.length > 0 ? (
                <div className="max-h-52 space-y-1.5 overflow-y-auto rounded-xl border border-zinc-200 bg-zinc-50/70 p-2.5 dark:border-zinc-800 dark:bg-zinc-950/50">
                  {myActiveTasks.map((t) => {
                    const checked = selectedShiftTaskIds.includes(t.id);
                    return (
                      <label
                        key={t.id}
                        className={`flex items-start gap-2.5 rounded-xl border p-2.5 text-xs transition cursor-pointer ${
                          checked
                            ? "border-emerald-500 bg-emerald-50/90 dark:border-emerald-600 dark:bg-emerald-950/40"
                            : "border-zinc-200 bg-white hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleShiftTaskSelection(t.id)}
                          className="mt-0.5 h-4 w-4 rounded accent-emerald-600 cursor-pointer"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {t.projectName && (
                              <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-bold text-white dark:bg-zinc-700">
                                {t.projectName}
                              </span>
                            )}
                            <span className="font-bold text-zinc-900 dark:text-white">{t.title}</span>
                          </div>
                          <span className="text-[10px] text-zinc-500">
                            الحالة: {t.status === "in-progress" ? "قيد التنفيذ" : "مسندة"} · الأولوية: {t.priority || "medium"}
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-3 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/40">
                  لا توجد مهام مسندة في القائمة حالياً — يمكنك كتابة المهمة التي ستعمل عليها في الحقل بالأسفل والبدء فوراً.
                </div>
              )}

              <div>
                <label className="block text-[11px] font-bold text-zinc-600 dark:text-zinc-400 mb-1">
                  مهمة إضافية أو ملاحظة للأدمن والأكونت مانجر (اختياري):
                </label>
                <input
                  type="text"
                  value={shiftTaskNote}
                  onChange={(e) => setShiftTaskNote(e.target.value)}
                  placeholder="مثال: سأبدأ بتعديلات العميل ثم تسليم التصميم..."
                  className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                />
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => void startActiveShift()}
                disabled={shiftBusy}
                autoFocus
                className="group flex flex-col items-start rounded-xl border-2 border-emerald-500 bg-emerald-50/70 p-4 text-right transition-all hover:-translate-y-0.5 hover:bg-emerald-50 hover:shadow-lg hover:shadow-emerald-600/10 disabled:opacity-60 dark:border-emerald-600 dark:bg-emerald-950/30 dark:hover:bg-emerald-950/50 cursor-pointer"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-md shadow-emerald-700/20 transition-transform group-hover:scale-105">
                  <Icon d={ICON.play} className="h-5 w-5" />
                </span>
                <span className="mt-2.5 text-sm font-extrabold text-zinc-900 dark:text-white">
                  {shiftBusy
                    ? "جاري بدء الشيفت..."
                    : durationMs > 60_000
                      ? "استئناف الشيفت وإبلاغ الإدارة بالمهام"
                      : "ابدأ الشيفت الآن وإبلاغ الأدمن والأكونت مانجر"}
                </span>
                <span className="mt-1 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">
                  يبدأ عداد الـ ٨ ساعات + إشعار فوري بالمهام المختارة + شيك إن كل ساعتين.
                </span>
              </button>

              <button
                type="button"
                onClick={chooseBrowseMode}
                className="group flex flex-col items-start rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 text-right transition-all hover:-translate-y-0.5 hover:border-zinc-300 hover:bg-zinc-100/70 dark:border-zinc-700 dark:bg-zinc-800/40 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/70 cursor-pointer"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-200 text-zinc-700 transition-transform group-hover:scale-105 dark:bg-zinc-700 dark:text-zinc-200">
                  <Icon d={ICON.eye} className="h-5 w-5" />
                </span>
                <span className="mt-2.5 text-sm font-bold text-zinc-900 dark:text-white">
                  تصفح فقط بدون بدء الشيفت (Just Browsing)
                </span>
                <span className="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                  الاطلاع على المهام والتنبيهات بدون تشغيل عداد الشيفت حالياً.
                </span>
              </button>
            </div>

            {(hrSettings.workLocations ?? []).some((l) => l.active !== false) && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-purple-200 bg-purple-50/70 px-3.5 py-2.5 text-xs text-purple-900 dark:border-purple-900/60 dark:bg-purple-950/30 dark:text-purple-200">
                <span>📍 جهازك بدون GPS داخل الشركة أو في مأمورية خارجية؟</span>
                <button
                  type="button"
                  onClick={() => {
                    setShowShiftChoiceModal(false);
                    setOutsideLocationModalOpen(true);
                  }}
                  className="rounded-lg bg-purple-600 px-3 py-1 text-[11px] font-bold text-white hover:bg-purple-700 cursor-pointer"
                >
                  🏢 كود المكتب (بدون GPS) / 🚗 طلب مأمورية
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── MODAL: 8-Hour Shift Completion & Overtime Request ── */}
      {shiftCompletedModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shift-end-title"
        >
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 animate-scale-in">
            <div className="flex items-center justify-between mb-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                Shift complete
              </span>
              {!showOvertimeForm && (
                <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-mono font-bold text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/60 dark:text-amber-300">
                  Auto clock-out {Math.floor(autoLogoutSeconds / 60)}:{String(autoLogoutSeconds % 60).padStart(2, "0")}
                </span>
              )}
            </div>

            <h2 id="shift-end-title" className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white">
              {showOvertimeForm ? "Request overtime" : `Great work today, ${firstName}!`}
            </h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
              {showOvertimeForm
                ? "Pick how much extra time you need and tell HR why."
                : "You've completed today's scheduled hours. Clock out now, or request overtime to keep working."}
            </p>

            {!showOvertimeForm ? (
              <div className="mt-6 space-y-4">
                <div className="rounded-xl border border-zinc-100 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-800/40 text-xs text-zinc-600 dark:text-zinc-300 space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Logged today</span>
                    <span className="font-mono font-bold text-zinc-900 dark:text-white">{formatSessionDuration(durationMs)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">First clock-in</span>
                    <span>{firstClockIn ? firstClockIn.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Status</span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">Hours fulfilled</span>
                  </div>
                </div>

                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-[11px] text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                  <Icon d={ICON.time} className="mt-px h-3.5 w-3.5 shrink-0" />
                  <span>
                    To keep your timesheet accurate, you&apos;ll be clocked out automatically in{" "}
                    <strong>
                      {Math.floor(autoLogoutSeconds / 60)}:{String(autoLogoutSeconds % 60).padStart(2, "0")}
                    </strong>{" "}
                    unless you request overtime. You&apos;ll stay signed in.
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 pt-2">
                  <button
                    type="button"
                    autoFocus
                    onClick={() => void clockOut({ silent: true, reason: "Shift complete — clocked out" })}
                    disabled={shiftBusy}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-900 py-3 text-xs font-bold text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 active:scale-95 disabled:opacity-60 transition-all cursor-pointer"
                  >
                    <Icon d={ICON.check} /> Clock out &amp; finish
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowOvertimeForm(true);
                      setOvertimeRequestedMins(60);
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 py-3 text-xs font-bold text-amber-800 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-300 dark:hover:bg-amber-900/60 active:scale-95 transition-all cursor-pointer"
                  >
                    <Icon d={ICON.bolt} /> Request overtime
                  </button>
                </div>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleOvertimeSubmit(overtimeRequestedMins, overtimeReason);
                }}
                className="mt-6 space-y-4"
              >
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
                    Select Overtime Duration *
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { mins: 30, label: "+30m" },
                      { mins: 60, label: "+1 hr" },
                      { mins: 90, label: "+1.5 hr" },
                      { mins: 120, label: "+2 hr" },
                    ].map((opt) => (
                      <button
                        key={opt.mins}
                        type="button"
                        onClick={() => setOvertimeRequestedMins(opt.mins)}
                        className={`rounded-lg py-2 text-xs font-bold transition-all cursor-pointer ${
                          overtimeRequestedMins === opt.mins
                            ? "bg-amber-500 text-white shadow-md shadow-amber-500/20"
                            : "border border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1" htmlFor="ot-reason">
                    Reason for Overtime *
                  </label>
                  <textarea
                    id="ot-reason"
                    required
                    rows={3}
                    value={overtimeReason}
                    onChange={(e) => setOvertimeReason(e.target.value)}
                    placeholder="Describe pending directives or urgent deliverables needing extra time..."
                    className="brutal-input resize-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowOvertimeForm(false)}
                    className="rounded-xl border border-zinc-200 px-4 py-2.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={overtimeSubmitting || !overtimeReason.trim()}
                    className="rounded-xl bg-amber-600 px-5 py-2.5 text-xs font-bold text-white shadow-md shadow-amber-600/20 hover:bg-amber-500 disabled:opacity-50 active:scale-95 transition-all cursor-pointer"
                  >
                    {overtimeSubmitting ? "Submitting…" : `Submit & Extend (+${overtimeRequestedMins}m)`}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ── MODAL: Proactive Overtime Request (From Time Tab) ── */}
      {isProactiveOvertimeOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
          role="dialog"
          aria-modal="true"
          aria-labelledby="proactive-ot-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setIsProactiveOvertimeOpen(false);
          }}
        >
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 animate-scale-in">
            <div className="flex items-center justify-between mb-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800 dark:bg-amber-950/70 dark:text-amber-300">
                <Icon d={ICON.bolt} className="h-3.5 w-3.5" /> Overtime
              </span>
              <button
                type="button"
                onClick={() => setIsProactiveOvertimeOpen(false)}
                aria-label="Close"
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 cursor-pointer"
              >
                <Icon d="M6 18L18 6M6 6l12 12" />
              </button>
            </div>

            <h2 id="proactive-ot-title" className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white">
              Request overtime
            </h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
              Need to stay longer than your 8-hour shift? Your shift is extended right away and HR is notified to review.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleOvertimeSubmit(overtimeRequestedMins, overtimeReason);
              }}
              className="mt-6 space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1.5">
                  Select Extra Time Needed *
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { mins: 30, label: "+30m" },
                    { mins: 60, label: "+1 hr" },
                    { mins: 90, label: "+1.5 hr" },
                    { mins: 120, label: "+2 hr" },
                  ].map((opt) => (
                    <button
                      key={opt.mins}
                      type="button"
                      onClick={() => setOvertimeRequestedMins(opt.mins)}
                      className={`rounded-lg py-2 text-xs font-bold transition-all cursor-pointer ${
                        overtimeRequestedMins === opt.mins
                          ? "bg-amber-500 text-white shadow-md shadow-amber-500/20"
                          : "border border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1" htmlFor="proactive-ot-reason">
                  Reason / Task Reference *
                </label>
                <textarea
                  id="proactive-ot-reason"
                  required
                  rows={3}
                  value={overtimeReason}
                  onChange={(e) => setOvertimeReason(e.target.value)}
                  placeholder="Detail why extra time is needed (e.g. resolving priority bug, urgent client directive)..."
                  className="brutal-input resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsProactiveOvertimeOpen(false)}
                  className="rounded-xl border border-zinc-200 px-4 py-2.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={overtimeSubmitting || !overtimeReason.trim()}
                  className="rounded-xl bg-amber-600 px-5 py-2.5 text-xs font-bold text-white shadow-md shadow-amber-600/20 hover:bg-amber-500 disabled:opacity-50 active:scale-95 transition-all cursor-pointer"
                >
                  {overtimeSubmitting ? "Submitting…" : `Submit Request (+${overtimeRequestedMins}m)`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* HR-POL-2026 smart early clock-out & lateness alert */}
      {smartOut && (
        <SmartClockOutModal
          requiredEnd={smartOut.requiredEnd}
          firstClockIn={firstClockIn ?? undefined}
          workedSoFarMs={durationMs}
          lateCovered={Boolean(todayLateEntry?.covered)}
          dailyUsedMinutes={getDailyPermissionCtx(localYmd(), "early_permission").dailyUsedMinutes}
          usage={policyUsage}
          cfg={policyCfg}
          hourlyRate={hrSettings.defaultHourlyRate || 31.25}
          mode={smartOut.mode}
          busy={smartBusy}
          onChoose={(c, ev) => void onSmartChoice(c, ev)}
        />
      )}

      {/* HR-POL-2026 smart late clock-in choice (use permission vs. salary deduction) */}
      {smartLateIn && (
        <SmartLateClockInModal
          clockIn={smartLateIn.clockIn}
          usage={usageBeforeTodayLate}
          dailyUsedMinutes={
            effectiveLedger
              .filter(
                (e) =>
                  e.date === localYmd(smartLateIn.clockIn) &&
                  e.kind !== "late" &&
                  e.status === "applied" &&
                  e.covered &&
                  (e.chargedMinutes || 0) > 0,
              )
              .reduce((sum, e) => sum + (e.chargedMinutes || 0), 0)
          }
          cfg={policyCfg}
          hourlyRate={hrSettings.defaultHourlyRate || 31.25}
          busy={smartBusy}
          currentCoveredChoice={todayLateEntry ? todayLateEntry.covered : null}
          onChoose={(c, ev, penaltyDays) => void onSmartLateChoice(c, ev, penaltyDays)}
          onClose={() => {
            sessionStorage.setItem(`mft_late_choice_${uid}_${localYmd(smartLateIn.clockIn)}`, "dismissed");
            setSmartLateIn(null);
          }}
        />
      )}

      {/* ── 2-Hour Presence Check-In Modal (opens 10 minutes early before end of 2h cycle with continuous loud alarm) ── */}
      <ActiveCheckInModal
        isOpen={checkInModalOpen}
        workerName={firstName}
        tasks={myActiveTasks}
        secondsRemaining={checkInSecondsRemaining}
        isIdle={isWorkerIdle}
        onConfirm={handleConfirmCheckIn}
      />

      {/* ── Outside Work Location / External Mission Request Modal ── */}
      <OutsideLocationMissionModal
        open={outsideLocationModalOpen}
        db={firebaseClient.db}
        uid={uid}
        workerName={`${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim() || (profile.email ?? "Worker")}
        workerEmail={profile.email ?? ""}
        hrSettings={hrSettings}
        geofenceResult={lastGeofenceResult}
        gpsError={lastGpsError}
        workerCoords={lastWorkerCoords}
        todayMissionRequests={exceptions.filter(
          (x) => x.type === "external_mission" && String(x.exceptionDate || "") === todayYmd,
        )}
        busy={shiftBusy}
        onRetryGpsAndStartShift={() => void startActiveShift()}
        onClose={() => setOutsideLocationModalOpen(false)}
      />

      {/* ── Mobile Bottom Navigation Bar ── */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 flex border-t border-zinc-200 bg-white/95 px-1 py-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] lg:hidden dark:border-zinc-800 dark:bg-zinc-900/95 backdrop-blur-md"
        aria-label="Mobile navigation"
      >
        {TABS.map((t) => {
          const count = t.id === "alerts" ? unreadAlerts : t.id === "exceptions" ? pendingRequests : 0;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className={`relative flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-semibold transition-colors cursor-pointer ${
                tab === t.id
                  ? "text-red-600"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
              }`}
            >
              {tab === t.id && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-red-600" />}
              <Icon d={t.icon} className="h-5 w-5" />
              <span className="leading-tight">{t.short}</span>
              {count > 0 && (
                <span className={`absolute right-[calc(50%-20px)] top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white ${t.id === "alerts" ? "bg-red-600" : "bg-amber-500"}`}>
                  {count}
                </span>
              )}
              {t.id === "tasks" && unreadChatMessages > 0 && (
                <span className="absolute right-[calc(50%-16px)] top-1.5 flex h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
              )}
              {t.id === "time" && onShift && (
                <span className="absolute right-[calc(50%-16px)] top-1.5 flex h-2 w-2 rounded-full bg-emerald-500" />
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
