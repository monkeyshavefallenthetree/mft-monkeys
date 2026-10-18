"use client";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";

export const DEFAULT_VAPID_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
  "BC4qV_AA_NGWwJUuOf3I5pKrblvWSHOhhSdY-F0ENgdfzZ3tqFEGPG6HcIj0tv-i8yGkeJA5puekWty8rLH5KQM";

const LOCAL_SUB_KEY = "mft.webPush.sub";

export type StoredPushSubscription = {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent?: string;
  platform?: string;
  createdAt?: string;
};

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function extractWebPushSubscriptions(data: Record<string, unknown> | undefined): StoredPushSubscription[] {
  if (!data) return [];
  const map = new Map<string, StoredPushSubscription>();

  if (Array.isArray(data.webPushSubscriptions)) {
    for (const s of data.webPushSubscriptions) {
      if (s && typeof s.endpoint === "string" && s.keys?.p256dh && s.keys?.auth) {
        map.set(s.endpoint, s as StoredPushSubscription);
      }
    }
  }

  if (typeof data.expoPushToken === "string" && data.expoPushToken.startsWith("webp:")) {
    try {
      const parsed = JSON.parse(data.expoPushToken.slice(5));
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const s of arr) {
        if (s && typeof s.endpoint === "string" && s.keys?.p256dh && s.keys?.auth) {
          map.set(s.endpoint, s as StoredPushSubscription);
        }
      }
    } catch {
      /* ignore invalid JSON */
    }
  }

  return Array.from(map.values());
}

export function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    nav.standalone === true
  );
}

export function isIosDevice(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isIPadOS =
    window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1;
  return isIOS || isIPadOS;
}

export function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;
  return isIosDevice() || /Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(window.navigator.userAgent || "");
}

export function isWebPushSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function getNotificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export async function registerWorkerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    void reg.update().catch(() => {});
    await navigator.serviceWorker.ready;
    return reg;
  } catch (err) {
    console.warn("[WebPush] Service worker registration failed:", err);
    return null;
  }
}

async function saveSubscriptionToWorkerDoc(
  db: Firestore,
  uid: string,
  subJson: PushSubscriptionJSON,
): Promise<StoredPushSubscription | null> {
  if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) return null;

  const entry: StoredPushSubscription = {
    endpoint: subJson.endpoint,
    expirationTime: subJson.expirationTime ?? null,
    keys: {
      p256dh: subJson.keys.p256dh,
      auth: subJson.keys.auth,
    },
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 160) : "",
    platform: isIosDevice() ? "ios" : isMobileDevice() ? "android" : "desktop",
    createdAt: new Date().toISOString(),
  };

  try {
    localStorage.setItem(LOCAL_SUB_KEY, JSON.stringify(entry));
  } catch {
    /* ignore */
  }

  try {
    const ref = doc(db, "workers", uid);
    const snap = await getDoc(ref);
    const existing = snap.exists()
      ? extractWebPushSubscriptions(snap.data() as Record<string, unknown>)
      : [];

    // Replace matching endpoint and keep up to 4 most recent device subscriptions
    const filtered = existing.filter(
      (item) => item && typeof item.endpoint === "string" && item.endpoint !== entry.endpoint,
    );
    const next = [entry, ...filtered].slice(0, 4);

    // 1. Always write to `expoPushToken` with `webp:` prefix because `expoPushToken` is allowed
    // by `changedOnly` in all versions of Firestore security rules.
    await updateDoc(ref, {
      expoPushToken: `webp:${JSON.stringify(next)}`,
    });

    // 2. Also write to `webPushSubscriptions` when the updated Firestore rules are deployed.
    await updateDoc(ref, {
      webPushSubscriptions: next,
      webPushUpdatedAt: serverTimestamp(),
    }).catch(() => {});
  } catch (err) {
    console.warn("[WebPush] Could not save subscription to Firestore:", err);
  }

  return entry;
}

