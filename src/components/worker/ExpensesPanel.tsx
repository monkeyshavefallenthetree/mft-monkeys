"use client";

import { useEffect, useRef, useState } from "react";
import type { Firestore } from "firebase/firestore";
import { compressImage, type CompressedImage } from "@/lib/worker/imageCompress";
import {
  createReimbursement,
  submitPurchaseInvoice,
  subscribeMyReimbursements,
  type AttachmentKind,
  type WorkerReimbursement,
} from "@/lib/worker/reimbursements";
import { REIMBURSEMENT_STAGE_AR, toArabicDigits, validateReimbursement, type ReimbursementType } from "@/lib/worker/hrPolicy2026";
import { localYmd } from "@/lib/worker/format";
import { toast } from "@/lib/worker/feedback";

const ar = toArabicDigits;
const egp = (n?: number | null) => (n == null ? "—" : `${ar(Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }))} ج.م`);

const STAGE_TONE: Record<string, string> = {
  pre_approval: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  pending_invoice: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  review: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

function ImageSlot({ id, label, hint, value, onChange }: { id: string; label: string; hint: string; value: CompressedImage | null; onChange: (v: CompressedImage | null) => void }) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file?: File | null) => {
    if (!file) return;
    setBusy(true);
    try {
      onChange(await compressImage(file));
    } catch (e) {
      toast.error("تعذر تجهيز الصورة", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">{label}</p>
      <input ref={ref} id={id} type="file" accept="image/*" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
      {value ? (
        <div className="group relative overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value.dataUrl} alt={label} className="h-40 w-full bg-zinc-950 object-contain" />
          <div className="flex items-center justify-between bg-zinc-50 px-2.5 py-1.5 text-[10px] text-zinc-500 dark:bg-zinc-800">
            <span className="font-mono" dir="ltr">{Math.round(value.originalBytes / 1024)}KB → {Math.round(value.bytes / 1024)}KB</span>
            <button type="button" onClick={() => onChange(null)} className="font-bold text-red-600 hover:underline cursor-pointer">إزالة</button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => ref.current?.click()}
          className={`flex h-40 w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed text-xs transition cursor-pointer ${busy ? "border-red-400 bg-red-50 text-red-700 dark:bg-red-950/30" : "border-zinc-300 text-zinc-500 hover:border-red-400 hover:bg-red-50/50 hover:text-red-700 dark:border-zinc-700 dark:hover:bg-red-950/20"}`}
        >
          <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
          <span className="font-semibold">{busy ? "جارٍ الضغط…" : hint}</span>
          <span className="text-[10px] text-zinc-400">ضغط تلقائي ≤ ٣٠٠ كيلوبايت</span>
        </button>
      )}
    </div>
  );
}

