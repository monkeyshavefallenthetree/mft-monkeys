"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Firestore } from "firebase/firestore";
import { serverTimestamp } from "firebase/firestore";
import {
  createTask,
  loadAllWorkers,
  loadProjects,
  loadTasksForWorker,
  taskPhotoUrl,
  updateTask,
  type ProjectRow,
  type TaskRow,
  type WorkerRow,
} from "@/lib/worker/tasks";
import { toDate } from "@/lib/worker/format";
import TaskChat from "./TaskChat";
import TasksCalendar from "./TasksCalendar";

type Props = {
  db: Firestore;
  uid: string;
  workerName: string;
  onToast: (msg: string, kind?: "ok" | "err") => void;
  onNewAdminMessage?: () => void;
};

const DEPTS = [
  { v: "social-media", l: "Social Media" },
  { v: "web-development", l: "Web Development" },
  { v: "media-buying", l: "Media Buying" },
  { v: "branding", l: "Branding" },
  { v: "seo", l: "SEO" },
  { v: "content-creation", l: "Content Creation" },
  { v: "general", l: "General" },
];

function workerLabel(w: WorkerRow) {
  const n = `${w.firstName ?? ""} ${w.lastName ?? ""}`.trim();
  return n || w.email || w.id;
}

function assignedList(task: TaskRow): string[] {
  const a = task.assignedTo;
  if (Array.isArray(a)) return a;
  if (typeof a === "string" && a) return [a];
  return [];
}

