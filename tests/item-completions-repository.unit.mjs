/**
 * Focused unit tests for src/data/itemCompletionsRepository.js
 * (recurring-obligations increment) — per-occurrence completion state for
 * recurring canonical Items.
 *
 * Precedent elsewhere in this suite (see gmail-approved-senders.unit.mjs's
 * header comment) has been to avoid unit-testing any src/data/*Repository.js
 * file that imports firebase/firestore, since most of those modules'
 * meaningful behavior lives behind a real Firestore call. This module is
 * different: its guest/local (`ctx.isAdmin`) path never touches Firestore
 * at all (confirmed: importing it in plain Node succeeds, since
 * firebase/firestore resolves fine as a library import — it's only an
 * actual network call, never attempted here, that would need a live
 * project), so its guest path — which mirrors the real path's exact
 * semantics — is fully testable here with a fake localStorage, same
 * pattern as parent-tools-preference.unit.mjs. The real (non-guest)
 * Firestore path is NOT exercised here, consistent with precedent.
 *
 * Usage: node tests/item-completions-repository.unit.mjs
 */
import { completionIdFor, subscribeItemCompletions, getItemCompletion, setItemCompletion } from "../src/data/itemCompletionsRepository.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

// ============ completionIdFor: deterministic + collision-proof ============
ok("Same (itemId, occurrenceDate) always produces the same id", completionIdFor("item-1", "2026-09-21") === completionIdFor("item-1", "2026-09-21"));
ok("Different occurrenceDate produces a different id", completionIdFor("item-1", "2026-09-21") !== completionIdFor("item-1", "2026-09-22"));
ok("Different itemId produces a different id", completionIdFor("item-1", "2026-09-21") !== completionIdFor("item-2", "2026-09-21"));
ok(
  "An itemId containing ':' never collides with a boundary-shifted equivalent (encodeURIComponent escapes ':' inside itemId)",
  completionIdFor("a:b", "c") !== completionIdFor("a", "b:c")
);
ok(
  "An itemId containing '_' is handled safely (id scheme never assumed to be '_'-free)",
  completionIdFor("item_with_underscores", "2026-09-21") === `${encodeURIComponent("item_with_underscores")}:2026-09-21`
);
ok("The id never contains a literal '/' (Firestore forbids it in a doc id)", !completionIdFor("weird/item:id", "2026-09-21").includes("/"));
ok("A guest local-id ('local-<ts>-<seq>') round-trips through the scheme unchanged (no special chars to escape)", completionIdFor("local-123-4", "2026-09-21") === "local-123-4:2026-09-21");

// ============ Guest/local path (ctx.isAdmin: true) ============
{
  const store = new Map();
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  const ctx = { uid: "guest-local", isAdmin: true };

  let delivered = null;
  const unsub = subscribeItemCompletions(ctx, (completions) => { delivered = completions; });
  ok("subscribeItemCompletions delivers an initial empty array before anything is set", Array.isArray(delivered) && delivered.length === 0);

  const written = await setItemCompletion(ctx, { itemId: "item-1", occurrenceDate: "2026-09-19", completed: true });
  ok("setItemCompletion returns the written record", written.itemId === "item-1" && written.occurrenceDate === "2026-09-19" && written.completed === true);
  ok("Checking sets completedAt to a non-null value", written.completedAt !== null && written.completedAt !== undefined);
  ok("The subscriber is notified synchronously after a guest write", Array.isArray(delivered) && delivered.length === 1 && delivered[0].completed === true);

  const fetched = await getItemCompletion(ctx, "item-1", "2026-09-19");
  ok("getItemCompletion reads back exactly what was written", fetched && fetched.completed === true && fetched.itemId === "item-1");

  // Idempotent upsert — writing the SAME (itemId, occurrenceDate) again must
  // update the existing document, never create a second one.
  await setItemCompletion(ctx, { itemId: "item-1", occurrenceDate: "2026-09-19", completed: true });
  ok("Re-writing the same occurrence with the same state never creates a second document", delivered.length === 1);

  // Unchecking — must set completed:false and completedAt:null, never
  // delete the document (current-state record, not an audit log).
  const unchecked = await setItemCompletion(ctx, { itemId: "item-1", occurrenceDate: "2026-09-19", completed: false });
  ok("Unchecking sets completed to false", unchecked.completed === false);
  ok("Unchecking sets completedAt back to null", unchecked.completedAt === null);
  ok("Unchecking still uses the SAME document id — no second/duplicate record", delivered.length === 1);

  // A different occurrence of the SAME item is a genuinely separate document.
  await setItemCompletion(ctx, { itemId: "item-1", occurrenceDate: "2026-09-20", completed: true });
  ok("A different occurrenceDate for the same item creates a second, independent document", delivered.length === 2);
  const stillYesterday = await getItemCompletion(ctx, "item-1", "2026-09-19");
  ok("Writing a new occurrence never mutates a previously-written occurrence's state", stillYesterday.completed === false);

  // A completely different item never collides.
  await setItemCompletion(ctx, { itemId: "item-2", occurrenceDate: "2026-09-19", completed: true });
  ok("A different item on the same date is a fully independent document", delivered.length === 3);

  // Missing required args throw rather than silently writing a malformed doc.
  let threw = false;
  try { await setItemCompletion(ctx, { itemId: null, occurrenceDate: "2026-09-19", completed: true }); } catch { threw = true; }
  ok("setItemCompletion throws (does not silently write) when itemId is missing", threw);

  ok("getItemCompletion returns null for an occurrence nobody has ever touched", (await getItemCompletion(ctx, "item-999", "2026-09-19")) === null);

  unsub();
  delete global.localStorage;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
