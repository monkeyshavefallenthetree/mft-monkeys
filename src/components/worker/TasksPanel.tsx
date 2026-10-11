"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Firestore } from "firebase/firestore";
import { serverTimestamp } from "firebase/firestore";
import {
  createTask,
  loadAllWorkers,
  loadProjects,
  loadTasksForWorker,
  updateTask,
  deleteTask,
  assignedWorkerIds,
  type ProjectRow,
  type TaskRow,
  type WorkerRow,
  type Subtask,
} from "@/lib/worker/tasks";
import TasksCalendar from "./TasksCalendar";
import TaskBoardView from "./TaskBoardView";
import TaskDetailDrawer from "./TaskDetailDrawer";
import { toast, confirmDialog } from "@/lib/worker/feedback";
import { localYmd } from "@/lib/worker/format";

type Props = {
  db: Firestore;
  uid: string;
  workerName: string;
  onToast?: (msg: string, kind?: "ok" | "err") => void;
  onNewAdminMessage?: () => void;
};

const DEPTS = [
  { v: "all", l: "All Departments" },
  { v: "social-media", l: "Social Media" },
  { v: "web-development", l: "Web Development" },
  { v: "media-buying", l: "Media Buying" },
  { v: "branding", l: "Branding" },
  { v: "seo", l: "SEO" },
  { v: "content-creation", l: "Content Creation" },
  { v: "general", l: "General" },
];

