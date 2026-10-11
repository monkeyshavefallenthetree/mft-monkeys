export function CardSkeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div className="ui-card space-y-3 p-6" aria-hidden>
      <div className="mft-skeleton h-4 w-1/3 rounded" />
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="mft-skeleton h-3 rounded" style={{ width: `${100 - ((i * 13) % 35)}%` }} />
      ))}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 pb-24 lg:pb-8" role="status" aria-label="Loading your dashboard">
      <div className="mft-skeleton h-14 rounded-2xl" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="mft-skeleton h-20 rounded-2xl" />
        ))}
      </div>
      <CardSkeleton lines={6} />
      <CardSkeleton lines={3} />
    </div>
  );
}
