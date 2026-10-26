import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import type { Firestore, Timestamp } from "firebase/firestore";

export type ProjectRow = { id: string; name?: string; createdAt?: Timestamp; [k: string]: unknown };
export type WorkerRow = {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: string;
  department?: string;
  status?: string;
  [k: string]: unknown;
};

export type Subtask = {
  id: string;
  title: string;
  description?: string;
  link?: string;
  completed: boolean;
};

export function sanitizeSubtask(st: Partial<Subtask>): Subtask {
  const item: Subtask = {
    id: st.id || "st_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
    title: (st.title || "").trim(),
    completed: Boolean(st.completed),
  };
  const desc = (st.description || "").trim();
  if (desc) item.description = desc;
  const link = (st.link || "").trim();
  if (link) item.link = link;
  return item;
}

export function sanitizeSubtasks(list?: Subtask[] | null): Subtask[] {
  if (!Array.isArray(list)) return [];
  return list.map(sanitizeSubtask);
}

export type TaskRow = {
  id: string;
  title?: string;
  description?: string;
  projectId?: string;
  projectName?: string;
  department?: string;
  priority?: string;
  assignedTo?: string | string[];
  assignedWorkerName?: string;
  startDate?: Timestamp | Date | null;
  dueDate?: Timestamp | Date | null;
  photo?: string | null;
  status?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  startedAt?: Timestamp;
  submittedForApprovalAt?: Timestamp;
  rejectionReason?: string;
  subtasks?: Subtask[];
  createdBy?: string;
  createdByName?: string;
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

export function assignedWorkerIds(assignedTo: string | string[] | undefined | null): string[] {
  if (!assignedTo) return [];
  if (Array.isArray(assignedTo)) return assignedTo.filter((x) => Boolean(x) && String(x).toLowerCase() !== "unassigned");
  if (typeof assignedTo === "string") {
    const trimmed = assignedTo.trim();
    if (!trimmed || trimmed.toLowerCase() === "unassigned") return [];
    return [trimmed];
  }
  return [];
}

/**
 * Extracts all assigned worker UIDs for a task.
 * Prefers `assignedTo` when explicitly present so removals from Admin or Worker portal are respected.
 */
export function getTaskAssigneeIds(task: TaskRow | null | undefined): string[] {
  if (!task) return [];
  const fromAssignedTo = assignedWorkerIds(task.assignedTo);
  if (fromAssignedTo.length > 0) {
    return Array.from(new Set(fromAssignedTo));
  }
  // If assignedTo was explicitly set to empty string or empty array (unassigned), respect it if assignedWorkerIds is also empty
  if (Array.isArray(task.assignedWorkerIds) && task.assignedWorkerIds.length > 0 && task.assignedTo === undefined) {
    return Array.from(new Set(task.assignedWorkerIds.map(String).filter(Boolean)));
  }
  if (Array.isArray(task.assignedWorkerIds) && task.assignedWorkerIds.length > 0 && fromAssignedTo.length === 0) {
    // Also include assignedWorkerIds if assignedTo was not an empty clear
    const rawAssignedTo = task.assignedTo;
    if (rawAssignedTo !== "" && !(Array.isArray(rawAssignedTo) && rawAssignedTo.length === 0)) {
      return Array.from(new Set(task.assignedWorkerIds.map(String).filter(Boolean)));
    }
  }
  if (task.workerId && typeof task.workerId === "string" && task.workerId.toLowerCase() !== "unassigned" && !task.assignedTo) {
    return [task.workerId];
  }
  return [];
}

const ADMIN_OR_ACCOUNT_MANAGER_EMAILS = new Set([
  "admin@mft.com",
  "mayamahmoud@mft.com",
  "hr@mft.com",
]);

const ADMIN_OR_ACCOUNT_MANAGER_ROLES = new Set([
  "super_admin",
  "ops_admin",
  "admin",
  "account_manager",
  "account-manager",
  "account manager",
]);

/**
 * Returns true if the worker profile belongs to an Admin or Account Manager.
 */
export function isWorkerAdminOrAccountManager(
  user?: { email?: string | null; role?: string | null } | null,
): boolean {
  if (!user) return false;
  const email = (user.email || "").trim().toLowerCase();
  if (email && ADMIN_OR_ACCOUNT_MANAGER_EMAILS.has(email)) return true;
  const role = (user.role || "").trim().toLowerCase();
  if (role && ADMIN_OR_ACCOUNT_MANAGER_ROLES.has(role)) return true;
  if (role.includes("account manager") || role.includes("account-manager") || role.includes("account_manager")) {
    return true;
  }
  return false;
}

/**
 * Determines whether the current user has edit & access-management permissions on a task.
 * Only:
 *  1) Workers currently assigned to the task (`assignedTo` / `assignedWorkerIds`)
 *  2) Admin or Account Manager
 * can edit the task, change its status/checklist, or grant/change access (assign other workers).
 * All other workers have View-Only access until assigned by an assignee, Admin, or Account Manager.
 */
export function canUserManageTask(
  task: TaskRow | null | undefined,
  uid: string | null | undefined,
  user?: { email?: string | null; role?: string | null } | null,
): boolean {
  if (!task || !uid) return false;
  if (isWorkerAdminOrAccountManager(user)) return true;
  const assignees = getTaskAssigneeIds(task);
  return assignees.includes(uid);
}

/** Loads all tasks if accessible, or falls back to tasks assigned to or created by the worker. */
export async function loadTasksForWorker(db: Firestore, uid: string): Promise<TaskRow[]> {
  // First attempt: load all tasks so workers can collaborate across the workspace
  try {
    const snap = await getDocs(query(collection(db, "tasks"), orderBy("createdAt", "desc")));
    if (!snap.empty) {
      return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as TaskRow[];
    }
  } catch {
    // Fall back to targeted queries if root read is restricted
  }

  const q1 = query(collection(db, "tasks"), where("assignedTo", "array-contains", uid));
  const [snap1, snap2, snap3] = await Promise.all([
    getDocs(q1).catch(() => null),
    getDocs(query(collection(db, "tasks"), where("assignedTo", "==", uid))).catch(() => null),
    getDocs(query(collection(db, "tasks"), where("createdBy", "==", uid))).catch(() => null),
  ]);

  const map = new Map<string, TaskRow>();
  if (snap1) snap1.docs.forEach((d) => map.set(d.id, { id: d.id, ...d.data() } as TaskRow));
  if (snap2) snap2.docs.forEach((d) => { if (!map.has(d.id)) map.set(d.id, { id: d.id, ...d.data() } as TaskRow); });
  if (snap3) snap3.docs.forEach((d) => { if (!map.has(d.id)) map.set(d.id, { id: d.id, ...d.data() } as TaskRow); });

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
    title: string;
    description: string;
    projectId?: string;
    projectName?: string;
    department?: string;
    priority?: string;
    assignedTo?: string | string[];
    assignedWorkerName?: string;
    assignedWorkerIds?: string[];
    startDate?: Date | null;
    dueDate?: Date | null;
    photo?: string | null;
    subtasks?: Subtask[];
    createdBy: string;
    createdByName: string;
    notificationMessage?: string;
  },
): Promise<string> {
  const payload: Record<string, unknown> = {
    title: data.title.trim(),
    description: data.description.trim(),
    projectName: data.projectName || "",
    department: data.department || "general",
    photo: data.photo?.trim() || null,
    assignedTo: data.assignedTo ?? "",
    assignedWorkerIds: data.assignedWorkerIds ?? assignedWorkerIds(data.assignedTo),
    assignedWorkerName: data.assignedWorkerName || "Unassigned",
    priority: data.priority || "medium",
    status: "assigned",
    startDate: data.startDate ?? null,
    dueDate: data.dueDate ?? null,
    subtasks: data.subtasks || [],
    createdBy: data.createdBy,
    createdByName: data.createdByName,
    createdAt: serverTimestamp(),
    assignedAt: serverTimestamp(),
  };

  if (data.projectId) {
    payload.projectId = data.projectId;
  }

  const docRef = await addDoc(collection(db, "tasks"), payload);

  // Send assignment alerts & Web Push to assigned workers
  const targetWorkerIds = (data.assignedWorkerIds || assignedWorkerIds(data.assignedTo)).filter(
    (wid) => wid && wid !== data.createdBy,
  );
  for (const workerId of targetWorkerIds) {
    await addDoc(collection(db, "alerts"), {
      recipients: [workerId],
      title: "New Task Assigned",
      message: data.notificationMessage?.trim() || `${data.createdByName} assigned you to task: ${data.title}`,
      type: "schedule",
      priority: data.priority || "medium",
      isRead: false,
      createdAt: serverTimestamp(),
      sentAt: serverTimestamp(),
      sentBy: data.createdByName || "Team Member",
    }).catch(() => {});
  }
  if (targetWorkerIds.length > 0) {
    import("./webPush")
      .then(({ sendWebPushToWorkers }) =>
        sendWebPushToWorkers(db, {
          recipientUids: targetWorkerIds,
          title: "New Task Assigned 📋",
          body: data.notificationMessage?.trim() || `${data.createdByName} assigned you: ${data.title}`,
          tab: "tasks",
          taskId: docRef.id,
        }),
      )
      .catch(() => {});
  }

  return docRef.id;
}

