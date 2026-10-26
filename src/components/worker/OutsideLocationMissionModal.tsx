"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, type Firestore } from "firebase/firestore";
import { compressImage, type CompressedImage } from "@/lib/worker/imageCompress";
import { submitException, type ExceptionRow } from "@/lib/worker/exceptions";
import {
  DEFAULT_HR_SETTINGS,
  authorizeTrustedOfficePc,
  detectConnectionInfo,
  fetchAllClientPublicIps,
  isTrustedOfficePc,
  markOfficePinVerifiedForToday,
  matchOfficeNetworkIp,
  verifyOfficePinInput,
  type GeofenceCheckResult,
  type HrSettings,
} from "@/lib/worker/hrShared";
import { localYmd } from "@/lib/worker/format";
import { toast } from "@/lib/worker/feedback";

interface Props {
  open: boolean;
  db: Firestore;
  uid: string;
  workerName: string;
  workerEmail: string;
  hrSettings: HrSettings;
  geofenceResult: GeofenceCheckResult | null;
  gpsError: string | null;
  workerCoords: { lat: number; lng: number } | null;
  todayMissionRequests: ExceptionRow[];
  busy?: boolean;
  onRetryGpsAndStartShift: (opts?: {
    pinJustVerified?: boolean;
    pcJustAuthorized?: boolean;
    wifiJustVerified?: boolean;
  }) => void;
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
  hrSettings,
  todayMissionRequests,
  busy = false,
  onRetryGpsAndStartShift,
  onClose,
}: Props) {
  const [activeTab, setActiveTab] = useState<"inside_office" | "outside_mission">("inside_office");

  // Inside office (non-GPS) state
  const [officePin, setOfficePin] = useState("");
  const [showPcSetup, setShowPcSetup] = useState(false);
  const [pcSetupCode, setPcSetupCode] = useState("");
  const [pcLabel, setPcLabel] = useState("");
  const [detectedIps, setDetectedIps] = useState<string[]>([]);
  const [liveSettings, setLiveSettings] = useState<HrSettings | null>(null);
  const [checkingIp, setCheckingIp] = useState(false);
  const [connInfo, setConnInfo] = useState(() => detectConnectionInfo());

  // External mission state
  const [missionHours, setMissionHours] = useState<number>(4);
  const [reason, setReason] = useState("");
  const [screenshot, setScreenshot] = useState<CompressedImage | null>(null);
  const [compressing, setCompressing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const effectiveSettings: HrSettings = liveSettings
    ? {
        ...hrSettings,
        ...liveSettings,
        officeNetworks:
          (liveSettings.officeNetworks?.length ?? 0) > 0
            ? liveSettings.officeNetworks
            : hrSettings.officeNetworks,
      }
    : hrSettings;

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    const info = detectConnectionInfo();
    setConnInfo(info);
    setCheckingIp(true);

    Promise.all([
      fetchAllClientPublicIps(),
      getDoc(doc(db, "settings", "hr")).catch(() => null),
    ])
      .then(([ips, snap]) => {
        if (!mounted) return;
        if (ips.length > 0) setDetectedIps(ips);
        let fresh = effectiveSettings;
        if (snap && snap.exists()) {
          fresh = { ...DEFAULT_HR_SETTINGS, ...(snap.data() as Partial<HrSettings>) };
          setLiveSettings(fresh);
        }
        if (!info.isCellular) {
          const matched = matchOfficeNetworkIp(ips, fresh);
          if (matched) {
            toast.success(`🌐 تم التأكد من اتصالك بشبكة الشركة (${matched.name}) ✓`);
            onRetryGpsAndStartShift({ wifiJustVerified: true });
          }
        }
      })
      .finally(() => {
        if (mounted) setCheckingIp(false);
      });
    return () => {
      mounted = false;
    };
  }, [open, db]);

  if (!open) return null;

  const detectedIp = detectedIps[0] || null;
  const pendingMission = todayMissionRequests.find((r) => !r.status || r.status === "pending");
  const approvedMission = todayMissionRequests.find((r) => r.status === "approved");
  const rejectedMission = todayMissionRequests.find((r) => r.status === "rejected");
  const trustedPcStatus = isTrustedOfficePc(effectiveSettings);
  const matchedOfficeNet = !connInfo.isCellular
    ? matchOfficeNetworkIp(detectedIps, effectiveSettings)
    : null;
  const activeOfficeNets = (effectiveSettings.officeNetworks ?? []).filter(
    (n) => n.active !== false && Boolean(n.ip?.trim()),
  );

  const handleRecheckNetwork = async () => {
    const freshConn = detectConnectionInfo();
    setConnInfo(freshConn);
    if (freshConn.isCellular) {
      toast.error("📵 أنت ما زلت متصلاً بباقة الموبايل (Mobile Data)!", {
        description: "أغلق بيانات الهاتف واتصل بـ Wi-Fi الشركة أولاً، أو أرسل طلب مأمورية خارجية.",
      });
      return;
    }
    setCheckingIp(true);
    const [ips, snap] = await Promise.all([
      fetchAllClientPublicIps(),
      getDoc(doc(db, "settings", "hr")).catch(() => null),
    ]);
    if (ips.length > 0) setDetectedIps(ips);
    let freshSettings = effectiveSettings;
    if (snap && snap.exists()) {
      freshSettings = { ...DEFAULT_HR_SETTINGS, ...(snap.data() as Partial<HrSettings>) };
      setLiveSettings(freshSettings);
    }
    setCheckingIp(false);

    const matched = matchOfficeNetworkIp(ips, freshSettings);
    if (matched) {
      toast.success(`🌐 تم التأكد من اتصالك بشبكة الشركة (${matched.name}) ✓ — جاري بدء الشيفت...`);
      onRetryGpsAndStartShift({ wifiJustVerified: true });
    } else {
      onRetryGpsAndStartShift();
    }
  };

  const handleVerifyOfficePin = (e: React.FormEvent) => {
    e.preventDefault();
    const freshConn = detectConnectionInfo();
    setConnInfo(freshConn);
    if (freshConn.isCellular) {
      toast.error("📵 لا يمكن استخدام كود حضور المكتب وأنت فاتح باقة الموبايل (Mobile Data)!", {
        description: "يرجى إغلاق الداتا والاتصال بـ Wi-Fi الشركة أولاً، أو إرسال طلب مأمورية خارجية.",
      });
      return;
    }
    const today = localYmd();
    if (!officePin.trim()) {
      toast.warning("يرجى إدخال كود حضور المكتب اليومي (اطلبه من الأدمن أو الـ HR).");
      return;
    }
    if (!verifyOfficePinInput(officePin, effectiveSettings, today)) {
      toast.error("كود حضور المكتب غير صحيح — تأكد من الكود المكون من 4 أرقام الظاهر في لوحة الـ HR لليوم.");
      return;
    }
    markOfficePinVerifiedForToday(uid, today);
    setOfficePin("");
    toast.success("🏢 تم التحقق من تواجدك داخل الشركة بكود المكتب ✓ — جاري بدء الشيفت...");
    onRetryGpsAndStartShift({ pinJustVerified: true });
  };

  const handleAuthorizeOfficePc = (e: React.FormEvent) => {
    e.preventDefault();
    const freshConn = detectConnectionInfo();
    setConnInfo(freshConn);
    if (freshConn.isCellular || freshConn.isMobileDevice) {
      toast.error("خيار الكمبيوتر المكتبي الثابت مخصص لأجهزة الكمبيوتر داخل الشركة فقط.");
      return;
    }
    if (!pcSetupCode.trim()) {
      toast.warning("يرجى إدخال كود اعتماد أجهزة الشركة الخاص بالأدمن.");
      return;
    }
    const ok = authorizeTrustedOfficePc(pcSetupCode, pcLabel || "كمبيوتر مكتبي بالشركة", effectiveSettings);
    if (!ok) {
      toast.error("كود اعتماد الجهاز غير صحيح — يرجى مراجعة الأدمن.");
      return;
    }
    setPcSetupCode("");
    setShowPcSetup(false);
    toast.success("💻 تم اعتماد هذا الكمبيوتر كجهاز مكتبي ثابت داخل الشركة ✓ — جاري بدء الشيفت...");
    onRetryGpsAndStartShift({ pcJustAuthorized: true });
  };

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

      await submitException(db, {
        workerId: uid,
        workerName,
        workerEmail,
        type: "external_mission",
        lateMinutes: Math.round(missionHours * 60),
        missionHours,
        screenshotUrl: screenshot.dataUrl,
        supportingEvidence: screenshot.dataUrl,
        workerLat: null,
        workerLng: null,
        nearestLocationName: null,
        distanceMeters: null,
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
              🏢
            </span>
            <div>
              <span className="inline-block rounded-full bg-red-100 px-2.5 py-0.5 text-[10px] font-extrabold text-red-800 dark:bg-red-950/70 dark:text-red-300">
                بوابة التحقق من التواجد (بدون GPS) · Office &amp; Mission Gate
              </span>
              <h3 className="mt-0.5 text-base sm:text-lg font-extrabold text-zinc-900 dark:text-white">
                هل أنت داخل مقر الشركة أم في مأمورية خارجية؟
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

        {/* Network / Cellular Status Diagnostic Box (No GPS) */}
        {connInfo.isCellular ? (
          <div className="mt-3.5 rounded-xl border-2 border-red-500 bg-red-50 p-3 text-xs text-red-900 dark:border-red-700 dark:bg-red-950/50 dark:text-red-200 space-y-1">
            <p className="font-extrabold flex items-center gap-1.5">
              <span>📵</span>
              <span>أنت فاتح باقة الموبايل (Mobile Data) ولست متصلاً بـ Wi-Fi الشركة!</span>
            </p>
            <p className="text-[11px] leading-relaxed">
              لا يسمح النظام ببدء الشيفت تلقائياً على بيانات الهاتف (Mobile Data). إذا كنت داخل مقر الشركة، يرجى إغلاق الداتا والاتصال بـ <strong>Wi-Fi الشركة</strong> أولاً، وإذا كنت خارج الشركة انتقل لتبويب <strong>«أنا في مأمورية خارجية»</strong>.
            </p>
          </div>
        ) : (
          <div className="mt-3.5 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-800 dark:border-zinc-800 dark:bg-zinc-800/50 dark:text-zinc-200 space-y-1">
            <p className="font-bold">
              🔐 يعمل نظام الحضور بدون GPS لحماية خصوصيتك ودعم جميع الأجهزة:
            </p>
            <p className="text-[11px] text-zinc-600 dark:text-zinc-300">
              إذا كنت داخل مقر الشركة، اتصل بـ <strong>Wi-Fi الشركة</strong> أو أدخل <strong>كود حضور المكتب اليومي (4 أرقام)</strong>. وإذا كنت خارج المقر، أرسل طلب مأمورية خارجية للأدمن.
            </p>
          </div>
        )}

        {/* Mode Switcher Tabs */}
        <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-zinc-100 p-1.5 dark:bg-zinc-800">
          <button
            type="button"
            onClick={() => setActiveTab("inside_office")}
            className={`rounded-lg py-2.5 px-3 text-xs font-extrabold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === "inside_office"
                ? "bg-emerald-600 text-white shadow-md"
                : "text-zinc-700 hover:bg-white/60 dark:text-zinc-300 dark:hover:bg-zinc-700/60"
            }`}
          >
            <span>🏢</span>
            <span>أنا داخل مقر الشركة</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("outside_mission")}
            className={`rounded-lg py-2.5 px-3 text-xs font-extrabold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === "outside_mission"
                ? "bg-red-600 text-white shadow-md"
                : "text-zinc-700 hover:bg-white/60 dark:text-zinc-300 dark:hover:bg-zinc-700/60"
            }`}
          >
            <span>🚗</span>
            <span>أنا في مأمورية خارجية</span>
          </button>
        </div>

        {/* ══════════════════ TAB 1: INSIDE COMPANY (NO GPS) ══════════════════ */}
        {activeTab === "inside_office" && (
          <div className="mt-4 space-y-4">
            {/* Option 1: Office Wi-Fi / IP Auto-Check */}
            <div className="rounded-xl border-2 border-sky-500 bg-sky-50/60 p-3.5 dark:border-sky-800 dark:bg-sky-950/30 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="space-y-1.5">
                <div className="font-extrabold text-zinc-900 dark:text-white flex items-center gap-1.5">
                  <span>🌐</span>
                  <span>١. التحقق عبر شبكة Wi-Fi الشركة</span>
                </div>
                {detectedIp ? (
                  <div className="space-y-1">
                    <div className="text-[11px] text-zinc-600 dark:text-zinc-300 flex flex-wrap items-center gap-1.5">
                      <span>عنوان شبكتك الحالي (IP):</span>
                      <code className="rounded bg-white px-1.5 py-0.5 font-mono font-bold text-zinc-900 border border-zinc-300 dark:bg-zinc-800 dark:text-zinc-200 dark:border-zinc-700" dir="ltr">
                        {detectedIp}
                      </code>
                      {matchedOfficeNet ? (
                        <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          ✓ مطابق لشبكة الشركة ({matchedOfficeNet.name})
                        </span>
                      ) : (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                          غير مطابق للشبكات المسجلة
                        </span>
                      )}
                    </div>
                    {!matchedOfficeNet && (
                      <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                        {activeOfficeNets.length === 0 ? (
                          <span className="text-red-600 dark:text-red-400 font-bold">
                            ⚠️ لم يتم حفظ أي IP لشبكة الشركة في إعدادات الـ HR بعد (يجب على الأدمن الضغط على «سجل شبكة الشركة الحالية» في لوحة الـ HR).
                          </span>
                        ) : (
                          <span>
                            الشبكات المسجلة في النظام:{" "}
                            <code className="font-mono font-bold text-zinc-700 dark:text-zinc-300" dir="ltr">
                              {activeOfficeNets.map((n) => n.ip).join(" , ")}
                            </code>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-[11px] text-zinc-500">
                    تأكد من إغلاق باقة الموبايل والاتصال بـ Wi-Fi الشركة ثم اضغط فحص الشبكة.
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => void handleRecheckNetwork()}
                disabled={busy || checkingIp}
                className={`rounded-xl px-4 py-2.5 text-xs font-extrabold text-white shadow-md disabled:opacity-50 cursor-pointer shrink-0 ${
                  matchedOfficeNet ? "bg-emerald-600 hover:bg-emerald-500" : "bg-sky-600 hover:bg-sky-500"
                }`}
              >
                {busy || checkingIp
                  ? "⏳ جاري الفحص..."
                  : matchedOfficeNet
                    ? "✓ بدء الشيفت عبر Wi-Fi الشركة"
                    : "🔄 فحص اتصال Wi-Fi الشركة الآن"}
              </button>
            </div>

            {/* Option 2: Daily Office PIN */}
            {effectiveSettings.officePinEnabled !== false && (
              <form
                onSubmit={handleVerifyOfficePin}
                className="rounded-xl border-2 border-emerald-500 bg-emerald-50/60 p-4 dark:border-emerald-700 dark:bg-emerald-950/30 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="inline-block rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">
                      سريع لجميع الأجهزة داخل المقر
                    </span>
                    <h4 className="mt-1 text-sm font-extrabold text-zinc-900 dark:text-white">
                      🔑 ٢. الدخول بكود حضور المكتب اليومي (Office PIN)
                    </h4>
                    <p className="text-[11px] text-zinc-600 dark:text-zinc-300 mt-0.5">
                      اكتب الكود المكون من 4 أرقام الظاهر في لوحة الـ HR أو الأدمن لبدء الشيفت فوراً من داخل الشركة:
                    </p>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    dir="ltr"
                    value={officePin}
                    onChange={(e) => setOfficePin(e.target.value)}
                    placeholder="أدخل كود المكتب (4 أرقام)"
                    className="flex-1 rounded-xl border-2 border-emerald-600 bg-white px-3.5 py-2.5 text-center font-mono text-base font-black tracking-widest text-zinc-900 placeholder:text-xs placeholder:font-sans placeholder:tracking-normal focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:bg-zinc-900 dark:text-white"
                    autoFocus
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-extrabold text-white shadow-md hover:bg-emerald-500 disabled:opacity-50 cursor-pointer shrink-0"
                  >
                    {busy ? "⏳ جاري البدء..." : "✓ تأكيد الكود وبدء الشيفت"}
                  </button>
                </div>
              </form>
            )}

            {/* Option 3: Trusted Office PC Setup (Desktop Only) */}
            {!connInfo.isMobileDevice && !connInfo.isCellular && (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3.5 dark:border-zinc-800 dark:bg-zinc-800/40 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h5 className="text-xs font-extrabold text-zinc-900 dark:text-white flex items-center gap-1.5">
                      <span>💻</span>
                      <span>٣. هل هذا كمبيوتر مكتبي ثابت داخل مقر الشركة؟</span>
                    </h5>
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      {trustedPcStatus.trusted
                        ? `هذا الجهاز معتمد بالفعل (${trustedPcStatus.label}).`
                        : "يمكن للأدمن تفعيل هذا الكمبيوتر مرة واحدة فقط ليفتح الشيفت دائماً بدون طلب كود يومي."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPcSetup((v) => !v)}
                    className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 cursor-pointer shrink-0"
                  >
                    {showPcSetup ? "إخفاء" : "⚙️ اعتماد هذا الكمبيوتر"}
                  </button>
                </div>

                {showPcSetup && (
                  <form onSubmit={handleAuthorizeOfficePc} className="pt-2 border-t border-zinc-200 dark:border-zinc-700 space-y-2.5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={pcLabel}
                        onChange={(e) => setPcLabel(e.target.value)}
                        placeholder="اسم الجهاز (مثال: كمبيوتر التصميم 1)"
                        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                      />
                      <input
                        type="password"
                        dir="ltr"
                        value={pcSetupCode}
                        onChange={(e) => setPcSetupCode(e.target.value)}
                        placeholder="كود اعتماد أجهزة المكتب (من الأدمن)"
                        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-mono text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
                      />
                    </div>
                    <button
                      type="submit"
                      className="w-full rounded-lg bg-zinc-900 py-2 text-xs font-extrabold text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 cursor-pointer"
                    >
                      🔒 اعتماد هذا الكمبيوتر دائماً وبدء الشيفت
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        )}

        {/* ══════════════════ TAB 2: OUTSIDE EXTERNAL MISSION ══════════════════ */}
        {activeTab === "outside_mission" && (
          <div className="mt-4 space-y-4">
            {/* Approved Mission Banner */}
            {approvedMission && (
              <div className="rounded-xl border-2 border-emerald-500 bg-emerald-50 p-4 text-xs text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-200 space-y-2">
                <div className="font-extrabold text-sm">
                  ✅ تمت موافقة الأدمن على طلب المأمورية اليوم ({String(approvedMission.missionHours || 4)} ساعة)!
                </div>
                <p>يمكنك الآن بدء الشيفت مباشرة.</p>
                <button
                  type="button"
                  onClick={() => onRetryGpsAndStartShift()}
                  className="w-full rounded-xl bg-emerald-600 py-2.5 text-xs font-extrabold text-white shadow-md hover:bg-emerald-500 cursor-pointer"
                >
                  ▶️ ابدأ الشيفت الآن
                </button>
              </div>
            )}

            {/* Pending Mission Status */}
            {pendingMission && !approvedMission && (
              <div className="rounded-xl border-2 border-amber-400 bg-amber-50/90 p-4 text-xs text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-sm">
                    ⏳ طلب المأمورية قيد مراجعة الأدمن ({String(pendingMission.missionHours || Math.round((Number(pendingMission.lateMinutes) || 60) / 60))} ساعة)
                  </span>
                  <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                    بانتظار الموافقة
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed">{String(pendingMission.reason || "")}</p>
                <p className="text-[11px] font-bold text-amber-800 dark:text-amber-300">
                  بمجرد موافقة الأدمن على المأمورية، ستُحتسب ساعاتها في حضورك وسيفتح لك الشيفت تلقائياً ويصلك إشعار فوري.
                </p>
              </div>
            )}

            {/* Rejected Notice */}
            {rejectedMission && !pendingMission && !approvedMission && (
              <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-xs text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
                <div className="font-bold">❌ تم رفض طلب المأمورية السابق</div>
                {Boolean(rejectedMission.adminResponse) && (
                  <div className="mt-1 text-[11px]">رد الأدمن: {String(rejectedMission.adminResponse)}</div>
                )}
              </div>
            )}

            {/* Submit External Mission Form */}
            {!approvedMission && (
              <form onSubmit={handleSubmitMission} className="space-y-4">
                <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-800/40 space-y-3.5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-extrabold text-zinc-900 dark:text-white">
                      🚗 إرسال طلب مأمورية خارجية للأدمن
                    </h4>
                    <span className="text-[10px] font-bold text-zinc-500">بساعات محددة + سكرين شوت</span>
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
          </div>
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
