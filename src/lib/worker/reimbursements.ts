/**
 * HR-POL-2026 clause 5 — worker reimbursement claims.
 *
 * Claim docs live in `reimbursements`; the heavy compressed images live in
 * `reimbursementAttachments` (one doc per image) so the claim list stays light.
 *   outdoor  → created directly in stage "review" (ride screenshot required)
 *   purchase → "pre_approval" (quote) → admin approves → "pending_invoice"
 *              → worker uploads invoice → "review" → admin approves → "approved"
 */
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import type { CompressedImage } from "./imageCompress";
import type { ReimbursementStage, ReimbursementType } from "./hrPolicy2026";

export type AttachmentKind = "ride_screenshot" | "quote" | "proforma" | "invoice";

export type ReimbursementPayoutMethod = "payroll" | "instant_transfer";

export type WorkerReimbursement = {
  id: string;
  workerId: string;
  type: ReimbursementType;
  stage: ReimbursementStage;
  purpose: string;
  date: string;
  routeFrom?: string;
  routeTo?: string;
  amount: number;
  quoteLink?: string | null;
  approvedAmount?: number | null;
  invoiceAmount?: number | null;
  paidAmount?: number | null;
  payoutMethod?: ReimbursementPayoutMethod;
  attachmentIds?: string[];
  attachmentKinds?: string[];
  imageHashes?: string[];
  adminNote?: string;
  createdAt?: { toDate: () => Date } | null;
};

type WorkerInfo = { uid: string; name: string; email?: string };

async function saveAttachments(
  db: Firestore,
  workerId: string,
  reimbursementId: string,
  items: { kind: AttachmentKind; image: CompressedImage }[],
): Promise<{ ids: string[]; kinds: string[]; hashes: string[] }> {
  const ids: string[] = [];
  const kinds: string[] = [];
  const hashes: string[] = [];
  for (const it of items) {
    const ref = await addDoc(collection(db, "reimbursementAttachments"), {
      reimbursementId,
      workerId,
      kind: it.kind,
      dataUrl: it.image.dataUrl,
      sha256: it.image.sha256,
      width: it.image.width,
      height: it.image.height,
      bytes: it.image.bytes,
      fileName: it.image.fileName,
      createdAt: serverTimestamp(),
    });
    ids.push(ref.id);
    kinds.push(it.kind);
    hashes.push(it.image.sha256);
  }
  return { ids, kinds, hashes };
}

export async function createReimbursement(
  db: Firestore,
  worker: WorkerInfo,
  data: {
    type: ReimbursementType;
    purpose: string;
    date: string;
    amount: number;
    routeFrom?: string;
    routeTo?: string;
    quoteLink?: string | null;
  },
  attachments: { kind: AttachmentKind; image: CompressedImage }[],
): Promise<string> {
  const ref = await addDoc(collection(db, "reimbursements"), {
    workerId: worker.uid,
    workerName: worker.name,
    workerEmail: worker.email ?? "",
    type: data.type,
    stage: data.type === "outdoor" ? "review" : "pre_approval",
    purpose: data.purpose.trim(),
    date: data.date,
    amount: data.amount,
    routeFrom: data.routeFrom?.trim() ?? "",
    routeTo: data.routeTo?.trim() ?? "",
    quoteLink: data.quoteLink?.trim() || null,
    approvedAmount: null,
    invoiceAmount: null,
    attachmentIds: [],
    attachmentKinds: [],
    imageHashes: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  if (attachments.length) {
    const saved = await saveAttachments(db, worker.uid, ref.id, attachments);
    await updateDoc(ref, { attachmentIds: saved.ids, attachmentKinds: saved.kinds, imageHashes: saved.hashes, updatedAt: serverTimestamp() });
  }

  import("./adminNotifications")
    .then(({ notifyAdmins }) =>
      notifyAdmins(db, {
        targetRoles: ["super_admin", "hr_admin"],
        category: "hr",
        eventType: "reimbursement_submitted",
        title: data.type === "outdoor" ? "🚕 New Outdoor Transport Claim" : "🛒 New Purchase Pre-Approval Request",
        body: `${worker.name} · ${data.amount} EGP — ${data.purpose.trim().slice(0, 80)}`,
        href: "/admin/reimbursements",
        actorUid: worker.uid,
        actorName: worker.name,
      }),
    )
    .catch(() => {});

  return ref.id;
}

/** Purchase stage 2: upload the proforma / final invoice after pre-approval. */
export async function submitPurchaseInvoice(
  db: Firestore,
  r: WorkerReimbursement,
  invoiceAmount: number,
  attachments: { kind: AttachmentKind; image: CompressedImage }[],
): Promise<void> {
  const saved = await saveAttachments(db, r.workerId, r.id, attachments);
  await updateDoc(doc(db, "reimbursements", r.id), {
    stage: "review",
    invoiceAmount,
    attachmentIds: [...(r.attachmentIds ?? []), ...saved.ids],
    attachmentKinds: [...(r.attachmentKinds ?? []), ...saved.kinds],
    imageHashes: [...(r.imageHashes ?? []), ...saved.hashes],
    invoiceSubmittedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  import("./adminNotifications")
    .then(({ notifyAdmins }) =>
      notifyAdmins(db, {
        targetRoles: ["super_admin", "hr_admin"],
        category: "hr",
        eventType: "reimbursement_invoice_uploaded",
        title: "🧾 Purchase Invoice Uploaded",
        body: `${r.purpose} · Invoice: ${invoiceAmount} EGP`,
        href: "/admin/reimbursements",
        actorUid: r.workerId,
      }),
    )
    .catch(() => {});
}

export function subscribeMyReimbursements(
  db: Firestore,
  workerId: string,
  onData: (rows: WorkerReimbursement[]) => void,
): () => void {
  return onSnapshot(
    query(collection(db, "reimbursements"), where("workerId", "==", workerId)),
    (snap) => {
      const rows: WorkerReimbursement[] = [];
      snap.forEach((d) => rows.push({ id: d.id, ...d.data() } as WorkerReimbursement));
      rows.sort((a, b) => (b.createdAt?.toDate?.()?.getTime() ?? Date.now()) - (a.createdAt?.toDate?.()?.getTime() ?? Date.now()));
      onData(rows);
    },
    (err) => {
      console.warn("[reimbursements] subscription failed:", err);
      onData([]);
    },
  );
}
