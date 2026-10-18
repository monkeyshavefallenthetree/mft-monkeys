import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";

export const VAPID_PUBLIC_KEY =
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
  "BC4qV_AA_NGWwJUuOf3I5pKrblvWSHOhhSdY-F0ENgdfzZ3tqFEGPG6HcIj0tv-i8yGkeJA5puekWty8rLH5KQM";

const VAPID_PRIVATE_KEY =
  process.env.VAPID_PRIVATE_KEY ||
  "af3SqNjdI2lIBaIVJKL4jzjydfPpHJKT8Q1YkvmWxrk";

const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@mft.com";

let configured = false;
function ensureVapid() {
  if (configured) return;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  configured = true;
}

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

export type WebPushPayload = {
  title: string;
  body: string;
  url?: string;
  tab?: string;
  taskId?: string;
  tag?: string;
  urgent?: boolean;
  requireInteraction?: boolean;
  badgeCount?: number;
  data?: Record<string, string>;
};

export async function GET() {
  return NextResponse.json({ publicKey: VAPID_PUBLIC_KEY });
}

export async function POST(req: NextRequest) {
  try {
    ensureVapid();
    const body = (await req.json()) as {
      subscriptions?: StoredPushSubscription[];
      payload?: WebPushPayload;
    };

    const subs = Array.isArray(body.subscriptions) ? body.subscriptions : [];
    const payload = body.payload;

    if (!payload || !payload.title) {
      return NextResponse.json({ error: "Missing notification payload.title" }, { status: 400 });
    }
    if (subs.length === 0) {
      return NextResponse.json({ sent: 0, failed: 0, goneEndpoints: [] });
    }

    const validSubs = subs.filter(
      (s) => s && typeof s.endpoint === "string" && s.keys?.p256dh && s.keys?.auth,
    );

    const serialized = JSON.stringify({
      title: payload.title,
      body: payload.body || "",
      url: payload.url || "/dashboard",
      tab: payload.tab,
      taskId: payload.taskId,
      tag: payload.tag || payload.taskId || `mft-${Date.now()}`,
      urgent: Boolean(payload.urgent || payload.requireInteraction),
      requireInteraction: Boolean(payload.requireInteraction || payload.urgent),
      badgeCount: payload.badgeCount ?? 1,
      data: payload.data || {},
    });

    let sent = 0;
    let failed = 0;
    const goneEndpoints: string[] = [];

    await Promise.all(
      validSubs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.keys.p256dh,
                auth: sub.keys.auth,
              },
            },
            serialized,
            {
              TTL: 86400,
              urgency: "high",
            },
          );
          sent += 1;
        } catch (err: unknown) {
          failed += 1;
          const statusCode =
            err && typeof err === "object" && "statusCode" in err
              ? Number((err as { statusCode?: number }).statusCode)
              : 0;
          if (statusCode === 404 || statusCode === 410) {
            goneEndpoints.push(sub.endpoint);
          } else {
            console.warn("[web-push] send error:", statusCode, err);
          }
        }
      }),
    );

    return NextResponse.json({ sent, failed, goneEndpoints });
  } catch (e) {
    console.error("[web-push] route error:", e);
    return NextResponse.json({ error: "Web push server error" }, { status: 500 });
  }
}
