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
  if (score < 5) return { score, ok: true, label: "Medium — good enough to continue", color: "bg-amber-500" };
  return { score, ok: true, label: "Strong password", color: "bg-emerald-500" };
}

const inputClass = "brutal-input";

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
  const [netspend, setNetspend] = useState("");

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
      if (!firstName.trim() || !lastName.trim() || !email.trim() || !phone.trim()) return "Fill in all fields.";
      if (phone.replace(/\D/g, "").length < 10) return "Enter a valid phone number.";
    }
    if (s === 1) {
      if (!role || !experience || !department || !employmentType || !expectedSalary || !government.trim() || !city.trim()) {
        return "Fill in all required work fields.";
      }
      if (role === "other" && !customRole.trim()) return "Specify your custom role.";
      const sal = parseFloat(expectedSalary);
      if (!sal || sal < 0) return "Enter a valid expected salary.";
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
      setError("Password is too weak.");
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

      sessionStorage.setItem("workerLoginTime", new Date().toISOString());
      setSuccess("Registration successful! Redirecting to dashboard…");
      window.setTimeout(() => router.push("/dashboard"), 1500);
    } catch (err: unknown) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code: string }).code) : "";
      setError(mapAuthError(code, "Registration failed."));
    } finally {
      setBusy(false);
    }
  }

  const steps = ["About you", "Work profile", "Security"];

  return (
    <WorkerAuthShell variant="wide">
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {error ? error : success ? success : `Step ${step + 1} of 3`}
      </div>

      <div className="mb-8">
        <h2 className="text-3xl font-oswald text-[var(--mft-primary)] mb-1">AUTH.JOIN</h2>
        <p className="text-xs uppercase tracking-widest text-[var(--mft-muted)]">
          Submit clearance packet
        </p>
      </div>

      {/* Progress */}
      <div className="mt-8 mb-6 flex items-center justify-between border-b border-[var(--mft-border)] pb-4">
        {steps.map((label, i) => (
          <div key={label} className="flex flex-col items-center gap-2 flex-1">
            <div
              className={`flex h-8 w-8 items-center justify-center text-xs font-bold border ${
                i === step
                  ? "bg-[var(--mft-primary)] text-black border-[var(--mft-primary)]"
                  : i < step
                    ? "bg-white text-black border-white"
                    : "bg-transparent text-[var(--mft-border)] border-[var(--mft-border)]"
              }`}
            >
              {i < step ? "✓" : i + 1}
            </div>
            <span className={`hidden text-center text-[10px] font-bold uppercase tracking-wider md:block ${i === step ? "text-[var(--mft-primary)]" : "text-[var(--mft-muted)]"}`}>
              {label}
            </span>
          </div>
        ))}
      </div>

      {error ? (
        <div role="alert" className="mt-6 rounded-xl border border-red-500/40 bg-red-950/50 px-4 py-3 text-sm text-red-100">
          {error}
        </div>
      ) : null}
      {success ? (
        <div role="status" className="mt-6 rounded-xl border border-emerald-500/40 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-100">
          {success}
        </div>
      ) : null}

      <form className="mt-8 space-y-5" onSubmit={step === 2 ? onSubmit : (e) => e.preventDefault()}>
        {step === 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-xs font-bold uppercase text-[var(--mft-muted)] tracking-wider" htmlFor="firstName">
                First name *
              </label>
              <input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} required className={inputClass} autoComplete="given-name" />
            </div>
            <div>
              <label className="mb-2 block text-xs font-bold uppercase text-[var(--mft-muted)] tracking-wider" htmlFor="lastName">
                Last name *
              </label>
              <input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} required className={inputClass} autoComplete="family-name" />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-2 block text-xs font-bold uppercase text-[var(--mft-muted)] tracking-wider" htmlFor="email">
                Email *
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className={inputClass}
                autoComplete="email"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-2 block text-xs font-bold uppercase text-[var(--mft-muted)] tracking-wider" htmlFor="phone">
                Phone *
              </label>
              <input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required className={inputClass} autoComplete="tel" />
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="grid max-h-[55vh] gap-4 overflow-y-auto pr-1 sm:grid-cols-2 sm:max-h-none">
            <div className="sm:col-span-2">
              <label className="mb-2 block text-xs font-bold uppercase text-[var(--mft-muted)] tracking-wider" htmlFor="role">
                Role *
              </label>
              <select id="role" value={role} onChange={(e) => setRole(e.target.value)} required className={inputClass}>
                <option value="">Select your role</option>
                <option value="media-buyer">Media Buyer</option>
                <option value="photo-editor">Photo editor</option>
                <option value="retoucher">Retoucher</option>
                <option value="reelmaker">Reelmaker</option>
                <option value="graphic-designer">Graphic Designer</option>
                <option value="web-developer">Web Developer</option>
                <option value="content-writer">Content Writer</option>
                <option value="social-media-manager">Social Media Manager</option>
                <option value="seo-specialist">SEO Specialist</option>
                <option value="video-editor">Video Editor</option>
                <option value="photographer">Photographer</option>
                <option value="project-manager">Project Manager</option>
                <option value="account-manager">Account Manager</option>
                <option value="other">Other</option>
              </select>
            </div>
            {role === "other" ? (
              <div className="sm:col-span-2">
                <label className="mb-2 block text-xs font-bold uppercase text-[var(--mft-muted)] tracking-wider" htmlFor="customRole">
                  Custom role *
                </label>
                <input
                  id="customRole"
                  value={customRole}
                  onChange={(e) => setCustomRole(e.target.value)}
                  className={inputClass}
                  placeholder="Your title"
                />
              </div>
            ) : null}
            <div className="sm:col-span-2">
              <label className="mb-2 block text-xs font-bold uppercase text-[var(--mft-muted)] tracking-wider" htmlFor="experience">
                Years of experience *
              </label>
              <select id="experience" value={experience} onChange={(e) => setExperience(e.target.value)} required className={inputClass}>
                <option value="">Select</option>
                <option value="0-1">0–1 years</option>
                <option value="1-3">1–3 years</option>
                <option value="3-5">3–5 years</option>
                <option value="5-10">5–10 years</option>
                <option value="10+">10+ years</option>
              </select>
            </div>
            <div>
              <label className="mb-2 block text-xs font-bold uppercase text-[var(--mft-muted)] tracking-wider" htmlFor="department">
                Department *
              </label>
              <select id="department" value={department} onChange={(e) => setDepartment(e.target.value)} required className={inputClass}>
                <option value="">Select</option>
                <option value="development">Development</option>
                <option value="design">Design</option>
                <option value="marketing">Marketing</option>
                <option value="management">Management</option>
                <option value="general">General</option>
              </select>
            </div>
            <div>
              <label className="mb-2 block text-xs font-bold uppercase text-[var(--mft-muted)] tracking-wider" htmlFor="employmentType">
                Work type *
              </label>
              <select id="employmentType" value={employmentType} onChange={(e) => setEmploymentType(e.target.value)} required className={inputClass}>
                <option value="">Select</option>
                <option value="full-time">Full-time</option>
                <option value="part-time">Part-time</option>
                <option value="remotely">Remotely</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-2 block text-xs font-bold uppercase text-[var(--mft-muted)] tracking-wider" htmlFor="expectedSalary">
                Expected monthly salary (EGP) *
              </label>
              <input
                id="expectedSalary"
                type="number"
                min={0}
                step="0.01"
                value={expectedSalary}
                onChange={(e) => setExpectedSalary(e.target.value)}
                required
                className={inputClass}
                placeholder="5000"
              />
            </div>
            <div>
              <label className="mb-2 block text-xs font-bold uppercase text-[var(--mft-muted)] tracking-wider" htmlFor="government">
                Region / governorate *
              </label>
              <input id="government" value={government} onChange={(e) => setGovernment(e.target.value)} required className={inputClass} placeholder="Cairo…" />
            </div>
            <div>
              <label className="mb-2 block text-xs font-bold uppercase text-[var(--mft-muted)] tracking-wider" htmlFor="city">
                City *
              </label>
              <input id="city" value={city} onChange={(e) => setCity(e.target.value)} required className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-2 block text-xs font-bold uppercase text-[var(--mft-muted)] tracking-wider" htmlFor="skills">
                Skills (comma-separated)
              </label>
              <input id="skills" value={skills} onChange={(e) => setSkills(e.target.value)} className={inputClass} placeholder="Figma, React…" />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-2 block text-xs font-bold uppercase text-[var(--mft-muted)] tracking-wider" htmlFor="portfolioLink">
                Portfolio URL
              </label>
              <input id="portfolioLink" type="url" value={portfolioLink} onChange={(e) => setPortfolioLink(e.target.value)} className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-2 block text-xs font-bold uppercase text-[var(--mft-muted)] tracking-wider" htmlFor="netspend">
                Time to leave current job
              </label>
              <input id="netspend" value={netspend} onChange={(e) => setNetspend(e.target.value)} className={inputClass} />
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-5">
            <div>
              <label className="mb-2 block text-xs font-bold uppercase text-[var(--mft-muted)] tracking-wider" htmlFor="password">
                Password *
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPw ? "text" : "password"}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className={`${inputClass} pr-14`}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((s) => !s)}
                  className="focus-ring absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs text-zinc-400 hover:text-white"
                >
                  {showPw ? "Hide" : "Show"}
                </button>
              </div>
              {password ? (
                <div className="mt-2 space-y-1">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div
                        key={i}
                        className={`h-1.5 flex-1 rounded-full transition-colors ${
                          i <= pwMeta.score ? pwMeta.color : "bg-white/10"
                        }`}
                      />
                    ))}
                  </div>
                  <p className={`text-xs ${pwMeta.ok ? "text-zinc-400" : "text-red-300"}`}>{pwMeta.label}</p>
                </div>
              ) : null}
            </div>
            <div>
              <label className="mb-2 block text-xs font-bold uppercase text-[var(--mft-muted)] tracking-wider" htmlFor="confirmPassword">
                Confirm password *
              </label>
              <input
                id="confirmPassword"
                type={showPw ? "text" : "password"}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                className={inputClass}
              />
            </div>
            <p className="text-xs text-zinc-500">
              By registering you confirm your details are accurate. An admin will review your account before full access.
            </p>
          </div>
        ) : null}

        <div className="flex flex-col-reverse gap-3 pt-6 border-t border-[var(--mft-border)] sm:flex-row sm:justify-between mt-8">
          <button
            type="button"
            onClick={back}
            disabled={step === 0 || busy}
            className="brutal-btn-outline disabled:opacity-40"
          >
            [ BACK ]
          </button>
          {step < 2 ? (
            <button type="button" onClick={next} className="brutal-btn">
              [ CONTINUE ]
            </button>
          ) : (
            <button
              type="submit"
              disabled={busy}
              className={`brutal-btn disabled:opacity-50 ${
                busy ? "worker-btn-loading" : ""
              }`}
            >
              {busy ? "[ PROCESSING... ]" : "[ COMMIT PROFILE ]"}
            </button>
          )}
        </div>
      </form>

      <div className="mt-6 text-center text-xs uppercase tracking-wider text-[var(--mft-muted)] border-t border-[var(--mft-border)] pt-4">
        ALREADY REGISTERED?{" "}
        <Link href="/" className="font-bold text-[var(--mft-primary)] hover:underline decoration-2 underline-offset-4">
          ACCESS TERMINAL
        </Link>
      </div>
    </WorkerAuthShell>
  );
}
