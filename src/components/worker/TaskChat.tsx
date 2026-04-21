"use client";

import { useEffect, useRef, useState } from "react";
import type { Firestore } from "firebase/firestore";
import { sendTaskMessage, subscribeTaskChat, type ChatMessage } from "@/lib/worker/taskChat";
import { sendChatNotificationToAdmin, markTaskChatNotificationsRead } from "@/lib/worker/chatNotifications";

type Props = {
  db: Firestore;
  taskId: string;
  taskTitle?: string;
  uid: string;
  workerName: string;
  onNewAdminMessage?: () => void;
};

export default function TaskChat({ db, taskId, taskTitle, uid, workerName, onNewAdminMessage }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);
  const isFirstRender = useRef(true);

  useEffect(() => {
    const unsub = subscribeTaskChat(db, taskId, (msgs) => {
      setMessages(msgs);

      if (!isFirstRender.current && msgs.length > prevCountRef.current) {
        const latest = msgs[msgs.length - 1];
        if (latest && latest.senderUid !== uid && latest.senderRole === "admin") {
          onNewAdminMessage?.();
        }
      }
      prevCountRef.current = msgs.length;
      isFirstRender.current = false;
    });
    return () => unsub();
  }, [db, taskId, uid, onNewAdminMessage]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    markTaskChatNotificationsRead(db, uid, taskId).catch(() => {});
  }, [db, uid, taskId, messages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    setBusy(true);
    try {
      await sendTaskMessage(db, taskId, {
        text: input,
        senderUid: uid,
        senderName: workerName,
        senderRole: "worker",
      });
      void sendChatNotificationToAdmin(db, {
        taskId,
        taskTitle: taskTitle || taskId,
        senderUid: uid,
        senderName: workerName,
        messageText: input,
      }).catch(() => {});
      setInput("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t border-[var(--mft-border)] pt-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)] mb-3">
        {"// COMMS CHANNEL"}
      </p>

      {/* Message list */}
      <div className="max-h-48 overflow-y-auto flex flex-col gap-2 mb-3 pr-1">
        {messages.length === 0 && (
          <p className="text-[10px] uppercase tracking-widest text-[var(--mft-muted)] italic">
            No messages yet. Start the conversation.
          </p>
        )}
        {messages.map((m) => {
          const isMe = m.senderUid === uid;
          const ts = m.createdAt?.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          return (
            <div
              key={m.id}
              className={`flex flex-col gap-0.5 ${isMe ? "items-end" : "items-start"}`}
            >
              <div
                className={`max-w-[80%] border px-3 py-2 text-sm leading-snug ${
                  isMe
                    ? "border-[var(--mft-primary)] bg-[var(--mft-primary)]/10 text-white"
                    : "border-[var(--mft-border)] bg-[var(--mft-surface)] text-white"
                }`}
              >
                {m.text}
              </div>
              <p className="text-[9px] uppercase tracking-widest text-[var(--mft-muted)]">
                {isMe ? "YOU" : `ADMIN`} · {ts ?? "—"}
              </p>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={(e) => void handleSend(e)} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type message..."
          disabled={busy}
          className="brutal-input flex-1 text-xs py-2 placeholder:text-zinc-600"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="brutal-btn px-4 py-2 text-xs disabled:opacity-40"
        >
          {busy ? "..." : "[ SEND ]"}
        </button>
      </form>
    </div>
  );
}