/**
 * Interactive subscription flow: requests permission, subscribes to PushManager,
 * and saves the subscription to `workers/{uid}`.
 */
export async function subscribeWorkerWebPush(
  db: Firestore,
  uid: string,
): Promise<{ ok: boolean; reason?: string; subscription?: StoredPushSubscription }> {
  if (!isWebPushSupported()) {
    if (isIosDevice() && !isStandalonePwa()) {
      return { ok: false, reason: "ios_needs_install" };
    }
    return { ok: false, reason: "unsupported" };
  }

  const perm =
    Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;

  if (perm !== "granted") {
    return { ok: false, reason: "permission_denied" };
  }

  const reg = await registerWorkerServiceWorker();
  if (!reg) {
    return { ok: false, reason: "sw_failed" };
  }

  try {
    const appServerKey = urlBase64ToUint8Array(DEFAULT_VAPID_PUBLIC_KEY);
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appServerKey.buffer as ArrayBuffer,
      });
    }
    const saved = await saveSubscriptionToWorkerDoc(db, uid, sub.toJSON());
    return { ok: true, subscription: saved ?? undefined };
  } catch (err) {
    console.warn("[WebPush] pushManager.subscribe error:", err);
    return { ok: false, reason: "subscribe_failed" };
  }
}

/**
 * Silent background sync on login: if permission is already granted, ensure
 * the service worker is registered and the PushSubscription is saved in Firestore.
 */
export async function syncWorkerWebPushIfGranted(
  db: Firestore,
  uid: string,
): Promise<boolean> {
  if (!isWebPushSupported() || Notification.permission !== "granted") {
    await registerWorkerServiceWorker();
    return false;
  }
  const res = await subscribeWorkerWebPush(db, uid);
  return res.ok;
}

/**
 * Fires a native OS notification through the Service Worker so it appears in the
 * mobile notification shade and lock screen.
 */
export async function showBackgroundNotification(payload: {
  title: string;
  body: string;
  url?: string;
  tab?: string;
  taskId?: string;
  tag?: string;
  urgent?: boolean;
}): Promise<void> {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const uniqueTag = `${payload.tag || payload.taskId || "mft"}-${Date.now()}`;

  try {
    const reg = await navigator.serviceWorker?.getRegistration("/");
    if (reg && typeof reg.showNotification === "function") {
      try {
        await reg.showNotification(payload.title, {
          body: payload.body,
          icon: "/icons/icon-192.png",
          badge: "/icons/icon-192.png",
          tag: uniqueTag,
          silent: false,
          requireInteraction: Boolean(payload.urgent),
          data: { url: payload.url || "/dashboard", tab: payload.tab, taskId: payload.taskId },
        });
        return;
      } catch {
        await reg.showNotification(payload.title, {
          body: payload.body,
          icon: "/icons/icon-192.png",
          data: { url: payload.url || "/dashboard", tab: payload.tab, taskId: payload.taskId },
        });
        return;
      }
    }
    if (reg && reg.active) {
      reg.active.postMessage({
        type: "SHOW_LOCAL_NOTIFICATION",
        payload: { ...payload, tag: uniqueTag },
      });
      return;
    }
  } catch {
    /* fallback below */
  }

  try {
    new Notification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192.png",
      tag: uniqueTag,
    });
  } catch {
    /* mobile browsers require ServiceWorkerRegistration.showNotification */
  }
}

/**
 * Sends a real Web Push notification to one or more workers via `/api/web-push`.
 */
