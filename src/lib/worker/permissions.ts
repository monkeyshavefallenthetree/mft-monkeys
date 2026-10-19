/**
 * HR-POL-2026 permission ledger (worker side).
 *
 * One Firestore doc per worker/day/kind with a deterministic id
 * `{workerId}_{YYYY-MM-DD}_{late|early}` so re-renders / reconnects never
 * double-charge the monthly quota. Admins can reverse entries from HR → Compliance.
 */
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import type { ClockInEvaluation, EarlyLeaveEvaluation, PermissionLedgerEntry } from "./hrPolicy2026";

export type WorkerLedgerDoc = PermissionLedgerEntry & {
  id: string;
  reversedReason?: string;
  requestStatus?: "pending" | "approved";
};

export const ledgerId = (workerId: string, date: string, kind: "late" | "early") => `${workerId}_${date}_${kind}`;

/** Live ledger entries of one worker inside [startYmd, endYmd] (single-field query, filtered locally). */
export function subscribeCycleLedger(
  db: Firestore,
  workerId: string,
  startYmd: string,
  endYmd: string,
  onData: (rows: WorkerLedgerDoc[]) => void,
): () => void {
  return onSnapshot(
    query(collection(db, "permissionLedger"), where("workerId", "==", workerId)),
    (snap) => {
      const rows: WorkerLedgerDoc[] = [];
      snap.forEach((d) => {
        const r = { id: d.id, ...d.data() } as WorkerLedgerDoc;
        if (r.date >= startYmd && r.date <= endYmd) rows.push(r);
      });
      rows.sort((a, b) => b.date.localeCompare(a.date));
      onData(rows);
    },
    (err) => {
      console.warn("[permissions] ledger subscription failed:", err);
      onData([]);
    },
  );
}

type WorkerInfo = { uid: string; name: string; email?: string };

/**
 * Records the worker's choice for today's late clock-in: use a monthly permission
 * (`usePermission: true`) or accept the salary deduction (`false`).
 *
 * - First call creates the entry (deterministic id → never double-charged).
 * - `overwrite: true` lets the worker change their mind the same day: only the choice
 *   fields are updated (Firestore rules enforce this and the same-day window).
 * - Entries an admin created or reversed are never changed from the worker app.
 *
 * Payroll re-verifies minutes and quota from attendance; this record only stores the choice.
 */
export async function chargeLatePermission(
  db: Firestore,
  worker: WorkerInfo,
  date: string,
  cycleId: string,
  ev: ClockInEvaluation,
  opts?: {
    usePermission?: boolean;
    penaltyDays?: 0 | 0.25 | 0.5;
    overwrite?: boolean;
  },
): Promise<boolean> {
  if (ev.status === "on-time") return false;
  const ref = doc(db, "permissionLedger", ledgerId(worker.uid, date, "late"));
  const wantPermission = opts?.usePermission ?? true;
  const covered = wantPermission && ev.covered;
  const fallbackPenaltyDays: 0 | 0.25 | 0.5 = covered
    ? 0
    : opts?.penaltyDays ?? (ev.fallbackPenaltyDays > 0 ? ev.fallbackPenaltyDays : 0.25);
  const choice = {
    covered,
    chargedMinutes: covered ? ev.chargedMinutes : 0,
    fallbackPenaltyDays,
    uncoveredReason: covered ? null : ev.uncoveredReason ?? "declined",
  };

  const existing = await getDoc(ref);
  if (existing.exists()) {
    if (!opts?.overwrite) return false;
    const cur = existing.data();
    if (cur.source === "admin" || cur.status !== "applied" || cur.reversedBy || cur.reappliedBy) {
      throw new Error("This entry was set by HR and can no longer be changed.");
    }
    if (date !== localYmdNow()) {
      throw new Error("The late-arrival choice can only be changed on the same day.");
    }
    await updateDoc(ref, { ...choice, source: "worker", choiceUpdatedAt: serverTimestamp() });
    import("./adminNotifications")
      .then(({ notifyAdmins }) =>
        notifyAdmins(db, {
          targetRoles: ["super_admin", "hr_admin"],
          category: "hr",
          eventType: "late_permission_updated",
          title: `⏰ Late Choice Updated: ${worker.name}`,
          body: covered
            ? `${worker.name} chose to use ${choice.chargedMinutes}m permission for ${ev.lateMinutes}m late arrival (${date}).`
            : `${worker.name} opted for ${fallbackPenaltyDays}d salary deduction for ${ev.lateMinutes}m late arrival (${date}).`,
          href: "/admin/hr",
          actorUid: worker.uid,
          actorName: worker.name,
        }),
      )
      .catch(() => {});
    return true;
  }

  await setDoc(ref, {
    workerId: worker.uid,
    workerName: worker.name,
    workerEmail: worker.email ?? "",
    cycleId,
    date,
    kind: "late",
    clockInHm: ev.clockInHm,
    actualMinutes: ev.lateMinutes,
    ...choice,
    status: "applied",
    source: opts?.usePermission !== undefined ? "worker" : "auto",
    createdAt: serverTimestamp(),
  });

  import("./adminNotifications")
    .then(({ notifyAdmins }) =>
      notifyAdmins(db, {
        targetRoles: ["super_admin", "hr_admin"],
        category: "hr",
        eventType: "late_permission_logged",
        title: `⏰ Late Arrival (${ev.lateMinutes}m): ${worker.name}`,
        body: covered
          ? `${worker.name} clocked in at ${ev.clockInHm} and used ${choice.chargedMinutes}m permission.`
          : `${worker.name} clocked in at ${ev.clockInHm} (${fallbackPenaltyDays}d deduction applied).`,
        href: "/admin/hr",
        actorUid: worker.uid,
        actorName: worker.name,
      }),
    )
    .catch(() => {});

  return true;
}

function localYmdNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Records an early-leave permission (covered) or an acknowledged unpermitted early leave (uncovered). */
export async function chargeEarlyLeave(
  db: Firestore,
  worker: WorkerInfo,
  date: string,
  cycleId: string,
  ev: EarlyLeaveEvaluation,
  usePermission: boolean,
  requiredEndHm: string,
): Promise<void> {
  const covered = usePermission && ev.canUsePermission;
  await setDoc(doc(db, "permissionLedger", ledgerId(worker.uid, date, "early")), {
    workerId: worker.uid,
    workerName: worker.name,
    workerEmail: worker.email ?? "",
    cycleId,
    date,
    kind: "early_leave",
    requiredEndHm,
    actualMinutes: ev.remainingMinutes,
    chargedMinutes: covered ? ev.chargedMinutes : 0,
    covered,
    uncoveredReason: covered ? null : ev.uncoveredReason ?? "declined",
    status: "applied",
    source: "worker",
    createdAt: serverTimestamp(),
  });

  import("./adminNotifications")
    .then(({ notifyAdmins }) =>
      notifyAdmins(db, {
        targetRoles: ["super_admin", "hr_admin"],
        category: "hr",
        eventType: "early_leave_logged",
        title: `🚪 Early Leave (${ev.remainingMinutes}m): ${worker.name}`,
        body: covered
          ? `${worker.name} left ${ev.remainingMinutes}m early and used ${ev.chargedMinutes}m permission.`
          : `${worker.name} left ${ev.remainingMinutes}m early (unpermitted early leave).`,
        href: "/admin/hr",
        actorUid: worker.uid,
        actorName: worker.name,
      }),
    )
    .catch(() => {});
}

/**
 * Worker clocked back in on the same day after an early leave → the early-leave
 * entry no longer reflects reality; mark it reversed so the quota is refunded.
 * (The next clock-out re-evaluates against the required end.)
 */
export async function reverseEarlyLeaveOnReturn(db: Firestore, workerId: string, date: string): Promise<void> {
  const ref = doc(db, "permissionLedger", ledgerId(workerId, date, "early"));
  try {
    const snap = await getDoc(ref);
    if (!snap.exists() || snap.data().status !== "applied") return;
    await updateDoc(ref, { status: "reversed", reversedReason: "returned_same_day", reversedAt: serverTimestamp() });
  } catch (e) {
    console.warn("[permissions] could not reverse early leave:", e);
  }
}
