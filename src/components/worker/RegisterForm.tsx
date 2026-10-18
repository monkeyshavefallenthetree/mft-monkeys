"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { getFirebase, isFirebaseConfigured } from "@/lib/firebase";
import { mapAuthError } from "@/lib/auth-errors";
import FirebaseSetupWarning from "./FirebaseSetupWarning";
import WorkerAuthShell from "./WorkerAuthShell";

type Step = 0 | 1 | 2;

function passwordStrength(password: string): { score: number; ok: boolean; label: string; color: string } {
  let score = 0;
  const feedback: string[] = [];
  if (password.length >= 8) score++;
  else feedback.push("8+ chars");
  if (/[a-z]/.test(password)) score++;
  else feedback.push("lowercase");
  if (/[A-Z]/.test(password)) score++;
  else feedback.push("uppercase");
  if (/[0-9]/.test(password)) score++;
  else feedback.push("number");
  if (/[^A-Za-z0-9]/.test(password)) score++;
  else feedback.push("symbol");

  if (score < 3) return { score, ok: false, label: `Weak — add: ${feedback.join(", ")}`, color: "bg-red-500" };
  if (score < 5) return { score, ok: true, label: "Medium password strength", color: "bg-amber-500" };
  return { score, ok: true, label: "Strong password", color: "bg-emerald-500" };
}

