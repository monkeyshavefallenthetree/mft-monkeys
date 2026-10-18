import { addDoc, collection, serverTimestamp, type Firestore } from "firebase/firestore";
import { sendWebPushToAdmins } from "./webPush";

export type AdminTargetRole = "super_admin" | "ops_admin" | "hr_admin";

export type AdminNotificationCategory = "chat" | "project" | "task" | "client" | "hr";

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
 * Records a real-time notification document in `adminNotifications` for the target
 * admin roles (`super_admin`, `ops_admin` / Account Manager, `hr_admin` / HR)
 * AND dispatches background Web Push notifications to their subscribed devices.
 */
export async function notifyAdmins(db: Firestore, input: NotifyAdminsInput): Promise<void> {
  const roles = Array.from(new Set<AdminTargetRole>(["super_admin", ...input.targetRoles]));

  try {
    await addDoc(collection(db, "adminNotifications"), {
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
    });
  } catch (err) {
    console.warn("[AdminNotifications] Could not create adminNotification doc:", err);
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
