"use client";

import { useState } from "react";
import type { Firestore } from "firebase/firestore";
import { compressImage, type CompressedImage } from "@/lib/worker/imageCompress";
import { submitException, type ExceptionRow } from "@/lib/worker/exceptions";
import type { GeofenceCheckResult } from "@/lib/worker/hrShared";
import { localYmd } from "@/lib/worker/format";
import { toast } from "@/lib/worker/feedback";

interface Props {
  open: boolean;
  db: Firestore;
  uid: string;
  workerName: string;
  workerEmail: string;
  geofenceResult: GeofenceCheckResult | null;
  gpsError: string | null;
  workerCoords: { lat: number; lng: number } | null;
  todayMissionRequests: ExceptionRow[];
  busy?: boolean;
  onRetryGpsAndStartShift: () => void;
  onClose: () => void;
}

const HOUR_PRESETS = [
  { hours: 1, label: "1 ساعة" },
  { hours: 2, label: "2 ساعتين" },
  { hours: 3, label: "3 ساعات" },
  { hours: 4, label: "4 ساعات" },
  { hours: 6, label: "6 ساعات" },
  { hours: 8, label: "8 ساعات (يوم كامل)" },
];

export default function OutsideLocationMissionModal({
  open,
  db,
  uid,
  workerName,
  workerEmail,
  geofenceResult,
  gpsError,
  workerCoords,
  todayMissionRequests,
  busy = false,
  onRetryGpsAndStartShift,
  onClose,
}: Props) {
  const [missionHours, setMissionHours] = useState<number>(4);
  const [reason, setReason] = useState("");
  const [screenshot, setScreenshot] = useState<CompressedImage | null>(null);
  const [compressing, setCompressing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const pendingMission = todayMissionRequests.find((r) => !r.status || r.status === "pending");
  const approvedMission = todayMissionRequests.find((r) => r.status === "approved");
  const rejectedMission = todayMissionRequests.find((r) => r.status === "rejected");

  const handlePickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCompressing(true);
    try {
      const compressed = await compressImage(file);
      setScreenshot(compressed);
      toast.success("تم إرفاق السكرين شوت بنجاح ✓");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذر قراءة الصورة");
    } finally {
      setCompressing(false);
      e.target.value = "";
    }
  };

  const handleSubmitMission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!missionHours || missionHours < 0.5 || missionHours > 16) {
      toast.warning("يرجى تحديد عدد ساعات المأمورية (من نصف ساعة إلى 16 ساعة).");
      return;
    }
    if (!screenshot) {
      toast.warning("يرجى إرفاق سكرين شوت لإثبات المأمورية (مطلوب).");
      return;
    }
    if (!reason.trim()) {
      toast.warning("يرجى كتابة سبب ومكان المأمورية باختصار.");
      return;
    }

    setSubmitting(true);
    try {
      const today = localYmd();
      const nearestName = geofenceResult?.nearestLocation?.name ?? null;
      const dist = geofenceResult?.distanceMeters ?? null;

      await submitException(db, {
        workerId: uid,
        workerName,
        workerEmail,
        type: "external_mission",
        lateMinutes: Math.round(missionHours * 60),
        missionHours,
        screenshotUrl: screenshot.dataUrl,
        supportingEvidence: screenshot.dataUrl,
        workerLat: workerCoords?.lat ?? null,
        workerLng: workerCoords?.lng ?? null,
        nearestLocationName: nearestName,
        distanceMeters: dist,
        exceptionDate: today,
        reason: `[مأمورية خارجية — ${missionHours} ساعة]: ${reason.trim()}`,
      });

      toast.success(`تم إرسال طلب المأمورية (${missionHours} ساعة) مع السكرين شوت للأدمن ⏳`, {
        description: "بمجرد موافقة الأدمن سيتم احتساب الساعات وفتح الشيفت لك تلقائياً.",
        duration: 8000,
      });
      setReason("");
      setScreenshot(null);
    } catch (err) {
      toast.error("تعذر إرسال طلب المأمورية", {
        description: err instanceof Error ? err.message : "تحقق من الاتصال وحاول مرة أخرى.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-fade-in overflow-y-auto"
      role="dialog"
      aria-modal="true"
      dir="rtl"
    >
      <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-2xl border-2 border-red-600 bg-white p-5 sm:p-6 shadow-2xl dark:border-red-500 dark:bg-zinc-900 animate-scale-in">
        {/* Top Header */}
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-600 text-lg text-white shadow-md">
              📍
            </span>
            <div>
              <span className="inline-block rounded-full bg-red-100 px-2.5 py-0.5 text-[10px] font-extrabold text-red-800 dark:bg-red-950/70 dark:text-red-300">
                خارج موقع العمل المعتمد · Outside Work Location
              </span>
              <h3 className="mt-0.5 text-base sm:text-lg font-extrabold text-zinc-900 dark:text-white">
                لا يمكن بدء الشيفت العادي من خارج اللوكيشن
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Location Distance / GPS Diagnostic Box */}
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50/80 p-3.5 text-xs text-red-950 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200 space-y-2">
          {gpsError ? (
            <p className="font-bold">⚠️ {gpsError}</p>
          ) : geofenceResult?.nearestLocation ? (
            <div className="space-y-1">
              <p className="font-bold">
                🏢 أقرب موقع عمل معتمد: <span className="underline">{geofenceResult.nearestLocation.name}</span>
              </p>
              <p>
                📏 المسافة الحالية بينك وبين الموقع:{" "}
                <strong className="font-mono text-red-700 dark:text-red-300">
                  {geofenceResult.distanceMeters >= 1000
                    ? `${(geofenceResult.distanceMeters / 1000).toFixed(2)} كم`
                    : `${geofenceResult.distanceMeters} متر`}
                </strong>{" "}
                (النطاق المسموح: {geofenceResult.nearestLocation.radiusMeters || 200} متر)
              </p>
            </div>
          ) : (
            <p className="font-bold">أنت حالياً خارج نطاق مواقع العمل المعتمدة من الإدارة.</p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className="text-[11px] opacity-85">
              لو كنت داخل المكتب بالفعل، اضغط «إعادة فحص الموقع». لو كنت في مأمورية بالخارج، ابعت طلب مأمورية بالأسفل.
            </span>
            <button
              type="button"
              onClick={onRetryGpsAndStartShift}
              disabled={busy}
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 cursor-pointer disabled:opacity-50"
            >
              {busy ? "⏳ جاري الفحص..." : "🔄 إعادة فحص الموقع (GPS)"}
            </button>
          </div>
        </div>

        {/* Approved Mission Banner */}
        {approvedMission && (
          <div className="mt-4 rounded-xl border-2 border-emerald-500 bg-emerald-50 p-4 text-xs text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-200 space-y-2">
            <div className="font-extrabold text-sm">
              ✅ تمت موافقة الأدمن على طلب المأمورية اليوم ({String(approvedMission.missionHours || 4)} ساعة)!
            </div>
            <p>يمكنك الآن بدء الشيفت مباشرة من موقعك الحالي.</p>
            <button
              type="button"
              onClick={onRetryGpsAndStartShift}
              className="w-full rounded-xl bg-emerald-600 py-2.5 text-xs font-extrabold text-white shadow-md hover:bg-emerald-500 cursor-pointer"
            >
              ▶️ ابدأ الشيفت الآن
            </button>
          </div>
        )}

        {/* Pending Mission Status */}
        {pendingMission && !approvedMission && (
          <div className="mt-4 rounded-xl border-2 border-amber-400 bg-amber-50/90 p-4 text-xs text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-extrabold text-sm">
                ⏳ طلب المأمورية قيد مراجعة الأدمن ({String(pendingMission.missionHours || Math.round((Number(pendingMission.lateMinutes) || 60) / 60))} ساعة)
              </span>
              <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                بانتظار الموافقة
              </span>
            </div>
            <p className="text-[11px] leading-relaxed">
              {String(pendingMission.reason || "")}
            </p>
            <p className="text-[11px] font-bold text-amber-800 dark:text-amber-300">
              بمجرد موافقة الأدمن على المأمورية، ستُحتسب ساعاتها في حضورك وسيفتح لك الشيفت تلقائياً ويصلك إشعار فوري.
            </p>
          </div>
        )}

        {/* Rejected Notice */}
        {rejectedMission && !pendingMission && !approvedMission && (
          <div className="mt-4 rounded-xl border border-red-300 bg-red-50 p-3 text-xs text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
            <div className="font-bold">❌ تم رفض طلب المأمورية السابق</div>
            {Boolean(rejectedMission.adminResponse) && (
              <div className="mt-1 text-[11px]">رد الأدمن: {String(rejectedMission.adminResponse)}</div>
            )}
          </div>
        )}

        {/* Submit External Mission Form */}
        {!approvedMission && (
          <form onSubmit={handleSubmitMission} className="mt-4 space-y-4">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-800/40 space-y-3.5">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-extrabold text-zinc-900 dark:text-white">
                  🚗 إرسال طلب مأمورية خارجية للأدمن
                </h4>
                <span className="text-[10px] font-bold text-zinc-500">
                  بساعات محددة + سكرين شوت
                </span>
              </div>

              {/* 1. Mission Hours */}
              <div>
                <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1.5">
                  ١. المأمورية بكام ساعة؟ (عدد ساعات المأمورية) *
                </label>
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 mb-2">
                  {HOUR_PRESETS.map((p) => (
                    <button
                      key={p.hours}
                      type="button"
                      onClick={() => setMissionHours(p.hours)}
                      className={`rounded-lg py-2 px-1.5 text-[11px] font-bold border transition-all cursor-pointer ${
                        missionHours === p.hours
                          ? "border-red-600 bg-red-600 text-white shadow-sm"
                          : "border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-zinc-500">أو اكتب عدد الساعات:</span>
                  <input
                    type="number"
                    min={0.5}
                    max={16}
                    step={0.5}
                    value={missionHours}
                    onChange={(e) => setMissionHours(parseFloat(e.target.value) || 1)}
                    className="w-24 rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-center text-xs font-bold dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                  />
                  <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">ساعة</span>
                </div>
              </div>

              {/* 2. Screenshot Upload */}
              <div>
                <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1.5">
                  ٢. إرفاق سكرين شوت المأمورية (صورة المكان / أوبر / التاسك) *
                </label>
                {screenshot ? (
                  <div className="rounded-xl border-2 border-emerald-500 bg-emerald-50/50 p-3 dark:bg-emerald-950/20 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-emerald-800 dark:text-emerald-300">
                        ✓ تم إرفاق السكرين شوت ({Math.round(screenshot.bytes / 1024)} KB)
                      </span>
                      <button
                        type="button"
                        onClick={() => setScreenshot(null)}
                        className="rounded bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-red-700 cursor-pointer"
                      >
                        تغيير الصورة
                      </button>
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={screenshot.dataUrl}
                      alt="Mission Screenshot Preview"
                      className="max-h-40 rounded-lg border border-emerald-300 object-contain mx-auto"
                    />
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-zinc-300 bg-white p-4 text-center hover:border-red-500 hover:bg-red-50/20 transition cursor-pointer dark:border-zinc-700 dark:bg-zinc-900">
                    <span className="text-2xl mb-1">📸</span>
                    <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                      {compressing ? "⏳ جاري ضغط وإرفاق الصورة..." : "اضغط هنا لرفع سكرين شوت أو التقاط صورة للمأمورية"}
                    </span>
                    <span className="text-[10px] text-zinc-400 mt-0.5">
                      PNG, JPG, WEBP — يتم ضغطها تلقائياً وإرسالها للأدمن
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handlePickImage}
                      disabled={compressing}
                      className="hidden"
                    />
                  </label>
                )}
              </div>

              {/* 3. Mission Reason & Destination */}
              <div>
                <label className="block text-xs font-bold text-zinc-700 dark:text-zinc-300 mb-1">
                  ٣. مكان وتفاصيل المأمورية *
                </label>
                <textarea
                  rows={2}
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="مثال: مأمورية تصوير مع العميل في التجمع / استلام معدات..."
                  className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-red-600 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                />
              </div>

              <button
                type="submit"
                disabled={submitting || compressing}
                className="w-full rounded-xl bg-red-600 py-3 text-xs font-extrabold text-white shadow-lg shadow-red-600/25 hover:bg-red-500 disabled:opacity-50 cursor-pointer transition-all"
              >
                {submitting
                  ? "⏳ جاري إرسال طلب المأمورية للأدمن..."
                  : `🚀 إرسال طلب المأمورية (${missionHours} ساعة) مع السكرين شوت`}
              </button>
            </div>
          </form>
        )}

        {/* Footer Close */}
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-zinc-300 px-4 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer"
          >
            تصفح فقط بدون بدء الشيفت (إغلاق)
          </button>
        </div>
      </div>
    </div>
  );
}
