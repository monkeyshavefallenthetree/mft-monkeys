import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import type { Firestore } from "firebase/firestore";

export type WorkSessionState = {
  id: string;
  startTime: Date;
  isActive: boolean;
};

export async function initWorkSession(
  db: Firestore,
  worker: { uid: string; firstName?: string; lastName?: string; email?: string },
  loginTimeIso: string,
): Promise<WorkSessionState | null> {
  const loginTime = new Date(loginTimeIso);
  const today = new Date().toISOString().split("T")[0];

  const q = query(
    collection(db, "workSessions"),
    where("workerId", "==", worker.uid),
    where("date", "==", today),
  );

  try {
    const snap = await getDocs(q);
    if (!snap.empty) {
      const existing = snap.docs[0]!;
      const data = existing.data();
      const start = data.startTime?.toDate?.() ?? new Date(data.startTime);
      await updateDoc(doc(db, "workSessions", existing.id), {
        isActive: true,
        lastLoginTime: loginTime,
        lastUpdated: serverTimestamp(),
      });
      return { id: existing.id, startTime: start, isActive: true };
    }

    const ref = await addDoc(collection(db, "workSessions"), {
      workerId: worker.uid,
      workerName: `${worker.firstName ?? ""} ${worker.lastName ?? ""}`.trim(),
      workerEmail: worker.email ?? "",
      loginTime,
      startTime: loginTime,
      isActive: true,
      totalWorkTime: 0,
      date: today,
      createdAt: serverTimestamp(),
    });

    return { id: ref.id, startTime: loginTime, isActive: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("index")) {
      const ref = await addDoc(collection(db, "workSessions"), {
        workerId: worker.uid,
        workerName: `${worker.firstName ?? ""} ${worker.lastName ?? ""}`.trim(),
        workerEmail: worker.email ?? "",
        loginTime,
        startTime: loginTime,
        isActive: true,
        totalWorkTime: 0,
        date: today,
        createdAt: serverTimestamp(),
      });
      return { id: ref.id, startTime: loginTime, isActive: true };
    }
    console.error("initWorkSession", e);
    return null;
  }
}

export async function syncWorkSession(
  db: Firestore,
  session: WorkSessionState,
): Promise<void> {
  if (!session.isActive) return;
  const now = new Date();
  const totalWorkTime = now.getTime() - session.startTime.getTime();
  await updateDoc(doc(db, "workSessions", session.id), {
    totalWorkTime,
    lastUpdated: serverTimestamp(),
  });
}

export async function endWorkSession(
  db: Firestore,
  session: WorkSessionState,
): Promise<void> {
  const logoutTime = new Date();
  const totalWorkTime = logoutTime.getTime() - session.startTime.getTime();
  await updateDoc(doc(db, "workSessions", session.id), {
    logoutTime,
    endTime: logoutTime,
    isActive: false,
    totalWorkTime,
    completedAt: serverTimestamp(),
  });
}
