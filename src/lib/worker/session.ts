import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
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
): Promise<WorkSessionState | null> {
  const now = new Date();
  const today = localYmd(now);
  const fullName = `${worker.firstName ?? ""} ${worker.lastName ?? ""}`.trim() || worker.email || "Team Member";

  const createNew = async (): Promise<WorkSessionState> => {
    const ref = await addDoc(collection(db, "workSessions"), {
      workerId: worker.uid,
      workerName: fullName,
      workerEmail: worker.email ?? "",
      loginTime: now,
      startTime: now,
      isActive: true,
      presenceStatus: "active",
      lastActiveCheckAt: serverTimestamp(),
      totalWorkTime: 0,
      date: today,
      createdAt: serverTimestamp(),
    });

    if (worker.uid) {
      updateDoc(doc(db, "workers", worker.uid), {
        presenceStatus: "active",
        lastActiveAt: serverTimestamp(),
        lastActiveCheckAt: serverTimestamp(),
      }).catch(() => {});

      import("./adminNotifications")
        .then(({ notifyAdmins }) =>
          notifyAdmins(db, {
            targetRoles: ["super_admin", "hr_admin"],
            category: "hr",
            eventType: "worker_clock_in",
            title: `🟢 Shift Started: ${fullName}`,
            body: `${fullName} clocked in for today's shift (${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}).`,
            href: "/admin/work-sessions",
            actorUid: worker.uid,
            actorName: fullName,
          }),
        )
        .catch(() => {});
    }

    return {
      id: ref.id,
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
    const snap = await getDocs(q);
    if (!snap.empty) {
      // Resume today's record: bank what was already logged, start a new segment now.
      const existing = snap.docs[0]!;
      const data = existing.data();
      const wasActive = Boolean(data.isActive);
      const start: Date = data.startTime?.toDate?.() ?? new Date(data.startTime ?? now);
      const priorMs = typeof data.totalWorkTime === "number" ? data.totalWorkTime : 0;
      await updateDoc(doc(db, "workSessions", existing.id), {
        isActive: true,
        presenceStatus: "active",
        lastLoginTime: now,
        lastActiveCheckAt: serverTimestamp(),
        lastUpdated: serverTimestamp(),
      });

      if (worker.uid) {
        updateDoc(doc(db, "workers", worker.uid), {
          presenceStatus: "active",
          lastActiveAt: serverTimestamp(),
          lastActiveCheckAt: serverTimestamp(),
        }).catch(() => {});

        if (!wasActive) {
          import("./adminNotifications")
            .then(({ notifyAdmins }) =>
              notifyAdmins(db, {
                targetRoles: ["super_admin", "hr_admin"],
                category: "hr",
                eventType: "worker_shift_resumed",
                title: `▶️ Shift Resumed: ${fullName}`,
                body: `${fullName} resumed their shift today (${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}).`,
                href: "/admin/work-sessions",
                actorUid: worker.uid,
                actorName: fullName,
              }),
            )
            .catch(() => {});
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
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("index")) return await createNew();
    console.error("initWorkSession", e);
    return null;
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
  await updateDoc(doc(db, "workSessions", session.id), {
    logoutTime,
    endTime: logoutTime,
    isActive: false,
    presenceStatus: "offline",
    totalWorkTime,
    completedAt: serverTimestamp(),
  });
  const hoursLogged = (totalWorkTime / (1000 * 60 * 60)).toFixed(1);
  const wName = session.workerName || "Team Member";
  import("./adminNotifications")
    .then(({ notifyAdmins }) =>
      notifyAdmins(db, {
        targetRoles: ["super_admin", "hr_admin"],
        category: "hr",
        eventType: "worker_clock_out",
        title: `⏹️ Shift Ended: ${wName}`,
        body: `${wName} clocked out (${hoursLogged}h logged today).`,
        href: "/admin/work-sessions",
        actorUid: session.workerId,
        actorName: wName,
      }),
    )
    .catch(() => {});
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
          targetRoles: ["super_admin", "hr_admin", "ops_admin"],
          category: "hr",
          eventType: "worker_presence_checkin",
          title: `✅ Active Check-In: ${wName}`,
          body: `${wName} confirmed active presence — working on "${data.taskTitle || "Active & Available"}"${data.note ? ` (${data.note})` : ""}.`,
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

    import("./adminNotifications")
      .then(({ notifyAdmins }) =>
        notifyAdmins(db, {
          targetRoles: ["super_admin", "hr_admin"],
          category: "hr",
          eventType: "missed_checkin",
          title: "⚠️ Missed 2-Hour Presence Check-In",
          body: `Worker (${workerId}) did not respond to the active presence check-in window and was marked Idle.`,
          href: "/admin/work-sessions",
          actorUid: workerId,
        }),
      )
      .catch(() => {});
  }
}

