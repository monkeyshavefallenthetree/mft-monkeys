import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  arrayUnion,
} from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { localYmd } from "./format";

/**
 * A worker's attendance record for one calendar day.
 *
 * A day can contain several work *segments* (clock in → clock out → clock in
 * again after a break). `priorMs` is the time already banked from earlier
 * segments and `segmentStart` is when the current segment began, so
 * `totalWorkTime = priorMs + (now - segmentStart)` never counts breaks.
 */
export type WorkSessionState = {
  id: string;
  /** First clock-in of the day (used for lateness + "started at"). */
  startTime: Date;
  /** Start of the currently running segment. */
  segmentStart: Date;
  /** Work time banked from earlier segments today (ms). */
  priorMs: number;
  isActive: boolean;
  workerId?: string;
  workerName?: string;
};

/** Total worked time today, including the running segment. */
export function workedMs(session: WorkSessionState | null, now = Date.now()): number {
  if (!session) return 0;
  const running = session.isActive ? Math.max(0, now - session.segmentStart.getTime()) : 0;
  return session.priorMs + running;
}

export async function initWorkSession(
  db: Firestore,
  worker: { uid: string; firstName?: string; lastName?: string; email?: string },
  shiftPlan?: {
    selectedTasks?: Array<{ id: string; title: string; projectName?: string }>;
    note?: string;
    sendNotification?: boolean;
  },
): Promise<WorkSessionState | null> {
  const now = new Date();
  const today = localYmd(now);
  const fullName = `${worker.firstName ?? ""} ${worker.lastName ?? ""}`.trim() || worker.email || "Team Member";

  const selectedTasks = (shiftPlan?.selectedTasks ?? []).map((t) => {
    const item: { id: string; title: string; projectName?: string } = {
      id: String(t.id || ""),
      title: String(t.title || "Untitled Task"),
    };
    if (t.projectName) {
      item.projectName = String(t.projectName);
    }
    return item;
  });
  const taskSummaryList = selectedTasks.map((t) => (t.projectName ? `[${t.projectName}] ${t.title}` : t.title));
  if (shiftPlan?.note?.trim()) {
    taskSummaryList.push(shiftPlan.note.trim());
  }
  const tasksSummaryText =
    taskSummaryList.length > 0 ? taskSummaryList.join(" ، ") : "مهام التشغيل العامة (General Tasks)";
  const shouldNotify = shiftPlan?.sendNotification !== false && Boolean(shiftPlan);

  const sendShiftStartNotification = (isResume: boolean) => {
    if (!worker.uid || !shouldNotify) return;
    const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    import("./adminNotifications")
      .then(({ notifyAdmins }) =>
        notifyAdmins(db, {
          targetRoles: ["super_admin", "account_manager", "ops_admin", "hr_admin"],
          category: "task",
          eventType: isResume ? "worker_shift_resumed" : "worker_clock_in",
          title: isResume
            ? `▶️ استئناف الشيفت وتحديد المهام: ${fullName}`
            : `🟢 بدء الشيفت واختيار المهام: ${fullName}`,
          body: `${fullName} ${isResume ? "استأنف الشيفت" : "بدأ الشيفت الآن"} (${timeStr}) وسيعمل على المهام: ${tasksSummaryText}`,
          href: "/admin/work-sessions",
          actorUid: worker.uid,
          actorName: fullName,
          urgent: true,
        }),
      )
      .catch(() => {});
  };

  const createNew = async (): Promise<WorkSessionState> => {
    const docRef = doc(collection(db, "workSessions"));
    const payload = {
      workerId: worker.uid,
      workerName: fullName,
      workerEmail: worker.email ?? "",
      loginTime: now,
      startTime: now,
      isActive: true,
      presenceStatus: "active",
      lastActiveCheckAt: serverTimestamp(),
      currentTaskTitle: tasksSummaryText,
      currentTaskNote: shiftPlan?.note?.trim() || null,
      shiftTasks: selectedTasks,
      totalWorkTime: 0,
      date: today,
      createdAt: serverTimestamp(),
    };

    try {
      await Promise.race([
        setDoc(docRef, payload),
        new Promise<void>((resolve) => setTimeout(() => resolve(), 6000)),
      ]);
    } catch (err) {
      console.warn("setDoc workSessions warning:", err);
    }

    if (worker.uid) {
      updateDoc(doc(db, "workers", worker.uid), {
        presenceStatus: "active",
        lastActiveAt: serverTimestamp(),
        lastActiveCheckAt: serverTimestamp(),
        currentTaskTitle: tasksSummaryText,
        currentTaskNote: shiftPlan?.note?.trim() || null,
      }).catch(() => {});

      sendShiftStartNotification(false);
    }

    return {
      id: docRef.id,
      startTime: now,
      segmentStart: now,
      priorMs: 0,
      isActive: true,
      workerId: worker.uid,
      workerName: fullName,
    };
  };

  const q = query(
    collection(db, "workSessions"),
    where("workerId", "==", worker.uid),
    where("date", "==", today),
  );

  try {
    const snap = await Promise.race([
      getDocs(q),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);
    if (snap && !snap.empty) {
      // Resume today's record: bank what was already logged, start a new segment now.
      const existing = snap.docs[0]!;
      const data = existing.data();
      const wasActive = Boolean(data.isActive);
      const rawStart: Date = data.startTime?.toDate?.() ?? new Date(data.startTime ?? now);
      const start: Date = isNaN(rawStart.getTime()) ? now : rawStart;
      const priorMs = typeof data.totalWorkTime === "number" ? data.totalWorkTime : 0;
      const updatePayload: Record<string, unknown> = {
        isActive: true,
        presenceStatus: "active",
        lastLoginTime: now,
        lastActiveCheckAt: serverTimestamp(),
        lastUpdated: serverTimestamp(),
      };
      if (shiftPlan) {
        updatePayload.currentTaskTitle = tasksSummaryText;
        updatePayload.currentTaskNote = shiftPlan.note?.trim() || null;
        updatePayload.shiftTasks = selectedTasks;
      }
      await Promise.race([
        updateDoc(doc(db, "workSessions", existing.id), updatePayload),
        new Promise<void>((resolve) => setTimeout(() => resolve(), 6000)),
      ]);

      if (worker.uid) {
        const workerPayload: Record<string, unknown> = {
          presenceStatus: "active",
          lastActiveAt: serverTimestamp(),
          lastActiveCheckAt: serverTimestamp(),
        };
        if (shiftPlan) {
          workerPayload.currentTaskTitle = tasksSummaryText;
          workerPayload.currentTaskNote = shiftPlan.note?.trim() || null;
        }
        updateDoc(doc(db, "workers", worker.uid), workerPayload).catch(() => {});

        if (!wasActive || shiftPlan) {
          sendShiftStartNotification(wasActive || priorMs > 60_000);
        }
      }

      return {
        id: existing.id,
        startTime: start,
        segmentStart: now,
        priorMs,
        isActive: true,
        workerId: worker.uid,
        workerName: fullName,
      };
    }
    return await createNew();
  } catch (e: unknown) {
    console.warn("initWorkSession query/update fallback to createNew:", e);
    try {
      return await createNew();
    } catch (innerErr) {
      console.error("initWorkSession fatal:", innerErr);
      return null;
    }
  }
}

export async function syncWorkSession(db: Firestore, session: WorkSessionState): Promise<void> {
  if (!session.isActive) return;
  await updateDoc(doc(db, "workSessions", session.id), {
    totalWorkTime: workedMs(session),
    lastUpdated: serverTimestamp(),
  });
}

/** Closes the running segment. Returns the banked session (isActive=false). */
export async function endWorkSession(db: Firestore, session: WorkSessionState): Promise<WorkSessionState> {
  const logoutTime = new Date();
  const totalWorkTime = workedMs(session, logoutTime.getTime());
  await Promise.race([
    updateDoc(doc(db, "workSessions", session.id), {
      logoutTime,
      endTime: logoutTime,
      isActive: false,
      presenceStatus: "offline",
      totalWorkTime,
      completedAt: serverTimestamp(),
    }),
    new Promise<void>((resolve) => setTimeout(() => resolve(), 6000)),
  ]);
  return { ...session, priorMs: totalWorkTime, segmentStart: logoutTime, isActive: false };
}

/**
 * Worker confirms active presence during 2h check-in prompt.
 * Records check-in entry, current task, note, and sets presenceStatus to active.
 */
export async function confirmPresenceCheckIn(
  db: Firestore,
  sessionId: string,
  workerId: string,
  data: {
    taskId?: string;
    taskTitle?: string;
    note?: string;
    workerName?: string;
  },
): Promise<void> {
  const now = new Date();
  const checkInRecord = {
    timestamp: now.toISOString(),
    taskId: data.taskId || null,
    taskTitle: data.taskTitle || "Active & Available",
    note: data.note || null,
    workerName: data.workerName || "",
  };

  const sessionRef = doc(db, "workSessions", sessionId);
  await updateDoc(sessionRef, {
    presenceStatus: "active",
    lastActiveCheckAt: serverTimestamp(),
    currentTaskTitle: data.taskTitle || "Active & Available",
    currentTaskNote: data.note || null,
    checkIns: arrayUnion(checkInRecord),
    lastUpdated: serverTimestamp(),
  });

  if (workerId) {
    const workerRef = doc(db, "workers", workerId);
    await updateDoc(workerRef, {
      presenceStatus: "active",
      lastActiveAt: serverTimestamp(),
      lastActiveCheckAt: serverTimestamp(),
      currentTaskTitle: data.taskTitle || "Active & Available",
      currentTaskNote: data.note || null,
    }).catch(() => {});

    const wName = data.workerName || "Team Member";
    import("./adminNotifications")
      .then(({ notifyAdmins }) =>
        notifyAdmins(db, {
          targetRoles: ["super_admin", "account_manager", "ops_admin", "hr_admin"],
          category: "hr",
          eventType: "worker_presence_checkin",
          title: `✅ تأكيد الحضور الدوري (٢ ساعة): ${wName}`,
          body: `${wName} أكد التواجد لساعتين إضافيتين — يعمل على "${data.taskTitle || "Active & Available"}"${data.note ? ` (${data.note})` : ""}.`,
          href: "/admin/work-sessions",
          actorUid: workerId,
          actorName: wName,
          taskId: data.taskId,
        }),
      )
      .catch(() => {});
  }
}

/**
 * Marks session as idle if worker failed to respond within countdown window.
 */
export async function markSessionIdle(
  db: Firestore,
  sessionId: string,
  workerId: string,
  workerName?: string,
): Promise<void> {
  const sessionRef = doc(db, "workSessions", sessionId);
  await updateDoc(sessionRef, {
    presenceStatus: "idle",
    missedCheckInAt: serverTimestamp(),
    lastUpdated: serverTimestamp(),
  });

  if (workerId) {
    const workerRef = doc(db, "workers", workerId);
    await updateDoc(workerRef, {
      presenceStatus: "idle",
      missedCheckInAt: serverTimestamp(),
    }).catch(() => {});

    const labelName = workerName || workerId;
    import("./adminNotifications")
      .then(({ notifyAdmins }) =>
        notifyAdmins(db, {
          targetRoles: ["super_admin", "account_manager", "ops_admin", "hr_admin"],
          category: "hr",
          eventType: "missed_checkin",
          title: `⚠️ عدم استجابة للشيك إن الدوري: ${labelName}`,
          body: `لم يقم ${labelName} بتأكيد الحضور خلال مهلة الـ ١٠ دقائق في نهاية الساعتين وتم تسجيله كـ غير مستجيب (Idle).`,
          href: "/admin/work-sessions",
          actorUid: workerId,
          actorName: labelName,
          urgent: true,
        }),
      )
      .catch(() => {});
  }
}


