"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc, serverTimestamp, updateDoc, onSnapshot, query, collection, where } from "firebase/firestore";
import type { Timestamp } from "firebase/firestore";
import { playTerminalBeep } from "@/lib/sound";
import { getFirebase, isFirebaseConfigured } from "@/lib/firebase";
import { loadAlertsForWorker, markAlertRead, type AlertRow } from "@/lib/worker/alerts";
import { subscribeChatNotifications, type ChatNotification } from "@/lib/worker/chatNotifications";
import {
  loadWorkerExceptions,
  submitException,
  type ExceptionRow,
} from "@/lib/worker/exceptions";
import {
  alertRelativeTime,
  formatRole,
  formatSessionDuration,
  formatWorkType,
  toDate,
} from "@/lib/worker/format";
import { endWorkSession, initWorkSession, syncWorkSession, type WorkSessionState } from "@/lib/worker/session";
import { loadTasksForWorker } from "@/lib/worker/tasks";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import TasksPanel from "./TasksPanel";
import { DashboardSkeleton } from "./Skeleton";
import FirebaseSetupWarning from "./FirebaseSetupWarning";

const MARKETING =
  process.env.NEXT_PUBLIC_MARKETING_SITE_URL?.replace(/\/$/, "") ?? "";

type Tab = "profile" | "time" | "tasks" | "alerts" | "exceptions";

type WorkerDoc = {
  email?: string;
  firstName?: string;
  lastName?: string;
  status?: string;
  role?: string;
  phone?: string;
  experience?: string;
  department?: string;
  employmentType?: string;
  expectedSalary?: number;
  government?: string;
  city?: string;
  skills?: string[];
  portfolioLink?: string;
  netspend?: string;
  createdAt?: Timestamp;
  lastLogin?: Timestamp;
};

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "profile", label: "Profile", icon: "👤" },
  { id: "time", label: "Time", icon: "⏱" },
  { id: "tasks", label: "Tasks", icon: "✓" },
  { id: "alerts", label: "Alerts", icon: "🔔" },
  { id: "exceptions", label: "Exceptions", icon: "⚠️" },
];

function alertIcon(type: string | undefined) {
  const icons: Record<string, string> = {
    attendance: "⏰",
    performance: "📊",
    schedule: "📅",
    policy: "📋",
    general: "📢",
    urgent: "🚨",
  };
  return icons[type ?? ""] ?? "📢";
}

