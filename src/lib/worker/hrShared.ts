import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  type Firestore,
} from "firebase/firestore";
import { POLICY_2026_SETTINGS_DEFAULTS, type Policy2026SettingsFields } from "./hrPolicy2026";

export interface WorkLocationItem {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number; // e.g. 200
  active?: boolean;
}

export interface OfficeNetworkItem {
  id: string;
  name: string; // e.g. "راوتر المقر الرئيسي"
  ip: string; // e.g. "197.52.104.88" or "197.52.104.*"
  active?: boolean;
}

export interface HrSettings extends Policy2026SettingsFields {
  monthStartDay: number; // 1 - 28 (e.g. 21 for 21st to 20th cycle)
  weekendDays: number[]; // e.g. [5, 6] for Friday & Saturday
  standardHours: number; // e.g. 8
  shiftStartTime: string; // "10:00"
  gracePeriodMinutes: number; // 30
  secondThresholdMinutes: number; // 60
  defaultHourlyRate: number; // 100
  overtimeMultiplier: number; // 1.5
  absencePenaltyMultiplier: number; // 2.0
  workLocations?: WorkLocationItem[];
  enforceGeofence?: boolean;
  /** Allowed company Wi-Fi / Public IPs so desktop PCs without GPS can clock in automatically. */
  officeNetworks?: OfficeNetworkItem[];
  /** Allow workers inside the office without GPS to clock in using the Office PIN. */
  officePinEnabled?: boolean;
  /** "daily_auto" rotates automatically every day; "fixed" uses officePinFixedCode. */
  officePinMode?: "daily_auto" | "fixed";
  /** Custom fixed PIN set by Admin when officePinMode === "fixed". */
  officePinFixedCode?: string;
  /** Secret salt used to derive the daily PIN (Admin can rotate at any time). */
  officePinSalt?: string;
  /** Master setup code to authorize a desktop browser as a Trusted Office PC. */
  officeDeviceAuthSecret?: string;
}

// Kept in sync with mft-admin DEFAULT_HR_SETTINGS (used only until `settings/hr` loads).
export const DEFAULT_HR_SETTINGS: HrSettings = {
  monthStartDay: 21,
  weekendDays: [5, 6], // Friday & Saturday (standard Egypt / MENA)
  standardHours: 8,
  shiftStartTime: "10:00",
  gracePeriodMinutes: 60, // 11:00 AM
  secondThresholdMinutes: 120, // 12:00 PM
  defaultHourlyRate: 31.25,
  overtimeMultiplier: 1.5,
  absencePenaltyMultiplier: 2.0,
  workLocations: [],
  enforceGeofence: true,
  officeNetworks: [],
  officePinEnabled: true,
  officePinMode: "daily_auto",
  officePinFixedCode: "2026",
  officePinSalt: "mft_office_pin_2026",
  officeDeviceAuthSecret: "MFT-OFFICE-2026",
  // HR-POL-2026 (off until enabled by an admin)
  ...POLICY_2026_SETTINGS_DEFAULTS,
};

const TRUSTED_OFFICE_PC_STORAGE_KEY = "mft_trusted_office_pc_v1";
const inMemoryVerifiedPins = new Map<string, number>();

export interface ClientConnectionInfo {
  /** True if browser explicitly reports cellular / mobile data (4G/5G/3G) instead of Wi-Fi/Ethernet. */
  isCellular: boolean;
  /** Raw connection type reported by Network Information API ("wifi", "cellular", "ethernet", "unknown"). */
  connectionType: string;
  /** True if User-Agent is a mobile/tablet device. */
  isMobileDevice: boolean;
}

/**
 * Detects whether the client is on cellular data (Mobile Data) vs Wi-Fi/Ethernet,
 * and whether the device is a mobile phone/tablet.
 */
export function detectConnectionInfo(): ClientConnectionInfo {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { isCellular: false, connectionType: "unknown", isMobileDevice: false };
  }
  const nav = navigator as Navigator & {
    connection?: { type?: string; effectiveType?: string };
    mozConnection?: { type?: string; effectiveType?: string };
    webkitConnection?: { type?: string; effectiveType?: string };
  };
  const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
  const rawType = String(conn?.type || "unknown").toLowerCase();
  const isCellular = rawType === "cellular" || rawType === "wimax" || rawType === "bluetooth";
  const ua = String(navigator.userAgent || "");
  const isMobileDevice = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  return {
    isCellular,
    connectionType: rawType,
    isMobileDevice,
  };
}

function normalizeDigits(str: string): string {
  return str
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .trim();
}

