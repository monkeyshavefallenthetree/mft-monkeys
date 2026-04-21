import { arrayUnion, collection, doc, getDocs, query, updateDoc, where } from "firebase/firestore";
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

export async function loadAlertsForWorker(db: Firestore, uid: string): Promise<AlertRow[]> {
  const q = query(collection(db, "alerts"), where("recipients", "array-contains", uid));
  const snap = await getDocs(q);
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as AlertRow[];
  list.sort((a, b) => {
    const da = a.sentAt?.toDate?.() ?? a.createdAt?.toDate?.() ?? new Date(0);
    const db_ = b.sentAt?.toDate?.() ?? b.createdAt?.toDate?.() ?? new Date(0);
    return db_.getTime() - da.getTime();
  });
  return list;
}

export async function markAlertRead(db: Firestore, alertId: string, uid: string): Promise<void> {
  await updateDoc(doc(db, "alerts", alertId), {
    isRead: true,
    readBy: arrayUnion(uid),
  });
}
