import { NextRequest, NextResponse } from "next/server";

function cleanIp(raw: string | null | undefined): string {
  if (!raw) return "";
  const first = raw.split(",")[0]?.trim() || "";
  return first.replace(/^::ffff:/i, "");
}

function isLocalOrPrivateIp(ip: string): boolean {
  if (!ip) return true;
  if (ip === "127.0.0.1" || ip === "::1" || ip === "localhost") return true;
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(ip)) return true;
  return false;
}

export async function GET(req: NextRequest) {
  const headerIp =
    cleanIp(req.headers.get("cf-connecting-ip")) ||
    cleanIp(req.headers.get("x-vercel-forwarded-for")) ||
    cleanIp(req.headers.get("x-forwarded-for")) ||
    cleanIp(req.headers.get("x-real-ip"));

  if (headerIp && !isLocalOrPrivateIp(headerIp)) {
    return NextResponse.json({ ip: headerIp, source: "headers" });
  }

  // Fallback for local dev or private proxy: resolve public router IP via ipify
  try {
    const res = await fetch("https://api.ipify.org?format=json", {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = (await res.json()) as { ip?: string };
      if (data?.ip) {
        return NextResponse.json({ ip: cleanIp(data.ip), source: "ipify" });
      }
    }
  } catch {
    /* ignore */
  }

  return NextResponse.json({ ip: headerIp || null, source: "fallback" });
}
