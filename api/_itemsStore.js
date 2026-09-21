/* ============================== Canonical Item store (server-only, Admin SDK) ==============================
 * Slice C. The server-side counterpart to src/data/itemsRepository.js's
 * client repository — reads/writes users/{uid}/items/{itemId} via the
 * Firebase Admin SDK (bypasses Firestore security rules entirely, same as
 * every other api/_*Store.js module), needed because api/calendar-publish.js
 * must load the Item and write its Calendar linkage fields server-side
 * (see that file's own doc comment — Google tokens and the insert call
 * itself must never happen client-side).
 *
 * Deliberately narrow: only what Slice C needs (read one Item, write
 * exactly its four googleCalendar* fields) — not a general-purpose
 * server-side Items CRUD module. "itemId alone cannot access another
 * user's Item" is a structural property of this module's own API, not an
 * extra check: every function takes uid and always reads/writes beneath
 * users/{uid}/items/..., where uid comes only from the caller's already-
 * verified Firebase token (see api/_auth.js) — there is no code path here
 * that accepts an itemId without a uid to scope it.
 */
import "./_auth.js"; // triggers Firebase Admin app initialization (side effect, shared singleton)
import { getFirestore } from "firebase-admin/firestore";

function defaultDb() {
  return getFirestore();
}

function itemRef(db, uid, itemId) {
  return db.collection("users").doc(uid).collection("items").doc(itemId);
}

export async function getItem(uid, itemId, { db = defaultDb() } = {}) {
  if (!uid || !itemId) return null;
  const snap = await itemRef(db, uid, itemId).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

/**
 * setItemGoogleCalendarFields — the ONE write this module performs for
 * Slice C, applied only after a successful Google Calendar insert (or a
 * recognized already-exists recovery) — see api/calendar-publish.js. Never
 * touches any other Item field.
 */
export async function setItemGoogleCalendarFields(uid, itemId, { googleCalendarEventId, googleCalendarId, googleCalendarSyncedAt, googleCalendarSyncError }, { db = defaultDb() } = {}) {
  await itemRef(db, uid, itemId).update({
    googleCalendarEventId,
    googleCalendarId,
    googleCalendarSyncedAt,
    googleCalendarSyncError,
  });
}
