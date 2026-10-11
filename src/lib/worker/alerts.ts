import { arrayUnion, collection, doc, getDocs, onSnapshot, query, updateDoc, where, writeBatch } from "firebase/firestore";
import type { Firestore, Timestamp } from "firebase/firestore";

export type AlertRow = {
  id: string;
  title?: string;
  message?: string;
  type?: string;
  priority?: string;
  isRead?: boolean;
  sentAt?: Timestamp;
  createdAt?: Timestamp;
  sentBy?: string;
  hasPenalty?: boolean;
  penaltyApplied?: number;
  [k: string]: unknown;
};

function alertsQuery(db: Firestore, uid: string) {
  return query(collection(db, "alerts"), where("recipients", "array-contains", uid));
}

function sortAlerts(list: AlertRow[]): AlertRow[] {
  return list.sort((a, b) => {
    const da = a.sentAt?.toDate?.() ?? a.createdAt?.toDate?.() ?? new Date(0);
    const db_ = b.sentAt?.toDate?.() ?? b.createdAt?.toDate?.() ?? new Date(0);
    return db_.getTime() - da.getTime();
  });
}

export async function loadAlertsForWorker(db: Firestore, uid: string): Promise<AlertRow[]> {
  const snap = await getDocs(alertsQuery(db, uid));
  return sortAlerts(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as AlertRow[]);
}

/** Live alerts feed so HR notices appear without a page reload. */
export function subscribeAlertsForWorker(
  db: Firestore,
  uid: string,
  onData: (rows: AlertRow[]) => void,
  onError?: (e: Error) => void,
): () => void {
  return onSnapshot(
    alertsQuery(db, uid),
    (snap) => onData(sortAlerts(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as AlertRow[])),
    (e) => onError?.(e),
  );
}

export async function markAlertRead(db: Firestore, alertId: string, uid: string): Promise<void> {
  await updateDoc(doc(db, "alerts", alertId), {
    isRead: true,
    readBy: arrayUnion(uid),
  });
}

export async function markAlertsRead(db: Firestore, alertIds: string[], uid: string): Promise<void> {
  if (!alertIds.length) return;
  const batch = writeBatch(db);
  alertIds.forEach((id) => batch.update(doc(db, "alerts", id), { isRead: true, readBy: arrayUnion(uid) }));
  await batch.commit();
}
