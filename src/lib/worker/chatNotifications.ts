import {
  addDoc,
  collection,
  onSnapshot,
  query,
  where,
  updateDoc,
  doc,
  serverTimestamp,
  getDocs,
  writeBatch,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";

export type ChatNotification = {
  id: string;
  recipientUid: string;
  taskId: string;
  taskTitle: string;
  senderName: string;
  senderRole: "worker" | "admin";
  messagePreview: string;
  isRead: boolean;
  createdAt: { toDate: () => Date } | null;
};

export function subscribeChatNotifications(
  db: Firestore,
  uid: string,
  callback: (notifications: ChatNotification[]) => void,
): Unsubscribe {
  const q = query(
    collection(db, "chatNotifications"),
    where("recipientUid", "==", uid),
  );
  return onSnapshot(
    q,
    (snap) => {
      const notifs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as ChatNotification)
        .filter((n) => n.isRead === false)
        .sort((a, b) => {
          const ta = a.createdAt?.toDate().getTime() ?? 0;
          const tb = b.createdAt?.toDate().getTime() ?? 0;
          return tb - ta;
        });
      callback(notifs);
    },
    (err) => {
      console.error("[ChatNotifications] listener error:", err.message, err);
      callback([]);
    },
  );
}

export async function sendChatNotification(
  db: Firestore,
  params: {
    recipientUids: string[];
    taskId: string;
    taskTitle: string;
    senderUid: string;
    senderName: string;
    senderRole: "worker" | "admin";
    messageText: string;
  },
): Promise<void> {
  const preview =
    params.messageText.length > 80
      ? params.messageText.slice(0, 80) + "…"
      : params.messageText;

  const promises = params.recipientUids
    .filter((uid) => uid !== params.senderUid)
    .map((uid) =>
      addDoc(collection(db, "chatNotifications"), {
        recipientUid: uid,
        taskId: params.taskId,
        taskTitle: params.taskTitle,
        senderName: params.senderName,
        senderRole: params.senderRole,
        messagePreview: preview,
        isRead: false,
        createdAt: serverTimestamp(),
      }),
    );
  await Promise.all(promises);
}

export async function markChatNotificationRead(
  db: Firestore,
  notificationId: string,
): Promise<void> {
  await updateDoc(doc(db, "chatNotifications", notificationId), {
    isRead: true,
  });
}

export async function sendChatNotificationToAdmin(
  db: Firestore,
  params: {
    taskId: string;
    taskTitle: string;
    senderUid: string;
    senderName: string;
    messageText: string;
  },
): Promise<void> {
  const preview =
    params.messageText.length > 80
      ? params.messageText.slice(0, 80) + "…"
      : params.messageText;

  await addDoc(collection(db, "chatNotifications"), {
    recipientUid: null,
    recipientRole: "admin",
    taskId: params.taskId,
    taskTitle: params.taskTitle,
    senderName: params.senderName,
    senderRole: "worker" as const,
    messagePreview: preview,
    isRead: false,
    createdAt: serverTimestamp(),
  });
}

export async function markTaskChatNotificationsRead(
  db: Firestore,
  uid: string,
  taskId: string,
): Promise<void> {
  const q = query(
    collection(db, "chatNotifications"),
    where("recipientUid", "==", uid),
  );
  const snap = await getDocs(q);
  const unread = snap.docs.filter(
    (d) => d.data().taskId === taskId && d.data().isRead === false,
  );
  if (unread.length === 0) return;

  const batch = writeBatch(db);
  unread.forEach((d) => batch.update(d.ref, { isRead: true }));
  await batch.commit();
}
