"use client";

import { useCallback, useEffect, useState } from "react";
import type { Firestore } from "firebase/firestore";
import {
  getNotificationPermission,
  isIosDevice,
  isStandalonePwa,
  isWebPushSupported,
  sendWebPushToWorkers,
  subscribeWorkerWebPush,
  syncWorkerWebPushIfGranted,
} from "@/lib/worker/webPush";
import { toast } from "@/lib/worker/feedback";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface Props {
  db: Firestore | null;
  uid: string | null;
  workerName?: string;
}

const DISMISS_KEY = "mft.pwaBanner.dismissed";

export default function PwaPushBanner({ db, uid, workerName }: Props) {
  const [mounted, setMounted] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [subscribed, setSubscribed] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [ios, setIos] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setMounted(true);
    setStandalone(isStandalonePwa());
    setIos(isIosDevice());
    setPushSupported(isWebPushSupported());
    setPermission(getNotificationPermission());
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      /* ignore */
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  // Automatically register Service Worker & sync Web Push subscription if permission is already granted
  useEffect(() => {
    if (!mounted || !db || !uid) return;
    syncWorkerWebPushIfGranted(db, uid)
      .then((ok) => {
        if (ok) {
          setSubscribed(true);
          setPermission(getNotificationPermission());
        }
      })
      .catch(() => {});
  }, [mounted, db, uid]);

  const handleEnablePush = useCallback(async () => {
    if (!db || !uid) return;
    setBusy(true);
    try {
      const res = await subscribeWorkerWebPush(db, uid);
      setPermission(getNotificationPermission());
      if (res.ok) {
        setSubscribed(true);
        toast.success("Background notifications enabled 🔔", {
          description: "تم تفعيل الإشعارات في الخلفية بنجاح — ستصلك التنبيهات حتى والتطبيق مغلق.",
          duration: 6000,
        });
      } else if (res.reason === "ios_needs_install") {
        toast.info("Install to Home Screen first", {
          description: "على أجهزة iPhone: اضغط زر المشاركة (Share ↑) ثم اختر Add to Home Screen لتفعيل الإشعارات.",
          duration: 8000,
        });
      } else if (res.reason === "permission_denied") {
        toast.error("Notification permission blocked", {
          description: "Please allow notifications for this site in your browser/phone settings.",
        });
      } else {
        toast.error("Could not enable background push", {
          description: "Please try again or check your browser settings.",
        });
      }
    } finally {
      setBusy(false);
    }
  }, [db, uid]);

  const handleInstallClick = useCallback(async () => {
    if (!installPrompt) return;
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setInstallPrompt(null);
        setStandalone(true);
        if (db && uid && Notification.permission !== "granted") {
          void handleEnablePush();
        }
      }
    } catch {
      /* ignore */
    }
  }, [installPrompt, db, uid, handleEnablePush]);

  const handleSendTestPush = useCallback(async () => {
    if (!db || !uid) return;
    setTesting(true);
    try {
      await sendWebPushToWorkers(db, {
        recipientUids: [uid],
        title: "MFT Background Push Active 🔔",
        body: `مرحبًا ${workerName || ""}! الإشعارات في الخلفية تعمل بنجاح على هاتفك.`,
        tab: "tasks",
      });
      toast.success("Test notification sent!", {
        description: "Lock your screen or switch apps — your device receives push alerts in the background.",
      });
    } catch {
      toast.error("Could not send test push");
    } finally {
      setTesting(false);
    }
  }, [db, uid, workerName]);

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  if (!mounted || !uid) return null;

  const needsIosInstall = ios && !standalone;
  const needsPushEnable = pushSupported && (permission !== "granted" || !subscribed);
  const canInstallChrome = Boolean(installPrompt) && !standalone;

  // When already subscribed & no install prompt needed, show a compact status bar in Profile or nothing intrusive
  if (!needsIosInstall && !needsPushEnable && !canInstallChrome) {
    return (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs">
        <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          <span className="font-semibold">Background Push Active · الإشعارات في الخلفية مفعّلة</span>
        </div>
        <button
          type="button"
          onClick={() => void handleSendTestPush()}
          disabled={testing}
          className="rounded-lg border border-emerald-500/40 bg-white/80 dark:bg-zinc-900/80 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-zinc-800 cursor-pointer disabled:opacity-50"
        >
          {testing ? "Sending…" : "🔔 Test Notification · تجربة إشعار"}
        </button>
      </div>
    );
  }

  if (dismissed) return null;

  return (
    <div className="mb-4 rounded-xl border-2 border-red-600/80 bg-gradient-to-r from-red-600/10 via-amber-500/5 to-transparent p-3.5 sm:p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-red-600 text-xs font-bold text-white">
              🔔
            </span>
            <p className="text-sm font-bold text-[var(--mft-text)]">
              {needsIosInstall
                ? "Install MFT App for Background Notifications · ثبّت التطبيق لتفعيل الإشعارات في الخلفية"
                : "Enable Background Mobile Notifications · تفعيل الإشعارات في الخلفية"}
            </p>
          </div>

          {needsIosInstall ? (
            <div className="space-y-1 text-xs text-[var(--mft-muted)]">
              <p dir="rtl" className="font-medium text-[var(--mft-text)]">
                📲 على الآيفون (Safari): اضغط على زر المشاركة{" "}
                <span className="inline-block rounded border border-current px-1.5 py-0.5 font-mono text-[11px]">
                  Share ↑
                </span>{" "}
                بالأسفل ثم اختر{" "}
                <strong className="text-red-600 dark:text-red-400">
                  Add to Home Screen (إضافة إلى الشاشة الرئيسية)
                </strong>{" "}
                لتصلك جميع الإشعارات في الخلفية حتى والهاتف مغلق.
              </p>
              <p>
                On iPhone/iPad Safari, tap <strong>Share ↑</strong> →{" "}
                <strong>&ldquo;Add to Home Screen&rdquo;</strong>, then open MFT from your Home Screen and tap Enable Notifications.
              </p>
            </div>
          ) : (
            <p className="text-xs text-[var(--mft-muted)]">
              Get instant alerts for new tasks, chat messages, routine check-ins, and HR approvals even when Chrome/Safari is in the background or your phone is locked.
              <span className="block mt-0.5 font-medium text-[var(--mft-text)]" dir="rtl">
                استقبل تنبيهات المهام والرسائل والموافقات فورًا على هاتفك حتى والتطبيق في الخلفية.
              </span>
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {canInstallChrome && (
            <button
              type="button"
              onClick={() => void handleInstallClick()}
              className="rounded-lg bg-zinc-900 dark:bg-white px-3.5 py-2 text-xs font-bold text-white dark:text-zinc-900 hover:opacity-90 cursor-pointer"
            >
              📲 Install App · تثبيت التطبيق
            </button>
          )}
          {needsPushEnable && (
            <button
              type="button"
              onClick={() => void handleEnablePush()}
              disabled={busy}
              className="rounded-lg bg-red-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm hover:bg-red-700 disabled:opacity-60 cursor-pointer"
            >
              {busy ? "Enabling…" : "🔔 Enable Notifications · تفعيل الإشعارات"}
            </button>
          )}
          <button
            type="button"
            onClick={dismiss}
            className="rounded-lg px-2 py-1.5 text-xs text-[var(--mft-muted)] hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