export default function DashboardApp() {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const [authLoading, setAuthLoading] = useState(true);
  const [uid, setUid] = useState<string | null>(null);
  const [profile, setProfile] = useState<(WorkerDoc & { uid: string }) | null>(null);
  const [tab, setTab] = useState<Tab>("profile");
  const [session, setSession] = useState<WorkSessionState | null>(null);
  const [, bumpSessionRender] = useState(0);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [exceptions, setExceptions] = useState<ExceptionRow[]>([]);
  const [exceptionsLoading, setExceptionsLoading] = useState(true);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);
  const [chatNotifications, setChatNotifications] = useState<ChatNotification[]>([]);
  const chatNotifCountRef = useRef(0);
  const [salaryEdit, setSalaryEdit] = useState(false);
  const [salaryVal, setSalaryVal] = useState("");
  const [exceptionType, setExceptionType] = useState("late");
  const [taskStats, setTaskStats] = useState({ total: 0, completed: 0, pending: 0, rate: 0 });
  const lastSyncRef = useRef(0);
  const sessionRef = useRef<WorkSessionState | null>(null);
  sessionRef.current = session;
  const loggingOutRef = useRef(false);

  // Collect Firestore listener unsubscribers so we can tear them down before signOut
  const firestoreUnsubs = useRef<Array<() => void>>([]);
  const registerUnsub = useCallback((unsub: () => void) => {
    firestoreUnsubs.current.push(unsub);
    return unsub;
  }, []);
  const teardownListeners = useCallback(() => {
    firestoreUnsubs.current.forEach((fn) => { try { fn(); } catch {} });
    firestoreUnsubs.current = [];
  }, []);

  const showToast = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    setToast({ msg, kind });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const loadDashboardData = useCallback(
    async (userId: string) => {
      if (loggingOutRef.current) return;
      const fb = getFirebase();
      if (!fb) return;

      const wref = doc(fb.db, "workers", userId);
      const snap = await getDoc(wref);
      if (!snap.exists()) {
        showToast("Worker profile not found.", "err");
        await signOut(fb.auth);
        router.replace("/");
        return;
      }
      const data = snap.data() as WorkerDoc;
      if (data.status === "rejected") {
        await signOut(fb.auth);
        router.replace("/");
        showToast("Your account has been rejected.", "err");
        return;
      }

      setProfile({ uid: userId, ...data });
      setSalaryVal(String(data.expectedSalary ?? ""));

      let loginIso = sessionStorage.getItem("workerLoginTime");
      if (!loginIso) {
        loginIso = new Date().toISOString();
        sessionStorage.setItem("workerLoginTime", loginIso);
      }

      const ws = await initWorkSession(
        fb.db,
        {
          uid: userId,
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
        },
        loginIso,
      );
      setSession(ws);

      setAlertsLoading(true);
      setExceptionsLoading(true);
      try {
        const [a, ex] = await Promise.all([
          loadAlertsForWorker(fb.db, userId),
          loadWorkerExceptions(fb.db, userId),
        ]);
        setAlerts(a);
        setExceptions(ex);
      } catch (e) {
        console.error(e);
        showToast("Some data failed to load. Try switching tabs to retry.", "err");
      } finally {
        setAlertsLoading(false);
        setExceptionsLoading(false);
      }

      try {
        const t = await loadTasksForWorker(fb.db, userId);
        const completed = t.filter((x) => x.status === "completed").length;
        const pending =
          t.filter((x) => x.status === "assigned" || x.status === "in-progress").length +
          t.filter((x) => x.status === "pending-approval").length;
        const rate = t.length ? Math.round((completed / t.length) * 100) : 0;
        setTaskStats({ total: t.length, completed, pending, rate });
      } catch {
        /* tasks optional for header stats */
      }
    },
    [router, showToast],
  );

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setAuthLoading(false);
      return;
    }
    const fb = getFirebase();
    if (!fb) return;

    const unsub = onAuthStateChanged(fb.auth, async (user) => {
      if (loggingOutRef.current) return;
      if (!user) {
        setUid(null);
        setProfile(null);
        setAuthLoading(false);
        router.replace("/");
        return;
      }
      setUid(user.uid);
      await loadDashboardData(user.uid);
      setAuthLoading(false);
    });
    return () => unsub();
  }, [router, loadDashboardData]);

  const handleLogout = useCallback((opts?: { silent?: boolean }) => {
    if (loggingOutRef.current) return;
    if (!opts?.silent && !window.confirm("Are you sure you want to log out?")) return;

    loggingOutRef.current = true;

    // 1. Kill all Firestore listeners immediately.
    teardownListeners();
    sessionStorage.removeItem("workerLoginTime");

    // 2. Sign out (fire-and-forget). This clears local auth persistence
    //    so the user won't be auto-authenticated on the next page load.
    const fb = getFirebase();
    if (fb) {
      signOut(fb.auth).catch(() => {});
    }

    // 3. Navigate NOW. This is synchronous — nothing above can block it.
    window.location.href = "/";
  }, [teardownListeners]);

  /** Session duration display + optional Firebase sync + 8h timeout */
  useEffect(() => {
    if (!uid || !session) return;

    const loginIso = sessionStorage.getItem("workerLoginTime");
    if (!loginIso) return;

    const tickMs = reducedMotion ? 5000 : 1000;
    const id = window.setInterval(() => {
      // Stop ALL work once logout has started.
      if (loggingOutRef.current) return;

      bumpSessionRender((t) => t + 1);
      const fb = getFirebase();
      const ws = sessionRef.current;
      if (fb && ws) {
        const now = Date.now();
        if (now - lastSyncRef.current > 15000) {
          lastSyncRef.current = now;
          syncWorkSession(fb.db, ws).catch(() => {});
        }
      }

      const start = new Date(loginIso).getTime();
      const hours = (Date.now() - start) / (1000 * 60 * 60);
      if (hours > 8) {
        showToast("Your session has expired. Logging out.", "err");
        handleLogout({ silent: true });
      }
    }, tickMs);
    return () => window.clearInterval(id);
  }, [uid, session, reducedMotion, handleLogout, showToast]);

  /** Real-time Tasks Listener for Notifications */
  useEffect(() => {
    if (!uid) return;
    const fb = getFirebase();
    if (!fb) return;

    const q = query(
      collection(fb.db, "tasks"),
      where("assignedTo", "array-contains", uid)
    );

    let isInitialRender = true;
    let previousPendingCount = 0;

    const unsub = registerUnsub(onSnapshot(q, (snap) => {
      let pendingCount = 0;
      let completedCount = 0;
      snap.docs.forEach((d) => {
        const s = d.data().status;
        if (s === "assigned" || s === "in-progress" || s === "pending-approval") {
          pendingCount++;
        }
        if (s === "completed") {
          completedCount++;
        }
      });

      if (!isInitialRender && pendingCount > previousPendingCount) {
        playTerminalBeep();
      }

      previousPendingCount = pendingCount;
      isInitialRender = false;

      const totalCount = snap.docs.length;
      setTaskStats({
        total: totalCount,
        completed: completedCount,
        pending: pendingCount,
        rate: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0,
      });
    }, (err) => {
      // Swallow permission errors that fire during/after logout
      console.warn("[tasks listener]", err.message);
    }));

    return () => unsub();
  }, [uid]);

  /** Real-time Chat Notifications Listener */
  useEffect(() => {
    if (!uid) return;
    const fb = getFirebase();
    if (!fb) return;

    let unsub: (() => void) | undefined;
    try {
      unsub = registerUnsub(subscribeChatNotifications(fb.db, uid, (notifs) => {
        setChatNotifications(notifs);
        if (notifs.length > chatNotifCountRef.current && chatNotifCountRef.current >= 0) {
          const newest = notifs[0];
          if (newest) {
            playTerminalBeep();
            showToast(`New message from ${newest.senderName}: ${newest.messagePreview}`, "ok");
          }
        }
        chatNotifCountRef.current = notifs.length;
      }));
    } catch (e) {
      console.warn("[chat notifs]", e);
    }

    return () => unsub?.();
  }, [uid, showToast]);

  const handleNewAdminMessage = useCallback(() => {
    playTerminalBeep();
  }, []);

  /** Backup 8h check every 5 minutes */
  useEffect(() => {
    if (!uid) return;
    const id = window.setInterval(() => {
      if (loggingOutRef.current) return;
      const loginIso = sessionStorage.getItem("workerLoginTime");
      if (!loginIso) return;
      const hours = (Date.now() - new Date(loginIso).getTime()) / (1000 * 60 * 60);
      if (hours > 8) {
        showToast("Your session has expired. Logging out.", "err");
        void handleLogout({ silent: true });
      }
    }, 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [uid, handleLogout, showToast]);

  async function saveSalary() {
    const fb = getFirebase();
    if (!fb || !uid) return;
    const n = parseFloat(salaryVal);
    if (!n || n < 0) {
      showToast("Enter a valid salary.", "err");
      return;
    }
    try {
      await updateDoc(doc(fb.db, "workers", uid), { expectedSalary: n });
      setProfile((p) => (p ? { ...p, expectedSalary: n } : p));
      setSalaryEdit(false);
      showToast("Expected salary updated.");
    } catch {
      showToast("Could not update salary.", "err");
    }
  }

  async function onMarkRead(alertId: string) {
    const fb = getFirebase();
    if (!fb || !uid) return;
    try {
      await markAlertRead(fb.db, alertId, uid);
      setAlerts((list) => list.map((a) => (a.id === alertId ? { ...a, isRead: true } : a)));
    } catch {
      showToast("Could not mark alert read.", "err");
    }
  }

  async function onExceptionSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fb = getFirebase();
    if (!fb || !uid || !profile) return;
    const fd = new FormData(e.currentTarget);
    const type = String(fd.get("exceptionType") ?? "");
    const lateRaw = fd.get("lateMinutes");
    const lateMinutes = lateRaw ? parseInt(String(lateRaw), 10) : null;
    const exceptionDate = String(fd.get("exceptionDate") ?? "");
    const reason = String(fd.get("exceptionReason") ?? "").trim();
    const supportingEvidence = String(fd.get("supportingEvidence") ?? "").trim() || null;

    if (type === "late" && (!lateMinutes || lateMinutes < 30 || lateMinutes > 120)) {
      showToast("For late arrival, enter minutes between 30 and 120.", "err");
      return;
    }
    if (!reason) {
      showToast("Please provide a reason.", "err");
      return;
    }

    try {
      await submitException(fb.db, {
        workerId: uid,
        workerName: `${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim(),
        workerEmail: profile.email ?? "",
        type,
        lateMinutes,
        exceptionDate,
        reason,
        supportingEvidence,
      });
      const ex = await loadWorkerExceptions(fb.db, uid);
      setExceptions(ex);
      e.currentTarget.reset();
      (e.currentTarget.elements.namedItem("exceptionDate") as HTMLInputElement).value =
        new Date().toISOString().split("T")[0];
      showToast("Exception submitted.");
    } catch {
      showToast("Could not submit exception.", "err");
    }
  }

  if (!isFirebaseConfigured()) {
    return (
      <div className="p-6">
        <FirebaseSetupWarning />
      </div>
    );
  }

  if (authLoading || !uid || !profile) {
    return <DashboardSkeleton />;
  }

  const firebaseClient = getFirebase();
  if (!firebaseClient) {
    return <DashboardSkeleton />;
  }

  const loginIso = sessionStorage.getItem("workerLoginTime");
  const loginDate = loginIso ? new Date(loginIso) : null;
  const durationMs = loginDate
    ? Date.now() - loginDate.getTime()
    : session
      ? Date.now() - session.startTime.getTime()
      : 0;

  const unreadAlerts = alerts.filter((a) => !a.isRead).length;
  const unreadChatMessages = chatNotifications.length;

  return (
    <div className="min-h-[100dvh] pb-24 lg:pb-8">
      <div aria-live="polite" className="sr-only">
        {toast?.msg ?? ""}
      </div>

      <header className="sticky top-0 z-30 border-b border-[var(--mft-border)] bg-[var(--mft-bg)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="flex min-w-0 flex-1 items-start gap-4">
            <span className="hidden text-3xl sm:block font-oswald text-[var(--mft-primary)]" aria-hidden>
              {"//"}
            </span>
            <div className="min-w-0 flex flex-col justify-center">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--mft-muted)]">Terminal.Session</p>
              <h1 className="truncate text-xl font-bold font-oswald text-white uppercase tracking-wider">
                OP_{profile.firstName ?? "X"}{" "}
                <span className="text-[var(--mft-primary)]">{profile.lastName ?? ""}</span>
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 border border-[var(--mft-border)] bg-[var(--mft-surface)] px-2 py-1 font-mono text-[10px] uppercase text-white">
                  <span aria-hidden className="text-[var(--mft-primary)]">TIME</span>
                  {loginDate ? formatSessionDuration(durationMs) : "--:--:--"}
                </span>
                {session?.isActive ? (
                  <span className="border border-[#00FF66] bg-[#00FF66]/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-[#00FF66]">
                    LIVE
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => playTerminalBeep()}
              className="relative flex items-center justify-center brutal-btn-outline p-2 mr-2 hover:bg-[#00FF66] hover:text-black hover:border-black group transition-colors"
              aria-label="Test Sound"
              title="TEST AUDIO ALERT SYSTEM"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-80 group-hover:opacity-100">
                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>
                <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
              </svg>
            </button>
            {MARKETING ? (
              <Link
                href={MARKETING}
                className="brutal-btn-outline py-1.5 px-3 text-xs"
              >
                [ HOME ]
              </Link>
            ) : (
              <Link href="/" className="brutal-btn-outline py-1.5 px-3 text-xs">
                [ LOGIN ]
              </Link>
            )}
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="brutal-btn-outline py-1.5 px-3 text-xs hover:bg-[var(--mft-primary)] hover:border-[var(--mft-primary)]"
            >
              [ LOGOUT ]
            </button>
          </div>
        </div>

        <nav
          className="mx-auto hidden max-w-6xl flex-wrap gap-2 px-4 pb-0 lg:flex"
          aria-label="Dashboard sections"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 border-t border-x border-transparent px-5 py-3 text-xs font-bold uppercase tracking-widest transition-colors ${
                tab === t.id
                  ? "bg-[var(--mft-primary)] text-black border-[var(--mft-primary)]"
                  : "text-[var(--mft-muted)] hover:text-white"
              }`}
            >
              <span aria-hidden>{t.icon}</span>
              {t.label}
              {t.id === "alerts" && unreadAlerts > 0 ? (
                <span className="min-w-[1.25rem] bg-black text-[var(--mft-primary)] px-1.5 font-bold border border-[var(--mft-primary)]">
                  {unreadAlerts > 9 ? "9+" : unreadAlerts}
                </span>
              ) : null}
              {t.id === "tasks" && taskStats.pending > 0 ? (
                <span className="min-w-[1.25rem] bg-[var(--mft-primary)] text-black px-1.5 font-bold border border-black group-hover:border-white">
                  {taskStats.pending > 9 ? "9+" : taskStats.pending}
                </span>
              ) : null}
              {t.id === "tasks" && unreadChatMessages > 0 ? (
                <span className="min-w-[1.25rem] bg-[#00CCFF] text-black px-1.5 font-bold border border-black animate-pulse">
                  {unreadChatMessages > 9 ? "9+" : unreadChatMessages}
                </span>
              ) : null}
            </button>
          ))}
        </nav>
      </header>

      {profile.status === "pending" ? (
        <div
          role="status"
          className="mx-auto max-w-6xl px-4 pt-4 text-sm text-amber-100"
        >
          <div className="rounded-2xl border border-amber-500/40 bg-amber-950/40 px-4 py-3">
            Your account is <strong>pending approval</strong>. Some actions may be limited until an admin approves you.
          </div>
        </div>
      ) : null}

      <main className="mx-auto max-w-6xl space-y-6 p-4">
        {/* Welcome + quick stats */}
        <section className="brutal-card p-6 sm:p-8">
          <div className="relative">
            <h2 className="text-3xl font-oswald text-[var(--mft-primary)] uppercase tracking-wider">
              {profile.firstName ? `WELCOME, OP_${profile.firstName}` : "WELCOME"}
            </h2>
            <p className="mt-2 text-xs uppercase tracking-widest text-[var(--mft-muted)]">
              Terminal ready. Track time, tasks, and alerts above.
            </p>
            <div className="mt-8 grid grid-cols-2 gap-px bg-[var(--mft-border)] border border-[var(--mft-border)] sm:grid-cols-5">
              <StatCard label="Tasks" value={taskStats.total} sub="assigned to you" />
              <StatCard label="Done" value={taskStats.completed} sub={`${taskStats.rate}% complete`} />
              <StatCard label="In progress" value={taskStats.pending} sub="active/pending" />
              <StatCard label="Messages" value={unreadChatMessages} sub="unread chat" highlight={unreadChatMessages > 0} />
              <StatCard label="Unread alerts" value={unreadAlerts} sub="from HR" highlight={unreadAlerts > 0} />
            </div>
          </div>
        </section>

        {tab === "profile" ? (
          <section className="brutal-card p-6" aria-labelledby="profile-heading">
            <h2 id="profile-heading" className="text-2xl font-oswald text-[var(--mft-primary)] uppercase tracking-wider mb-2">
              Profile
            </h2>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <ProfileItem label="Email" value={profile.email ?? "—"} />
              <ProfileItem label="Phone" value={profile.phone ?? "—"} />
              <ProfileItem label="Role" value={formatRole(profile.role)} />
              <ProfileItem label="Experience" value={profile.experience ?? "—"} />
              <ProfileItem label="Department" value={profile.department ?? "—"} />
              <ProfileItem label="Work type" value={formatWorkType(profile.employmentType)} />
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase text-zinc-500">Expected monthly salary</dt>
                <dd className="mt-1 flex flex-wrap items-center gap-2 text-white">
                  {!salaryEdit ? (
                    <>
                      <span>{profile.expectedSalary != null ? `EGP ${profile.expectedSalary}` : "Not set"}</span>
                      <button
                        type="button"
                        onClick={() => setSalaryEdit(true)}
                        className="brutal-btn-outline py-1 px-3 text-xs"
                      >
                        [ EDIT ]
                      </button>
                    </>
                  ) : (
                    <>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={salaryVal}
                        onChange={(e) => setSalaryVal(e.target.value)}
                        className="brutal-input w-32 py-1 px-2 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => void saveSalary()}
                        className="brutal-btn py-1 px-3 text-xs"
                      >
                        [ SAVE ]
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSalaryEdit(false);
                          setSalaryVal(String(profile.expectedSalary ?? ""));
                        }}
                        className="brutal-btn-outline py-1 px-3 text-xs"
                      >
                        [ CANCEL ]
                      </button>
                    </>
                  )}
                </dd>
              </div>
              <ProfileItem
                label="Location"
                value={`${profile.government ?? "—"}, ${profile.city ?? "—"}`}
              />
              <ProfileItem
                label="Skills"
                value={
                  profile.skills?.length ? profile.skills.join(", ") : "Not specified"
                }
              />
              <ProfileItem
                label="Portfolio"
                value={
                  profile.portfolioLink ? (
                    <a
                      href={profile.portfolioLink}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#ef414b] underline"
                    >
                      View portfolio
                    </a>
                  ) : (
                    "Not provided"
                  )
                }
              />
              <ProfileItem label="Time to leave job" value={profile.netspend ?? "—"} />
              <ProfileItem
                label="Account status"
                value={
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs uppercase">
                    {profile.status ?? "—"}
                  </span>
                }
              />
              <ProfileItem
                label="Member since"
                value={
                  profile.createdAt
                    ? toDate(profile.createdAt)?.toLocaleDateString() ?? "—"
                    : "—"
                }
              />
              <ProfileItem
                label="Last login"
                value={
                  profile.lastLogin
                    ? toDate(profile.lastLogin)?.toLocaleString() ?? "—"
                    : "—"
                }
              />
            </dl>
          </section>
        ) : null}

        {tab === "time" ? (
          <section className="brutal-card p-6" aria-labelledby="time-heading">
            <h2 id="time-heading" className="text-2xl font-oswald text-[var(--mft-primary)] uppercase tracking-wider mb-2">
              Work session
            </h2>
            <p className="text-xs uppercase tracking-widest text-[var(--mft-muted)] mb-6">
              Your session is tracked for today. Time syncs to Firestore periodically.
            </p>
            <div className="border border-[var(--mft-border)] bg-[var(--mft-surface)] p-8 text-center brutal-card-hover">
              <p className="text-xs uppercase font-bold text-[var(--mft-muted)] tracking-wider">Session duration</p>
              <p className="mt-2 text-5xl font-mono text-white tabular-nums">
                {formatSessionDuration(durationMs)}
              </p>
              {session ? (
                <p className="mt-4 text-[10px] uppercase font-bold tracking-widest text-[var(--mft-primary)]">
                  SYS.DOC: {session.isActive ? "ACTIVE" : "TERMINATED"} {"//"} SYNC OK
                </p>
              ) : (
                <p className="mt-4 text-xs font-bold text-red-500">[ERR] CANNOT INITIALIZE SESSION DOC</p>
              )}
            </div>
          </section>
        ) : null}

        {tab === "tasks" ? (
          <section aria-labelledby="tasks-heading">
            <h2 id="tasks-heading" className="mb-4 text-xl font-semibold text-[#ef414b]">
              Tasks
            </h2>
            <TasksPanel
              db={firebaseClient.db}
              uid={uid}
              workerName={`${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim() || uid}
              onToast={showToast}
              onNewAdminMessage={handleNewAdminMessage}
            />
          </section>
        ) : null}

        {tab === "alerts" ? (
          <section className="brutal-card p-6" aria-labelledby="alerts-heading">
            <h2 id="alerts-heading" className="text-2xl font-oswald text-[var(--mft-primary)] uppercase tracking-wider mb-6">
              HR alerts
            </h2>
            {alertsLoading ? (
              <div className="h-24 animate-pulse bg-[var(--mft-border)]" />
            ) : alerts.length === 0 ? (
              <div className="border border-dashed border-[var(--mft-border)] p-8 text-center text-[var(--mft-muted)]">
                <p className="text-sm font-bold uppercase tracking-widest text-white">NO ALERTS FOUND</p>
                <p className="mt-2 text-[10px] uppercase tracking-widest">Awaiting transmissions</p>
              </div>
            ) : (
              <ul className="space-y-4">
                {alerts.map((a) => (
                  <li
                    key={a.id}
                    className={`border p-4 transition-colors ${
                      a.isRead ? "border-[var(--mft-border)] bg-[var(--mft-surface)]" : "border-[var(--mft-primary)] bg-[var(--mft-primary)]/10 shadow-[4px_4px_0px_0px_#FF5500]"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <span className="text-xs font-bold tracking-widest uppercase text-[var(--mft-primary)]">
                        [{alertIcon(a.type)} {a.type ?? "GENERAL"}]
                      </span>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)] border border-[var(--mft-border)] px-1.5 py-0.5">{a.priority ?? "MEDIUM"}</span>
                    </div>
                    <p className="font-oswald text-lg text-white tracking-wide uppercase">{a.title ?? "UNTITLED"}</p>
                    <p className="mt-2 text-sm text-[var(--mft-muted)]">{a.message ?? ""}</p>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-[var(--mft-border)] pt-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)]">
                        {alertRelativeTime(a.sentAt ?? a.createdAt)} {"//"} FROM: {String(a.sentBy ?? "HR")}
                      </p>
                      {!a.isRead ? (
                        <button
                          type="button"
                          onClick={() => void onMarkRead(a.id)}
                          className="brutal-btn-outline py-1 px-3 text-[10px]"
                        >
                          [ ACKNOWLEDGE ]
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {tab === "exceptions" ? (
          <section className="space-y-6" aria-labelledby="ex-head">
            <h2 id="ex-head" className="text-2xl font-oswald text-[var(--mft-primary)] uppercase tracking-wider mb-2">
              Exception requests
            </h2>

            <form
              className="brutal-card grid gap-4 p-6 sm:grid-cols-2"
              onSubmit={(e) => void onExceptionSubmit(e)}
            >
              <div className="sm:col-span-2">
                <label className="text-xs font-bold uppercase text-[var(--mft-muted)] tracking-wider block mb-2" htmlFor="exceptionType">
                  Type *
                </label>
                <select
                  id="exceptionType"
                  name="exceptionType"
                  required
                  value={exceptionType}
                  onChange={(e) => setExceptionType(e.target.value)}
                  className="brutal-input"
                >
                  <option value="late">Late arrival</option>
                  <option value="absent">Absent for the day</option>
                </select>
              </div>
              {exceptionType === "late" ? (
              <div id="lateMinutesGroup" className="sm:col-span-2">
                <label className="text-xs font-bold uppercase text-[var(--mft-muted)] tracking-wider block mb-2" htmlFor="lateMinutes">
                  Minutes late (30–120)
                </label>
                <input
                  id="lateMinutes"
                  name="lateMinutes"
                  type="number"
                  min={30}
                  max={120}
                  className="brutal-input"
                />
              </div>
              ) : null}
              <div className="sm:col-span-2">
                <label className="text-xs font-bold uppercase text-[var(--mft-muted)] tracking-wider block mb-2" htmlFor="exceptionDate">
                  Date *
                </label>
                <input
                  id="exceptionDate"
                  name="exceptionDate"
                  type="date"
                  required
                  defaultValue={new Date().toISOString().split("T")[0]}
                  className="brutal-input"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-bold uppercase text-[var(--mft-muted)] tracking-wider block mb-2" htmlFor="exceptionReason">
                  Reason *
                </label>
                <textarea
                  id="exceptionReason"
                  name="exceptionReason"
                  required
                  rows={3}
                  className="brutal-input"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs font-bold uppercase text-[var(--mft-muted)] tracking-wider block mb-2" htmlFor="supportingEvidence">
                  Supporting evidence (optional)
                </label>
                <textarea
                  id="supportingEvidence"
                  name="supportingEvidence"
                  rows={2}
                  className="brutal-input"
                />
              </div>
              <div className="sm:col-span-2 mt-2">
                <button
                  type="submit"
                  className="brutal-btn w-full hover:bg-white"
                >
                  [ SUBMIT EXCEPTION ]
                </button>
              </div>
            </form>

            <div className="brutal-card p-6">
              <h3 className="font-oswald text-xl text-white uppercase tracking-wider mb-4 border-b border-[var(--mft-border)] pb-2">History</h3>
              {exceptionsLoading ? (
                <div className="h-24 animate-pulse bg-[var(--mft-border)]" />
              ) : exceptions.length === 0 ? (
                <p className="text-center text-[10px] font-bold uppercase tracking-widest text-[var(--mft-muted)] border border-dashed border-[var(--mft-border)] p-8">
                  NO EXCEPTIONS FOUND
                </p>
              ) : (
                <ul className="space-y-4">
                  {exceptions.map((ex) => (
                    <li key={ex.id} className="border border-[var(--mft-border)] bg-[var(--mft-surface)] p-4 text-sm brutal-card-hover">
                      <div className="flex flex-wrap justify-between gap-2 border-b border-[var(--mft-border)] pb-2 mb-2">
                        <span className="font-bold uppercase tracking-wider text-white">
                          {ex.type === "late" ? "LATE ARRIVAL" : "ABSENT"}{" "}
                          {ex.type === "late" && ex.lateMinutes != null
                            ? `(${ex.lateMinutes}m)`
                            : ""}
                        </span>
                        <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 border ${
                          ex.status === "approved" ? "border-[#00FF66] text-[#00FF66]" :
                          ex.status === "rejected" ? "border-red-500 text-red-500" :
                          "border-amber-500 text-amber-500"
                        }`}>
                          {String(ex.status ?? "PENDING")}
                        </span>
                      </div>
                      <p className="text-[var(--mft-muted)]">
                        <strong className="text-white uppercase text-xs tracking-wider">REASON:</strong> {String(ex.reason ?? "")}
                      </p>
                      {ex.supportingEvidence ? (
                        <p className="mt-2 text-[var(--mft-muted)]">
                          <strong className="text-white uppercase text-xs tracking-wider">EVIDENCE:</strong> {String(ex.supportingEvidence)}
                        </p>
                      ) : null}
                      {ex.adminResponse ? (
                        <p className="mt-2 text-[var(--mft-muted)] border-l-2 border-[var(--mft-primary)] pl-2">
                          <strong className="text-[var(--mft-primary)] uppercase text-xs tracking-wider">ADMIN:</strong> {String(ex.adminResponse)}
                        </p>
                      ) : null}
                      <p className="mt-4 pt-2 border-t border-[var(--mft-border)] text-[10px] uppercase font-bold tracking-widest text-[var(--mft-muted)]">
                        DATE: {ex.exceptionDate ? String(ex.exceptionDate) : "—"} {"//"} SUBMITTED:{" "}
                        {toDate(ex.createdAt as Timestamp | undefined)?.toLocaleString() ?? "—"}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        ) : null}
      </main>

      <nav
        className="fixed bottom-0 left-0 right-0 z-40 flex border-t border-[var(--mft-border)] bg-[#000000] px-1 py-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] lg:hidden"
        aria-label="Mobile dashboard"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`relative flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors ${
              tab === t.id
                ? "bg-[var(--mft-primary)] text-black"
                : "text-[var(--mft-muted)] hover:text-white"
            }`}
          >
            <span className="text-sm leading-none" aria-hidden>
              {t.icon}
            </span>
            <span className="leading-tight">{t.label}</span>
            {t.id === "alerts" && unreadAlerts > 0 ? (
              <span className="absolute right-2 top-1 flex h-4 min-w-4 items-center justify-center bg-black border border-[var(--mft-primary)] px-1 text-[9px] font-bold text-[var(--mft-primary)]">
                {unreadAlerts > 9 ? "9+" : unreadAlerts}
              </span>
            ) : null}
            {t.id === "tasks" && unreadChatMessages > 0 ? (
              <span className="absolute left-2 top-1 flex h-4 min-w-4 items-center justify-center bg-[#00CCFF] border border-black px-1 text-[9px] font-bold text-black animate-pulse">
                {unreadChatMessages > 9 ? "9+" : unreadChatMessages}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      {toast ? (
        <div
          role="status"
          className={`fixed bottom-20 left-1/2 z-50 w-[90%] max-w-sm -translate-x-1/2 border px-4 py-3 text-sm font-mono shadow-[4px_4px_0px_0px_#FF5500] lg:bottom-8 ${
            toast?.kind === "err"
              ? "border-red-500 bg-red-950 text-red-500 shadow-[4px_4px_0px_0px_#EF4444]"
              : "border-[var(--mft-primary)] bg-[var(--mft-primary)] text-black"
          }`}
        >
          <span className="font-bold mr-2">{toast?.kind === "err" ? "[ERR]" : "[SYS]"}</span>
          {toast.msg}
        </div>
      ) : null}
    </div>
  );
}

function ProfileItem({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="border border-[var(--mft-border)] bg-[var(--mft-surface)] p-4 transition-colors hover:border-[var(--mft-primary)]">
      <dt className="text-[10px] uppercase font-bold tracking-widest text-[var(--mft-muted)] mb-1">{label}</dt>
      <dd className="text-white text-sm">{value}</dd>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: number;
  sub: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`p-4 text-center transition-colors bg-[var(--mft-bg)] hover:bg-[var(--mft-surface)] hover:text-white ${
        highlight
          ? "border-b-4 border-b-[var(--mft-primary)]"
          : ""
      }`}
    >
      <div className={`text-4xl font-oswald tabular-nums ${highlight ? "text-[var(--mft-primary)]" : "text-white"}`}>{value}</div>
      <div className="mt-2 text-xs font-bold uppercase tracking-wider text-[var(--mft-muted)]">{label}</div>
      <div className="mt-1 text-[10px] uppercase text-[var(--mft-muted)]">{sub}</div>
    </div>
  );
}
