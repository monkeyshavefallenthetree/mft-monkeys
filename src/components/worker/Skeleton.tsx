export function CardSkeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div className="glass-card animate-pulse space-y-3 p-6" aria-hidden>
      <div className="h-4 w-1/3 rounded bg-white/10" />
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-3 w-full rounded bg-white/5" />
      ))}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 pb-24 lg:pb-8">
      <div className="h-14 animate-pulse rounded-2xl bg-white/5" />
      <CardSkeleton lines={6} />
      <CardSkeleton lines={3} />
    </div>
  );
}
