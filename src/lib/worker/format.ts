import type { Timestamp } from "firebase/firestore";

export function formatWorkType(workType: string | undefined): string {
  if (!workType) return "N/A";
  return workType
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function formatRole(role: string | undefined): string {
  if (!role) return "N/A";
  return role
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Local calendar date as YYYY-MM-DD. Use this instead of
 * `toISOString().split("T")[0]`, which returns the *UTC* date and files
 * records under the wrong day for timezones ahead of UTC.
 * Matches the admin dashboard, which keys sessions by local date.
 */
export function localYmd(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function greetingFor(d: Date = new Date()): string {
  const h = d.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function toDate(value: Timestamp | Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string") return new Date(value);
  if (typeof (value as Timestamp).toDate === "function") return (value as Timestamp).toDate();
  return null;
}

export function formatSessionDuration(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((ms % (1000 * 60)) / 1000);
  return `${hours}h ${minutes}m ${seconds}s`;
}

export function alertRelativeTime(ts: Timestamp | Date | null | undefined): string {
  const date = toDate(ts ?? null);
  if (!date) return "Unknown date";
  const now = new Date();
  const diff = Math.abs(now.getTime() - date.getTime());
  const diffDays = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    return `Today at ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  if (diffDays === 1) return `Yesterday at ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString();
}