export async function updateTask(
  db: Firestore,
  taskId: string,
  data: Record<string, unknown>,
  notification?: {
    assignedWorkerIds?: string[];
    message?: string;
    senderName?: string;
    taskTitle?: string;
    priority?: string;
    currentUid?: string;
  },
): Promise<void> {
  await updateDoc(doc(db, "tasks", taskId), {
    ...data,
    updatedAt: serverTimestamp(),
  });

  if (notification?.assignedWorkerIds && notification.assignedWorkerIds.length > 0) {
    const targets = notification.assignedWorkerIds.filter(
      (wid) => wid && wid !== notification.currentUid,
    );
    const bodyMsg =
      notification.message?.trim() ||
      `${notification.senderName || "Team"} updated task: ${notification.taskTitle || "Task"}`;
    for (const workerId of targets) {
      await addDoc(collection(db, "alerts"), {
        recipients: [workerId],
        title: "Task Reassigned / Updated",
        message: bodyMsg,
        type: "schedule",
        priority: notification.priority || "medium",
        isRead: false,
        createdAt: serverTimestamp(),
        sentAt: serverTimestamp(),
        sentBy: notification.senderName || "Team Member",
      }).catch(() => {});
    }
    if (targets.length > 0) {
      import("./webPush")
        .then(({ sendWebPushToWorkers }) =>
          sendWebPushToWorkers(db, {
            recipientUids: targets,
            title: "Task Updated 📋",
            body: bodyMsg,
            tab: "tasks",
            taskId,
          }),
        )
        .catch(() => {});
    }
  }
}

export async function deleteTask(db: Firestore, taskId: string): Promise<void> {
  await deleteDoc(doc(db, "tasks", taskId));
}

export function taskPhotoUrl(filename: string | null | undefined): string | null {
  if (!filename?.trim()) return null;
  const base = process.env.NEXT_PUBLIC_TASK_PHOTOS_BASE?.replace(/\/$/, "") ?? "";
  if (base) return `${base}/${filename.trim()}`;
  return `/photos/${filename.trim()}`;
}
