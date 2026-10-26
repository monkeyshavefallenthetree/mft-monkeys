"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
} from "firebase/auth";
import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { getFirebase, isFirebaseConfigured } from "@/lib/firebase";
import { mapAuthError } from "@/lib/auth-errors";
import FirebaseSetupWarning from "./FirebaseSetupWarning";
import WorkerAuthShell from "./WorkerAuthShell";

const LAST_EMAIL_KEY = "mft.worker.lastEmail";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [shiftEndNotice, setShiftEndNotice] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [capsLock, setCapsLock] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const notice = sessionStorage.getItem("shiftEndNotice");
      if (notice) {
        setShiftEndNotice(notice);
        sessionStorage.removeItem("shiftEndNotice");
      }
      try {
        const last = localStorage.getItem(LAST_EMAIL_KEY);
        if (last) setEmail(last);
      } catch {
        /* storage unavailable */
      }
    }
  }, []);

  // Skip the login screen entirely for workers who are already signed in and approved.
  useEffect(() => {
    const fb = getFirebase();
    if (!fb) {
      setCheckingSession(false);
      return;
    }
    const unsub = onAuthStateChanged(fb.auth, async (user) => {
      if (!user || submittingRef.current) {
        setCheckingSession(false);
        return;
      }
      try {
        const snap = await getDoc(doc(fb.db, "workers", user.uid));
        const status = snap.exists() ? (snap.data() as { status?: string }).status : undefined;
        if (status === "approved" && !submittingRef.current) {
          router.replace("/dashboard");
          return;
        }
      } catch {
        /* fall through to the form */
      }
      setCheckingSession(false);
    });
    return unsub;
  }, [router]);

  function onPasswordKey(e: React.KeyboardEvent<HTMLInputElement>) {
    setCapsLock(e.getModifierState?.("CapsLock") ?? false);
  }

  if (!isFirebaseConfigured()) {
    return (
      <div className="mx-auto max-w-md p-6">
        <FirebaseSetupWarning />
      </div>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const fb = getFirebase();
    if (!fb) return;

    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }

    setBusy(true);
    submittingRef.current = true;
    try {
      const cred = await signInWithEmailAndPassword(fb.auth, email.trim(), password);
      try {
        localStorage.setItem(LAST_EMAIL_KEY, email.trim());
      } catch {
        /* storage unavailable */
      }
      const user = cred.user;
      const wref = doc(fb.db, "workers", user.uid);
      const snap = await getDoc(wref);
      if (!snap.exists()) {
        await signOut(fb.auth);
        throw new Error("Worker account not found. Please register as a worker.");
      }
      const workerData = snap.data() as { status?: string };

      if (workerData.status === "rejected") {
        await signOut(fb.auth);
        throw new Error("Your account has been rejected. Please contact the administrator.");
      }

      if (workerData.status === "pending") {
        await signOut(fb.auth);
        setPassword("");
        setPendingEmail(email.trim());
        return;
      }

      // Reset any previous session storage state so user can choose their shift mode
      try {
        sessionStorage.removeItem("workerLoginTime");
        sessionStorage.removeItem("workerShiftMode");
        sessionStorage.removeItem("workerOvertimeMinutes");
        sessionStorage.removeItem("mft_office_verified_date");
      } catch {
        /* ignore sessionStorage errors */
      }

      await Promise.race([
        updateDoc(wref, {
          lastLogin: serverTimestamp(),
          currentLoginTime: serverTimestamp(),
          isOnline: true,
        }).catch(() => {}),
        new Promise<void>((resolve) => setTimeout(() => resolve(), 2500)),
      ]);

      setSuccess("Welcome back! Opening your dashboard…");
      router.push("/dashboard");
      return;
    } catch (err: unknown) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code: string }).code) : "";
      const message = err instanceof Error ? err.message : "Login failed.";
      if (message.includes("Worker account") || message.includes("rejected")) {
        setError(message);
      } else {
        setError(mapAuthError(code, message));
      }
    }
    submittingRef.current = false;
    setBusy(false);
  }

  async function onForgotPassword() {
    setError(null);
    setSuccess(null);
    const fb = getFirebase();
    if (!fb) return;
    const addr = email.trim();
    if (!addr) {
      setError("Please enter your email above first, then click Forgot password.");
      return;
    }
    setBusy(true);
    try {
      await sendPasswordResetEmail(fb.auth, addr);
      setSuccess("Password reset email sent. Please check your inbox.");
    } catch (err: unknown) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code: string }).code) : "";
      setError(mapAuthError(code, "Could not send reset email."));
    } finally {
      setBusy(false);
    }
  }

  if (checkingSession) {
    return (
      <WorkerAuthShell variant="narrow">
        <div className="flex flex-col items-center gap-3 py-10 text-xs text-zinc-500" role="status">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-red-600 border-t-transparent" />
          Checking your session…
        </div>
      </WorkerAuthShell>
    );
  }

  if (pendingEmail) {
    return (
      <WorkerAuthShell variant="narrow">
        <div className="flex flex-col items-center text-center animate-fade-in">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400">
            <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-white">Awaiting approval</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Your account <span className="font-semibold text-zinc-900 dark:text-zinc-100">{pendingEmail}</span> is
            registered but hasn&apos;t been approved yet.
          </p>
          <ol className="mt-5 w-full space-y-2 text-left text-xs text-zinc-600 dark:text-zinc-400">
            <li className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-white">✓</span>
              Registration submitted
            </li>
            <li className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">2</span>
              An admin reviews your account
            </li>
            <li className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-300 text-[10px] font-bold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">3</span>
              Sign in and start your first shift
            </li>
          </ol>
          <button
            type="button"
            onClick={() => setPendingEmail(null)}
            className="brutal-btn mt-6 w-full"
          >
            Back to sign in
          </button>
        </div>
      </WorkerAuthShell>
    );
  }

  return (
    <WorkerAuthShell
      variant="narrow"
      footer={
        <p>
          Don&apos;t have an account?{" "}
          <Link href="/register" className="font-semibold text-red-600 hover:text-red-700 hover:underline">
            Register as a worker
          </Link>
        </p>
      }
    >
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
          Sign In
        </h1>
        <p className="mt-1 text-xs text-zinc-500">
          Enter your worker credentials to access your tasks and dashboard.
        </p>
      </div>

      {shiftEndNotice && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300 animate-fade-in">
          <svg className="h-4 w-4 shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="min-w-0 flex-1">{shiftEndNotice}</div>
        </div>
      )}

      {error && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300 animate-fade-in">
          <svg className="h-4 w-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <div className="min-w-0 flex-1">{error}</div>
        </div>
      )}

      {success && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300 animate-fade-in">
          <svg className="h-4 w-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <div className="min-w-0 flex-1">{success}</div>
        </div>
      )}

      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <div>
          <label htmlFor="email" className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
            Email Address *
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="brutal-input"
            placeholder="worker@mft.com"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="password" className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Password *
            </label>
            <button
              type="button"
              onClick={onForgotPassword}
              className="text-xs font-medium text-zinc-500 hover:text-red-600 transition-colors cursor-pointer"
            >
              Forgot password?
            </button>
          </div>
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPw ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={onPasswordKey}
              onKeyUp={onPasswordKey}
              onBlur={() => setCapsLock(false)}
              className="brutal-input pr-16"
              placeholder="••••••••"
              aria-describedby={capsLock ? "caps-hint" : undefined}
            />
            <button
              type="button"
              onClick={() => setShowPw((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
            >
              {showPw ? "Hide" : "Show"}
            </button>
          </div>
          {capsLock && (
            <p id="caps-hint" className="mt-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
              Caps Lock is on
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={busy}
          className="brutal-btn w-full mt-2"
        >
          {busy ? (
            <span className="flex items-center gap-2">
              <span className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Signing In…
            </span>
          ) : (
            "Sign In"
          )}
        </button>
      </form>
    </WorkerAuthShell>
  );
}
