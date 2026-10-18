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
    reason: string;
    supportingEvidence: string | null;
    requestedAmount?: number | null;
    /** HR-POL-2026 annual leave length in days (0.5 steps). */
    leaveDays?: number | null;
  },
): Promise<string> {
  const ref = await addDoc(collection(db, "exceptionRequests"), {
    ...payload,
    status: "pending",
    createdAt: serverTimestamp(),
  });

  import("./adminNotifications")
    .then(({ notifyAdmins }) =>
      notifyAdmins(db, {
        targetRoles: ["super_admin", "hr_admin"],
        category: "hr",
        eventType: "exception_submitted",
        title: `📋 New ${payload.type.replace(/_/g, " ")} Request`,
        body: `${payload.workerName} (${payload.exceptionDate}): ${payload.reason.slice(0, 80)}`,
        href: "/admin/exceptions",
        actorUid: payload.workerId,
        actorName: payload.workerName,
      }),
    )
    .catch(() => {});

  return ref.id;
}
