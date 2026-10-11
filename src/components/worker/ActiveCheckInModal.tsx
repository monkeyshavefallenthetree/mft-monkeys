"use client";

import { useState, useEffect } from "react";
import type { TaskRow } from "@/lib/worker/tasks";
import { playTerminalBeep } from "@/lib/sound";

interface Props {
  isOpen: boolean;
  workerName: string;
  tasks: TaskRow[];
  secondsRemaining: number;
  isIdle: boolean;
  onConfirm: (data: { taskId?: string; taskTitle?: string; note?: string }) => Promise<void>;
}

export default function ActiveCheckInModal({
  isOpen,
  workerName,
  tasks,
  secondsRemaining,
  isIdle,
  onConfirm,
}: Props) {
  const [selectedTaskId, setSelectedTaskId] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  // Set default selected task if worker has in-progress or assigned tasks
  useEffect(() => {
    if (tasks.length > 0 && !selectedTaskId) {
      const activeOne = tasks.find((t) => t.status === "in-progress") || tasks[0];
      if (activeOne) {
        setSelectedTaskId(activeOne.id);
      }
    }
  }, [tasks, selectedTaskId]);

  // Audio alert on render if open
  useEffect(() => {
    if (isOpen) {
      playTerminalBeep({ force: true });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const mins = Math.floor(Math.max(0, secondsRemaining) / 60);
  const secs = Math.max(0, secondsRemaining) % 60;
  const timeFormatted = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  const percentRemaining = Math.min(100, Math.max(0, (secondsRemaining / 600) * 100));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const chosen = tasks.find((t) => t.id === selectedTaskId);
      const taskTitle = chosen
        ? chosen.projectName
          ? `[${chosen.projectName}] ${chosen.title}`
          : chosen.title
        : selectedTaskId === "break"
        ? "Taking scheduled short break"
        : selectedTaskId === "general"
        ? "General operational duties & communications"
        : "Active & Available";

      await onConfirm({
        taskId: chosen?.id || undefined,
        taskTitle,
        note: note.trim() || undefined,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[150] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 rounded-2xl w-full max-w-lg shadow-[8px_8px_0px_0px_#09090b] dark:shadow-[8px_8px_0px_0px_#000] p-6 space-y-5 animate-scale-in text-zinc-900 dark:text-zinc-100">
        {/* Top Header */}
        <div className="flex items-start justify-between gap-3 border-b-2 border-zinc-900 dark:border-zinc-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-red-600 text-white flex items-center justify-center text-2xl shadow-sm shrink-0">
              ⏱️
            </div>
            <div>
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/60 px-2 py-0.5 rounded border border-red-200 dark:border-red-900">
                2-Hour Routine Verification
              </span>
              <h3 className="text-xl font-bold uppercase tracking-wide mt-1">
                Active Presence Check-In
              </h3>
            </div>
          </div>
        </div>

        {/* Inactive / Countdown Warning Box */}
        {isIdle ? (
          <div className="rounded-xl border-2 border-red-600 bg-red-50 dark:bg-red-950/40 p-4 space-y-1 animate-shake">
            <div className="flex items-center gap-2 text-red-700 dark:text-red-400 font-bold text-xs uppercase tracking-wider">
              <span>⚠️</span>
              <span>Status: Marked Idle / Unresponsive</span>
            </div>
            <p className="text-xs text-red-900 dark:text-red-200 leading-relaxed font-mono">
              The 10-minute confirmation window expired without a response. Management has been notified that your station is currently idle. Click below immediately to confirm your presence and restore active status.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-2">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="font-bold text-amber-900 dark:text-amber-200 uppercase tracking-wide">
                Confirmation Window Remaining
              </span>
              <span className={`font-bold font-mono text-sm ${secondsRemaining <= 120 ? "text-red-600 animate-pulse" : "text-amber-800 dark:text-amber-300"}`}>
                ⏳ {timeFormatted}
              </span>
            </div>
            <div className="h-2 w-full bg-amber-200 dark:bg-amber-900/50 rounded-full overflow-hidden">
              <div
                style={{ width: `${percentRemaining}%` }}
                className={`h-full transition-all duration-1000 ${
                  secondsRemaining <= 120 ? "bg-red-600" : "bg-amber-500"
                }`}
              />
            </div>
            <p className="text-[11px] text-amber-800 dark:text-amber-400">
              Hello {workerName || "there"}, please confirm you are at your station to maintain continuous active tracking.
            </p>
          </div>
        )}

        {/* Activity Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 mb-1.5 font-mono">
              What are you actively working on?
            </label>
            <select
              value={selectedTaskId}
              onChange={(e) => setSelectedTaskId(e.target.value)}
              className="w-full rounded-lg border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-2.5 text-xs text-zinc-900 dark:text-white font-mono focus:border-red-600 focus:outline-none"
            >
              {tasks.length > 0 ? (
                tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.projectName ? `[${t.projectName}] ` : ""}{t.title} ({t.status})
                  </option>
                ))
              ) : (
                <option value="general">General Operations &amp; Directive Tasks</option>
              )}
              <option value="general">General Operational Tasks &amp; Communications</option>
              <option value="break">Short Break (Bio / Hydration / Coffee)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 mb-1.5 font-mono">
              Brief Progress Note (Optional)
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g., Implementing navigation menu, testing mobile layout..."
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-2.5 text-xs text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:border-red-600 focus:outline-none font-mono"
            />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold font-mono text-sm uppercase tracking-wider rounded-xl border-2 border-zinc-900 dark:border-zinc-700 shadow-[3px_3px_0px_0px_#09090b] dark:shadow-[3px_3px_0px_0px_#000] active:translate-x-0.5 active:translate-y-0.5 transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {submitting ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>Verifying Presence...</span>
                </>
              ) : isIdle ? (
                <>
                  <span>✓</span>
                  <span>I&apos;m Back &amp; Active — Resume Shift</span>
                </>
              ) : (
                <>
                  <span>✓</span>
                  <span>Confirm I&apos;m Active &amp; Continue</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
