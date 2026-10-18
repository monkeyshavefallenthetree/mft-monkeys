"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Firestore } from "firebase/firestore";
import {
  subscribeProjectChat,
  sendProjectMessage,
  markProjectChatNotificationsRead,
  type ProjectChatMessage,
} from "@/lib/worker/projectChat";
import { assignedWorkerIds, type ProjectRow, type TaskRow, type WorkerRow } from "@/lib/worker/tasks";
import { playTerminalBeep } from "@/lib/sound";

type Props = {
  db: Firestore;
  project: ProjectRow | null;
  tasks: TaskRow[];
  workers: WorkerRow[];
  uid: string;
  workerName: string;
  onClose: () => void;
  onNewAdminMessage?: () => void;
};

export default function ProjectGroupChatModal({
  db,
  project,
  tasks,
  workers,
  uid,
  workerName,
  onClose,
  onNewAdminMessage,
}: Props) {
  const [messages, setMessages] = useState<ProjectChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);
  const isFirstRender = useRef(true);

  const projectTasks = useMemo(() => {
    if (!project) return [];
    return tasks.filter((t) => t.projectId === project.id);
  }, [tasks, project]);

  const projectMemberIds = useMemo(() => {
    if (!project) return [];
    const set = new Set<string>();
    const rawMembers = (project as { memberIds?: unknown }).memberIds;
    if (Array.isArray(rawMembers)) {
      for (const id of rawMembers) {
        if (typeof id === "string" && id.trim()) set.add(id.trim());
      }
    }
    for (const t of projectTasks) {
      for (const wid of assignedWorkerIds(t.assignedTo)) {
        if (wid) set.add(wid);
      }
      if (Array.isArray(t.assignedWorkerIds)) {
        for (const wid of t.assignedWorkerIds) {
          if (wid) set.add(wid);
        }
      }
      if (t.workerId) set.add(String(t.workerId));
    }
    set.add(uid);
    return [...set];
  }, [project, projectTasks, uid]);

  useEffect(() => {
    if (!project) return;
    isFirstRender.current = true;
    prevCountRef.current = 0;

    const unsub = subscribeProjectChat(db, project.id, (msgs) => {
      setMessages(msgs);

      if (!isFirstRender.current && msgs.length > prevCountRef.current) {
        const latest = msgs[msgs.length - 1];
        if (latest && latest.senderUid !== uid) {
          playTerminalBeep();
          onNewAdminMessage?.();
        }
      }
      prevCountRef.current = msgs.length;
      isFirstRender.current = false;
    });
    return () => unsub();
  }, [db, project, uid, onNewAdminMessage]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (!project) return;
    markProjectChatNotificationsRead(db, uid, project.id).catch(() => {});
  }, [db, uid, project, messages.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!project) return null;

  const projectName = project.name || (project.title as string) || project.id;

  const getWorkerName = (id: string) => {
    if (id === uid) return workerName ? `${workerName} (You)` : "You";
    const w = workers.find((x) => x.id === id);
    if (!w) return "Team Member";
    return `${w.firstName ?? ""} ${w.lastName ?? ""}`.trim() || "Team Member";
  };

  async function handleSend(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!input.trim() || busy || !project) return;
    const textToSend = input.trim();
    setInput("");
    setBusy(true);
    try {
      const me = workers.find((w) => w.id === uid);
      await sendProjectMessage(db, {
        projectId: project.id,
        projectName,
        text: textToSend,
        senderUid: uid,
        senderName: workerName || "Team Member",
        senderTitle: me?.role || me?.department || "Team Member",
        recipientWorkerIds: projectMemberIds,
      });
    } catch (err) {
      console.error(err);
      setInput(textToSend);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 sm:p-4 backdrop-blur-xs animate-fade-in"
      onClick={onClose}
    >
      <div
        className="flex h-[82vh] max-h-[680px] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-5 py-3.5 dark:border-zinc-800 dark:bg-zinc-900/90">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <h3 className="truncate text-sm font-bold text-zinc-900 dark:text-white">
                💬 {projectName} — Group Chat
              </h3>
            </div>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              Connected to Project · Account Manager, Admin & {projectMemberIds.length} team member
              {projectMemberIds.length === 1 ? "" : "s"} notified in real time
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-200/70 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Team Members Strip */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-100 bg-white px-5 py-2 dark:border-zinc-800/80 dark:bg-zinc-950/40">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mr-1">
            Team:
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-950/60 dark:text-red-300">
            🛡️ Admin & Account Mgr
          </span>
          {projectMemberIds.slice(0, 8).map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            >
              👤 {getWorkerName(id)}
            </span>
          ))}
        </div>

        {/* Messages Stream */}
        <div className="flex-1 space-y-3 overflow-y-auto p-4 sm:p-5 bg-zinc-50/40 dark:bg-zinc-950/20">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400">
                <span className="text-xl">💬</span>
              </div>
              <p className="mt-3 text-sm font-bold text-zinc-800 dark:text-zinc-200">
                Start the {projectName} Group Discussion
              </p>
              <p className="mt-1 max-w-xs text-xs text-zinc-500">
                Messages posted here are shared with all project members, the Account Manager, and Admin.
              </p>
            </div>
          ) : (
            messages.map((m) => {
              const isMe = m.senderUid === uid;
              const isAdmin = m.senderRole === "admin";
              const timeStr = m.createdAt?.toDate
                ? m.createdAt.toDate().toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "";

              if (m.isSystem) {
                return (
                  <div key={m.id} className="flex justify-center my-2">
                    <div className="rounded-full border border-zinc-200 bg-white px-3.5 py-1 text-[11px] font-medium text-zinc-600 shadow-2xs dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                      🚀 {m.text}
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={m.id}
                  className={`flex flex-col gap-1 ${isMe ? "items-end" : "items-start"}`}
                >
                  <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                    <span className="font-bold text-zinc-700 dark:text-zinc-300">
                      {isMe ? "You" : m.senderName || (isAdmin ? "Admin" : "Teammate")}
                    </span>
                    {isAdmin ? (
                      <span className="rounded bg-red-100 px-1.5 py-0.2 text-[9px] font-bold uppercase text-red-700 dark:bg-red-950/60 dark:text-red-400">
                        {m.senderTitle || "ADMIN"}
                      </span>
                    ) : (
                      m.senderTitle && (
                        <span className="rounded bg-zinc-200/70 px-1.5 py-0.2 text-[9px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                          {m.senderTitle}
                        </span>
                      )
                    )}
                    {timeStr && (
                      <>
                        <span>·</span>
                        <span>{timeStr}</span>
                      </>
                    )}
                  </div>
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed whitespace-pre-wrap ${
                      isMe
                        ? "rounded-br-xs bg-red-600 text-white shadow-xs"
                        : isAdmin
                          ? "rounded-bl-xs border border-red-200 bg-red-50/60 text-zinc-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-zinc-100"
                          : "rounded-bl-xs border border-zinc-200 bg-white text-zinc-900 shadow-2xs dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
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

        {/* Quick Task Tag Bar */}
        {projectTasks.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto border-t border-zinc-100 bg-zinc-50 px-4 py-1.5 dark:border-zinc-800/70 dark:bg-zinc-900/60">
            <span className="shrink-0 text-[10px] font-semibold text-zinc-400">
              Tag task:
            </span>
            {projectTasks.slice(0, 6).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() =>
                  setInput((prev) => `${prev ? `${prev} ` : ""}[Task: ${t.title}] `)
                }
                className="shrink-0 rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-[10px] font-medium text-zinc-600 hover:border-red-300 hover:text-red-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 transition-colors cursor-pointer"
              >
                #{t.title}
              </button>
            ))}
          </div>
        )}

        {/* Composer */}
        <form
          onSubmit={handleSend}
          className="flex items-center gap-2 border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder={`Message ${projectName} team & Account Manager…`}
            className="flex-1 rounded-xl border border-zinc-300 bg-zinc-50 px-3.5 py-2.5 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-red-500 focus:bg-white focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:bg-zinc-950 transition-all"
          />
          <button
            type="submit"
            disabled={!input.trim() || busy}
            className="inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2.5 text-xs font-bold text-white shadow-xs transition-all hover:bg-red-700 disabled:opacity-50 cursor-pointer"
          >
            <span>Send</span>
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
              />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}
