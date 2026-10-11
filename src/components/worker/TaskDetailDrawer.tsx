"use client";

import { useEffect, useState } from "react";
import type { Firestore } from "firebase/firestore";
import { doc, updateDoc } from "firebase/firestore";
import type { TaskRow, Subtask, WorkerRow } from "@/lib/worker/tasks";
import { assignedWorkerIds } from "@/lib/worker/tasks";
import TaskChat from "./TaskChat";
import { toast } from "@/lib/worker/feedback";

interface Props {
  db: Firestore;
  task: TaskRow | null;
  uid: string;
  workerName: string;
  workers?: WorkerRow[];
  onClose: () => void;
  onStartTask: (taskId: string) => Promise<void>;
  onSubmitApproval: (taskId: string) => Promise<void>;
  onUndoSubmission?: (taskId: string) => Promise<void>;
  onClaimTask?: (taskId: string) => Promise<void>;
  onEditTask?: (task: TaskRow) => void;
  onNewAdminMessage?: () => void;
  onTaskUpdated?: () => void;
}

const STATUS_CONFIG: Record<string, { label: string; badge: string; dot: string }> = {
  assigned: { label: "Assigned", badge: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-400 dark:border-blue-900", dot: "bg-blue-500" },
  "in-progress": { label: "In Progress", badge: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-900", dot: "bg-amber-500" },
  "pending-approval": { label: "Pending Approval", badge: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/50 dark:text-violet-400 dark:border-violet-900", dot: "bg-violet-500" },
  completed: { label: "Completed", badge: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-900", dot: "bg-emerald-500" },
};

const PRIORITY_CONFIG: Record<string, { label: string; badge: string }> = {
  urgent: { label: "Urgent", badge: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-400 dark:border-red-900" },
  high: { label: "High", badge: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/50 dark:text-orange-400 dark:border-orange-900" },
  medium: { label: "Medium", badge: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-400 dark:border-blue-900" },
  low: { label: "Low", badge: "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700" },
};

function formatDueDate(val: unknown): { formatted: string; isOverdue: boolean; label: string } {
  if (!val) return { formatted: "No deadline", isOverdue: false, label: "" };
  let d: Date;
  if (val && typeof (val as { toDate?: () => Date }).toDate === "function") {
    d = (val as { toDate: () => Date }).toDate();
  } else if (val instanceof Date) {
    d = val;
  } else {
    d = new Date(String(val));
  }
  if (isNaN(d.getTime())) return { formatted: "Invalid date", isOverdue: false, label: "" };

  const now = new Date();
  const diffDays = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const isOverdue = diffDays < 0;

  let label = "";
  if (diffDays === 0) label = "Due today";
  else if (diffDays === 1) label = "Due tomorrow";
  else if (diffDays > 1) label = `${diffDays} days left`;
  else label = `${Math.abs(diffDays)} days overdue`;

  return {
    formatted: d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
    isOverdue,
    label,
  };
}

function formatExternalUrl(url?: string): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export default function TaskDetailDrawer({
  db,
  task,
  uid,
  workerName,
  workers,
  onClose,
  onStartTask,
  onSubmitApproval,
  onUndoSubmission,
  onClaimTask,
  onEditTask,
  onNewAdminMessage,
  onTaskUpdated,
}: Props) {
  const [activeTab, setActiveTab] = useState<"details" | "chat">("details");
  const [lightboxPhoto, setLightboxPhoto] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [newSubtaskDesc, setNewSubtaskDesc] = useState("");
  const [newSubtaskLink, setNewSubtaskLink] = useState("");
  const [editingSubtaskId, setEditingSubtaskId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editLink, setEditLink] = useState("");
  const [subtasksBusy, setSubtasksBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!task) return null;

  const st = STATUS_CONFIG[task.status ?? "assigned"] ?? STATUS_CONFIG.assigned;
  const pr = PRIORITY_CONFIG[task.priority?.toLowerCase() ?? "medium"] ?? PRIORITY_CONFIG.medium;
  const due = formatDueDate(task.dueDate);

  const assigneeIds = Array.from(
    new Set(
      [
        ...assignedWorkerIds(task.assignedTo),
        ...(Array.isArray(task.assignedWorkerIds) ? task.assignedWorkerIds : []),
        ...(task.workerId ? [String(task.workerId)] : []),
      ].filter(Boolean),
    ),
  );

  const isUnassigned =
    assigneeIds.length === 0 &&
    (!task.assignedWorkerName || task.assignedWorkerName.toLowerCase() === "unassigned") &&
    (!task.workerName || (typeof task.workerName === "string" && task.workerName.toLowerCase() === "unassigned"));

  const assigneeDisplay = (() => {
    if (assigneeIds.length > 0) {
      const names = assigneeIds.map((id) => {
        if (id === uid) return workerName ? `${workerName} (You)` : "You";
        const w = (workers || []).find((x) => x.id === id);
        if (w) {
          const full = `${w.firstName ?? ""} ${w.lastName ?? ""}`.trim();
          if (full) return full;
        }
        return id;
      });
      return names.join(", ");
    }
    if (task.assignedWorkerName && task.assignedWorkerName.toLowerCase() !== "unassigned") {
      return task.assignedWorkerName;
    }
    if (task.workerName && typeof task.workerName === "string" && task.workerName.toLowerCase() !== "unassigned") {
      return task.workerName;
    }
    return "Unassigned (Open for Claiming)";
  })();

  const subtasksList: Subtask[] = task.subtasks || [];
  const completedSubtasksCount = subtasksList.filter((s) => s.completed).length;
  const subtasksPercent = subtasksList.length > 0 ? Math.round((completedSubtasksCount / subtasksList.length) * 100) : 0;

  const handleToggleSubtask = async (subtaskId: string) => {
    if (subtasksBusy) return;
    setSubtasksBusy(true);
    try {
      const updated = subtasksList.map((st) =>
        st.id === subtaskId ? { ...st, completed: !st.completed } : st,
      );
      await updateDoc(doc(db, "tasks", task.id), { subtasks: updated });
      task.subtasks = updated;
      onTaskUpdated?.();
    } catch {
      toast.error("Failed to update checklist item");
    } finally {
      setSubtasksBusy(false);
    }
  };

  const handleAddSubtask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubtaskTitle.trim() || subtasksBusy) return;
    setSubtasksBusy(true);
    try {
      const newSubtask: Subtask = {
        id: `st-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        title: newSubtaskTitle.trim(),
        description: newSubtaskDesc.trim() || undefined,
        link: newSubtaskLink.trim() || undefined,
        completed: false,
      };
      const updated = [...subtasksList, newSubtask];
      await updateDoc(doc(db, "tasks", task.id), { subtasks: updated });
      task.subtasks = updated;
      setNewSubtaskTitle("");
      setNewSubtaskDesc("");
      setNewSubtaskLink("");
      onTaskUpdated?.();
      toast.success("Checklist item added");
    } catch {
      toast.error("Failed to add checklist item");
    } finally {
      setSubtasksBusy(false);
    }
  };

  const handleStartEditSubtask = (st: Subtask) => {
    setEditingSubtaskId(st.id);
    setEditTitle(st.title);
    setEditDesc(st.description || "");
    setEditLink(st.link || "");
  };

  const handleSaveEditSubtask = async () => {
    if (!editingSubtaskId || !editTitle.trim() || subtasksBusy) return;
    setSubtasksBusy(true);
    try {
      const updated = subtasksList.map((st) =>
        st.id === editingSubtaskId
          ? {
              ...st,
              title: editTitle.trim(),
              description: editDesc.trim() || undefined,
              link: editLink.trim() || undefined,
            }
          : st
      );
      await updateDoc(doc(db, "tasks", task.id), { subtasks: updated });
      task.subtasks = updated;
      setEditingSubtaskId(null);
      setEditTitle("");
      setEditDesc("");
      setEditLink("");
      onTaskUpdated?.();
      toast.success("Checklist item updated");
    } catch {
      toast.error("Failed to update checklist item");
    } finally {
      setSubtasksBusy(false);
    }
  };

  const handleCancelEditSubtask = () => {
    setEditingSubtaskId(null);
    setEditTitle("");
    setEditDesc("");
    setEditLink("");
  };

  const handleDeleteSubtask = async (subtaskId: string) => {
    if (subtasksBusy) return;
    setSubtasksBusy(true);
    try {
      const updated = subtasksList.filter((st) => st.id !== subtaskId);
      await updateDoc(doc(db, "tasks", task.id), { subtasks: updated });
      task.subtasks = updated;
      onTaskUpdated?.();
    } catch {
      toast.error("Failed to delete checklist item");
    } finally {
      setSubtasksBusy(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-xs transition-opacity animate-fade-in"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }}
      />

      {/* Drawer */}
      <div
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col bg-white shadow-2xl animate-slide-up dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-zinc-200 p-5 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
          <div className="min-w-0 flex-1 pr-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold ${st.badge}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                {st.label}
              </span>
              <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${pr.badge}`}>
                {pr.label}
              </span>
              {task.department && (
                <span className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                  {task.department}
                </span>
              )}
            </div>
            <h2 className="mt-2 text-lg font-bold text-zinc-900 dark:text-white leading-tight">
              {task.title || "Untitled Task"}
            </h2>
            {task.projectName && (
              <p className="mt-1 text-xs text-zinc-500 font-medium flex items-center gap-1">
                <span>📁</span>
                <span>{task.projectName}</span>
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {onEditTask && (
              <button
                type="button"
                onClick={() => onEditTask(task)}
                className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 hover:text-red-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 transition-colors flex items-center gap-1 cursor-pointer"
                title="Edit / Reassign Task"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
                <span>Edit / Reassign</span>
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }}
              aria-label="Close drawer"
              className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Workflow Progress Stepper */}
        <div className="border-b border-zinc-200 bg-white px-6 py-3.5 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-2">Workflow Phase</p>
          <div className="flex items-center justify-between">
            {[
              { id: "assigned", label: "Assigned" },
              { id: "in-progress", label: "In Progress" },
              { id: "pending-approval", label: "In Review" },
              { id: "completed", label: "Completed" },
            ].map((step, idx) => {
              const order = ["assigned", "in-progress", "pending-approval", "completed"];
              const currentIdx = order.indexOf(task.status ?? "assigned");
              const isPast = idx < currentIdx;
              const isCurrent = idx === currentIdx;

              return (
                <div key={step.id} className="flex items-center flex-1 last:flex-none">
                  <div className="flex flex-col items-center">
                    <div
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold transition-all ${
                        isPast
                          ? "bg-emerald-600 text-white"
                          : isCurrent
                          ? "bg-red-600 text-white ring-4 ring-red-100 dark:ring-red-950"
                          : "border border-zinc-300 bg-zinc-100 text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800"
                      }`}
                    >
                      {isPast ? "✓" : idx + 1}
                    </div>
                    <span className={`mt-1 text-[10px] font-semibold ${isCurrent ? "text-zinc-900 dark:text-white" : "text-zinc-400"}`}>
                      {step.label}
                    </span>
                  </div>
                  {idx < 3 && (
                    <div
                      className={`h-0.5 flex-1 mx-2 ${
                        idx < currentIdx ? "bg-emerald-600" : "bg-zinc-200 dark:bg-zinc-800"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Tab Toggle */}
        <div className="flex border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-6">
          <button
            type="button"
            onClick={() => setActiveTab("details")}
            className={`border-b-2 py-3 text-xs font-semibold transition-colors cursor-pointer mr-6 ${
              activeTab === "details"
                ? "border-red-600 text-red-600"
                : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
            }`}
          >
            Directive Details
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("chat")}
            className={`border-b-2 py-3 text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === "chat"
                ? "border-red-600 text-red-600"
                : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
            }`}
          >
            <span>Task Discussion</span>
            <span className="rounded-full bg-zinc-100 px-1.5 py-0.2 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              Live
            </span>
          </button>
        </div>

        {/* Content body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === "details" ? (
            <div className="space-y-6">
              {/* Revision / Rejection alert if applicable */}
              {task.status === "in-progress" && task.rejectionReason && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/40 animate-shake">
                  <div className="flex items-start gap-3">
                    <span className="text-xl">⚠️</span>
                    <div>
                      <h4 className="text-xs font-bold text-amber-900 dark:text-amber-200 uppercase tracking-wide">
                        Revision Requested by Admin
                      </h4>
                      <p className="mt-1 text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                        {task.rejectionReason}
                      </p>
                      <p className="mt-2 text-[11px] text-amber-700/80 dark:text-amber-400">
                        Please update your deliverables and re-submit for approval once corrected.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Status Action CTA */}
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-800/50 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-zinc-900 dark:text-white">Current Workflow Status</p>
                  <p className="text-[11px] text-zinc-500">
                    {task.status === "assigned" && "Task is assigned. Click start to begin."}
                    {task.status === "in-progress" && "You or your team are actively working on this task."}
                    {task.status === "pending-approval" && "Submitted to admin for review. Need to make adjustments? Click Undo Submission."}
                    {task.status === "completed" && "Task is approved and marked complete."}
                  </p>
                </div>
                <div className="flex gap-2">
                  {isUnassigned && onClaimTask && (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={async () => {
                        setActionBusy(true);
                        try {
                          await onClaimTask(task.id);
                        } finally {
                          setActionBusy(false);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-red-700 active:scale-[0.98] transition-all cursor-pointer"
                    >
                      ✋ Claim Directive
                    </button>
                  )}

                  {task.status === "assigned" && !isUnassigned && (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={async () => {
                        setActionBusy(true);
                        try {
                          await onStartTask(task.id);
                        } finally {
                          setActionBusy(false);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 active:scale-[0.98] transition-all cursor-pointer"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Start Task
                    </button>
                  )}

                  {task.status === "in-progress" && (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={async () => {
                        setActionBusy(true);
                        try {
                          await onSubmitApproval(task.id);
                        } finally {
                          setActionBusy(false);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-amber-700 active:scale-[0.98] transition-all cursor-pointer"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Submit for Approval
                    </button>
                  )}

                  {task.status === "pending-approval" && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-50 px-3.5 py-1.5 text-xs font-semibold text-violet-700 dark:border-violet-800 dark:bg-violet-950/60 dark:text-violet-300">
                        <span className="h-2 w-2 rounded-full bg-violet-500 animate-ping" />
                        In Admin Review
                      </span>
                      {onUndoSubmission && (
                        <button
                          type="button"
                          disabled={actionBusy}
                          onClick={async () => {
                            setActionBusy(true);
                            try {
                              await onUndoSubmission(task.id);
                            } finally {
                              setActionBusy(false);
                            }
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg border-2 border-zinc-900 bg-white px-3.5 py-1.5 text-xs font-bold text-zinc-900 shadow-[2px_2px_0px_0px_#09090b] hover:bg-zinc-100 active:translate-x-0.5 active:translate-y-0.5 transition-all cursor-pointer dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:shadow-[2px_2px_0px_0px_#000] disabled:opacity-60"
                          title="Undo submission and return task to In Progress"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a5 5 0 015 5v2m-15-7l4-4m-4 4l4 4" />
                          </svg>
                          <span>Undo Submission</span>
                        </button>
                      )}
                    </div>
                  )}

                  {task.status === "completed" && (
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3.5 py-1.5 text-xs font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                      <span>✅</span> Approved &amp; Done
                    </span>
                  )}
                </div>
              </div>

              {/* Deadline & Meta Grid */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-zinc-200 bg-white p-3.5 dark:border-zinc-800 dark:bg-zinc-800">
                  <p className="text-[11px] font-medium text-zinc-500">Deadline</p>
                  <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-white">{due.formatted}</p>
                  {due.label && (
                    <span
                      className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        due.isOverdue
                          ? "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400"
                          : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400"
                      }`}
                    >
                      {due.label}
                    </span>
                  )}
                </div>

                <div className="rounded-xl border border-zinc-200 bg-white p-3.5 dark:border-zinc-800 dark:bg-zinc-800">
                  <p className="text-[11px] font-medium text-zinc-500">Priority</p>
                  <p className="mt-1 text-sm font-semibold capitalize text-zinc-900 dark:text-white">{pr.label}</p>
                </div>

                <div className="rounded-xl border border-zinc-200 bg-white p-3.5 dark:border-zinc-800 dark:bg-zinc-800">
                  <p className="text-[11px] font-medium text-zinc-500">Assigned To</p>
                  <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-white truncate" title={assigneeDisplay}>
                    {isUnassigned ? (
                      <span className="text-amber-600 dark:text-amber-400 font-medium">Unassigned (Open)</span>
                    ) : (
                      assigneeDisplay
                    )}
                  </p>
                </div>

                <div className="rounded-xl border border-zinc-200 bg-white p-3.5 dark:border-zinc-800 dark:bg-zinc-800">
                  <p className="text-[11px] font-medium text-zinc-500">Assigned By</p>
                  <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-white truncate">
                    {String(task.createdByName || (task.createdBy === uid ? "You" : "Administration"))}
                  </p>
                </div>
              </div>

              {/* Subtasks / Directive Checklist Section */}
              <div className="rounded-xl border border-zinc-200 bg-white p-4.5 dark:border-zinc-800 dark:bg-zinc-800/80 space-y-3.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">☑</span>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-900 dark:text-white">
                      Checklist &amp; Subtasks
                    </h3>
                    {subtasksList.length > 0 && (
                      <span className="text-[10px] font-mono font-bold text-zinc-600 bg-zinc-100 dark:bg-zinc-700 dark:text-zinc-300 px-2 py-0.5 rounded-full">
                        {completedSubtasksCount}/{subtasksList.length} ({subtasksPercent}%)
                      </span>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                {subtasksList.length > 0 && (
                  <div className="h-1.5 w-full bg-zinc-100 dark:bg-zinc-700 rounded-full overflow-hidden">
                    <div
                      style={{ width: `${subtasksPercent}%` }}
                      className="h-full bg-emerald-500 transition-all duration-300"
                    />
                  </div>
                )}

                {/* Subtasks List */}
                <div className="space-y-2">
                  {subtasksList.map((st) => {
                    const isEditing = editingSubtaskId === st.id;
                    if (isEditing) {
                      return (
                        <div
                          key={st.id}
                          className="p-3 bg-white dark:bg-zinc-900 border-2 border-red-500 rounded-lg space-y-2 shadow-xs"
                        >
                          <input
                            type="text"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            placeholder="Subtask title (required)"
                            className="w-full text-xs px-2.5 py-1.5 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:outline-none focus:border-red-500"
                            autoFocus
                          />
                          <input
                            type="text"
                            value={editDesc}
                            onChange={(e) => setEditDesc(e.target.value)}
                            placeholder="Description or notes (optional)"
                            className="w-full text-[11px] px-2.5 py-1.5 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 focus:outline-none focus:border-red-500"
                          />
                          <input
                            type="text"
                            value={editLink}
                            onChange={(e) => setEditLink(e.target.value)}
                            placeholder="Link URL (e.g. figma.com/... or PR link, optional)"
                            className="w-full text-[11px] px-2.5 py-1.5 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 focus:outline-none focus:border-red-500"
                          />
                          <div className="flex justify-end gap-1.5 pt-1">
                            <button
                              type="button"
                              onClick={handleCancelEditSubtask}
                              className="text-[10px] font-semibold px-2.5 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={handleSaveEditSubtask}
                              disabled={!editTitle.trim() || subtasksBusy}
                              className="text-[10px] font-semibold px-3 py-1 rounded bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 cursor-pointer"
                            >
                              Save Changes
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={st.id}
                        className={`p-2.5 bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-700/60 rounded-lg transition-colors group ${
                          st.completed ? "opacity-75" : "hover:border-zinc-300 dark:hover:border-zinc-600"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2.5">
                          <label className="flex items-start gap-2.5 flex-1 min-w-0 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={st.completed}
                              onChange={() => handleToggleSubtask(st.id)}
                              className="accent-emerald-600 w-4 h-4 mt-0.5 cursor-pointer rounded shrink-0"
                            />
                            <div className="flex-1 min-w-0">
                              <span
                                className={`text-xs font-medium block break-words transition-all ${
                                  st.completed ? "line-through text-zinc-400 dark:text-zinc-500" : "text-zinc-800 dark:text-zinc-200"
                                }`}
                              >
                                {st.title}
                              </span>
                              {st.description && (
                                <p
                                  className={`text-[11px] mt-0.5 whitespace-pre-wrap break-words ${
                                    st.completed ? "text-zinc-400 dark:text-zinc-500 line-through" : "text-zinc-500 dark:text-zinc-400"
                                  }`}
                                >
                                  {st.description}
                                </p>
                              )}
                              {st.link && (
                                <div className="mt-1.5">
                                  <a
                                    href={formatExternalUrl(st.link)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-800 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/50 px-2 py-0.5 rounded transition-colors cursor-pointer max-w-full truncate"
                                    title={st.link}
                                  >
                                    <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                    </svg>
                                    <span className="truncate">{st.link.replace(/^https?:\/\//i, "")}</span>
                                  </a>
                                </div>
                              )}
                            </div>
                          </label>
                          <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={() => handleStartEditSubtask(st)}
                              className="p-1 text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded text-xs cursor-pointer transition-colors"
                              title="Edit subtask"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteSubtask(st.id)}
                              className="p-1 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded text-xs cursor-pointer transition-colors"
                              title="Delete subtask"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {subtasksList.length === 0 && (
                    <p className="text-xs text-zinc-400 italic py-1">No checklist items yet. Add one below.</p>
                  )}
                </div>

                {/* Add Subtask Input Form */}
                <form onSubmit={handleAddSubtask} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 space-y-2">
                  <input
                    value={newSubtaskTitle}
                    onChange={(e) => setNewSubtaskTitle(e.target.value)}
                    placeholder="+ Subtask title (required)…"
                    className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-xs text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:border-red-500 focus:outline-none"
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={newSubtaskDesc}
                      onChange={(e) => setNewSubtaskDesc(e.target.value)}
                      placeholder="Description / notes (optional)…"
                      className="rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-[11px] text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none"
                    />
                    <input
                      type="text"
                      value={newSubtaskLink}
                      onChange={(e) => setNewSubtaskLink(e.target.value)}
                      placeholder="Link URL (e.g. figma.com/..., optional)…"
                      className="rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-[11px] text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none"
                    />
                  </div>
                  <div className="flex justify-end pt-0.5">
                    <button
                      type="submit"
                      disabled={!newSubtaskTitle.trim() || subtasksBusy}
                      className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 cursor-pointer transition-colors"
                    >
                      + Add Subtask
                    </button>
                  </div>
                </form>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">Task Directives</h3>
                <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-4 text-sm leading-relaxed text-zinc-800 whitespace-pre-wrap dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-200">
                  {task.description ? task.description : <span className="italic text-zinc-400">No description provided.</span>}
                </div>
              </div>

              {/* Photo attachment if available */}
              {task.photo && (
                <div className="space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500">Attachment Preview</h3>
                  <div
                    className="group relative max-w-xs cursor-pointer overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-800"
                    onClick={() => setLightboxPhoto(String(task.photo))}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={String(task.photo)}
                      alt="Task attachment"
                      className="max-h-60 w-full object-cover transition-transform group-hover:scale-105"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                      <span className="rounded-lg bg-white/90 px-3 py-1.5 text-xs font-semibold text-zinc-900 shadow">
                        Click to expand
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
              <TaskChat
                db={db}
                taskId={task.id}
                taskTitle={task.title}
                uid={uid}
                workerName={workerName}
                onNewAdminMessage={onNewAdminMessage}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-200 p-4 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setActiveTab(activeTab === "details" ? "chat" : "details")}
            className="text-xs font-semibold text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <span>💬</span>
            <span>{activeTab === "details" ? "Open Chat" : "Back to Details"}</span>
          </button>
          <div className="flex items-center gap-2">
            {onEditTask && (
              <button
                type="button"
                onClick={() => onEditTask(task)}
                className="rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 transition-colors cursor-pointer"
              >
                Edit / Reassign
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 transition-colors cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      </div>

      {/* Lightbox Modal */}
      {lightboxPhoto && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-fade-in"
          onClick={() => setLightboxPhoto(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightboxPhoto}
              alt="Enlarged attachment"
              className="max-h-[85vh] max-w-full rounded-xl object-contain shadow-2xl"
            />
            <button
              type="button"
              onClick={() => setLightboxPhoto(null)}
              className="absolute -top-3 -right-3 rounded-full bg-white p-2 text-zinc-900 shadow-lg hover:bg-zinc-100 dark:bg-zinc-800 dark:text-white"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}
