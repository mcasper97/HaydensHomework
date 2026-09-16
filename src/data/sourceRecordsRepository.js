/* ============================== SourceRecord Repository ==============================
 * Provenance foundation only — lightweight records answering "where did this
 * information come from?" (manual entry, CSV import, and future
 * document/image/email/website capture types). This module does NOT do any
 * AI ingestion, review/reconciliation, or confidence scoring; it just stores
 * a record of a capture event that canonical items can optionally reference
 * via item.sourceRecordId.
 *
 * Lives at users/{uid}/sourceRecords/{sourceRecordId} in Firestore — covered
 * by the existing users/{uid}/{document=**} rule, no rules change needed.
 * Mirrors itemsRepository.js's exact ctx = { uid, isAdmin } branching, guest
 * localStorage fallback, and listener-notification pattern.
 */
import { collection, doc, addDoc, updateDoc, getDoc, getDocs, serverTimestamp } from "firebase/firestore";
import { db } from "../Firebase.js";

const GUEST_SOURCE_RECORDS_KEY = "crestly_admin_source_records";

function readGuestSourceRecords() {
  try {
    const raw = localStorage.getItem(GUEST_SOURCE_RECORDS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeGuestSourceRecords(records) {
  try {
    localStorage.setItem(GUEST_SOURCE_RECORDS_KEY, JSON.stringify(records));
  } catch {
    // ignore — same best-effort behavior as the rest of the guest/local path
  }
}

let guestIdSeq = 0;
function genGuestId() {
  guestIdSeq += 1;
  return `local-src-${Date.now().toString(36)}-${guestIdSeq}`;
}

function sourceRecordsCollection(uid) {
  return collection(db, "users", uid, "sourceRecords");
}

const EMPTY_DEFAULTS = {
  sourceType: "manual",
  title: null,
  mimeType: null,
  processingStatus: "captured",
  createdByUid: null,
  // Generic bag for future type-specific detail (sourceUrl, sender,
  // externalId, contentHash, originalFileReference, receivedAt, ...) —
  // deliberately not pre-declared as top-level fields until a real capture
  // type needs them, per "use the smallest schema."
  metadata: {},
};

export async function createSourceRecord(ctx, data) {
  const payload = { ...EMPTY_DEFAULTS, ...data };

  if (ctx?.isAdmin) {
    const now = new Date().toISOString();
    const record = { id: genGuestId(), ...payload, capturedAt: now, updatedAt: now };
    const records = readGuestSourceRecords();
    records.push(record);
    writeGuestSourceRecords(records);
    return record;
  }

  if (!db || !ctx?.uid) throw new Error("No signed-in account to save to.");
  const ref = await addDoc(sourceRecordsCollection(ctx.uid), {
    ...payload,
    capturedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { id: ref.id, ...payload };
}

export async function getSourceRecord(ctx, sourceRecordId) {
  if (!sourceRecordId) return null;

  if (ctx?.isAdmin) {
    return readGuestSourceRecords().find((r) => r.id === sourceRecordId) || null;
  }

  if (!db || !ctx?.uid) return null;
  const snap = await getDoc(doc(db, "users", ctx.uid, "sourceRecords", sourceRecordId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function listSourceRecords(ctx) {
  if (ctx?.isAdmin) return readGuestSourceRecords();
  if (!db || !ctx?.uid) return [];
  const snap = await getDocs(sourceRecordsCollection(ctx.uid));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function updateSourceRecord(ctx, sourceRecordId, patch) {
  if (ctx?.isAdmin) {
    const records = readGuestSourceRecords().map((r) =>
      r.id === sourceRecordId ? { ...r, ...patch, updatedAt: new Date().toISOString() } : r
    );
    writeGuestSourceRecords(records);
    return;
  }
  if (!db || !ctx?.uid) return;
  await updateDoc(doc(db, "users", ctx.uid, "sourceRecords", sourceRecordId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}
