"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
} from "firebase/auth";
import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { getFirebase, isFirebaseConfigured } from "@/lib/firebase";
import { mapAuthError } from "@/lib/auth-errors";
import FirebaseSetupWarning from "./FirebaseSetupWarning";
import WorkerAuthShell from "./WorkerAuthShell";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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

    setBusy(true);
    try {
      const cred = await signInWithEmailAndPassword(fb.auth, email.trim(), password);
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
        setSuccess(
          "Login successful! Your account is pending approval. You will be notified when approved.",
        );
        await signOut(fb.auth);
        window.setTimeout(() => {
          router.replace("/");
        }, 3000);
        return;
      }

      const loginIso = new Date().toISOString();
      sessionStorage.setItem("workerLoginTime", loginIso);

      await updateDoc(wref, {
        lastLogin: serverTimestamp(),
        currentLoginTime: serverTimestamp(),
        isOnline: true,
      });

      setSuccess("Login successful! Redirecting to dashboard…");
      window.setTimeout(() => router.push("/dashboard"), 800);
    } catch (err: unknown) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code: string }).code) : "";
      const message = err instanceof Error ? err.message : "Login failed.";
      if (message.includes("Worker account") || message.includes("rejected")) {
        setError(message);
      } else {
        setError(mapAuthError(code, message));
      }
    } finally {
      setBusy(false);
    }
  }

  async function onForgotPassword() {
    setError(null);
    setSuccess(null);
    const fb = getFirebase();
    if (!fb) return;
    const addr = email.trim();
    if (!addr) {
      setError("Enter your email above, then click Forgot password.");
      return;
    }
    setBusy(true);
    try {
      await sendPasswordResetEmail(fb.auth, addr);
      setSuccess("Password reset email sent. Check your inbox.");
    } catch (err: unknown) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code: string }).code) : "";
      setError(mapAuthError(code, "Could not send reset email."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <WorkerAuthShell variant="narrow">
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {error ? error : success ? success : ""}
      </div>

      <div className="mb-8">
        <h2 className="text-3xl font-oswald text-[var(--mft-primary)] mb-1">AUTH.LOGIN</h2>
        <p className="text-xs uppercase tracking-widest text-[var(--mft-muted)]">
          Identify to access terminal
        </p>
      </div>

      {error ? (
        <div role="alert" className="mb-6 border-l-4 border-red-500 bg-red-950/30 px-4 py-3 text-sm text-red-200">
          [ERR] {error}
        </div>
      ) : null}
      {success ? (
        <div role="status" className="mb-6 border-l-4 border-green-500 bg-green-950/30 px-4 py-3 text-sm text-green-200">
          [SYS] {success}
        </div>
      ) : null}

      <form className="space-y-6" onSubmit={onSubmit} noValidate>
        <div>
          <label htmlFor="email" className="mb-2 block text-xs font-bold uppercase text-[var(--mft-muted)] tracking-wider">
            Operator Email <span className="text-[var(--mft-primary)]">*</span>
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="brutal-input placeholder:text-[#333333]"
            placeholder="OPERATOR@MFT.SYS"
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-2 block text-xs font-bold uppercase text-[var(--mft-muted)] tracking-wider">
            Access Code <span className="text-[var(--mft-primary)]">*</span>
          </label>
          <div className="relative flex">
            <input
              id="password"
              name="password"
              type={showPw ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="brutal-input pr-16"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPw((s) => !s)}
              className="absolute right-0 top-0 h-full px-4 text-xs font-bold uppercase text-[var(--mft-muted)] hover:text-white border-l border-[var(--mft-border)] bg-[var(--mft-surface)] hover:bg-[var(--mft-primary)] hover:border-[var(--mft-primary)] transition-colors"
            >
              {showPw ? "HIDE" : "SHOW"}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={busy}
          className={`w-full brutal-btn ${busy ? "worker-btn-loading" : ""}`}
        >
          {busy ? "[ AUTHENTICATING... ]" : "[ INITIALIZE SESSION ]"}
        </button>

        <div className="pt-4 border-t border-[var(--mft-border)] flex flex-col gap-3">
          <button
            type="button"
            onClick={onForgotPassword}
            disabled={busy}
            className="text-center text-xs text-[var(--mft-muted)] uppercase tracking-wider hover:text-[var(--mft-primary)] transition-colors"
          >
            &gt; Request Code Reset &lt;
          </button>
          <div className="text-center text-xs uppercase tracking-wider text-[var(--mft-muted)] mt-2">
            NO CLEARANCE?{" "}
            <Link href="/register" className="font-bold text-[var(--mft-primary)] hover:underline decoration-2 underline-offset-4">
              REGISTER NEW OPERATOR
            </Link>
          </div>
        </div>
      </form>
    </WorkerAuthShell>
  );
}
