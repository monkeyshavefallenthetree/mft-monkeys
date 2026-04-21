import type { ReactNode } from "react";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-[100dvh] text-white">{children}</div>;
}
