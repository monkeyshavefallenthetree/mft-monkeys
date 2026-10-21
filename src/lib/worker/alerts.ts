import { arrayUnion, collection, doc, getDocs, onSnapshot, updateDoc, writeBatch } from "firebase/firestore";
import type { Firestore, Timestamp } from "firebase/firestore";

export type AlertRow = {
  id: string;
  title?: string;
  message?: string;
  type?: string;
  priority?: string;
  recipient?: string;
  isRead?: boolean;
  readBy?: string[];
  sentAt?: Timestamp;
  createdAt?: Timestamp;
  sentBy?: string;
  hasPenalty?: boolean;
  penaltyApplied?: number;
  [k: string]: unknown;
};

function isAlertForWorker(data: Record<string, unknown>, uid: string): boolean {
  if (data.recipient === "all") return true;
  if (data.workerId === uid) return true;
  if (Array.isArray(data.recipients) && data.recipients.includes(uid)) return true;
  return false;
}

function mapDocToAlertRow(id: string, data: Record<string, unknown>, uid: string): AlertRow {
  const readBy = Array.isArray(data.readBy) ? (data.readBy as string[]) : [];
  const isIndividual = data.recipient === "individual" || (!data.recipient && data.workerId === uid);
  const isReadForWorker = readBy.includes(uid) || (isIndividual && Boolean(data.isRead));
  return {
    id,
    ...data,
    readBy,
    isRead: isReadForWorker,
  } as AlertRow;
}

function sortAlerts(list: AlertRow[]): AlertRow[] {
  return list.sort((a, b) => {
    const da = a.sentAt?.toDate?.() ?? a.createdAt?.toDate?.() ?? new Date(0);
    const db_ = b.sentAt?.toDate?.() ?? b.createdAt?.toDate?.() ?? new Date(0);
    return db_.getTime() - da.getTime();
  });
}

export async function loadAlertsForWorker(db: Firestore, uid: string): Promise<AlertRow[]> {
  const snap = await getDocs(collection(db, "alerts"));
  const rows: AlertRow[] = [];
  snap.docs.forEach((d) => {
    const data = d.data() as Record<string, unknown>;
    if (isAlertForWorker(data, uid)) {
      rows.push(mapDocToAlertRow(d.id, data, uid));
    }
  });
  return sortAlerts(rows);
}

/** Live alerts feed so HR notices & broadcast messages appear to everyone without a page reload. */
export function subscribeAlertsForWorker(
  db: Firestore,
  uid: string,
  onData: (rows: AlertRow[]) => void,
  onError?: (e: Error) => void,
): () => void {
  return onSnapshot(
    collection(db, "alerts"),
    (snap) => {
      const rows: AlertRow[] = [];
      snap.docs.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        if (isAlertForWorker(data, uid)) {
          rows.push(mapDocToAlertRow(d.id, data, uid));
        }
      });
      onData(sortAlerts(rows));
    },
    (e) => onError?.(e),
  );
}

export async function markAlertRead(db: Firestore, alertId: string, uid: string): Promise<void> {
  await updateDoc(doc(db, "alerts", alertId), {
    readBy: arrayUnion(uid),
  });
}

export async function markAlertsRead(db: Firestore, alertIds: string[], uid: string): Promise<void> {
  if (!alertIds.length) return;
  const batch = writeBatch(db);
  alertIds.forEach((id) => batch.update(doc(db, "alerts", id), { readBy: arrayUnion(uid) }));
  await batch.commit();
}
