export default function FirebaseSetupWarning() {
  return (
    <div
      role="alert"
      className="glass-card border-[#ef414b]/40 bg-red-950/30 p-4 text-sm text-red-100"
    >
      <p className="font-semibold text-[#ef414b]">Firebase is not configured</p>
      <p className="mt-2 text-zinc-300">
        Copy <code className="rounded bg-black/40 px-1">.env.example</code> to{" "}
        <code className="rounded bg-black/40 px-1">.env.local</code> and set all{" "}
        <code className="rounded bg-black/40 px-1">NEXT_PUBLIC_FIREBASE_*</code> variables, then restart{" "}
        <code className="rounded bg-black/40 px-1">npm run dev</code>.
      </p>
    </div>
  );
}
