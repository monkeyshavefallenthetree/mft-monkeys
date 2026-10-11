"use client";

import { useEffect, useRef, useState } from "react";
import type { Firestore } from "firebase/firestore";
import { sendTaskMessage, subscribeTaskChat, type ChatMessage } from "@/lib/worker/taskChat";
import { sendChatNotificationToAdmin, markTaskChatNotificationsRead } from "@/lib/worker/chatNotifications";
import { playTerminalBeep } from "@/lib/sound";

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
          playTerminalBeep();
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

  async function handleSend(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!input.trim() || busy) return;
    const textToSend = input.trim();
    setInput("");
    setBusy(true);
    try {
      await sendTaskMessage(db, taskId, {
        text: textToSend,
        senderUid: uid,
        senderName: workerName,
        senderRole: "worker",
      });
      void sendChatNotificationToAdmin(db, {
        taskId,
        taskTitle: taskTitle || taskId,
        senderUid: uid,
        senderName: workerName,
        messageText: textToSend,
      }).catch(() => {});
    } catch (err) {
      console.error(err);
      setInput(textToSend);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">Task Discussion</p>
        </div>
        <span className="text-[10px] text-zinc-500 font-mono">{messages.length} message{messages.length === 1 ? "" : "s"}</span>
      </div>

      {/* Message stream */}
      <div className="flex-1 space-y-3 overflow-y-auto p-4 max-h-[360px] min-h-[180px]">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-100 text-zinc-400 dark:bg-zinc-800">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p className="mt-2 text-xs font-medium text-zinc-600 dark:text-zinc-400">No messages yet</p>
            <p className="text-[11px] text-zinc-400">Ask a question or leave updates for the admin.</p>
          </div>
        ) : (
          messages.map((m) => {
            const isMe = m.senderUid === uid;
            const timeStr = m.createdAt?.toDate ? m.createdAt.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
            return (
              <div key={m.id} className={`flex flex-col gap-1 ${isMe ? "items-end" : "items-start"}`}>
                <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                  <span className="font-semibold">{isMe ? "You" : m.senderName || "Admin"}</span>
                  {!isMe && (
                    <span className="rounded bg-red-100 px-1 py-0.2 text-[9px] font-bold text-red-700 dark:bg-red-950/60 dark:text-red-400">
                      ADMIN
                    </span>
                  )}
                  <span>·</span>
                  <span>{timeStr}</span>
                </div>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                    isMe
                      ? "rounded-br-xs bg-red-600 text-white shadow-sm"
                      : "rounded-bl-xs border border-zinc-200 bg-zinc-100 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                  }`}
                >
                  {m.text}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <form onSubmit={handleSend} className="border-t border-zinc-200 p-2.5 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          placeholder="Write a message to admin…"
          className="flex-1 rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:bg-zinc-950 transition-all"
        />
        <button
          type="submit"
          disabled={!input.trim() || busy}
          className="inline-flex items-center justify-center rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white transition-all hover:bg-red-700 disabled:opacity-50 cursor-pointer"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      </form>
    </div>
  );
}
