import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore";

export type ChatMessage = {
  id: string;
  text: string;
  senderUid: string;
  senderName: string;
  senderRole: "worker" | "admin";
  createdAt: { toDate: () => Date } | null;
};

export function subscribeTaskChat(
  db: Firestore,
  taskId: string,
  callback: (msgs: ChatMessage[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(db, "tasks", taskId, "messages"),
    orderBy("createdAt", "asc"),
  );
  return onSnapshot(
    q,
    (snap) => {
      callback(
        snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ChatMessage),
      );
    },
    (err) => {
      console.warn("[TaskChat] Firestore listener error:", err.message);
      onError?.(err);
    },
  );
}

export async function sendTaskMessage(
  db: Firestore,
  taskId: string,
  {
    text,
    senderUid,
    senderName,
    senderRole,
  }: {
    text: string;
    senderUid: string;
    senderName: string;
    senderRole: "worker" | "admin";
  },
): Promise<void> {
  await addDoc(collection(db, "tasks", taskId, "messages"), {
    text: text.trim(),
    senderUid,
    senderName,
    senderRole,
    createdAt: serverTimestamp(),
  });
}
