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
  // Store & subscribe at tasks/project_{projectId}/messages so it is authorized
  // under both `tasks/{id}/messages` and `projects/{id}/messages` rules.
  const qTask = query(
    collection(db, "tasks", `project_${projectId}`, "messages"),
    orderBy("createdAt", "asc"),
  );
  const qProj = query(
    collection(db, "projects", projectId, "messages"),
    orderBy("createdAt", "asc"),
  );

  let taskMsgs: ProjectChatMessage[] = [];
  let projMsgs: ProjectChatMessage[] = [];

  const emitMerged = () => {
    const map = new Map<string, ProjectChatMessage>();
    for (const m of [...projMsgs, ...taskMsgs]) {
      const key = `${m.senderUid}_${m.text}_${m.createdAt?.toDate?.()?.getTime() ?? m.id}`;
      if (!map.has(key)) map.set(key, m);
    }
    const merged = Array.from(map.values()).sort((a, b) => {
      const ta = a.createdAt?.toDate?.()?.getTime() ?? 0;
      const tb = b.createdAt?.toDate?.()?.getTime() ?? 0;
      return ta - tb;
    });
    callback(merged);
  };

  const unsub1 = onSnapshot(
    qTask,
    (snap) => {
      taskMsgs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ProjectChatMessage);
      emitMerged();
    },
    (err) => {
      onError?.(err);
    },
  );

  const unsub2 = onSnapshot(
    qProj,
    (snap) => {
      projMsgs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ProjectChatMessage);
      emitMerged();
    },
    () => {
      /* ignore if projects/{id}/messages rule is not deployed yet */
    },
  );

  return () => {
    unsub1();
    unsub2();
  };
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

  const msgData = {
    text: trimmed,
    senderUid: params.senderUid,
    senderName: params.senderName,
    senderRole: "worker" as const,
    senderTitle: params.senderTitle || "Team Member",
    isSystem: false,
    createdAt: serverTimestamp(),
  };

  await addDoc(collection(db, "tasks", `project_${params.projectId}`, "messages"), msgData);
  await addDoc(collection(db, "projects", params.projectId, "messages"), msgData).catch(() => {});

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
