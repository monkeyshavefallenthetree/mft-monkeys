/* MFT Monkeys Worker Portal — Service Worker (Web Push + Mobile Lock Screen Notifications) */

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function buildNotificationOptions(payload) {
  const title = payload.title || "MFT Monkeys";
  const url = payload.url || "/dashboard";
  // Always use a unique tag per push event so iOS & Android wake the lock screen
  // instead of silently updating an older notification in the tray.
  const baseTag = payload.tag || payload.taskId || "mft";
  const tag = `${baseTag}-${Date.now()}`;
  const urgent = Boolean(payload.urgent || payload.requireInteraction);

  return {
    title,
    options: {
      body: payload.body || "You have a new update in MFT Worker Portal.",
      icon: payload.icon || "/icons/icon-192.png",
      badge: payload.badge || "/icons/icon-192.png",
      tag,
      renotify: true,
      silent: false,
      requireInteraction: urgent,
      vibrate: urgent ? [300, 120, 300, 120, 400] : [200, 100, 200],
      timestamp: Date.now(),
      data: {
        url,
        tab: payload.tab || null,
        taskId: payload.taskId || null,
        ...(payload.data || {}),
      },
    },
  };
}

async function displayLockScreenNotification(payload) {
  const { title, options } = buildNotificationOptions(payload);
  try {
    await self.registration.showNotification(title, options);
  } catch {
    // Fallback with minimal standard options for strict mobile browsers (e.g. iOS WebKit)
    await self.registration.showNotification(title, {
      body: options.body,
      icon: "/icons/icon-192.png",
      data: options.data,
    });
  }

  try {
    if (self.navigator && typeof self.navigator.setAppBadge === "function") {
      await self.navigator.setAppBadge(payload.badgeCount || 1);
    }
  } catch {
    /* ignore badge errors */
  }
}

self.addEventListener("push", (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { title: "MFT Monkeys", body: event.data.text() };
    }
  }

  event.waitUntil(displayLockScreenNotification(payload));
});

self.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "SHOW_LOCAL_NOTIFICATION" && msg.payload) {
    event.waitUntil(displayLockScreenNotification(msg.payload));
  } else if (msg.type === "CLEAR_BADGE") {
    if (self.navigator && typeof self.navigator.clearAppBadge === "function") {
      self.navigator.clearAppBadge().catch(() => {});
    }
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = data.url || "/dashboard";

  event.waitUntil(
    (async () => {
      try {
        if (self.navigator && typeof self.navigator.clearAppBadge === "function") {
          await self.navigator.clearAppBadge();
        }
      } catch {
        /* ignore */
      }

      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of clientList) {
        if ("focus" in client) {
          await client.focus();
          client.postMessage({
            type: "MFT_NOTIFICATION_CLICK",
            url: targetUrl,
            tab: data.tab || null,
            taskId: data.taskId || null,
          });
          return;
        }
      }

      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })(),
  );
});
