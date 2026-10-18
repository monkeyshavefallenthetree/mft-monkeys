"use client";

import { collection, doc, getDoc, getDocs, serverTimestamp, updateDoc, type Firestore } from "firebase/firestore";

export const DEFAULT_VAPID_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
  "BC4qV_AA_NGWwJUuOf3I5pKrblvWSHOhhSdY-F0ENgdfzZ3tqFEGPG6HcIj0tv-i8yGkeJA5puekWty8rLH5KQM";

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
    const ref = doc(db, "workers", uid);
    const snap = await getDoc(ref);
    const existingRaw = snap.exists() ? snap.data()?.webPushSubscriptions : [];
    const existing: StoredPushSubscription[] = Array.isArray(existingRaw) ? existingRaw : [];

    // Replace matching endpoint and keep up to 5 most recent device subscriptions
    const filtered = existing.filter(
      (item) => item && typeof item.endpoint === "string" && item.endpoint !== entry.endpoint,
    );
    const next = [entry, ...filtered].slice(0, 5);

    await updateDoc(ref, {
      webPushSubscriptions: next,
      webPushUpdatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn("[WebPush] Could not save subscription to Firestore:", err);
  }

  return entry;
}

/**
 * Interactive subscription flow: requests permission, subscribes to PushManager,
 * and saves the subscription to `workers/{uid}.webPushSubscriptions`.
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
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const appServerKey = urlBase64ToUint8Array(DEFAULT_VAPID_PUBLIC_KEY);
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
 * Fires a native OS notification through the Service Worker when the app is in
 * the background on mobile/desktop.
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

  try {
    const reg = await navigator.serviceWorker?.getRegistration("/");
    if (reg && reg.active) {
      reg.active.postMessage({
        type: "SHOW_LOCAL_NOTIFICATION",
        payload,
      });
      return;
    }
    if (reg && typeof reg.showNotification === "function") {
      await reg.showNotification(payload.title, {
        body: payload.body,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag: payload.tag || payload.taskId || `mft-${Date.now()}`,
        data: { url: payload.url || "/dashboard", tab: payload.tab, taskId: payload.taskId },
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
      tag: payload.tag || payload.taskId,
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
  },
): Promise<void> {
  const allSubs: StoredPushSubscription[] = [];
  for (const uid of opts.recipientUids) {
    try {
      const snap = await getDoc(doc(db, "workers", uid));
      if (!snap.exists()) continue;
      const subs = snap.data()?.webPushSubscriptions;
      if (Array.isArray(subs)) {
        for (const s of subs) {
          if (s && typeof s.endpoint === "string" && s.keys?.p256dh && s.keys?.auth) {
            allSubs.push(s as StoredPushSubscription);
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

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
          url: opts.url || (opts.tab ? `/dashboard?tab=${opts.tab}` : "/dashboard"),
          tab: opts.tab,
          taskId: opts.taskId,
          urgent: opts.urgent,
        },
      }),
    });
  } catch (err) {
    console.warn("[WebPush] sendWebPushToWorkers failed:", err);
  }
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
  const allSubs: StoredPushSubscription[] = [];
  try {
    const snap = await getDocs(collection(db, "adminPushSubscriptions"));
    snap.forEach((d) => {
      const data = d.data();
      const role = data?.role as "super_admin" | "ops_admin" | "hr_admin" | undefined;
      if (role && !opts.roles.includes(role)) return;

      if (Array.isArray(data?.subscriptions)) {
        for (const s of data.subscriptions) {
          if (s && typeof s.endpoint === "string" && s.keys?.p256dh && s.keys?.auth) {
            allSubs.push(s as StoredPushSubscription);
          }
        }
      } else if (
        data?.subscription &&
        typeof data.subscription.endpoint === "string" &&
        data.subscription.keys?.p256dh &&
        data.subscription.keys?.auth
      ) {
        allSubs.push(data.subscription as StoredPushSubscription);
      }
    });
  } catch {
    /* ignore */
  }

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