function formatRole(role?: string) {
  if (!role) return "Worker";
  return role
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function parseTaskDueDate(val: unknown): Date | null {
  if (!val) return null;
  if (val && typeof (val as { toDate?: () => Date }).toDate === "function") {
    return (val as { toDate: () => Date }).toDate();
  }
  if (val instanceof Date) return val;
  const d = new Date(String(val));
  return isNaN(d.getTime()) ? null : d;
}

export function isTaskOverdue(task: TaskRow): boolean {
  if (task.status === "completed") return false;
  const d = parseTaskDueDate(task.dueDate);
  if (!d) return false;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  return d.getTime() < todayStart.getTime();
}

export function isTaskDueToday(task: TaskRow): boolean {
  if (task.status === "completed") return false;
  const d = parseTaskDueDate(task.dueDate);
  if (!d) return false;
  const today = new Date();
  return (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  );
}

export function isTaskUrgent(task: TaskRow): boolean {
  if (task.status === "completed") return false;
  const p = (task.priority || "").toLowerCase();
  return p === "urgent" || p === "high";
}

export default function TasksPanel({ db, uid, workerName, onNewAdminMessage }: Props) {
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [workers, setWorkers] = useState<WorkerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // View & Filter States
  const [viewMode, setViewMode] = useState<"list" | "board" | "calendar">("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [scopeFilter, setScopeFilter] = useState<"all" | "assigned-me" | "created-me">("all");
  const [quickFilter, setQuickFilter] = useState<"all" | "overdue" | "today" | "urgent">("all");
  const [sortBy, setSortBy] = useState<"due" | "priority" | "newest" | "title">("due");
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [inlineActionTaskId, setInlineActionTaskId] = useState<string | null>(null);

  // Drawer & Modals
  const [activeTask, setActiveTask] = useState<TaskRow | null>(null);
  const [modalMode, setModalMode] = useState<"create" | "edit" | null>(null);
  const [editId, setEditId] = useState<string | null>(null);

  // Form states
  const [formTitle, setFormTitle] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formDept, setFormDept] = useState("general");
  const [formPriority, setFormPriority] = useState("medium");
  const [formStatus, setFormStatus] = useState("assigned");
  const [formProjectId, setFormProjectId] = useState("");
  const [formDueDate, setFormDueDate] = useState("");
  const [formPhoto, setFormPhoto] = useState("");
  const [formAssignedWorkerIds, setFormAssignedWorkerIds] = useState<string[]>([]);
  const [formSubtasks, setFormSubtasks] = useState<Subtask[]>([]);
  const [newSubtaskInput, setNewSubtaskInput] = useState("");
  const [newSubtaskDesc, setNewSubtaskDesc] = useState("");
  const [newSubtaskLink, setNewSubtaskLink] = useState("");
  const [formNotificationMessage, setFormNotificationMessage] = useState("");
  const [workerSearch, setWorkerSearch] = useState("");
  const [formSaving, setFormSaving] = useState(false);

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

      // Keep active task updated if drawer is open (without stale closure)
      setActiveTask((current) => {
        if (!current) return null;
        return t.find((x) => x.id === current.id) ?? current;
      });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, [db, uid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Approved workers list for assignment
  const approvedWorkers = useMemo(() => {
    const list = workers.filter((w) => !w.status || w.status === "approved");
    // Ensure current worker is always present if not found
    if (!list.some((w) => w.id === uid)) {
      list.unshift({ id: uid, firstName: workerName || "You", role: "Worker", status: "approved" });
    }
    return list;
  }, [workers, uid, workerName]);

  const filteredModalWorkers = useMemo(() => {
    const q = workerSearch.trim().toLowerCase();
    if (!q) return approvedWorkers;
    return approvedWorkers.filter((w) => {
      const name = `${w.firstName ?? ""} ${w.lastName ?? ""}`.toLowerCase();
      const role = (w.role ?? "").toLowerCase();
      const dept = (w.department ?? "").toLowerCase();
      return name.includes(q) || role.includes(q) || dept.includes(q);
    });
  }, [approvedWorkers, workerSearch]);

  const toggleAssignee = (workerId: string) => {
    setFormAssignedWorkerIds((prev) => {
      const s = new Set(prev);
      if (s.has(workerId)) s.delete(workerId);
      else s.add(workerId);
      return [...s];
    });
  };

  const getWorkerDisplayName = (id: string) => {
    const w = workers.find((x) => x.id === id);
    if (!w) return id === uid ? (workerName || "You") : "Worker";
    return `${w.firstName ?? ""} ${w.lastName ?? ""}`.trim() || id;
  };

  /** Resolves assignee names dynamically using assignedTo, assignedWorkerIds, workerId, or workers collection lookup */
  const resolveAssigneeDisplay = useCallback(
    (task: TaskRow): string => {
      const ids = Array.from(
        new Set(
          [
            ...assignedWorkerIds(task.assignedTo),
            ...(Array.isArray(task.assignedWorkerIds) ? task.assignedWorkerIds : []),
            ...(task.workerId ? [String(task.workerId)] : []),
          ].filter(Boolean),
        ),
      );

      if (ids.length > 0) {
        const names = ids.map((id) => {
          if (id === uid) return workerName ? `${workerName} (You)` : "You";
          const w = workers.find((x) => x.id === id);
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

      return "Unassigned";
    },
    [workers, uid, workerName],
  );

  // Scope counters
  const scopeCounts = useMemo(() => {
    let assignedMe = 0;
    let createdMe = 0;
    for (const t of tasks) {
      const ids = [
        ...assignedWorkerIds(t.assignedTo),
        ...(Array.isArray(t.assignedWorkerIds) ? t.assignedWorkerIds : []),
        ...(t.workerId ? [String(t.workerId)] : []),
      ];
      if (ids.includes(uid)) assignedMe++;
      if (t.createdBy === uid) createdMe++;
    }
    return {
      all: tasks.length,
      assignedMe,
      createdMe,
    };
  }, [tasks, uid]);

  // Quick filter counters
  const quickCounts = useMemo(() => {
    let overdue = 0;
    let today = 0;
    let urgent = 0;
    for (const t of tasks) {
      if (isTaskOverdue(t)) overdue++;
      if (isTaskDueToday(t)) today++;
      if (isTaskUrgent(t)) urgent++;
    }
    return { all: tasks.length, overdue, today, urgent };
  }, [tasks]);

  // Filtered & sorted tasks pipeline
  const filteredTasks = useMemo(() => {
    const PRIORITY_WEIGHT: Record<string, number> = {
      urgent: 4,
      high: 3,
      medium: 2,
      low: 1,
    };

    const filtered = tasks.filter((t) => {
      // Scope filter
      if (scopeFilter === "assigned-me") {
        const ids = [
          ...assignedWorkerIds(t.assignedTo),
          ...(Array.isArray(t.assignedWorkerIds) ? t.assignedWorkerIds : []),
          ...(t.workerId ? [String(t.workerId)] : []),
        ];
        if (!ids.includes(uid)) return false;
      } else if (scopeFilter === "created-me") {
        if (t.createdBy !== uid) return false;
      }

      // Quick filter
      if (quickFilter === "overdue" && !isTaskOverdue(t)) return false;
      if (quickFilter === "today" && !isTaskDueToday(t)) return false;
      if (quickFilter === "urgent" && !isTaskUrgent(t)) return false;

      // Calendar filter
      if (viewMode === "calendar" && selectedDate) {
        const d = parseTaskDueDate(t.dueDate);
        if (!d) return false;
        const match =
          d.getFullYear() === selectedDate.getFullYear() &&
          d.getMonth() === selectedDate.getMonth() &&
          d.getDate() === selectedDate.getDate();
        if (!match) return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = (t.title || "").toLowerCase().includes(q);
        const matchDesc = (t.description || "").toLowerCase().includes(q);
        const matchProj = (t.projectName || "").toLowerCase().includes(q);
        const matchAssignee = resolveAssigneeDisplay(t).toLowerCase().includes(q);
        if (!matchTitle && !matchDesc && !matchProj && !matchAssignee) return false;
      }

      // Status
      if (statusFilter !== "all" && t.status !== statusFilter) return false;

      // Priority
      if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;

      // Department
      if (deptFilter !== "all" && t.department !== deptFilter) return false;

      return true;
    });

    // Sorting
    return filtered.sort((a, b) => {
      if (sortBy === "priority") {
        const wa = PRIORITY_WEIGHT[(a.priority || "medium").toLowerCase()] ?? 0;
        const wb = PRIORITY_WEIGHT[(b.priority || "medium").toLowerCase()] ?? 0;
        if (wb !== wa) return wb - wa;
      } else if (sortBy === "due") {
        const da = parseTaskDueDate(a.dueDate);
        const db_ = parseTaskDueDate(b.dueDate);
        if (da && db_) return da.getTime() - db_.getTime();
        if (da) return -1;
        if (db_) return 1;
      } else if (sortBy === "title") {
        return (a.title || "").localeCompare(b.title || "");
      }
      // "newest" or default
      const ca = a.createdAt?.toDate?.() ?? new Date(0);
      const cb = b.createdAt?.toDate?.() ?? new Date(0);
      return cb.getTime() - ca.getTime();
    });
  }, [
    tasks,
    scopeFilter,
    quickFilter,
    sortBy,
    viewMode,
    selectedDate,
    searchQuery,
    statusFilter,
    priorityFilter,
    deptFilter,
    uid,
  ]);

  // Group by project for List View
  const groupedByProject = useMemo(() => {
    const map = new Map<string, TaskRow[]>();
    for (const t of filteredTasks) {
      const pid = t.projectId || "__general__";
      if (!map.has(pid)) map.set(pid, []);
      map.get(pid)!.push(t);
    }
    return map;
  }, [filteredTasks]);

  const projectTitle = (pid: string) => {
    if (pid === "__general__") return "General Directives";
    const found = projects.find((p) => p.id === pid);
    return found?.name || (found?.title as string) || pid;
  };

  // KPI stats
  const stats = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === "completed").length;
    const inProgress = tasks.filter((t) => t.status === "in-progress").length;
    const review = tasks.filter((t) => t.status === "pending-approval").length;
    const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, inProgress, review, rate };
  }, [tasks]);

  // Modal Open Handlers
  const openCreateModal = () => {
    setFormTitle("");
    setFormDesc("");
    setFormDept("general");
    setFormPriority("medium");
    setFormStatus("assigned");
    setFormProjectId("");
    setFormDueDate("");
    setFormPhoto("");
    setFormAssignedWorkerIds([uid]); // Default self
    setFormSubtasks([]);
    setNewSubtaskInput("");
    setNewSubtaskDesc("");
    setNewSubtaskLink("");
    setFormNotificationMessage("");
    setWorkerSearch("");
    setEditId(null);
    setModalMode("create");
  };

  const openEditModal = (task: TaskRow) => {
    let dateStr = "";
    if (task.dueDate) {
      const val = task.dueDate as any;
      const d = typeof val.toDate === "function" ? val.toDate() : new Date(val);
      if (!isNaN(d.getTime())) {
        dateStr = localYmd(d);
      }
    }

    setFormTitle(task.title || "");
    setFormDesc(task.description || "");
    setFormDept(task.department || "general");
    setFormPriority(task.priority || "medium");
    setFormStatus(task.status || "assigned");
    setFormProjectId(task.projectId || "");
    setFormDueDate(dateStr);
    const initialWorkerIds = Array.from(
      new Set(
        [
          ...assignedWorkerIds(task.assignedTo),
          ...(Array.isArray(task.assignedWorkerIds) ? task.assignedWorkerIds : []),
          ...(task.workerId ? [String(task.workerId)] : []),
        ].filter(Boolean),
      ),
    );
    setFormAssignedWorkerIds(initialWorkerIds.length > 0 ? initialWorkerIds : [uid]);
    setFormSubtasks(task.subtasks || []);
    setNewSubtaskInput("");
    setNewSubtaskDesc("");
    setNewSubtaskLink("");
    setFormNotificationMessage("");
    setWorkerSearch("");
    setEditId(task.id);
    setModalMode("edit");
  };

  const handleAddModalSubtask = () => {
    if (!newSubtaskInput.trim()) return;
    const item: Subtask = {
      id: `st-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      title: newSubtaskInput.trim(),
      description: newSubtaskDesc.trim() || undefined,
      link: newSubtaskLink.trim() || undefined,
      completed: false,
    };
    setFormSubtasks((prev) => [...prev, item]);
    setNewSubtaskInput("");
    setNewSubtaskDesc("");
    setNewSubtaskLink("");
  };

  async function startTask(id: string) {
    try {
      await updateTask(db, id, {
        status: "in-progress",
        startedAt: serverTimestamp(),
      });
      toast.success("Task started", { description: "Timer and activity are logged." });
      await refresh();
    } catch {
      toast.error("Could not start task");
    }
  }

  async function submitApproval(id: string) {
    try {
      await updateTask(db, id, {
        status: "pending-approval",
        submittedForApprovalAt: serverTimestamp(),
      });
      if (activeTask?.id === id) {
        setActiveTask((prev) => (prev ? { ...prev, status: "pending-approval" } : null));
      }
      toast.success("Submitted for approval", {
        description: "Admin has been notified. You can undo if you need to edit further.",
        action: {
          label: "Undo",
          onClick: () => void undoSubmission(id),
        },
      });
      await refresh();
    } catch {
      toast.error("Could not submit task");
    }
  }

  async function undoSubmission(id: string) {
    try {
      await updateTask(db, id, {
        status: "in-progress",
        submittedForApprovalAt: null,
      });
      if (activeTask?.id === id) {
        setActiveTask((prev) => (prev ? { ...prev, status: "in-progress", submittedForApprovalAt: undefined } : null));
      }
      toast.success("Submission undone", {
        description: "Task reverted to In Progress. You can continue working and editing.",
      });
      await refresh();
    } catch {
      toast.error("Could not undo submission");
    }
  }

  async function claimTask(id: string) {
    try {
      await updateTask(db, id, {
        assignedTo: uid,
        assignedWorkerName: workerName || "Team Member",
        assignedWorkerIds: [uid],
        status: "in-progress",
        startedAt: serverTimestamp(),
      });
      toast.success("Directive claimed!", { description: "You are now assigned. Moved to In Progress." });
      await refresh();
    } catch {
      toast.error("Could not claim directive");
    }
  }

  async function handleDeleteTask(taskId: string) {
    const ok = await confirmDialog({
      title: "Delete Task Directive",
      message: "Are you sure you want to delete this task? This action cannot be undone.",
      confirmLabel: "Delete Task",
      cancelLabel: "Cancel",
      tone: "danger",
    });
    if (!ok) return;

    try {
      await deleteTask(db, taskId);
      toast.success("Task deleted");
      if (activeTask?.id === taskId) setActiveTask(null);
      await refresh();
    } catch {
      toast.error("Failed to delete task");
    }
  }

  async function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formTitle.trim()) {
      toast.warning("Task title is required");
      return;
    }

    if (formAssignedWorkerIds.length === 0) {
      toast.warning("Please assign at least one team member");
      return;
    }

    setFormSaving(true);
    try {
      const p = projects.find((x) => x.id === formProjectId);
      const projName = p?.name || (p?.title as string) || "";
      const assignedNames = formAssignedWorkerIds.map((id) => getWorkerDisplayName(id)).join(", ");

      const assignedToVal =
        formAssignedWorkerIds.length === 1 ? formAssignedWorkerIds[0] : formAssignedWorkerIds;

      if (modalMode === "create") {
        await createTask(db, {
          title: formTitle.trim(),
          description: formDesc.trim(),
          projectId: formProjectId || undefined,
          projectName: projName,
          department: formDept,
          priority: formPriority,
          assignedTo: assignedToVal,
          assignedWorkerName: assignedNames || "Unassigned",
          assignedWorkerIds: formAssignedWorkerIds,
          dueDate: formDueDate ? new Date(formDueDate) : null,
          photo: formPhoto.trim() || null,
          subtasks: formSubtasks,
          createdBy: uid,
          createdByName: workerName || "Team Member",
          notificationMessage: formNotificationMessage.trim() || undefined,
        });
        toast.success("Task created & assigned", { description: `Assigned to ${assignedNames}` });
      } else if (modalMode === "edit" && editId) {
        const updateData: Record<string, unknown> = {
          title: formTitle.trim(),
          description: formDesc.trim(),
          department: formDept,
          priority: formPriority,
          status: formStatus,
          assignedTo: assignedToVal,
          assignedWorkerName: assignedNames || "Unassigned",
          dueDate: formDueDate ? new Date(formDueDate) : null,
          photo: formPhoto.trim() || null,
          subtasks: formSubtasks,
        };
        if (formProjectId) {
          updateData.projectId = formProjectId;
          updateData.projectName = projName;
        } else {
          updateData.projectId = null;
          updateData.projectName = "";
        }

        await updateTask(db, editId, updateData, {
          assignedWorkerIds: formAssignedWorkerIds,
          senderName: workerName,
          taskTitle: formTitle.trim(),
          priority: formPriority,
          currentUid: uid,
          message: formNotificationMessage.trim() || undefined,
        });
        toast.success("Task updated & reassigned", { description: `Assigned to ${assignedNames}` });
      }

      setModalMode(null);
      await refresh();
    } catch {
      toast.error(modalMode === "create" ? "Failed to create task" : "Failed to update task");
    } finally {
      setFormSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-20 rounded-xl mft-skeleton" />
          ))}
        </div>
        <div className="h-64 rounded-xl mft-skeleton" />
      </div>
    );
  }

  if (err) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
        <p className="font-semibold text-sm">Failed to load tasks: {err}</p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 transition-colors cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* KPI Stats Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="ui-card p-4">
          <p className="text-[11px] font-medium text-zinc-500">Total Directives</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">{stats.total}</p>
        </div>
        <div className="ui-card p-4">
          <p className="text-[11px] font-medium text-zinc-500">In Progress</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-amber-600">{stats.inProgress}</p>
        </div>
        <div className="ui-card p-4">
          <p className="text-[11px] font-medium text-zinc-500">In Review</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-violet-600">{stats.review}</p>
        </div>
        <div className="ui-card p-4">
          <p className="text-[11px] font-medium text-zinc-500">Completed</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-emerald-600">{stats.completed}</p>
        </div>
        <div className="ui-card p-4 col-span-2 sm:col-span-1">
          <p className="text-[11px] font-medium text-zinc-500">Completion Rate</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">{stats.rate}%</p>
        </div>
      </div>

      {/* Scope Filter Switcher */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-200 dark:border-zinc-800 pb-2">
        <button
          type="button"
          onClick={() => setScopeFilter("all")}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
            scopeFilter === "all"
              ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
              : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          }`}
        >
          <span>🌐 All Team Tasks</span>
          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-zinc-200/50 dark:bg-zinc-700">
            {scopeCounts.all}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setScopeFilter("assigned-me")}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
            scopeFilter === "assigned-me"
              ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
              : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          }`}
        >
          <span>👤 Assigned to Me</span>
          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-zinc-200/50 dark:bg-zinc-700">
            {scopeCounts.assignedMe}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setScopeFilter("created-me")}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
            scopeFilter === "created-me"
              ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
              : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          }`}
        >
          <span>✍️ Assigned by Me</span>
          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-zinc-200/50 dark:bg-zinc-700">
            {scopeCounts.createdMe}
          </span>
        </button>
      </div>

      {/* Quick Status & Urgency Chips */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setQuickFilter("all")}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
            quickFilter === "all"
              ? "border-zinc-800 bg-zinc-800 text-white dark:border-white dark:bg-white dark:text-zinc-900"
              : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-700"
          }`}
        >
          All Items ({quickCounts.all})
        </button>
        <button
          type="button"
          onClick={() => setQuickFilter("overdue")}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
            quickFilter === "overdue"
              ? "border-red-600 bg-red-600 text-white"
              : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
          }`}
        >
          <span>🔥 Overdue</span>
          <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${quickFilter === "overdue" ? "bg-white/20 text-white" : "bg-red-200/60 text-red-800 dark:bg-red-900/80 dark:text-red-200"}`}>
            {quickCounts.overdue}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setQuickFilter("today")}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
            quickFilter === "today"
              ? "border-amber-600 bg-amber-600 text-white"
              : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300"
          }`}
        >
          <span>📅 Due Today</span>
          <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${quickFilter === "today" ? "bg-white/20 text-white" : "bg-amber-200/60 text-amber-800 dark:bg-amber-900/80 dark:text-amber-200"}`}>
            {quickCounts.today}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setQuickFilter("urgent")}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
            quickFilter === "urgent"
              ? "border-orange-600 bg-orange-600 text-white"
              : "border-orange-200 bg-orange-50 text-orange-700 hover:bg-orange-100 dark:border-orange-900/60 dark:bg-orange-950/40 dark:text-orange-300"
          }`}
        >
          <span>⚡ Urgent / High</span>
          <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${quickFilter === "urgent" ? "bg-white/20 text-white" : "bg-orange-200/60 text-orange-800 dark:bg-orange-900/80 dark:text-orange-200"}`}>
            {quickCounts.urgent}
          </span>
        </button>
      </div>

      {/* Control Bar: Search, Filters, View Switcher & New Task */}
      <div className="ui-card p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2.5">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tasks, directives, assignees…"
              className="brutal-input pl-9"
            />
          </div>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="brutal-input w-auto min-w-[130px]"
            aria-label="Filter by status"
          >
            <option value="all">All Statuses</option>
            <option value="assigned">Assigned</option>
            <option value="in-progress">In Progress</option>
            <option value="pending-approval">In Review</option>
            <option value="completed">Completed</option>
          </select>

          {/* Priority filter */}
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="brutal-input w-auto min-w-[120px]"
            aria-label="Filter by priority"
          >
            <option value="all">All Priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          {/* Department filter */}
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="brutal-input w-auto min-w-[140px]"
            aria-label="Filter by department"
          >
            {DEPTS.map((d) => (
              <option key={d.v} value={d.v}>
                {d.l}
              </option>
            ))}
          </select>

          {/* Sort order */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="brutal-input w-auto min-w-[135px]"
            aria-label="Sort tasks"
          >
            <option value="due">Sort: Deadline</option>
            <option value="priority">Sort: Priority</option>
            <option value="newest">Sort: Newest</option>
            <option value="title">Sort: Title (A-Z)</option>
          </select>
        </div>

        {/* View Switcher + New Task */}
        <div className="flex items-center gap-2 self-end lg:self-auto">
          <div className="flex items-center rounded-lg border border-zinc-200 bg-zinc-100 p-0.5 dark:border-zinc-800 dark:bg-zinc-800">
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`rounded-md p-1.5 text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 ${
                viewMode === "list"
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                  : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300"
              }`}
              title="List view"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              <span className="hidden sm:inline">List</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("board")}
              className={`rounded-md p-1.5 text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 ${
                viewMode === "board"
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                  : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300"
              }`}
              title="Board view"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
              </svg>
              <span className="hidden sm:inline">Board</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("calendar")}
              className={`rounded-md p-1.5 text-xs font-semibold transition-all cursor-pointer flex items-center gap-1 ${
                viewMode === "calendar"
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
                  : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300"
              }`}
              title="Calendar view"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="hidden sm:inline">Calendar</span>
            </button>
          </div>

          <button
            type="button"
            onClick={openCreateModal}
            className="brutal-btn"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            <span>Assign New Task</span>
          </button>
        </div>
      </div>

      {/* Main Task View Body */}
      {viewMode === "board" ? (
        <TaskBoardView
          tasks={filteredTasks}
          onSelectTask={(t) => setActiveTask(t)}
          onStartTask={startTask}
          onSubmitApproval={submitApproval}
          onUndoSubmission={undoSubmission}
        />
      ) : viewMode === "calendar" ? (
        <div className="space-y-4">
          <TasksCalendar
            tasks={tasks}
            selectedDate={selectedDate}
            onSelectDate={(d) => setSelectedDate(d)}
          />
          <div className="ui-card p-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-3">
              {selectedDate ? `Tasks due on ${selectedDate.toLocaleDateString()}` : "Tasks with deadlines"}
            </h3>
            {filteredTasks.length === 0 ? (
              <p className="text-xs text-zinc-400 py-6 text-center">No tasks scheduled for this date.</p>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {filteredTasks.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => setActiveTask(t)}
                    className="flex items-center justify-between py-3 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800 px-2 rounded-lg transition-colors"
                  >
                    <div>
                      <p className="text-sm font-semibold text-zinc-900 dark:text-white">{t.title}</p>
                      <p className="text-xs text-zinc-500">
                        {t.projectName || "General directive"} · Assigned to: {resolveAssigneeDisplay(t)}
                      </p>
                    </div>
                    <span className="rounded bg-zinc-100 px-2 py-1 text-xs font-semibold capitalize dark:bg-zinc-800">
                      {t.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* List View */
        <div className="space-y-4">
          {filteredTasks.length === 0 ? (
            <div className="ui-card flex flex-col items-center justify-center p-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-400 dark:bg-zinc-800">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <h3 className="mt-3 text-sm font-semibold text-zinc-900 dark:text-white">No tasks match your filters</h3>
              <p className="mt-1 text-xs text-zinc-500 max-w-sm">Try clearing your search query or picking a different department, status, or scope.</p>
              {(searchQuery || statusFilter !== "all" || priorityFilter !== "all" || deptFilter !== "all" || scopeFilter !== "all" || quickFilter !== "all") && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setStatusFilter("all");
                    setPriorityFilter("all");
                    setDeptFilter("all");
                    setScopeFilter("all");
                    setQuickFilter("all");
                    setSortBy("due");
                  }}
                  className="mt-4 text-xs font-semibold text-red-600 hover:text-red-700 cursor-pointer"
                >
                  Reset all filters
                </button>
              )}
            </div>
          ) : (
            [...groupedByProject.entries()].map(([pid, list]) => (
              <div key={pid} className="ui-card overflow-hidden">
                {/* Project Header */}
                <div className="border-b border-zinc-200 bg-zinc-50/70 px-5 py-3 dark:border-zinc-800 dark:bg-zinc-800/50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-zinc-900 dark:text-white">
                      {projectTitle(pid)}
                    </span>
                    <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                      {list.length}
                    </span>
                  </div>
                </div>

                {/* Tasks List */}
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {list.map((task) => {
                    const isRevision = task.status === "in-progress" && Boolean(task.rejectionReason);
                    const subtasks = task.subtasks || [];
                    const completedSub = subtasks.filter((s) => s.completed).length;

                    return (
                      <div
                        key={task.id}
                        onClick={() => setActiveTask(task)}
                        className="group flex flex-col gap-3 p-4 transition-colors hover:bg-zinc-50/80 dark:hover:bg-zinc-800/70 sm:flex-row sm:items-center sm:justify-between cursor-pointer"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-zinc-900 group-hover:text-red-600 transition-colors dark:text-white">
                              {task.title || "Untitled Task"}
                            </span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                task.priority === "urgent"
                                  ? "bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-400"
                                  : task.priority === "high"
                                  ? "bg-orange-50 text-orange-700 dark:bg-orange-950/60 dark:text-orange-400"
                                  : task.priority === "low"
                                  ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                                  : "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400"
                              }`}
                            >
                              {task.priority || "normal"}
                            </span>

                            {task.department && (
                              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                                {task.department}
                              </span>
                            )}

                            {subtasks.length > 0 && (
                              <div className="flex items-center gap-1.5 rounded-md bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5" title={`${completedSub} of ${subtasks.length} subtasks done`}>
                                <div className="h-1.5 w-10 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                                  <div
                                    className={`h-full rounded-full transition-all duration-300 ${
                                      completedSub === subtasks.length ? "bg-emerald-500" : "bg-red-600 dark:bg-red-500"
                                    }`}
                                    style={{ width: `${Math.round((completedSub / subtasks.length) * 100)}%` }}
                                  />
                                </div>
                                <span className="font-mono text-[10px] text-zinc-600 dark:text-zinc-300 font-medium">
                                  {completedSub}/{subtasks.length}
                                </span>
                              </div>
                            )}

                            {task.dueDate && (() => {
                              const d = parseTaskDueDate(task.dueDate);
                              if (!d) return null;
                              const overdue = isTaskOverdue(task);
                              const today = isTaskDueToday(task);
                              return (
                                <span
                                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium font-mono ${
                                    overdue
                                      ? "bg-red-100 text-red-700 dark:bg-red-950/70 dark:text-red-400 font-semibold"
                                      : today
                                      ? "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 font-semibold"
                                      : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                                  }`}
                                >
                                  <span>{overdue ? "⚠️ Overdue:" : today ? "⏰ Today:" : "📅"}</span>
                                  <span>{d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                                </span>
                              );
                            })()}
                          </div>

                          {task.description && (
                            <p className="mt-1 line-clamp-1 text-xs text-zinc-500 leading-normal">
                              {task.description}
                            </p>
                          )}

                          {/* Assignee & Submitter tag */}
                          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-zinc-400 font-mono">
                            <span className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300 font-sans">
                              <span>👤</span>
                              <span>Assigned to:</span>
                              {resolveAssigneeDisplay(task) === "Unassigned" ? (
                                <span className="rounded bg-amber-100 px-1.5 py-0.2 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                                  Unassigned
                                </span>
                              ) : (
                                <strong className="text-zinc-800 dark:text-zinc-200">
                                  {resolveAssigneeDisplay(task)}
                                </strong>
                              )}
                            </span>
                            {task.createdBy && (
                              <span>
                                By: {task.createdBy === uid ? "You" : (task.createdByName || "Admin")}
                              </span>
                            )}
                          </div>

                          {isRevision && (
                            <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                              ⚠️ <span className="font-semibold">Revision requested: </span>
                              {task.rejectionReason}
                            </div>
                          )}
                        </div>

                        {/* Right side actions */}
                        <div className="flex items-center gap-2 self-end sm:self-center" onClick={(e) => e.stopPropagation()}>
                          {/* Claim Action for Unassigned Directives */}
                          {resolveAssigneeDisplay(task) === "Unassigned" && (
                            <button
                              type="button"
                              disabled={inlineActionTaskId === task.id}
                              onClick={async (e) => {
                                e.stopPropagation();
                                setInlineActionTaskId(task.id);
                                try {
                                  await claimTask(task.id);
                                } finally {
                                  setInlineActionTaskId(null);
                                }
                              }}
                              className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-2.5 py-1 text-xs font-semibold text-white shadow-xs hover:bg-red-700 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-60"
                              title="Claim and assign this directive to yourself"
                            >
                              {inlineActionTaskId === task.id ? (
                                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                              ) : (
                                <span>✋ Claim</span>
                              )}
                            </button>
                          )}

                          {/* Fast Inline Progression Action */}
                          {task.status === "assigned" && resolveAssigneeDisplay(task) !== "Unassigned" && (
                            <button
                              type="button"
                              disabled={inlineActionTaskId === task.id}
                              onClick={async (e) => {
                                e.stopPropagation();
                                setInlineActionTaskId(task.id);
                                try {
                                  await startTask(task.id);
                                } finally {
                                  setInlineActionTaskId(null);
                                }
                              }}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-60"
                              title="Start this task now"
                            >
                              {inlineActionTaskId === task.id ? (
                                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                              ) : (
                                <span>▶ Start</span>
                              )}
                            </button>
                          )}

                          {task.status === "in-progress" && (
                            <button
                              type="button"
                              disabled={inlineActionTaskId === task.id}
                              onClick={async (e) => {
                                e.stopPropagation();
                                setInlineActionTaskId(task.id);
                                try {
                                  await submitApproval(task.id);
                                } finally {
                                  setInlineActionTaskId(null);
                                }
                              }}
                              className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1 text-xs font-semibold text-white shadow-xs hover:bg-violet-700 active:scale-[0.98] transition-all cursor-pointer disabled:opacity-60"
                              title="Submit for admin approval"
                            >
                              {inlineActionTaskId === task.id ? (
                                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                              ) : (
                                <span>Submit ➔</span>
                              )}
                            </button>
                          )}

                          {task.status === "pending-approval" && (
                            <button
                              type="button"
                              disabled={inlineActionTaskId === task.id}
                              onClick={async (e) => {
                                e.stopPropagation();
                                setInlineActionTaskId(task.id);
                                try {
                                  await undoSubmission(task.id);
                                } finally {
                                  setInlineActionTaskId(null);
                                }
                              }}
                              className="inline-flex items-center gap-1 rounded-lg bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 px-2.5 py-1 text-xs font-semibold text-zinc-800 dark:text-zinc-200 shadow-xs active:scale-[0.98] transition-all cursor-pointer disabled:opacity-60"
                              title="Undo submission and return to In Progress"
                            >
                              {inlineActionTaskId === task.id ? (
                                <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-700 border-t-transparent" />
                              ) : (
                                <span>↩ Undo</span>
                              )}
                            </button>
                          )}

                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${
                              task.status === "completed"
                                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400"
                                : task.status === "pending-approval"
                                ? "bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-400"
                                : task.status === "in-progress"
                                ? "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400"
                                : "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400"
                            }`}
                          >
                            {task.status === "pending-approval" ? "In Review" : task.status}
                          </span>

                          <button
                            type="button"
                            onClick={() => openEditModal(task)}
                            className="rounded-lg p-1.5 text-zinc-400 hover:text-zinc-800 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                            title="Edit or Reassign Task"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>

                          {(task.createdBy === uid || task.status === "completed") && (
                            <button
                              type="button"
                              onClick={() => handleDeleteTask(task.id)}
                              className="rounded-lg p-1.5 text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer"
                              title="Delete Task"
                            >
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Task Detail Drawer */}
      <TaskDetailDrawer
        db={db}
        task={activeTask}
        uid={uid}
        workerName={workerName}
        workers={workers}
        onClose={() => setActiveTask(null)}
        onStartTask={startTask}
        onSubmitApproval={submitApproval}
        onUndoSubmission={undoSubmission}
        onClaimTask={claimTask}
        onEditTask={openEditModal}
        onNewAdminMessage={onNewAdminMessage}
        onTaskUpdated={() => void refresh()}
      />

      {/* Create / Edit / Reassign Task Modal (Matching Admin Features) */}
      {modalMode !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs animate-fade-in"
          onClick={() => setModalMode(null)}
        >
          <div
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-zinc-200 dark:border-zinc-800">
              <div>
                <h3 className="text-lg font-bold text-zinc-900 dark:text-white">
                  {modalMode === "create" ? "Assign New Task Directive" : "Edit & Reassign Task"}
                </h3>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Assign tasks to team members with directives, deadlines, and notification alerts.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalMode(null)}
                className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 transition-colors"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Task Title *
                </label>
                <input
                  required
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="e.g. Design responsive landing hero"
                  className="brutal-input"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Description / Directives
                </label>
                <textarea
                  rows={3}
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="Details, requirements, guidelines, deliverables…"
                  className="brutal-input resize-none"
                />
              </div>

              {/* Project & Department */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                    Project
                  </label>
                  <select
                    value={formProjectId}
                    onChange={(e) => setFormProjectId(e.target.value)}
                    className="brutal-input"
                  >
                    <option value="">No Project (General Directive)</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name || (p.title as string) || p.id}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                    Department
                  </label>
                  <select
                    value={formDept}
                    onChange={(e) => setFormDept(e.target.value)}
                    className="brutal-input"
                  >
                    {DEPTS.filter((d) => d.v !== "all").map((d) => (
                      <option key={d.v} value={d.v}>
                        {d.l}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Priority & Due Date */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                    Priority
                  </label>
                  <select
                    value={formPriority}
                    onChange={(e) => setFormPriority(e.target.value)}
                    className="brutal-input"
                  >
                    <option value="low">Low Priority</option>
                    <option value="medium">Medium Priority</option>
                    <option value="high">High Priority</option>
                    <option value="urgent">Urgent Priority</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                    Due Date
                  </label>
                  <input
                    type="date"
                    value={formDueDate}
                    onChange={(e) => setFormDueDate(e.target.value)}
                    className="brutal-input"
                  />
                </div>
              </div>

              {modalMode === "edit" && (
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                    Workflow Status
                  </label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value)}
                    className="brutal-input"
                  >
                    <option value="assigned">Assigned</option>
                    <option value="in-progress">In Progress</option>
                    <option value="pending-approval">Pending Approval</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
              )}

              {/* ── Assignees Selection (Matching Admin) ── */}
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 bg-zinc-50/50 dark:bg-zinc-800/40 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                    Assign To Team Members *
                  </label>
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setFormAssignedWorkerIds([uid])}
                      className="text-red-600 hover:underline font-semibold cursor-pointer"
                    >
                      Assign to Me
                    </button>
                    <span className="text-zinc-300 dark:text-zinc-700">|</span>
                    <button
                      type="button"
                      onClick={() => setFormAssignedWorkerIds(approvedWorkers.map((w) => w.id))}
                      className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300 cursor-pointer"
                    >
                      Select All
                    </button>
                    <span className="text-zinc-300 dark:text-zinc-700">|</span>
                    <button
                      type="button"
                      onClick={() => setFormAssignedWorkerIds([])}
                      className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300 cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                {/* Search */}
                <input
                  value={workerSearch}
                  onChange={(e) => setWorkerSearch(e.target.value)}
                  placeholder="Filter team members by name, role or department…"
                  className="brutal-input text-xs py-1.5 bg-white dark:bg-zinc-900"
                />

                {/* Worker List */}
                <div className="max-h-48 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800 bg-white dark:bg-zinc-900 p-1 space-y-1">
                  {filteredModalWorkers.map((w) => {
                    const isSelected = formAssignedWorkerIds.includes(w.id);
                    const isSelf = w.id === uid;
                    return (
                      <div
                        key={w.id}
                        onClick={() => toggleAssignee(w.id)}
                        className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all ${
                          isSelected
                            ? "bg-red-50 text-red-950 dark:bg-red-950/40 dark:text-red-200 ring-1 ring-red-500/40"
                            : "hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300"
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}}
                            className="accent-red-600 w-4 h-4 cursor-pointer rounded"
                          />
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-200 text-[10px] font-bold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
                            {w.firstName?.[0]?.toUpperCase() || "W"}
                          </div>
                          <div>
                            <p className="text-xs font-semibold leading-none">
                              {w.firstName} {w.lastName} {isSelf && <span className="text-[10px] text-zinc-400 font-normal">(You)</span>}
                            </p>
                            <p className="text-[10px] text-zinc-400 mt-0.5">
                              {w.role ? formatRole(w.role) : "Worker"} {w.department ? `· ${w.department}` : ""}
                            </p>
                          </div>
                        </div>
                        {isSelected && (
                          <span className="text-[10px] font-bold text-red-600 bg-red-100 dark:bg-red-950 px-2 py-0.5 rounded-md">
                            Selected
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {filteredModalWorkers.length === 0 && (
                    <p className="text-xs text-zinc-400 p-4 text-center italic">No team members match &quot;{workerSearch}&quot;</p>
                  )}
                </div>
                <p className="text-[11px] text-zinc-500">
                  {formAssignedWorkerIds.length} worker{formAssignedWorkerIds.length === 1 ? "" : "s"} selected for assignment.
                </p>
              </div>

              {/* ── Subtasks / Directive Checklist Builder ── */}
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 bg-zinc-50/50 dark:bg-zinc-800/40 space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                    Checklist &amp; Subtasks
                  </label>
                  <span className="text-[10px] font-mono text-zinc-400">
                    {formSubtasks.length} item{formSubtasks.length === 1 ? "" : "s"}
                  </span>
                </div>

                <div className="space-y-2">
                  {formSubtasks.map((st) => (
                    <div
                      key={st.id}
                      className="p-2.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <span className="font-semibold block truncate text-zinc-800 dark:text-zinc-200">{st.title}</span>
                          {st.description && (
                            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5 whitespace-pre-wrap">{st.description}</p>
                          )}
                          {st.link && (
                            <a
                              href={/^https?:\/\//i.test(st.link.trim()) ? st.link.trim() : `https://${st.link.trim()}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[10px] text-blue-600 dark:text-blue-400 hover:underline mt-1"
                            >
                              <span>🔗</span>
                              <span className="truncate">{st.link.replace(/^https?:\/\//i, "")}</span>
                            </a>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setFormSubtasks((prev) => prev.filter((x) => x.id !== st.id))}
                          className="text-zinc-400 hover:text-red-600 px-1 cursor-pointer text-base font-bold shrink-0"
                          title="Remove item"
                        >
                          &times;
                        </button>
                      </div>
                    </div>
                  ))}
                  {formSubtasks.length === 0 && (
                    <p className="text-xs text-zinc-400 italic">No subtasks added yet.</p>
                  )}
                </div>

                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 space-y-2">
                  <input
                    value={newSubtaskInput}
                    onChange={(e) => setNewSubtaskInput(e.target.value)}
                    placeholder="+ Subtask title (required)…"
                    className="w-full rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-xs text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:border-red-500 focus:outline-none"
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={newSubtaskDesc}
                      onChange={(e) => setNewSubtaskDesc(e.target.value)}
                      placeholder="Description / criteria (optional)…"
                      className="rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-[11px] text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none"
                    />
                    <input
                      type="text"
                      value={newSubtaskLink}
                      onChange={(e) => setNewSubtaskLink(e.target.value)}
                      placeholder="Link URL (figma, PR, doc, optional)…"
                      className="rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-1.5 text-[11px] text-zinc-700 dark:text-zinc-300 placeholder:text-zinc-400 focus:border-red-500 focus:outline-none"
                    />
                  </div>
                  <div className="flex justify-end pt-0.5">
                    <button
                      type="button"
                      onClick={handleAddModalSubtask}
                      disabled={!newSubtaskInput.trim()}
                      className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200 cursor-pointer transition-colors"
                    >
                      + Add Subtask
                    </button>
                  </div>
                </div>
              </div>

              {/* Attachment Photo */}
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Photo / Deliverable Asset URL (optional)
                </label>
                <input
                  type="url"
                  value={formPhoto}
                  onChange={(e) => setFormPhoto(e.target.value)}
                  placeholder="https://..."
                  className="brutal-input"
                />
              </div>

              {/* Notification Message */}
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Custom Notification Message to Assignees (optional)
                </label>
                <input
                  value={formNotificationMessage}
                  onChange={(e) => setFormNotificationMessage(e.target.value)}
                  placeholder="e.g. Please finish this before sprint review on Thursday"
                  className="brutal-input"
                />
                <p className="text-[10px] text-zinc-400 mt-1">
                  Assigned team members will receive an instant push notification &amp; portal alert.
                </p>
              </div>

              <div className="mt-6 flex justify-end gap-2 pt-3 border-t border-zinc-200 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setModalMode(null)}
                  className="brutal-btn-outline"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSaving}
                  className="brutal-btn"
                >
                  {formSaving ? "Saving…" : modalMode === "create" ? "Assign Task" : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
