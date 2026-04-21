import {
  addDoc,
  collection,
  getDocs,
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
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as ExceptionRow[];
    rows.sort((a, b) => {
      const da = toDate(a.createdAt as never) ?? new Date(0);
      const db_ = toDate(b.createdAt as never) ?? new Date(0);
      return db_.getTime() - da.getTime();
    });
    return rows;
  }
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
  },
): Promise<string> {
  const ref = await addDoc(collection(db, "exceptionRequests"), {
    ...payload,
    status: "pending",
    createdAt: serverTimestamp(),
  });
  return ref.id;
}
