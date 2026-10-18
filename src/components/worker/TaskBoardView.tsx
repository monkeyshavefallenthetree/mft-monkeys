"use client";

import type { TaskRow } from "@/lib/worker/tasks";

interface Props {
  tasks: TaskRow[];
  onSelectTask: (task: TaskRow) => void;
  onStartTask: (taskId: string) => Promise<void>;
  onSubmitApproval: (taskId: string) => Promise<void>;
  onUndoSubmission?: (taskId: string) => Promise<void>;
}

const COLUMNS = [
  { id: "assigned", label: "Assigned", headerColor: "border-blue-500", dot: "bg-blue-500", bgTint: "bg-blue-500/5" },
  { id: "in-progress", label: "In Progress", headerColor: "border-amber-500", dot: "bg-amber-500", bgTint: "bg-amber-500/5" },
  { id: "pending-approval", label: "In Review", headerColor: "border-violet-500", dot: "bg-violet-500", bgTint: "bg-violet-500/5" },
  { id: "completed", label: "Completed", headerColor: "border-emerald-500", dot: "bg-emerald-500", bgTint: "bg-emerald-500/5" },
];

const PRIORITY_BADGES: Record<string, { label: string; cls: string }> = {
  urgent: { label: "Urgent", cls: "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-400 border-red-200 dark:border-red-900" },
  high: { label: "High", cls: "bg-orange-50 text-orange-700 dark:bg-orange-950/60 dark:text-orange-400 border-orange-200 dark:border-orange-900" },
  medium: { label: "Medium", cls: "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400 border-blue-200 dark:border-blue-900" },
  low: { label: "Low", cls: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700" },
};

function formatDue(val: unknown) {
  if (!val) return null;
  let d: Date;
  if (val && typeof (val as { toDate?: () => Date }).toDate === "function") {
    d = (val as { toDate: () => Date }).toDate();
  } else if (val instanceof Date) {
    d = val;
  } else {
    d = new Date(String(val));
  }
  if (isNaN(d.getTime())) return null;

  const now = new Date();
  const diffDays = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const isOverdue = diffDays < 0;
  return {
    date: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    isOverdue,
    label: diffDays === 0 ? "Today" : diffDays === 1 ? "Tomorrow" : diffDays < 0 ? `${Math.abs(diffDays)}d overdue` : `${diffDays}d left`,
  };
}

function formatStart(val: unknown): string | null {
  if (!val) return null;
  let d: Date;
  if (val && typeof (val as { toDate?: () => Date }).toDate === "function") {
    d = (val as { toDate: () => Date }).toDate();
  } else if (val instanceof Date) {
    d = val;
  } else {
    d = new Date(String(val));
  }
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function TaskBoardView({
  tasks,
  onSelectTask,
  onStartTask,
  onSubmitApproval,
  onUndoSubmission,
}: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {COLUMNS.map((col) => {
        const colTasks = tasks.filter((t) => (t.status ?? "assigned") === col.id);
        return (
          <div
            key={col.id}
            className={`flex flex-col rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/60 p-3 min-h-[450px]`}
          >
            {/* Column Header */}
            <div className={`flex items-center justify-between border-t-2 ${col.headerColor} pt-2 pb-3 px-1`}>
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${col.dot}`} />
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-800 dark:text-zinc-200">
                  {col.label}
                </h3>
              </div>
              <span className="rounded-full bg-zinc-200/80 px-2 py-0.5 text-[11px] font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {colTasks.length}
              </span>
            </div>

            {/* Tasks list */}
            <div className="flex-1 space-y-2.5 overflow-y-auto pr-0.5">
              {colTasks.length === 0 ? (
                <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-zinc-300 dark:border-zinc-800 p-4 text-center">
                  <p className="text-[11px] font-medium text-zinc-400">No tasks</p>
                </div>
              ) : (
                colTasks.map((t) => {
                  const pr = PRIORITY_BADGES[t.priority?.toLowerCase() ?? "medium"] ?? PRIORITY_BADGES.medium;
                  const start = formatStart(t.startDate);
                  const due = formatDue(t.dueDate);
                  const isRejected = t.status === "in-progress" && Boolean(t.rejectionReason);

                  return (
                    <div
                      key={t.id}
                      onClick={() => onSelectTask(t)}
                      className="group relative cursor-pointer rounded-lg border border-zinc-200 bg-white p-3.5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-800 dark:hover:border-zinc-700"
                    >
                      {/* Top tags */}
                      <div className="flex flex-wrap items-center justify-between gap-1.5 mb-2">
                        {t.projectName ? (
                          <span className="truncate max-w-[130px] text-[10px] font-medium text-zinc-500 bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-400 px-1.5 py-0.5 rounded">
                            {t.projectName}
                          </span>
                        ) : (
                          <span />
                        )}
                        <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${pr.cls}`}>
                          {pr.label}
                        </span>
                      </div>

                      {/* Title */}
                      <h4 className="text-sm font-semibold text-zinc-900 group-hover:text-red-600 transition-colors line-clamp-2 dark:text-white">
                        {t.title || "Untitled Task"}
                      </h4>

                      {/* Revision notice */}
                      {isRejected && (
                        <div className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                          ⚠️ Changes requested: <span className="font-normal italic">{String(t.rejectionReason)}</span>
                        </div>
                      )}

                      {/* Assignee & Subtasks progress */}
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-zinc-500 font-mono">
                        <span className="truncate max-w-[140px] text-zinc-600 dark:text-zinc-300 font-sans">
                          {t.assignedWorkerName && t.assignedWorkerName.toLowerCase() !== "unassigned" ? (
                            <span>👤 {t.assignedWorkerName}</span>
                          ) : (
                            <span className="rounded bg-amber-100/70 px-1 py-0.2 text-[9px] font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                              Unassigned
                            </span>
                          )}
                        </span>
                        {Array.isArray(t.subtasks) && t.subtasks.length > 0 && (
                          <span className="rounded bg-zinc-100 dark:bg-zinc-800 px-1 py-0.2">
                            ☑ {t.subtasks.filter((s) => s.completed).length}/{t.subtasks.length}
                          </span>
                        )}
                      </div>

                      {/* Footer meta */}
                      <div className="mt-2.5 flex items-center justify-between border-t border-zinc-100 pt-2 text-xs text-zinc-500 dark:border-zinc-800">
                        <div className="flex flex-wrap items-center gap-2">
                          {start && (
                            <span className="flex items-center gap-0.5 text-[10px] font-medium text-sky-600 dark:text-sky-400">
                              <span>▶</span>
                              <span>{start}</span>
                            </span>
                          )}
                          {due ? (
                            <span
                              className={`flex items-center gap-1 text-[10px] font-medium ${
                                due.isOverdue
                                  ? "text-red-600 font-semibold"
                                  : "text-zinc-500 dark:text-zinc-400"
                              }`}
                            >
                              <span>📅</span>
                              <span>{due.label}</span>
                            </span>
                          ) : !start ? (
                            <span className="text-[10px] text-zinc-400">No due date</span>
                          ) : null}
                        </div>

                        {/* Quick action button inside card */}
                        <div onClick={(e) => e.stopPropagation()}>
                          {t.status === "assigned" && (
                            <button
                              type="button"
                              onClick={() => void onStartTask(t.id)}
                              className="rounded bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700 hover:bg-emerald-600 hover:text-white dark:bg-emerald-950/60 dark:text-emerald-400 transition-colors cursor-pointer"
                            >
                              Start →
                            </button>
                          )}
                          {t.status === "in-progress" && (
                            <button
                              type="button"
                              onClick={() => void onSubmitApproval(t.id)}
                              className="rounded bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700 hover:bg-amber-600 hover:text-white dark:bg-amber-950/60 dark:text-amber-400 transition-colors cursor-pointer"
                            >
                              Submit →
                            </button>
                          )}
                          {t.status === "pending-approval" && onUndoSubmission && (
                            <button
                              type="button"
                              onClick={() => void onUndoSubmission(t.id)}
                              className="rounded bg-violet-100 px-2 py-1 text-[10px] font-bold text-violet-700 hover:bg-violet-600 hover:text-white dark:bg-violet-950/80 dark:text-violet-300 dark:hover:bg-violet-700 transition-colors cursor-pointer inline-flex items-center gap-0.5"
                              title="Revert task back to In Progress"
                            >
                              <span>↩</span> Undo
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