export default function ExpensesPanel({ db, worker }: { db: Firestore; worker: { uid: string; name: string; email?: string } }) {
  const [rows, setRows] = useState<WorkerReimbursement[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<ReimbursementType>("outdoor");
  const [purpose, setPurpose] = useState("");
  const [date, setDate] = useState(localYmd());
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [quoteLink, setQuoteLink] = useState("");
  const [shot, setShot] = useState<CompressedImage | null>(null);
  const [busy, setBusy] = useState(false);
  const [invoiceFor, setInvoiceFor] = useState<WorkerReimbursement | null>(null);

  useEffect(() => {
    return subscribeMyReimbursements(db, worker.uid, (r) => {
      setRows(r);
      setLoading(false);
    });
  }, [db, worker.uid]);

  const reset = () => {
    setPurpose("");
    setFrom("");
    setTo("");
    setAmount("");
    setQuoteLink("");
    setShot(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(amount);
    const kind: AttachmentKind = type === "outdoor" ? "ride_screenshot" : "quote";
    const flags = validateReimbursement({
      type,
      stage: type === "outdoor" ? "review" : "pre_approval",
      amount: amt,
      routeFrom: from,
      routeTo: to,
      quoteLink,
      attachmentKinds: shot ? [kind] : [],
      imageHashes: shot ? [shot.sha256] : [],
    }, { knownHashes: rows.flatMap((r) => r.imageHashes ?? []) });
    const blocking = flags.filter((f) => f.severity === "error");
    if (!purpose.trim()) return toast.warning("اكتب الغرض من المصروف");
    if (blocking.length) return toast.warning("الطلب غير مكتمل", { description: blocking.map((f) => f.messageAr).join("\n") });
    setBusy(true);
    try {
      await createReimbursement(db, worker, { type, purpose, date, amount: amt, routeFrom: from, routeTo: to, quoteLink }, shot ? [{ kind, image: shot }] : []);
      toast.success(type === "outdoor" ? "تم إرسال طلب المأمورية للمراجعة" : "تم إرسال طلب الموافقة المسبقة", {
        description: type === "purchase" ? "لا تقم بالشراء قبل وصول الموافقة." : "سيضاف المبلغ لراتبك بعد الاعتماد.",
      });
      reset();
    } catch (err) {
      console.error(err);
      toast.error("تعذر إرسال الطلب", { description: "تحقق من الاتصال وحاول مرة أخرى." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-6 animate-fade-in" aria-labelledby="expenses-heading" dir="rtl" lang="ar">
      <div>
        <h2 id="expenses-heading" className="text-xl font-bold text-zinc-900 dark:text-white">المصروفات والمأموريات</h2>
        <p className="text-xs text-zinc-500">البند ٥ من لائحة HR-POL-2026 — المأموريات بلقطة من تطبيق النقل، والمشتريات بموافقة مسبقة ثم فاتورة مطابقة.</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <form onSubmit={(e) => void submit(e)} className="ui-card space-y-4 p-6" id="worker-expense-form">
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="نوع الطلب">
            {([
              ["outdoor", "🚕 مأمورية خارجية"],
              ["purchase", "🛒 مشتريات"],
            ] as const).map(([v, l]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={type === v}
                id={`worker-expense-type-${v}`}
                onClick={() => { setType(v); setShot(null); }}
                className={`rounded-xl border p-3 text-sm font-bold transition cursor-pointer ${type === v ? "border-red-500 bg-red-50 text-red-700 ring-2 ring-red-500/15 dark:bg-red-950/40 dark:text-red-300" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}
              >
                {l}
              </button>
            ))}
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300" htmlFor="worker-expense-purpose">الغرض *</label>
            <input id="worker-expense-purpose" className="brutal-input" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder={type === "outdoor" ? "مثال: اجتماع مع العميل لتسليم التصميمات" : "مثال: شراء هارد ديسك خارجي للأرشيف"} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300" htmlFor="worker-expense-date">التاريخ</label>
              <input id="worker-expense-date" type="date" className="brutal-input" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300" htmlFor="worker-expense-amount">{type === "outdoor" ? "سعر الرحلة *" : "المبلغ التقديري *"}</label>
              <input id="worker-expense-amount" type="number" min={0} step="0.01" className="brutal-input" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>

          {type === "outdoor" ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300" htmlFor="worker-expense-from">من *</label>
                <input id="worker-expense-from" className="brutal-input" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300" htmlFor="worker-expense-to">إلى *</label>
                <input id="worker-expense-to" className="brutal-input" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300" htmlFor="worker-expense-link">رابط عرض السعر (أو ارفع صورة)</label>
              <input id="worker-expense-link" type="url" dir="ltr" className="brutal-input" placeholder="https://…" value={quoteLink} onChange={(e) => setQuoteLink(e.target.value)} />
            </div>
          )}

          <ImageSlot
            id="worker-expense-image"
            label={type === "outdoor" ? "لقطة شاشة تطبيق النقل *" : "صورة عرض السعر"}
            hint={type === "outdoor" ? "يجب أن تظهر خط السير والبداية والنهاية والسعر" : "ارفع لقطة عرض السعر"}
            value={shot}
            onChange={setShot}
          />

          <button type="submit" id="worker-expense-submit" disabled={busy} className="w-full rounded-xl bg-red-600 py-3 text-sm font-bold text-white shadow-lg shadow-red-600/20 transition hover:bg-red-700 disabled:opacity-60 cursor-pointer">
            {busy ? "جارٍ الإرسال…" : type === "outdoor" ? "إرسال للمراجعة" : "طلب موافقة مسبقة"}
          </button>
        </form>

        <div className="ui-card p-6">
          <h3 className="mb-4 text-sm font-bold text-zinc-900 dark:text-white">طلباتي</h3>
          {loading ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-800" />)}</div>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-xs text-zinc-400">لا توجد طلبات بعد.</p>
          ) : (
            <ul className="space-y-2.5">
              {rows.map((r) => (
                <li key={r.id} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-zinc-900 dark:text-white">{r.type === "outdoor" ? "🚕" : "🛒"} {r.purpose}</p>
                      <p className="mt-0.5 text-[11px] text-zinc-500">
                        {r.type === "outdoor" && r.routeFrom ? `${r.routeFrom} ← ${r.routeTo} · ` : ""}
                        <span className="font-mono" dir="ltr">{r.date}</span>
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${STAGE_TONE[r.stage] ?? ""}`}>{REIMBURSEMENT_STAGE_AR[r.stage]}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-600 dark:text-zinc-400">
                    <span>المطلوب: <b>{egp(r.invoiceAmount ?? r.amount)}</b></span>
                    {r.approvedAmount != null && <span>المعتمد: <b className="text-emerald-700 dark:text-emerald-400">{egp(r.approvedAmount)}</b></span>}
                    {r.stage === "approved" && r.paidAmount != null && <span>المصروف: <b>{egp(r.paidAmount)}</b></span>}
                    {r.stage === "approved" && (
                      r.payoutMethod === "instant_transfer" ? (
                        <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300">
                          ⚡ تم التحويل فورياً (خارج المرتب)
                        </span>
                      ) : (
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                          📅 ينزل أول الشهر مع المرتب
                        </span>
                      )
                    )}
                  </div>
                  {r.adminNote && <p className="mt-2 rounded-lg bg-zinc-50 px-2.5 py-1.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">💬 {r.adminNote}</p>}
                  {r.stage === "pending_invoice" && (
                    <button type="button" id={`worker-expense-invoice-${r.id}`} onClick={() => setInvoiceFor(r)} className="mt-2.5 w-full rounded-lg border border-sky-300 bg-sky-50 py-2 text-xs font-bold text-sky-800 transition hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-300 cursor-pointer">
                      ارفع الفاتورة (حد الموافقة {egp(r.approvedAmount)})
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {invoiceFor && <InvoiceModal db={db} r={invoiceFor} onClose={() => setInvoiceFor(null)} />}
    </section>
  );
}

function InvoiceModal({ db, r, onClose }: { db: Firestore; r: WorkerReimbursement; onClose: () => void }) {
  const [img, setImg] = useState<CompressedImage | null>(null);
  const [amount, setAmount] = useState(String(r.approvedAmount ?? r.amount ?? ""));
  const [kind, setKind] = useState<"invoice" | "proforma">("invoice");
  const [busy, setBusy] = useState(false);
  const amt = Number(amount);
  const over = Number(r.approvedAmount) > 0 && amt > Number(r.approvedAmount);

  const send = async () => {
    if (!img) return toast.warning("ارفع صورة الفاتورة");
    if (!(amt > 0)) return toast.warning("أدخل قيمة الفاتورة");
    setBusy(true);
    try {
      await submitPurchaseInvoice(db, r, amt, [{ kind, image: img }]);
      toast.success("تم رفع الفاتورة للمراجعة");
      onClose();
    } catch (e) {
      console.error(e);
      toast.error("تعذر رفع الفاتورة");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-zinc-950/60 p-3 backdrop-blur-sm animate-fade-in sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()} dir="rtl">
      <div className="w-full max-w-md space-y-4 rounded-3xl border border-zinc-200 bg-white p-6 shadow-2xl animate-scale-in dark:border-zinc-700 dark:bg-zinc-900" role="dialog" aria-modal="true" id="worker-invoice-modal">
        <h3 className="text-base font-bold text-zinc-900 dark:text-white">رفع الفاتورة — {r.purpose}</h3>
        <div className="grid grid-cols-2 gap-2">
          {([
            ["invoice", "فاتورة نهائية"],
            ["proforma", "فاتورة مبدئية"],
          ] as const).map(([v, l]) => (
            <button key={v} type="button" onClick={() => setKind(v)} className={`rounded-xl border p-2 text-xs font-bold cursor-pointer ${kind === v ? "border-red-500 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300" : "border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"}`}>
              {l}
            </button>
          ))}
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-zinc-700 dark:text-zinc-300" htmlFor="worker-invoice-amount">قيمة الفاتورة</label>
          <input id="worker-invoice-amount" type="number" min={0} step="0.01" className="brutal-input" value={amount} onChange={(e) => setAmount(e.target.value)} />
          {over && <p className="mt-1 text-[11px] font-semibold text-red-600">القيمة تتجاوز المبلغ المعتمد مسبقًا ({egp(r.approvedAmount)}) — سيتم صرف المعتمد فقط ما لم توافق الإدارة على الفرق.</p>}
        </div>
        <ImageSlot id="worker-invoice-image" label="صورة الفاتورة *" hint="ارفع الفاتورة" value={img} onChange={setImg} />
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-zinc-200 py-2.5 text-sm font-semibold text-zinc-700 dark:border-zinc-700 dark:text-zinc-300 cursor-pointer">إلغاء</button>
          <button type="button" id="worker-invoice-submit" disabled={busy} onClick={() => void send()} className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60 cursor-pointer">
            {busy ? "جارٍ الرفع…" : "إرسال"}
          </button>
        </div>
      </div>
    </div>
  );
}
