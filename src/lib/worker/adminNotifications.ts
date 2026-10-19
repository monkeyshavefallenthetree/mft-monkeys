import { addDoc, collection, serverTimestamp, type Firestore } from "firebase/firestore";
import { sendWebPushToAdmins } from "./webPush";

export type AdminTargetRole = "super_admin" | "ops_admin" | "account_manager" | "hr_admin";

export type AdminNotificationCategory = "chat" | "project" | "task" | "tasks" | "client" | "hr";

export interface NotifyAdminsInput {
  targetRoles: AdminTargetRole[];
  category: AdminNotificationCategory;
  eventType: string;
  title: string;
  body: string;
  href: string;
  actorUid?: string;
  actorName?: string;
  entityId?: string;
  projectId?: string;
  taskId?: string;
  urgent?: boolean;
}

/**
 * Records a real-time notification document in `adminNotifications` (with automatic
 * fallback to `alerts` so it works under all deployed Firestore rule versions)
 * AND dispatches background Web Push notifications to subscribed admin devices.
 */
export async function notifyAdmins(db: Firestore, input: NotifyAdminsInput): Promise<void> {
  const roles = Array.from(new Set<AdminTargetRole>(["super_admin", ...input.targetRoles]));

  const payload = {
    targetRoles: roles,
    category: input.category,
    eventType: input.eventType,
    title: input.title,
    body: input.body,
    href: input.href,
    actorUid: input.actorUid ?? null,
    actorName: input.actorName ?? null,
    entityId: input.entityId ?? null,
    projectId: input.projectId ?? null,
    taskId: input.taskId ?? null,
    readBy: [],
    createdAt: serverTimestamp(),
  };

  try {
    await addDoc(collection(db, "adminNotifications"), payload);
  } catch {
    try {
      await addDoc(collection(db, "alerts"), {
        ...payload,
        type: "schedule",
        isRead: false,
        hasPenalty: false,
        adminNotif: true,
      });
    } catch (err2) {
      console.warn("[AdminNotifications] Could not create adminNotification doc:", err2);
    }
  }

  try {
    await sendWebPushToAdmins(db, {
      roles,
      title: input.title,
      body: input.body,
      url: input.href,
      taskId: input.taskId,
      urgent: input.urgent,
    });
  } catch (err) {
    console.warn("[AdminNotifications] Web Push failed:", err);
  }
}
