import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";
import { sendWebPushToWorkers } from "./webPush";
import { notifyAdmins } from "./adminNotifications";

export type ProjectChatMessage = {
  id: string;
  text: string;
  senderUid: string;
  senderName: string;
  senderRole: "worker" | "admin";
  senderTitle?: string;
  isSystem?: boolean;
  createdAt: { toDate: () => Date } | null;
};

export function subscribeProjectChat(
  db: Firestore,
  projectId: string,
  callback: (msgs: ProjectChatMessage[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(db, "projects", projectId, "messages"),
    orderBy("createdAt", "asc"),
  );
  return onSnapshot(
    q,
    (snap) => {
      callback(
        snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ProjectChatMessage),
      );
    },
    (err) => {
      console.warn("[ProjectChat] Firestore listener error:", err.message);
      onError?.(err);
    },
  );
}

export async function sendProjectMessage(
  db: Firestore,
  params: {
    projectId: string;
    projectName: string;
    text: string;
    senderUid: string;
    senderName: string;
    senderTitle?: string;
    recipientWorkerIds?: string[];
  },
): Promise<void> {
  const trimmed = params.text.trim();
  if (!trimmed) return;

  await addDoc(collection(db, "projects", params.projectId, "messages"), {
    text: trimmed,
    senderUid: params.senderUid,
    senderName: params.senderName,
    senderRole: "worker" as const,
    senderTitle: params.senderTitle || "Team Member",
    isSystem: false,
    createdAt: serverTimestamp(),
  });

  const preview = trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;

  // Update project last-message metadata (best effort)
  await updateDoc(doc(db, "projects", params.projectId), {
    lastMessageAt: serverTimestamp(),
    lastMessageText: preview,
    lastMessageSender: params.senderName,
    updatedAt: serverTimestamp(),
  }).catch(() => {});

  const targets = (params.recipientWorkerIds ?? []).filter(
    (uid) => Boolean(uid) && uid !== params.senderUid,
  );

  // 1. Notify teammate workers in the project
  if (targets.length > 0) {
    await Promise.all(
      targets.map((uid) =>
        addDoc(collection(db, "chatNotifications"), {
          recipientUid: uid,
          recipientRole: null,
          chatType: "project",
          projectId: params.projectId,
          projectName: params.projectName,
          taskId: `project:${params.projectId}`,
          taskTitle: `${params.projectName} (Group Chat)`,
          senderName: params.senderName,
          senderRole: "worker" as const,
          messagePreview: preview,
          isRead: false,
          createdAt: serverTimestamp(),
        }).catch(() => {}),
      ),
    );

    void sendWebPushToWorkers(db, {
      recipientUids: targets,
      title: `💬 ${params.projectName} · ${params.senderName}`,
      body: preview,
      tab: "tasks",
      url: `/dashboard?tab=tasks&projectChat=${encodeURIComponent(params.projectId)}`,
    }).catch(() => {});
  }

  // 2. Create admin chatNotification for project unread badge
  await addDoc(collection(db, "chatNotifications"), {
    recipientUid: null,
    recipientRole: "admin",
    chatType: "project",
    projectId: params.projectId,
    projectName: params.projectName,
    taskId: `project:${params.projectId}`,
    taskTitle: `${params.projectName} (Group Chat)`,
    senderName: params.senderName,
    senderRole: "worker" as const,
    messagePreview: preview,
    isRead: false,
    createdAt: serverTimestamp(),
  }).catch(() => {});

  // 3. Notify Super Admin & Account Manager (ops_admin) via adminNotifications + Web Push
  await notifyAdmins(db, {
    targetRoles: ["super_admin", "ops_admin"],
    category: "chat",
    eventType: "project_chat_message",
    title: `💬 ${params.projectName} (Group Chat)`,
    body: `${params.senderName}: ${preview}`,
    href: `/admin/projects?project=${encodeURIComponent(params.projectId)}&view=chat`,
    actorUid: params.senderUid,
    actorName: params.senderName,
    projectId: params.projectId,
  });
}

export async function markProjectChatNotificationsRead(
  db: Firestore,
  uid: string,
  projectId: string,
): Promise<void> {
  try {
    const q = query(
      collection(db, "chatNotifications"),
      where("recipientUid", "==", uid),
    );
    const snap = await getDocs(q);
    const key = `project:${projectId}`;
    const unread = snap.docs.filter((d) => {
      const data = d.data();
      return (
        data.isRead === false &&
        (data.projectId === projectId || data.taskId === key)
      );
    });
    if (unread.length === 0) return;

    const batch = writeBatch(db);
    unread.forEach((d) => batch.update(d.ref, { isRead: true }));
    await batch.commit();
  } catch {
    /* ignore */
  }
}
