"use client";

import { useState, useEffect } from "react";
import type { TaskRow } from "@/lib/worker/tasks";
import { startContinuousCheckInAlarm, stopContinuousCheckInAlarm } from "@/lib/sound";

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

  // Continuous loud alarm throughout the 10-minute check-in window (stops when confirmed or closed)
  useEffect(() => {
    if (isOpen && secondsRemaining > 0 && !submitting) {
      startContinuousCheckInAlarm();
    } else {
      stopContinuousCheckInAlarm();
    }
    return () => {
      stopContinuousCheckInAlarm();
    };
  }, [isOpen, secondsRemaining > 0, submitting]);

  if (!isOpen) return null;

  const mins = Math.floor(Math.max(0, secondsRemaining) / 60);
  const secs = Math.max(0, secondsRemaining) % 60;
  const timeFormatted = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  const percentRemaining = Math.min(100, Math.max(0, (secondsRemaining / 600) * 100));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    stopContinuousCheckInAlarm();
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
      className="fixed inset-0 z-[150] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
    >
      <div
        dir="rtl"
        className="bg-white dark:bg-zinc-900 border-2 border-red-600 rounded-2xl w-full max-w-lg shadow-[8px_8px_0px_0px_#dc2626] p-6 space-y-5 animate-scale-in text-zinc-900 dark:text-zinc-100"
      >
        {/* Top Header */}
        <div className="flex items-start justify-between gap-3 border-b-2 border-zinc-900 dark:border-zinc-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-red-600 text-white flex items-center justify-center text-2xl shadow-sm shrink-0 animate-bounce">
              🔔
            </div>
            <div>
              <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/60 px-2 py-0.5 rounded border border-red-200 dark:border-red-900">
                تأكيد الحضور الدوري كل ساعتين · 2-Hour Check-In
              </span>
              <h3 className="text-lg font-extrabold tracking-wide mt-1">
                تأكيد التواجد وتجديد الشيفت لساعتين كمان
              </h3>
            </div>
          </div>
          {secondsRemaining > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-1 text-[11px] font-bold text-white animate-pulse shrink-0">
              🔊 تنبيه نشط
            </span>
          )}
        </div>

        {/* Inactive / Countdown Warning Box */}
        {isIdle ? (
          <div className="rounded-xl border-2 border-red-600 bg-red-50 dark:bg-red-950/40 p-4 space-y-1">
            <div className="flex items-center gap-2 text-red-700 dark:text-red-400 font-bold text-xs uppercase tracking-wider">
              <span>⚠️</span>
              <span>انتهت مهلة الـ ١٠ دقائق بدون استجابة (Marked Idle)</span>
            </div>
            <p className="text-xs text-red-900 dark:text-red-200 leading-relaxed">
              انتهت مهلة الـ ١٠ دقائق المخصصة لتأكيد الحضور وتم إشعار الإدارة. اضغط بالأسفل فورًا لتأكيد تواجدك واستئناف حساب الساعتين القادمتين.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border-2 border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-amber-950 dark:text-amber-200">
                مهلة الـ ١٠ دقائق قبل انتهاء الساعتين:
              </span>
              <span
                dir="ltr"
                className={`font-black font-mono text-base px-2.5 py-0.5 rounded-lg ${
                  secondsRemaining <= 120
                    ? "bg-red-600 text-white animate-pulse"
                    : "bg-amber-200/80 text-amber-950 dark:bg-amber-900 dark:text-amber-100"
                }`}
              >
                ⏳ {timeFormatted}
              </span>
            </div>
            <div className="h-2.5 w-full bg-amber-200 dark:bg-amber-900/50 rounded-full overflow-hidden">
              <div
                style={{ width: `${percentRemaining}%` }}
                className={`h-full transition-all duration-1000 ${
                  secondsRemaining <= 120 ? "bg-red-600" : "bg-amber-500"
                }`}
              />
            </div>
            <p className="text-xs text-amber-900 dark:text-amber-300 leading-relaxed">
              أهلاً <b>{workerName || "بك"}</b> — يتبقى ١٠ دقائق على نهاية الساعتين الحاليتين. سيستمر صوت التنبيه حتى تضغط على زر تأكيد الحضور بالأسفل لتجديد الشيفت لساعتين إضافيتين.
            </p>
          </div>
        )}

        {/* Activity Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1.5">
              المهمة التي تعمل عليها الآن (للساعتين القادمتين):
            </label>
            <select
              value={selectedTaskId}
              onChange={(e) => setSelectedTaskId(e.target.value)}
              className="w-full rounded-xl border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-2.5 text-xs text-zinc-900 dark:text-white font-semibold focus:border-red-600 focus:outline-none"
            >
              {tasks.length > 0 ? (
                tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.projectName ? `[${t.projectName}] ` : ""}{t.title} ({t.status})
                  </option>
                ))
              ) : (
                <option value="general">مهام التشغيل العامة والمتابعة (General Operations)</option>
              )}
              <option value="general">مهام التشغيل العامة والتواصل مع الفريق</option>
              <option value="break">استراحة قصيرة (Short Break)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1.5">
              ملاحظة سريعة عن التقدم (اختياري):
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="مثال: جاري إنهاء التصميم، مراجعة التعديلات..."
              className="w-full rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-2.5 text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:border-red-600 focus:outline-none"
            />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm rounded-xl border-2 border-zinc-900 dark:border-zinc-700 shadow-[3px_3px_0px_0px_#09090b] active:translate-x-0.5 active:translate-y-0.5 transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {submitting ? (
                <span>جاري تأكيد الحضور...</span>
              ) : isIdle ? (
                <>
                  <span>✓</span>
                  <span>أنا متواجد الآن — استئناف الشيفت لساعتين كمان</span>
                </>
              ) : (
                <>
                  <span>✓</span>
                  <span>تأكيد الحضور (Check In) لساعتين كمان وإيقاف الصوت</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