export default function RegisterForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [role, setRole] = useState("");
  const [customRole, setCustomRole] = useState("");
  const [experience, setExperience] = useState("");
  const [department, setDepartment] = useState("");
  const [employmentType, setEmploymentType] = useState("");
  const [expectedSalary, setExpectedSalary] = useState("");
  const [government, setGovernment] = useState("");
  const [city, setCity] = useState("");
  const [skills, setSkills] = useState("");
  const [portfolioLink, setPortfolioLink] = useState("");
  const [netspend] = useState("");
  const [hireDate, setHireDate] = useState(() => new Date().toISOString().split("T")[0]);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const pwMeta = useMemo(() => passwordStrength(password), [password]);

  if (!isFirebaseConfigured()) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <FirebaseSetupWarning />
      </div>
    );
  }

  function validateStep(s: Step): string | null {
    if (s === 0) {
      if (!firstName.trim() || !lastName.trim() || !email.trim() || !phone.trim()) return "Please fill in all personal contact fields.";
      if (phone.replace(/\D/g, "").length < 10) return "Please enter a valid phone number (at least 10 digits).";
    }
    if (s === 1) {
      if (!role || !experience || !department || !employmentType || !expectedSalary || !government.trim() || !city.trim()) {
        return "Please fill in all required professional profile fields.";
      }
      if (role === "other" && !customRole.trim()) return "Please specify your custom role.";
      const sal = parseFloat(expectedSalary);
      if (!sal || sal < 0) return "Please enter a valid expected salary amount.";
    }
    return null;
  }

  function next() {
    setError(null);
    const err = validateStep(step);
    if (err) {
      setError(err);
      return;
    }
    setStep((x) => (x < 2 ? ((x + 1) as Step) : x));
  }

  function back() {
    setError(null);
    setStep((x) => (x > 0 ? ((x - 1) as Step) : x));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const err0 = validateStep(0);
    const err1 = validateStep(1);
    if (err0 || err1) {
      setError(err0 || err1);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (!pwMeta.ok) {
      setError("Password is too weak. Please include at least 8 characters with numbers and symbols.");
      return;
    }

    const fb = getFirebase();
    if (!fb) return;

    setBusy(true);
    try {
      const cred = await createUserWithEmailAndPassword(fb.auth, email.trim(), password);
      const user = cred.user;

      const skillsArr = skills
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

      const resolvedRole = role === "other" ? customRole.trim() : role;

      const todayYmd = new Date().toISOString().split("T")[0];
      await setDoc(doc(fb.db, "workers", user.uid), {
        uid: user.uid,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        role: resolvedRole,
        experience,
        department,
        employmentType,
        expectedSalary: parseFloat(expectedSalary),
        government: government.trim(),
        city: city.trim(),
        portfolioLink: portfolioLink.trim(),
        netspend: netspend.trim(),
        skills: skillsArr,
        hireDate: hireDate || todayYmd,
        attendanceStartDate: todayYmd,
        startDate: serverTimestamp(),
        isActive: true,
        isWorker: true,
        isOnline: false,
        createdAt: serverTimestamp(),
        lastLogin: serverTimestamp(),
        status: "pending",
        tasks: [],
        completedTasks: 0,
        totalTasks: 0,
        performanceNotes: [],
      });

      const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
      await import("@/lib/worker/adminNotifications")
        .then(({ notifyAdmins }) =>
          notifyAdmins(fb.db, {
            targetRoles: ["super_admin", "hr_admin"],
            category: "hr",
            eventType: "worker_registered",
            title: `👤 New Hire Registration: ${fullName}`,
            body: `${fullName} (${resolvedRole} · ${department}) registered and is awaiting HR approval.`,
            href: "/admin/workers?status=pending",
            actorUid: user.uid,
            actorName: fullName,
          }),
        )
        .catch(() => {});

      sessionStorage.removeItem("workerLoginTime");
      sessionStorage.removeItem("workerShiftMode");
      sessionStorage.removeItem("workerOvertimeMinutes");
      setSuccess("Registration submitted! Redirecting to your dashboard…");
      window.setTimeout(() => router.push("/dashboard"), 1200);
    } catch (err: unknown) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code: string }).code) : "";
      setError(mapAuthError(code, "Registration failed."));
    } finally {
      setBusy(false);
    }
  }

  const steps = ["Personal Info", "Work Profile", "Security"];

  return (
    <WorkerAuthShell
      variant="wide"
      footer={
        <p>
          Already registered?{" "}
          <Link href="/" className="font-semibold text-red-600 hover:text-red-700 hover:underline">
            Sign in to your account
          </Link>
        </p>
      }
    >
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
          Worker Registration
        </h1>
        <p className="mt-1 text-xs text-zinc-500">
          Create your worker account to receive project task assignments and track your attendance.
        </p>
      </div>

      {/* Stepper Indicator */}
      <div className="mb-6 flex items-center justify-between border-b border-zinc-200 pb-4 dark:border-zinc-800">
        {steps.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-all ${
                i === step
                  ? "bg-red-600 text-white shadow-sm shadow-red-900/30"
                  : i < step
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400"
                  : "bg-zinc-100 text-zinc-400 dark:bg-zinc-800"
              }`}
            >
              {i < step ? "✓" : i + 1}
            </span>
            <span className={`text-xs font-semibold hidden sm:inline ${i === step ? "text-zinc-900 dark:text-white" : "text-zinc-400"}`}>
              {label}
            </span>
          </div>
        ))}
      </div>

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

      <form onSubmit={step === 2 ? onSubmit : (e) => e.preventDefault()} noValidate>
        {/* Step 0: Personal Info */}
        {step === 0 && (
          <div className="space-y-4 animate-fade-in">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1" htmlFor="firstName">
                  First Name *
                </label>
                <input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  placeholder="John"
                  className="brutal-input"
                  autoComplete="given-name"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1" htmlFor="lastName">
                  Last Name *
                </label>
                <input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  placeholder="Doe"
                  className="brutal-input"
                  autoComplete="family-name"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1" htmlFor="email">
                Email Address *
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="john.doe@example.com"
                className="brutal-input"
                autoComplete="email"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1" htmlFor="phone">
                Phone Number (WhatsApp) *
              </label>
              <input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                placeholder="+20 100 000 0000"
                className="brutal-input"
                autoComplete="tel"
              />
            </div>
          </div>
        )}

        {/* Step 1: Work Profile */}
        {step === 1 && (
          <div className="space-y-4 animate-fade-in">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1" htmlFor="department">
                  Department *
                </label>
                <select
                  id="department"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  required
                  className="brutal-input"
                >
                  <option value="">Select department</option>
                  <option value="web-development">Web Development</option>
                  <option value="social-media">Social Media</option>
                  <option value="media-buying">Media Buying</option>
                  <option value="branding">Branding &amp; Design</option>
                  <option value="content-creation">Content Creation</option>
                  <option value="seo">SEO</option>
                  <option value="general">General</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1" htmlFor="role">
                  Role Title *
                </label>
                <select
                  id="role"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  required
                  className="brutal-input"
                >
                  <option value="">Select role</option>
                  <option value="frontend-dev">Frontend Developer</option>
                  <option value="backend-dev">Backend Developer</option>
                  <option value="fullstack-dev">Fullstack Developer</option>
                  <option value="ui-ux-designer">UI/UX Designer</option>
                  <option value="graphic-designer">Graphic Designer</option>
                  <option value="media-buyer">Media Buyer</option>
                  <option value="content-creator">Content Creator</option>
                  <option value="project-manager">Project Manager</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>

            {role === "other" && (
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1" htmlFor="customRole">
                  Specify Custom Role *
                </label>
                <input
                  id="customRole"
                  value={customRole}
                  onChange={(e) => setCustomRole(e.target.value)}
                  required
                  placeholder="e.g. Motion Designer"
                  className="brutal-input"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1" htmlFor="experience">
                  Experience *
                </label>
                <select
                  id="experience"
                  value={experience}
                  onChange={(e) => setExperience(e.target.value)}
                  required
                  className="brutal-input"
                >
                  <option value="">Select experience</option>
                  <option value="entry">Entry Level (&lt; 1 yr)</option>
                  <option value="junior">Junior (1–2 yrs)</option>
                  <option value="mid">Mid Level (2–4 yrs)</option>
                  <option value="senior">Senior (4+ yrs)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1" htmlFor="employmentType">
                  Employment Type *
                </label>
                <select
                  id="employmentType"
                  value={employmentType}
                  onChange={(e) => setEmploymentType(e.target.value)}
                  required
                  className="brutal-input"
                >
                  <option value="">Select type</option>
                  <option value="full-time">Full-Time</option>
                  <option value="part-time">Part-Time</option>
                  <option value="contract">Contract</option>
                  <option value="intern">Internship</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1" htmlFor="expectedSalary">
                  Expected Monthly Salary (EGP) *
                </label>
                <input
                  id="expectedSalary"
                  type="number"
                  min={0}
                  step="100"
                  value={expectedSalary}
                  onChange={(e) => setExpectedSalary(e.target.value)}
                  required
                  placeholder="10000"
                  className="brutal-input"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1" htmlFor="government">
                  Governorate *
                </label>
                <input
                  id="government"
                  value={government}
                  onChange={(e) => setGovernment(e.target.value)}
                  required
                  placeholder="Cairo / Giza"
                  className="brutal-input"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1" htmlFor="city">
                  City / District *
                </label>
                <input
                  id="city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  required
                  placeholder="Maadi / Dokki"
                  className="brutal-input"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1" htmlFor="skills">
                  Key Skills (comma separated)
                </label>
                <input
                  id="skills"
                  value={skills}
                  onChange={(e) => setSkills(e.target.value)}
                  placeholder="React, Figma, Next.js"
                  className="brutal-input"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1" htmlFor="hireDate">
                Company Joining Date (تاريخ الالتحاق بالشركة) *
              </label>
              <input
                id="hireDate"
                type="date"
                value={hireDate}
                max={new Date().toISOString().split("T")[0]}
                onChange={(e) => setHireDate(e.target.value)}
                required
                className="brutal-input"
              />
              <p className="mt-1 text-[11px] text-zinc-500">
                Already working with the company before this system? Pick your original company start date so your probation &amp; annual leave balance are calculated accurately. (HR can also adjust this later.)
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1" htmlFor="portfolioLink">
                Portfolio or GitHub URL (optional)
              </label>
              <input
                id="portfolioLink"
                type="url"
                value={portfolioLink}
                onChange={(e) => setPortfolioLink(e.target.value)}
                placeholder="https://behance.net/..."
                className="brutal-input"
              />
            </div>
          </div>
        )}

        {/* Step 2: Security & Password */}
        {step === 2 && (
          <div className="space-y-4 animate-fade-in">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300" htmlFor="password">
                  Account Password *
                </label>
                <button
                  type="button"
                  onClick={() => setShowPw((s) => !s)}
                  className="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 cursor-pointer"
                >
                  {showPw ? "Hide" : "Show"}
                </button>
              </div>
              <input
                id="password"
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                className="brutal-input"
                autoComplete="new-password"
              />

              {password && (
                <div className="mt-2">
                  <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                    <div
                      className={`h-full transition-all duration-300 ${pwMeta.color}`}
                      style={{ width: `${Math.min(100, (pwMeta.score / 5) * 100)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-zinc-500 font-medium">{pwMeta.label}</p>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1" htmlFor="confirm">
                Confirm Password *
              </label>
              <input
                id="confirm"
                type={showPw ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                placeholder="••••••••"
                className="brutal-input"
                autoComplete="new-password"
              />
            </div>
          </div>
        )}

        {/* Action Controls */}
        <div className="mt-6 flex items-center justify-between pt-4 border-t border-zinc-200 dark:border-zinc-800">
          {step > 0 ? (
            <button
              type="button"
              onClick={back}
              disabled={busy}
              className="brutal-btn-outline"
            >
              ← Back
            </button>
          ) : (
            <span />
          )}

          {step < 2 ? (
            <button
              type="button"
              onClick={next}
              className="brutal-btn"
            >
              Continue →
            </button>
          ) : (
            <button
              type="submit"
              disabled={busy}
              className="brutal-btn"
            >
              {busy ? (
                <span className="flex items-center gap-2">
                  <span className="h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Creating Account…
                </span>
              ) : (
                "Submit Registration"
              )}
            </button>
          )}
        </div>
      </form>
    </WorkerAuthShell>
  );
}
