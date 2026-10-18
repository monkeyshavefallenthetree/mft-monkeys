/* MFT Monkeys Worker Portal — Service Worker (Web Push + Background Notifications) */

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function buildNotificationOptions(payload) {
  const title = payload.title || "MFT Monkeys";
  const url = payload.url || "/dashboard";
  const tag = payload.tag || payload.taskId || `mft-${Date.now()}`;
  const urgent = Boolean(payload.urgent || payload.requireInteraction);

  return {
    title,
    options: {
      body: payload.body || "You have a new update in MFT Worker Portal.",
      icon: payload.icon || "/icons/icon-192.png",
      badge: payload.badge || "/icons/icon-192.png",
      tag,
      renotify: true,
      requireInteraction: urgent,
      vibrate: urgent ? [300, 120, 300, 120, 400] : [200, 100, 200],
      data: {
        url,
        tab: payload.tab || null,
        taskId: payload.taskId || null,
        ...(payload.data || {}),
      },
    },
  };
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

  const { title, options } = buildNotificationOptions(payload);

  event.waitUntil(
    (async () => {
      try {
        if (self.navigator && typeof self.navigator.setAppBadge === "function") {
          await self.navigator.setAppBadge(payload.badgeCount || 1);
        }
      } catch {
        /* ignore badge errors */
      }
      await self.registration.showNotification(title, options);
    })(),
  );
});

self.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "SHOW_LOCAL_NOTIFICATION" && msg.payload) {
    const { title, options } = buildNotificationOptions(msg.payload);
    event.waitUntil(self.registration.showNotification(title, options));
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