export async function sendWebPushToWorkers(
  db: Firestore,
  opts: {
    recipientUids: string[];
    title: string;
    body: string;
    tab?: string;
    taskId?: string;
    url?: string;
    urgent?: boolean;
    delayMs?: number;
  },
): Promise<{ sent: number }> {
  const subMap = new Map<string, StoredPushSubscription>();

  for (const uid of opts.recipientUids) {
    try {
      const snap = await getDoc(doc(db, "workers", uid));
      if (!snap.exists()) continue;
      const extracted = extractWebPushSubscriptions(snap.data() as Record<string, unknown>);
      for (const s of extracted) {
        subMap.set(s.endpoint, s);
      }
    } catch {
      /* ignore */
    }
  }

  // Fallback to local device subscription if testing on the current device
  if (subMap.size === 0 && typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem(LOCAL_SUB_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as StoredPushSubscription;
        if (parsed?.endpoint && parsed?.keys?.p256dh && parsed?.keys?.auth) {
          subMap.set(parsed.endpoint, parsed);
        }
      }
    } catch {
      /* ignore */
    }
  }

  const allSubs = Array.from(subMap.values());
  if (allSubs.length === 0) return { sent: 0 };

  try {
    const res = await fetch("/api/web-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscriptions: allSubs,
        delayMs: opts.delayMs,
        payload: {
          title: opts.title,
          body: opts.body,
          url: opts.url || (opts.tab ? `/dashboard?tab=${opts.tab}` : "/dashboard"),
          tab: opts.tab,
          taskId: opts.taskId,
          urgent: opts.urgent,
        },
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as { sent?: number };
      return { sent: data.sent ?? 0 };
    }
  } catch (err) {
    console.warn("[WebPush] sendWebPushToWorkers failed:", err);
  }
  return { sent: 0 };
}

/**
 * Sends a real Web Push notification to subscribed admins matching the given roles
 * (e.g., `["super_admin", "ops_admin"]` for task/chat updates, or `["super_admin", "hr_admin"]` for HR requests).
 */
export async function sendWebPushToAdmins(
  db: Firestore,
  opts: {
    roles: Array<"super_admin" | "ops_admin" | "hr_admin">;
    title: string;
    body: string;
    url?: string;
    taskId?: string;
    urgent?: boolean;
  },
): Promise<void> {
  const subMap = new Map<string, StoredPushSubscription>();

  const collectFromDoc = (data: Record<string, unknown> | undefined) => {
    if (!data) return;
    const role = data.role as "super_admin" | "ops_admin" | "hr_admin" | undefined;
    if (role && !opts.roles.includes(role)) return;

    if (Array.isArray(data.subscriptions)) {
      for (const s of data.subscriptions) {
        if (s && typeof s.endpoint === "string" && s.keys?.p256dh && s.keys?.auth) {
          subMap.set(s.endpoint, s as StoredPushSubscription);
        }
      }
    } else if (
      data.subscription &&
      typeof (data.subscription as StoredPushSubscription).endpoint === "string" &&
      (data.subscription as StoredPushSubscription).keys?.p256dh &&
      (data.subscription as StoredPushSubscription).keys?.auth
    ) {
      const s = data.subscription as StoredPushSubscription;
      subMap.set(s.endpoint, s);
    }
  };

  try {
    const snap = await getDocs(collection(db, "adminPushSubscriptions"));
    snap.forEach((d) => collectFromDoc(d.data() as Record<string, unknown>));
  } catch {
    /* fallback below when adminPushSubscriptions is not in deployed Firestore rules */
  }

  try {
    const fallbackSnap = await getDocs(
      query(collection(db, "alerts"), where("type", "==", "admin_push_sub")),
    );
    fallbackSnap.forEach((d) => collectFromDoc(d.data() as Record<string, unknown>));
  } catch {
    /* ignore */
  }

  const allSubs = Array.from(subMap.values());
  if (allSubs.length === 0) return;

  try {
    await fetch("/api/web-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subscriptions: allSubs,
        payload: {
          title: opts.title,
          body: opts.body,
          url: opts.url || "/admin",
          taskId: opts.taskId,
          urgent: opts.urgent,
        },
      }),
    });
  } catch (err) {
    console.warn("[WebPush] sendWebPushToAdmins failed:", err);
  }
}