export default function TasksPanel({ db, uid, workerName, onToast, onNewAdminMessage }: Props) {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  /** `undefined` = expanded (default open). */
  const [expanded, setExpanded] = useState<Record<string, boolean | undefined>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [editTask, setEditTask] = useState<TaskRow | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const refresh = useCallback(async () => {
    setErr(null);
    try {
      const [p, w, t] = await Promise.all([
        loadProjects(db),
        loadAllWorkers(db),
        loadTasksForWorker(db, uid),
      ]);
      setProjects(p);
      setWorkers(w);
      setTasks(t);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, [db, uid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filteredTasks = useMemo(() => {
    if (!selectedDate) return tasks;
    return tasks.filter((t) => {
      if (!t.dueDate) return false;
      const val = t.dueDate as any;
      const d = typeof val.toDate === "function" ? val.toDate() : new Date(val);
      return d.getFullYear() === selectedDate.getFullYear() &&
             d.getMonth() === selectedDate.getMonth() &&
             d.getDate() === selectedDate.getDate();
    });
  }, [tasks, selectedDate]);

  const grouped = useMemo(() => {
    const m = new Map<string, TaskRow[]>();
    for (const t of filteredTasks) {
      const pid = (t.projectId as string) || "_none";
      if (!m.has(pid)) m.set(pid, []);
      m.get(pid)!.push(t);
    }
    return m;
  }, [filteredTasks]);

  const stats = useMemo(() => {
    const total = filteredTasks.length;
    const completed = filteredTasks.filter((t) => t.status === "completed").length;
    const pending =
      filteredTasks.filter((t) => t.status === "assigned" || t.status === "in-progress").length +
      filteredTasks.filter((t) => t.status === "pending-approval").length;
    const rate = total ? Math.round((completed / total) * 100) : 0;
    return { total, completed, pending, rate };
  }, [tasks]);

  function projectTitle(pid: string): string {
    if (pid === "_none") return "No project";
    const p = projects.find((x) => x.id === pid);
    if (!p) return `Project ${pid.slice(0, 6)}…`;
    const name = typeof p.name === "string" ? p.name : "";
    const title = typeof p.title === "string" ? p.title : "";
    return name || title || `Project ${pid.slice(0, 6)}…`;
  }

  async function startTask(id: string) {
    try {
      await updateTask(db, id, { status: "in-progress", startedAt: serverTimestamp() });
      onToast("Task started.");
      await refresh();
    } catch {
      onToast("Could not start task.", "err");
    }
  }

  async function submitApproval(id: string) {
    try {
      await updateTask(db, id, {
        status: "pending-approval",
        submittedForApprovalAt: serverTimestamp(),
      });
      onToast("Submitted for approval.");
      await refresh();
    } catch {
      onToast("Could not submit task.", "err");
    }
  }

  if (loading) {
    return (
      <div className="brutal-card p-6">
        <div className="h-4 w-40 animate-pulse bg-[var(--mft-border)]" />
        <div className="mt-4 h-24 animate-pulse bg-[var(--mft-border)]" />
      </div>
    );
  }

  if (err) {
    return (
      <div className="brutal-card border-red-500 bg-red-950 p-6 text-red-100 shadow-[4px_4px_0px_0px_#EF4444]" role="alert">
        <p className="font-bold uppercase tracking-widest text-sm">[SYSERR] {err}</p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="brutal-btn mt-4 px-4 py-2 text-xs"
        >
          [ RETRY ]
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <TasksCalendar tasks={tasks} selectedDate={selectedDate} onSelectDate={setSelectedDate} />

      <div className="grid grid-cols-2 gap-px bg-[var(--mft-border)] border border-[var(--mft-border)] sm:grid-cols-4">
        {[
          ["Total", stats.total],
          ["Done", stats.completed],
          ["Active", stats.pending],
          ["Rate", `${stats.rate}%`],
        ].map(([l, v]) => (
          <div key={String(l)} className="bg-[var(--mft-bg)] px-4 py-4 text-center transition-colors hover:bg-[var(--mft-surface)] hover:text-white">
            <div className="text-[10px] uppercase font-bold tracking-widest text-[var(--mft-muted)] mb-1">{l}</div>
            <div className="text-3xl font-oswald text-[var(--mft-primary)]">{v}</div>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="brutal-btn px-4 py-2"
        >
          [ + NEW TASK ]
        </button>
      </div>

      {filteredTasks.length === 0 ? (
        <div className="border border-dashed border-[var(--mft-border)] p-10 text-center">
          <p className="text-sm font-bold uppercase tracking-widest text-white">NO TASKS FOUND</p>
          <p className="mt-2 text-[10px] uppercase tracking-widest text-[var(--mft-muted)]">
            Awaiting assignments {"//"} No local records
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {[...grouped.entries()].map(([pid, list]) => (
            <div key={pid} className="border border-[var(--mft-border)] bg-[var(--mft-bg)] transition-colors hover:border-[var(--mft-primary)]">
              <button
                type="button"
                onClick={() =>
                  setExpanded((e) => ({ ...e, [pid]: !((e[pid] ?? true) as boolean) }))
                }
                className="flex w-full items-center justify-between px-6 py-4 text-left brutal-card-hover"
              >
                <span className="font-oswald text-xl uppercase tracking-wider text-[var(--mft-primary)]">
                  {projectTitle(pid)} <span className="text-sm font-mono text-[var(--mft-muted)] ml-2">[{list.length}]</span>
                </span>
                <span className="text-[var(--mft-primary)] font-bold">{(expanded[pid] ?? true) ? "[-]" : "[+]"}</span>
              </button>
              {(expanded[pid] ?? true) ? (
                <ul className="space-y-0 border-t border-[var(--mft-border)] bg-[var(--mft-surface)]">
                  {list.map((task) => (
                    <li
                      key={task.id}
                      className="border-b border-[var(--mft-border)] last:border-0 p-4 sm:p-6"
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-bold uppercase tracking-wider text-white text-lg">{task.title || "UNTITLED"}</p>
                          <p className="mt-2 line-clamp-2 text-sm text-[var(--mft-muted)]">
                            {task.description || "NO DATA"}
                          </p>
                          <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-[var(--mft-primary)]">
                            [PRIORITY: {task.priority || "MEDIUM"}] {"//"} [STATUS: {task.status || "UNKNOWN"}]
                          </p>
                          {task.status === "in-progress" && task.rejectionReason ? (
                            <p className="mt-2 text-xs font-bold text-red-500 uppercase tracking-wide">
                              [REJECTION] {String(task.rejectionReason)}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2 sm:justify-end">
                          {task.status === "assigned" ? (
                            <button
                              type="button"
                              onClick={() => void startTask(task.id)}
                              className="brutal-btn bg-[#00FF66] text-black border-[#00FF66] hover:bg-white hover:border-white px-3 py-1.5 text-xs"
                            >
                              [ EXECUTE ]
                            </button>
                          ) : null}
                          {task.status === "in-progress" ? (
                            <button
                              type="button"
                              onClick={() => void submitApproval(task.id)}
                              className="brutal-btn bg-[#FFCC00] text-black border-[#FFCC00] hover:bg-white hover:border-white px-3 py-1.5 text-xs"
                            >
                              [ SUBMIT ]
                            </button>
                          ) : null}
                          {task.status === "pending-approval" ? (
                            <span className="border border-white/20 bg-white/5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)]">
                              [ AWAITING ADMIN ]
                            </span>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => setEditTask(task)}
                            className="brutal-btn-outline px-3 py-1.5 text-xs"
                          >
                            [ EDIT ]
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onToast(
                                `Title: ${task.title}\nProject: ${task.projectName || projectTitle(pid)}\nPriority: ${task.priority}\nStatus: ${task.status}`,
                                "ok",
                              )
                            }
                            className="brutal-btn-outline px-3 py-1.5 text-xs"
                          >
                            [ INFO ]
                          </button>
                        </div>
                        {/* Inline task chat */}
                        <TaskChat
                          db={db}
                          taskId={task.id}
                          taskTitle={task.title || "Task"}
                          uid={uid}
                          workerName={workerName}
                          onNewAdminMessage={onNewAdminMessage}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {createOpen ? (
        <CreateTaskModal
          db={db}
          uid={uid}
          projects={projects}
          workers={workers}
          onClose={() => setCreateOpen(false)}
          onDone={async () => {
            setCreateOpen(false);
            await refresh();
            onToast("Task created.");
          }}
          onError={(m) => onToast(m, "err")}
        />
      ) : null}

      {editTask ? (
        <EditTaskModal
          db={db}
          uid={uid}
          task={editTask}
          workers={workers}
          onClose={() => setEditTask(null)}
          onDone={async () => {
            setEditTask(null);
            await refresh();
            onToast("Task updated.");
          }}
          onError={(m) => onToast(m, "err")}
        />
      ) : null}
    </div>
  );
}

function CreateTaskModal({
  db,
  uid,
  projects,
  workers,
  onClose,
  onDone,
  onError,
}: {
  db: Firestore;
  uid: string;
  projects: ProjectRow[];
  workers: WorkerRow[];
  onClose: () => void;
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [department, setDepartment] = useState("");
  const [priority, setPriority] = useState("medium");
  const [due, setDue] = useState("");
  const [photo, setPhoto] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({ [uid]: true });
  const [busy, setBusy] = useState(false);

  const preview = taskPhotoUrl(photo);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const assigned = Object.entries(selected)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (!assigned.length) {
      onError("Select at least one worker.");
      return;
    }
    if (!projectId || !title.trim() || !description.trim() || !department) {
      onError("Fill required fields.");
      return;
    }
    const proj = projects.find((p) => p.id === projectId);
    const projectName = (proj?.name as string) || (proj?.title as string) || undefined;
    setBusy(true);
    try {
      await createTask(db, {
        projectId,
        projectName,
        title: title.trim(),
        description: description.trim(),
        department,
        priority,
        assignedTo: assigned,
        dueDate: due ? new Date(due) : null,
        photo: photo.trim() || null,
        createdBy: uid,
      });
      onDone();
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/90 p-4 sm:items-center backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-task-title"
        className="brutal-card max-h-[90vh] w-full max-w-lg overflow-y-auto p-6"
      >
        <div className="mb-6 flex items-center justify-between border-b border-[var(--mft-border)] pb-4">
          <h2 id="create-task-title" className="text-xl font-oswald text-[var(--mft-primary)] uppercase tracking-wider">
            {"//"} CREATE TASK
          </h2>
          <button type="button" onClick={onClose} className="text-sm font-bold text-[var(--mft-muted)] hover:text-white transition-colors">
            [X]
          </button>
        </div>
        <form className="space-y-4" onSubmit={(e) => void submit(e)}>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)] block mb-1">Project *</label>
            <select
              required
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="brutal-input"
            >
              <option value="">Select project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {(p.name as string) || (p.title as string) || p.id}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)] block mb-1">Title *</label>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="brutal-input"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)] block mb-1">Description *</label>
            <textarea
              required
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="brutal-input"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)] block mb-1">Department *</label>
            <select
              required
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="brutal-input"
            >
              <option value="">Select</option>
              {DEPTS.map((d) => (
                <option key={d.v} value={d.v}>
                  {d.l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)] block mb-1">Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="brutal-input"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)] block mb-1">Assign workers *</p>
            <div className="max-h-40 overflow-y-auto border border-[var(--mft-border)] bg-[var(--mft-bg)] p-2">
              {workers.map((w) => (
                <label key={w.id} className="flex cursor-pointer items-center gap-2 py-1 text-xs uppercase tracking-wider text-white hover:text-[var(--mft-primary)]">
                  <input
                    type="checkbox"
                    checked={!!selected[w.id]}
                    onChange={(e) => setSelected((s) => ({ ...s, [w.id]: e.target.checked }))}
                    className="accent-[var(--mft-primary)]"
                  />
                  {workerLabel(w)}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)] block mb-1">Due date</label>
            <input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="brutal-input"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)] block mb-1">Photo filename (optional)</label>
            <input
              value={photo}
              onChange={(e) => setPhoto(e.target.value)}
              placeholder="e.g. design.webp"
              className="brutal-input placeholder:text-zinc-600"
            />
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" className="mt-4 max-h-40 border border-[var(--mft-border)] grayscale hover:grayscale-0 transition-all" />
            ) : null}
          </div>
          <div className="flex gap-4 pt-4 mt-8 border-t border-[var(--mft-border)]">
            <button
              type="button"
              onClick={onClose}
              className="brutal-btn-outline flex-1"
            >
              [ CANCEL ]
            </button>
            <button
              type="submit"
              disabled={busy}
              className="brutal-btn flex-1 disabled:opacity-50"
            >
              {busy ? "[ PROCESSING... ]" : "[ CREATE ]"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditTaskModal({
  db,
  uid,
  task,
  workers,
  onClose,
  onDone,
  onError,
}: {
  db: Firestore;
  uid: string;
  task: TaskRow;
  workers: WorkerRow[];
  onClose: () => void;
  onDone: () => void;
  onError: (m: string) => void;
}) {
  const [title, setTitle] = useState(task.title ?? "");
  const [description, setDescription] = useState(task.description ?? "");
  const [priority, setPriority] = useState(task.priority ?? "medium");
  const [status, setStatus] = useState(task.status ?? "assigned");
  const [photo, setPhoto] = useState(task.photo ?? "");
  const [selected, setSelected] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    for (const id of assignedList(task)) m[id] = true;
    return m;
  });
  const [busy, setBusy] = useState(false);

  const dueStr = task.dueDate
    ? (toDate(task.dueDate as never)?.toLocaleDateString() ?? "—")
    : "No due date";

  const preview = taskPhotoUrl(photo);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const assigned = Object.entries(selected)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (!assigned.length) {
      onError("Select at least one worker.");
      return;
    }
    setBusy(true);
    try {
      await updateTask(db, task.id, {
        title: title.trim(),
        description: description.trim(),
        priority,
        status,
        assignedTo: assigned,
        photo: photo.trim() || null,
        updatedAt: serverTimestamp(),
        updatedBy: uid,
      });
      onDone();
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/90 p-4 sm:items-center backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-task-title"
        className="brutal-card max-h-[90vh] w-full max-w-lg overflow-y-auto p-6"
      >
        <div className="mb-6 flex items-center justify-between border-b border-[var(--mft-border)] pb-4">
          <h2 id="edit-task-title" className="text-xl font-oswald text-[var(--mft-primary)] uppercase tracking-wider">
            {"//"} EDIT TASK: {task.id.slice(0, 6)}
          </h2>
          <button type="button" onClick={onClose} className="text-sm font-bold text-[var(--mft-muted)] hover:text-white transition-colors">
            [X]
          </button>
        </div>
        <form className="space-y-4" onSubmit={(e) => void submit(e)}>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)] block mb-1">Title *</label>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="brutal-input"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)] block mb-1">Description *</label>
            <textarea
              required
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="brutal-input"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)] block mb-1">Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="brutal-input"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)] block mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="brutal-input"
            >
              <option value="assigned">Assigned</option>
              <option value="in-progress">In progress</option>
              <option value="pending-approval">Pending approval</option>
            </select>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)] block mb-1">Assign workers *</p>
            <div className="max-h-40 overflow-y-auto border border-[var(--mft-border)] bg-[var(--mft-bg)] p-2">
              {workers.map((w) => (
                <label key={w.id} className="flex cursor-pointer items-center gap-2 py-1 text-xs uppercase tracking-wider text-white hover:text-[var(--mft-primary)]">
                  <input
                    type="checkbox"
                    checked={!!selected[w.id]}
                    onChange={(e) => setSelected((s) => ({ ...s, [w.id]: e.target.checked }))}
                    className="accent-[var(--mft-primary)]"
                  />
                  {workerLabel(w)}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)] block mb-1">Due date (read only)</label>
            <input readOnly value={dueStr} className="brutal-input opacity-50 cursor-not-allowed" />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)] block mb-1">Photo filename</label>
            <input
              value={photo}
              onChange={(e) => setPhoto(e.target.value)}
              className="brutal-input"
            />
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" className="mt-4 max-h-40 border border-[var(--mft-border)] grayscale hover:grayscale-0 transition-all" />
            ) : null}
          </div>
          <div className="flex gap-4 pt-4 mt-8 border-t border-[var(--mft-border)]">
            <button
              type="button"
              onClick={onClose}
              className="brutal-btn-outline flex-1"
            >
              [ CANCEL ]
            </button>
            <button
              type="submit"
              disabled={busy}
              className="brutal-btn flex-1 disabled:opacity-50"
            >
              {busy ? "[ PROCESSING... ]" : "[ SAVE ]"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
