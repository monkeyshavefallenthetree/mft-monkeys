import {
  addDoc,
  collection,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { toDate } from "./format";

export type ExceptionRow = Record<string, unknown> & { id: string };

export async function loadWorkerExceptions(db: Firestore, workerId: string): Promise<ExceptionRow[]> {
  try {
    const q = query(
      collection(db, "exceptionRequests"),
      where("workerId", "==", workerId),
      orderBy("createdAt", "desc"),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    const q2 = query(collection(db, "exceptionRequests"), where("workerId", "==", workerId));
    const snap = await getDocs(q2);
    return sortByCreatedDesc(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as ExceptionRow[]);
  }
}

function sortByCreatedDesc(rows: ExceptionRow[]): ExceptionRow[] {
  return rows.sort((a, b) => {
    const da = toDate(a.createdAt as never) ?? new Date();
    const db_ = toDate(b.createdAt as never) ?? new Date();
    return db_.getTime() - da.getTime();
  });
}

/**
 * Live feed of the worker's requests so admin decisions show up instantly.
 * Uses the single-field query (no composite index needed) and sorts locally.
 */
export function subscribeWorkerExceptions(
  db: Firestore,
  workerId: string,
  onData: (rows: ExceptionRow[]) => void,
  onError?: (e: Error) => void,
): () => void {
  return onSnapshot(
    query(collection(db, "exceptionRequests"), where("workerId", "==", workerId)),
    (snap) => onData(sortByCreatedDesc(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as ExceptionRow[])),
    (e) => onError?.(e),
  );
}

export async function submitException(
  db: Firestore,
  payload: {
    workerId: string;
    workerName: string;
    workerEmail: string;
    type: string;
    lateMinutes: number | null;
    exceptionDate: string;
    endDate?: string | null;
    reason: string;
    supportingEvidence: string | null;
    requestedAmount?: number | null;
    /** HR-POL-2026 annual leave length in days (0.5 steps). */
    leaveDays?: number | null;
    /** External mission duration in hours & screenshot proof when outside allowed geofence. */
    missionHours?: number | null;
    screenshotUrl?: string | null;
    workerLat?: number | null;
    workerLng?: number | null;
    nearestLocationName?: string | null;
    distanceMeters?: number | null;
  },
): Promise<string> {
  const ref = await addDoc(collection(db, "exceptionRequests"), {
    ...payload,
    status: "pending",
    createdAt: serverTimestamp(),
  });

  const labelMap: Record<string, string> = {
    external_mission: "🚗 External Mission (مأمورية خارجية)",
    advance_late: "Advance Late Permission (إذن تأخير مسبق)",
    early_permission: "Early Leave Permission (إذن انصراف مبكر)",
    unpaid_leave: "Unpaid Leave (إجازة بدون مرتب)",
    annual_leave: "Annual Leave (إجازة سنوية)",
    late: "Late Arrival Excuse (استثناء تأخير)",
    absent: "Absence Excuse (عذر غياب)",
    overtime: "Overtime (عمل إضافي)",
    sick_leave: "Sick Leave (إجازة مرضية)",
    emergency_leave: "Emergency Leave (إجازة عارضة)",
    advance_request: "Salary Advance (سلفة)",
  };
  const label = labelMap[payload.type] || payload.type.replace(/_/g, " ");
  const dateRangeStr =
    payload.endDate && payload.endDate !== payload.exceptionDate
      ? `${payload.exceptionDate} → ${payload.endDate}`
      : payload.exceptionDate;

  import("./adminNotifications")
    .then(({ notifyAdmins }) =>
      notifyAdmins(db, {
        targetRoles: ["super_admin", "hr_admin"],
        category: "hr",
        eventType: "exception_submitted",
        title: `📋 New Request: ${label}`,
        body: `${payload.workerName} (${dateRangeStr}): ${payload.reason.slice(0, 80)}`,
        href: "/admin/exceptions",
        actorUid: payload.workerId,
        actorName: payload.workerName,
      }),
    )
    .catch(() => {});

  return ref.id;
}