export function getLocalYmdForPin(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Computes the active Office Check-In PIN for a given YYYY-MM-DD date.
 */
export function computeDailyOfficePin(
  settings?: Partial<HrSettings>,
  dateYmd: string = getLocalYmdForPin(),
): string {
  if (settings?.officePinMode === "fixed") {
    const fixed = normalizeDigits(settings?.officePinFixedCode || "");
    if (fixed.length >= 4) return fixed;
  }
  const salt = (settings?.officePinSalt || "mft_office_pin_2026").trim();
  const seed = `${dateYmd}::${salt}`;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const pinNum = 1000 + (Math.abs(hash) % 9000);
  return String(pinNum);
}

/**
 * Verifies a worker-entered Office PIN against today's expected PIN.
 */
export function verifyOfficePinInput(
  inputPin: string,
  settings?: Partial<HrSettings>,
  dateYmd: string = getLocalYmdForPin(),
): boolean {
  if (settings?.officePinEnabled === false) return false;
  const cleaned = normalizeDigits(inputPin || "");
  if (!cleaned) return false;
  const expected = computeDailyOfficePin(settings, dateYmd);
  if (cleaned === expected) return true;
  if (settings?.officePinMode === "fixed" && settings?.officePinFixedCode) {
    return cleaned === normalizeDigits(settings.officePinFixedCode);
  }
  return false;
}

/**
 * Marks that the worker just verified the Office PIN for the immediate clock-in attempt
 * (valid for 2 minutes and consumed once the shift starts, so switching to Mobile Data later cannot reuse it).
 */
export function markOfficePinVerifiedForToday(uid: string, dateYmd: string = getLocalYmdForPin()): void {
  const key = `mft_office_pin_ok_${uid}_${dateYmd}`;
  const now = Date.now();
  inMemoryVerifiedPins.set(key, now);
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(key, String(now));
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function hasVerifiedOfficePinToday(uid: string, dateYmd: string = getLocalYmdForPin()): boolean {
  if (!uid) return false;
  const conn = detectConnectionInfo();
  if (conn.isCellular) return false;
  const key = `mft_office_pin_ok_${uid}_${dateYmd}`;
  const now = Date.now();
  const MAX_PIN_TOKEN_AGE_MS = 2 * 60 * 1000; // 2 minutes
  const memTs = inMemoryVerifiedPins.get(key);
  if (memTs && now - memTs <= MAX_PIN_TOKEN_AGE_MS) {
    return true;
  }
  if (typeof window === "undefined") return false;
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) {
      const ts = parseInt(raw, 10);
      if (Number.isFinite(ts) && now - ts <= MAX_PIN_TOKEN_AGE_MS) {
        return true;
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

export function consumeOfficePinVerification(uid: string, dateYmd: string = getLocalYmdForPin()): void {
  const key = `mft_office_pin_ok_${uid}_${dateYmd}`;
  inMemoryVerifiedPins.delete(key);
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * Checks if this browser is authorized as a permanent Trusted Office PC.
 * Never trusts mobile devices or cellular data connections.
 */
export function isTrustedOfficePc(settings?: Partial<HrSettings>): { trusted: boolean; label?: string } {
  if (typeof window === "undefined") return { trusted: false };
  const conn = detectConnectionInfo();
  if (conn.isCellular || conn.isMobileDevice) {
    return { trusted: false };
  }
  try {
    const raw = localStorage.getItem(TRUSTED_OFFICE_PC_STORAGE_KEY);
    if (!raw) return { trusted: false };
    const parsed = JSON.parse(raw) as { secret?: string; label?: string };
    const expected = normalizeDigits(settings?.officeDeviceAuthSecret || "MFT-OFFICE-2026").toUpperCase();
    const actual = normalizeDigits(parsed?.secret || "").toUpperCase();
    if (actual && actual === expected) {
      return { trusted: true, label: parsed.label || "جهاز كمبيوتر الشركة" };
    }
  } catch {
    /* ignore */
  }
  return { trusted: false };
}

/**
 * Authorizes the current browser as a Trusted Office PC using the Admin's setup code.
 */
export function authorizeTrustedOfficePc(
  inputCode: string,
  deviceLabel: string,
  settings?: Partial<HrSettings>,
): boolean {
  if (typeof window === "undefined") return false;
  const expected = normalizeDigits(settings?.officeDeviceAuthSecret || "MFT-OFFICE-2026").toUpperCase();
  const actual = normalizeDigits(inputCode || "").toUpperCase();
  if (!actual || actual !== expected) return false;
  try {
    localStorage.setItem(
      TRUSTED_OFFICE_PC_STORAGE_KEY,
      JSON.stringify({
        secret: settings?.officeDeviceAuthSecret || "MFT-OFFICE-2026",
        label: deviceLabel.trim() || "جهاز كمبيوتر الشركة",
        authorizedAt: new Date().toISOString(),
      }),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalizes an IP string or pattern by converting Arabic/Persian digits,
 * stripping invisible directional characters, whitespace, protocol prefixes, and ::ffff:.
 */
export function normalizeIpString(raw: string | null | undefined): string {
  if (!raw) return "";
  return normalizeDigits(String(raw))
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/^::ffff:/i, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

/**
 * Fetches all candidate Public IP addresses for the current client (both IPv4 and header IP).
 * Always prefers IPv4 first because all devices on the same office Wi-Fi NAT router share the same IPv4.
 */
export async function fetchAllClientPublicIps(): Promise<string[]> {
  const fetchWithTimeout = async (url: string, ms = 3000): Promise<Response> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      return await fetch(url, { cache: "no-store", signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  const results = await Promise.allSettled([
    (async () => {
      const res = await fetchWithTimeout("https://api.ipify.org?format=json", 2800);
      if (!res.ok) return null;
      const data = (await res.json()) as { ip?: string };
      return normalizeIpString(data?.ip);
    })(),
    (async () => {
      const res = await fetchWithTimeout("/api/client-ip", 2500);
      if (!res.ok) return null;
      const data = (await res.json()) as { ip?: string | null };
      return normalizeIpString(data?.ip);
    })(),
  ]);

  const ips: string[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value && !ips.includes(r.value)) {
      ips.push(r.value);
    }
  }
  return ips;
}

/**
 * Fetches the client's primary Public IP address (preferring IPv4).
 */
export async function fetchClientPublicIp(): Promise<string | null> {
  const ips = await fetchAllClientPublicIps();
  return ips[0] || null;
}

function getIpv6NetworkPrefix64(ip: string): string | null {
  if (!ip.includes(":")) return null;
  const parts = ip.split(":").filter(Boolean);
  if (parts.length < 4) return null;
  return parts.slice(0, 4).join(":");
}

/**
 * Checks if a client IP (or list of client IPs) matches any active configured Office Network IP / prefix.
 */
export function matchOfficeNetworkIp(
  clientIpOrList: string | string[] | null | undefined,
  settings?: Partial<HrSettings>,
): OfficeNetworkItem | null {
  const candidateIps = (Array.isArray(clientIpOrList) ? clientIpOrList : [clientIpOrList])
    .map((x) => normalizeIpString(x))
    .filter(Boolean);
  if (candidateIps.length === 0) return null;

  const activeNets = (settings?.officeNetworks ?? []).filter(
    (n) => n.active !== false && Boolean(normalizeIpString(n.ip)),
  );

  for (const net of activeNets) {
    // Allow comma or space separated patterns inside net.ip
    const rawPatterns = String(net.ip || "")
      .split(/[,\s|]+/)
      .map((p) => normalizeIpString(p))
      .filter(Boolean);

    for (const pat of rawPatterns) {
      for (const ip of candidateIps) {
        if (pat === ip) return net;
        if (pat.endsWith("*")) {
          const prefix = pat.replace(/\*+$/, "");
          if (prefix && ip.startsWith(prefix)) return net;
        }
        // If both are IPv6 addresses on the same router (/64 prefix), match the router prefix
        if (pat.includes(":") && ip.includes(":")) {
          const patPfx = getIpv6NetworkPrefix64(pat);
          const ipPfx = getIpv6NetworkPrefix64(ip);
          if (patPfx && ipPfx && patPfx === ipPfx) return net;
        }
      }
    }
  }
  return null;
}

export interface GeofenceCheckResult {
  enforced: boolean;
  inside: boolean;
  matchedLocation: WorkLocationItem | null;
  nearestLocation: WorkLocationItem | null;
  distanceMeters: number;
}

/**
 * Computes distance in meters between two GPS coordinates using Haversine formula.
 */
export function haversineDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Checks if a worker's GPS position is within at least one active configured work location.
 */
export function evaluateWorkerGeofence(
  workerLat: number,
  workerLng: number,
  settings: HrSettings = DEFAULT_HR_SETTINGS,
): GeofenceCheckResult {
  const activeLocs = (settings.workLocations ?? []).filter(
    (l) => l.active !== false && Number.isFinite(Number(l.lat)) && Number.isFinite(Number(l.lng)),
  );
  if (settings.enforceGeofence === false || activeLocs.length === 0) {
    return {
      enforced: false,
      inside: true,
      matchedLocation: null,
      nearestLocation: null,
      distanceMeters: 0,
    };
  }

  let nearest: WorkLocationItem | null = null;
  let minDistance = Infinity;
  let matched: WorkLocationItem | null = null;

  for (const loc of activeLocs) {
    const dist = haversineDistanceMeters(workerLat, workerLng, Number(loc.lat), Number(loc.lng));
    const radius = Math.max(30, Number(loc.radiusMeters) || 200);
    if (dist < minDistance) {
      minDistance = dist;
      nearest = loc;
    }
    if (dist <= radius && !matched) {
      matched = loc;
    }
  }

  return {
    enforced: true,
    inside: Boolean(matched),
    matchedLocation: matched,
    nearestLocation: nearest,
    distanceMeters: Number.isFinite(minDistance) ? minDistance : 0,
  };
}

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
    label: `${startFormatted} – ${endFormatted}`,
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
  callback: (settings: HrSettings, fromServer?: boolean) => void,
): () => void {
  const ref = doc(db, "settings", "hr");
  return onSnapshot(
    ref,
    (snap) => {
      if (snap.exists()) {
        callback(
          {
            ...DEFAULT_HR_SETTINGS,
            ...snap.data(),
          },
          true,
        );
      } else {
        callback(DEFAULT_HR_SETTINGS, true);
      }
    },
    (err) => {
      console.warn("[hrShared] Error subscribing to hr settings:", err);
      callback(DEFAULT_HR_SETTINGS, false);
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
