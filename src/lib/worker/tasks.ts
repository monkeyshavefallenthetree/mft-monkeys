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
import type { Firestore, Timestamp } from "firebase/firestore";

export type ProjectRow = { id: string; name?: string; createdAt?: Timestamp; [k: string]: unknown };
export type WorkerRow = { id: string; firstName?: string; lastName?: string; email?: string; [k: string]: unknown };
export type TaskRow = {
  id: string;
  title?: string;
  description?: string;
  projectId?: string;
  projectName?: string;
  department?: string;
  priority?: string;
  assignedTo?: string | string[];
  dueDate?: Timestamp | Date | null;
  photo?: string | null;
  status?: string;
  createdAt?: Timestamp;
  startedAt?: Timestamp;
  submittedForApprovalAt?: Timestamp;
  rejectionReason?: string;
  [k: string]: unknown;
};

export async function loadProjects(db: Firestore): Promise<ProjectRow[]> {
  const snap = await getDocs(collection(db, "projects"));
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as ProjectRow[];
  list.sort((a, b) => {
    const da = a.createdAt?.toDate?.() ?? new Date(0);
    const db_ = b.createdAt?.toDate?.() ?? new Date(0);
    return db_.getTime() - da.getTime();
  });
  return list;
}

export async function loadAllWorkers(db: Firestore): Promise<WorkerRow[]> {
  const snap = await getDocs(collection(db, "workers"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as WorkerRow[];
}

export async function loadTasksForWorker(db: Firestore, uid: string): Promise<TaskRow[]> {
  const q1 = query(collection(db, "tasks"), where("assignedTo", "array-contains", uid));
  const [snap1, snap2] = await Promise.all([
    getDocs(q1),
    getDocs(query(collection(db, "tasks"), where("assignedTo", "==", uid))).catch(() => null),
  ]);

  const map = new Map<string, TaskRow>();
  snap1.docs.forEach((d) => map.set(d.id, { id: d.id, ...d.data() } as TaskRow));
  if (snap2) {
    snap2.docs.forEach((d) => {
      if (!map.has(d.id)) map.set(d.id, { id: d.id, ...d.data() } as TaskRow);
    });
  }

  const list = [...map.values()];
  list.sort((a, b) => {
    const da = a.createdAt?.toDate?.() ?? new Date(0);
    const db_ = b.createdAt?.toDate?.() ?? new Date(0);
    return db_.getTime() - da.getTime();
  });
  return list;
}

export async function createTask(
  db: Firestore,
  data: {
    projectId: string;
    projectName?: string;
    title: string;
    description: string;
    department: string;
    priority: string;
    assignedTo: string[];
    dueDate: Date | null;
    photo: string | null;
    createdBy: string;
  },
): Promise<void> {
  await addDoc(collection(db, "tasks"), {
    ...data,
    status: "assigned",
    createdAt: serverTimestamp(),
    assignedAt: serverTimestamp(),
  });
}

export async function updateTask(
  db: Firestore,
  taskId: string,
  data: Record<string, unknown>,
): Promise<void> {
  await updateDoc(doc(db, "tasks", taskId), data);
}

export function taskPhotoUrl(filename: string | null | undefined): string | null {
  if (!filename?.trim()) return null;
  const base = process.env.NEXT_PUBLIC_TASK_PHOTOS_BASE?.replace(/\/$/, "") ?? "";
  if (base) return `${base}/${filename.trim()}`;
  return `/photos/${filename.trim()}`;
}
