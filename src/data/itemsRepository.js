/* ============================== Canonical Item Repository ==============================
 * The single place that knows the canonical item model lives at
 * users/{uid}/items/{itemId} in Firestore (rules-covered by the existing
 * `users/{uid}/{document=**}` rule — no rules change needed). Every UI
 * component (ParentOrganizer, OrganizerCalendar, ItemForm, ChildTodayView,
 * App.jsx) goes through this module instead of importing Firestore directly,
 * so a future household-level storage model can replace the internals here
 * without touching any component.
 *
 * ctx = { uid, isAdmin } — the same shape FamilyBoard.jsx already uses.
 * isAdmin means "local-only guest/demo profile" (see AuthShell.jsx's
 * GUEST_USER) — not a privilege level — and routes storage to localStorage
 * instead of Firestore, mirroring FamilyBoard's existing admin bypass.
 */
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  getDoc,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../Firebase.js";

const GUEST_ITEMS_KEY = "crestly_admin_items";

// Exported (Slice 2) so candidateCommitRepository.js's guest-mode branch can
// compose its own "insert item at a specific id if missing" logic without a
// new parameter on createItem() below — createItem() itself is unchanged.
export function readGuestItems() {
  try {
    const raw = localStorage.getItem(GUEST_ITEMS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeGuestItems(items) {
  try {
    localStorage.setItem(GUEST_ITEMS_KEY, JSON.stringify(items));
  } catch {
    // ignore — same best-effort behavior as the rest of the guest/local path
  }
}

// Guest storage has no live Firestore-style listener, so subscribers are
// notified manually whenever a guest write happens (create/update/delete).
const guestListeners = new Set();
export function notifyGuestListeners() {
  const items = readGuestItems();
  guestListeners.forEach((cb) => cb(items));
}

let guestIdSeq = 0;
function genGuestId() {
  guestIdSeq += 1;
  return `local-${Date.now().toString(36)}-${guestIdSeq}`;
}

function itemsCollection(uid) {
  return collection(db, "users", uid, "items");
}

// Exported (Slice 2) so candidateCommitRepository.js can build an Item
// payload with the exact same defaults createItem() applies, without
// duplicating this object or importing createItem() itself.
export const EMPTY_DEFAULTS = {
  childIds: [],
  subject: null,
  courseId: null,
  startDate: null,
  startTime: null,
  dueDate: null,
  dueTime: null,
  endDate: null,
  endTime: null,
  allDay: true,
  status: "open",
  notes: "",
  parentItemId: null,
  studyMaterialIds: [],
  source: { type: "manual", sourceId: null },
  // Domain-hardening additions — all optional, all default to "not set"
  // (null, matching the rest of this object's convention) rather than a
  // falsy-but-meaningful value, so absence is always distinguishable from an
  // explicit value. Existing documents predating these fields simply lack
  // these keys; every reader treats undefined the same as null.
  academicTopic: null,
  academicUnit: null,
  preparationRequired: null,
  location: null,
  priority: null,
  // SourceRecord provenance foundation — optional reference to a
  // users/{uid}/sourceRecords/{id} document describing how this item was
  // captured. item.source stays as-is (kept for backward compatibility);
  // sourceRecordId is purely additive and defaults to null/absent for every
  // pre-existing item.
  sourceRecordId: null,
  // Recurring reminders — optional, additive. null/absent means exactly
  // today's existing one-time behavior (startDate/dueDate as a single
  // occurrence), completely unchanged. When present, shape is
  // { recurring: true, weekdays: [0-6,...], timeMode: "daypart"|"exact"|null,
  // daypart: "morning"|"evening"|null, time: "HH:MM"|null, active: true } —
  // see src/organizer/itemBuckets.js's normalizeSchedule/isRecurringDueOn,
  // the single place this shape is validated/evaluated. The item's own
  // existing startDate field doubles as the recurrence's effective start
  // boundary (see isRecurringDueOn) — no new date field was added for this.
  schedule: null,
  // Google Calendar publishing (Slice C) — optional, additive. All four
  // default to null/absent for every pre-existing item and stay that way
  // until a parent explicitly publishes this Item (see
  // src/organizer/ParentOrganizer.jsx's "Add to Google Calendar" control
  // and api/calendar-publish.js, the only place any of these are ever
  // written — never here, never through a generic updateItem() call).
  // googleCalendarEventId is the deterministic id derived from this
  // Item's own Firestore id (see api/_googleCalendarClient.js's
  // deriveGoogleEventId) — its presence is what "published" means.
  googleCalendarEventId: null,
  // Which calendar the event lives in — Slice C always uses "primary";
  // stored explicitly rather than assumed, for auditability and so a
  // future multi-calendar phase doesn't need a schema migration.
  googleCalendarId: null,
  // ISO timestamp of the last successful publish (create in Slice C;
  // create-or-update from Slice D onward).
  googleCalendarSyncedAt: null,
  // Set only when a publish/sync attempt failed AFTER the Item already
  // had a meaningful linkage to react to (Slice C's own create failures
  // leave this untouched — see api/calendar-publish.js's own doc
  // comment); reserved primarily for Slice D's re-sync flow.
  googleCalendarSyncError: null,
};

/**
 * subscribeItems(ctx, filter, onChange) -> unsubscribe
 * filter.childId (optional) — when given, only items whose childIds includes
 * it are delivered. Filtering happens client-side: a family's item count is
 * small, and this avoids needing a fresh composite index for every
 * childId/type/date combination a view might ask for.
 */
export function subscribeItems(ctx, filter, onChange) {
  const applyFilter = (items) => {
    if (!filter?.childId) return items;
    return items.filter((it) => Array.isArray(it.childIds) && it.childIds.includes(filter.childId));
  };

  if (ctx?.isAdmin) {
    const listener = (items) => onChange(applyFilter(items));
    guestListeners.add(listener);
    listener(readGuestItems());
    return () => guestListeners.delete(listener);
  }

  if (!db || !ctx?.uid) {
    onChange([]);
    return () => {};
  }

  const unsub = onSnapshot(
    itemsCollection(ctx.uid),
    (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      onChange(applyFilter(items));
    },
    (err) => {
      console.error("itemsRepository: subscribeItems failed", err);
      onChange([]);
    }
  );
  return unsub;
}

/** One-shot fetch — for CSV-import dedup and the family-event migration. */
export async function listItems(ctx) {
  if (ctx?.isAdmin) return readGuestItems();
  if (!db || !ctx?.uid) return [];
  const snap = await getDocs(itemsCollection(ctx.uid));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * getItem(ctx, itemId) -> item | null (Slice 2)
 * Read-only single-item fetch — used by candidateCommitRepository.js's
 * guest-mode branch to check "does items/{candidateId} already exist"
 * without a transaction (Firestore's real path checks this itself, inside
 * its own runTransaction, and does not call this).
 */
export async function getItem(ctx, itemId) {
  if (!itemId) return null;
  if (ctx?.isAdmin) {
    return readGuestItems().find((it) => it.id === itemId) || null;
  }
  if (!db || !ctx?.uid) return null;
  const snap = await getDoc(doc(db, "users", ctx.uid, "items", itemId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function createItem(ctx, data) {
  const payload = { ...EMPTY_DEFAULTS, ...data };

  if (ctx?.isAdmin) {
    const now = new Date().toISOString();
    const item = { id: genGuestId(), ...payload, createdAt: now, updatedAt: now };
    const items = readGuestItems();
    items.push(item);
    writeGuestItems(items);
    notifyGuestListeners();
    return item;
  }

  if (!db || !ctx?.uid) throw new Error("No signed-in account to save to.");
  const ref = await addDoc(itemsCollection(ctx.uid), {
    ...payload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { id: ref.id, ...payload };
}

export async function updateItem(ctx, itemId, patch) {
  if (ctx?.isAdmin) {
    const items = readGuestItems().map((it) =>
      it.id === itemId ? { ...it, ...patch, updatedAt: new Date().toISOString() } : it
    );
    writeGuestItems(items);
    notifyGuestListeners();
    return;
  }
  if (!db || !ctx?.uid) return;
  await updateDoc(doc(db, "users", ctx.uid, "items", itemId), { ...patch, updatedAt: serverTimestamp() });
}

export async function setItemStatus(ctx, itemId, status) {
  return updateItem(ctx, itemId, { status });
}

export async function deleteItem(ctx, itemId) {
  if (ctx?.isAdmin) {
    writeGuestItems(readGuestItems().filter((it) => it.id !== itemId));
    notifyGuestListeners();
    return;
  }
  if (!db || !ctx?.uid) return;
  await deleteDoc(doc(db, "users", ctx.uid, "items", itemId));
}

/**
 * Idempotent, additive migration of legacy users/{uid}.familyEvents entries
 * into canonical family_event items. Each created item is tagged
 * source = { type: "legacy_family_event", sourceId: <legacy event's own id> }
 * so re-running this (e.g. on every FamilyBoard mount, or a retried/failed
 * previous run) can tell which legacy events already have a canonical item
 * and never creates a duplicate. The legacy familyEvents array itself is
 * never read-modified or deleted here — callers keep it in place.
 *
 * Callers should also gate this behind a coarse one-time flag (see
 * FamilyBoard.jsx's migrated_familyEvents_v1 on users/{uid}) to avoid
 * re-scanning on every mount once migration has completed; the per-item
 * sourceId check here is the correctness guarantee against duplicates,
 * the flag is just an optimization to skip the scan.
 */
export async function migrateLegacyFamilyEvents(ctx, legacyFamilyEvents) {
  if (!Array.isArray(legacyFamilyEvents) || legacyFamilyEvents.length === 0) {
    return { migrated: 0 };
  }

  const existing = await listItems(ctx);
  const alreadyMigrated = new Set(
    existing
      .filter((it) => it.type === "family_event" && it.source?.type === "legacy_family_event")
      .map((it) => it.source.sourceId)
  );

  let migrated = 0;
  for (const ev of legacyFamilyEvents) {
    if (!ev?.id || alreadyMigrated.has(ev.id)) continue;
    await createItem(ctx, {
      type: "family_event",
      title: ev.title || "Family Event",
      childIds: [],
      startDate: ev.date || null,
      allDay: true,
      notes: ev.note || "",
      status: "open",
      source: { type: "legacy_family_event", sourceId: ev.id },
    });
    migrated += 1;
  }
  return { migrated };
}
