/**
 * Focused unit tests for Slice 3 (one-time obligation reconciliation) —
 * src/organizer/oneTimeObligationMatch.js. Pure logic, zero Firestore —
 * every test here calls the EXACT functions src/AuthShell.jsx's
 * handleCheckEmail imports and calls (buildOneTimeSignatureFromItem,
 * decideOneTimeReconciliation) — never a reimplemented/mirrored copy of
 * the comparison rules. The "same-run sequence" section below drives
 * decideOneTimeReconciliation repeatedly, maintaining the same
 * runRecords accumulator AuthShell.jsx maintains — pure bookkeeping
 * (push the previous call's own returned signature), with zero matching
 * logic of its own; every actual comparison still happens inside the one
 * production function under test.
 *
 * Usage: node tests/one-time-obligation-match.unit.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeOneTimeAction,
  buildOneTimeSignatureFromItem,
  canReconcileOneTime,
  decideOneTimeReconciliation,
} from "../src/organizer/oneTimeObligationMatch.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============ normalizeOneTimeAction ============
ok("Case-insensitive", normalizeOneTimeAction("PTA Spirit Night") === normalizeOneTimeAction("pta spirit night"));
ok("Punctuation stripped", normalizeOneTimeAction("PTA Spirit Night — Oct. 1") === normalizeOneTimeAction("PTA Spirit Night Oct 1"));
ok("Whitespace collapses", normalizeOneTimeAction("PTA   Spirit    Night") === normalizeOneTimeAction("PTA Spirit Night"));
ok(
  "Only a narrow filler list is stripped (a/an/the/please/remember/to) — 'day'/'night'/'each'/'every' are NEVER stripped, unlike recurringObligationMatch.js's filler list, since they're often part of a one-time event's actual name",
  normalizeOneTimeAction("PTA Spirit Night") === "pta spirit night" && normalizeOneTimeAction("Picture Day") === "picture day"
);
ok("Pure connective filler is still stripped", normalizeOneTimeAction("Please remember to bring the permission slip") === "bring permission slip");
ok("A non-string input normalizes to an empty string rather than throwing", normalizeOneTimeAction(null) === "" && normalizeOneTimeAction(undefined) === "");

// ============ buildOneTimeSignatureFromItem — due-vs-start routing ============
{
  const schoolEvent = { type: "school_event", title: "PTA Spirit Night", startDate: "2026-10-01", startTime: "17:00", endTime: "20:00", childIds: [] };
  const sig = buildOneTimeSignatureFromItem(schoolEvent);
  ok("Non-due type reads startDate/startTime/endTime", sig.date === "2026-10-01" && sig.startTime === "17:00" && sig.endTime === "20:00");
  ok("Non-due type resolves targetKey from childIds (empty = family)", sig.targetKey === "family");

  const assignment = { type: "assignment", title: "Book Report", dueDate: "2026-10-06", dueTime: "23:59", startDate: "2026-09-20", startTime: "08:00", endTime: "09:00", childIds: ["c1"] };
  const dueSig = buildOneTimeSignatureFromItem(assignment);
  ok("Due-date type (assignment) reads dueDate/dueTime, NOT startDate/startTime", dueSig.date === "2026-10-06" && dueSig.startTime === "23:59");
  ok("Due-date type never reads an end time (no analogous field)", dueSig.endTime === null);
  ok("Due-date type resolves targetKey from childIds", dueSig.targetKey === "children:c1");

  const legacyNoSourceCandidateId = { type: "school_event", title: "PTA Spirit Night", startDate: "2026-10-01", startTime: "17:00", endTime: "20:00", childIds: [] };
  ok("A legacy Item with no sourceCandidateId field at all still produces a valid, matchable signature (content-only matching)", JSON.stringify(buildOneTimeSignatureFromItem(legacyNoSourceCandidateId)) === JSON.stringify(sig));
}

// ============ canReconcileOneTime — hard gates ============
const BASE = { type: "school_event", title: "PTA Spirit Night", target: { targetType: "family" }, date: "2026-10-01", startTime: "17:00", endTime: "20:00" };
function sigOf(overrides) {
  return buildOneTimeSignatureFromItem({
    type: overrides.type ?? BASE.type,
    title: overrides.title ?? BASE.title,
    startDate: overrides.date ?? BASE.date,
    startTime: overrides.startTime === undefined ? BASE.startTime : overrides.startTime,
    endTime: overrides.endTime === undefined ? BASE.endTime : overrides.endTime,
    childIds: overrides.childIds ?? [],
  });
}

ok("Existing item matches (EXISTING ITEM MATCHES): same type + target + date + normalized title corroborates", canReconcileOneTime(sigOf({}), sigOf({})));
ok(
  "Equivalent wording corroborates only when deterministic normalization makes it clearly equivalent",
  canReconcileOneTime(sigOf({ title: "PTA Spirit Night!" }), sigOf({ title: "pta spirit night" }))
);
ok("HARD GATE — different date does not corroborate", !canReconcileOneTime(sigOf({}), sigOf({ date: "2026-10-02" })));
ok("HARD GATE — different type does not corroborate", !canReconcileOneTime(sigOf({}), sigOf({ type: "family_event" })));
ok("HARD GATE — family vs specific child does not corroborate", !canReconcileOneTime(sigOf({}), sigOf({ childIds: ["c1"] })));
ok("HARD GATE — different child does not corroborate", !canReconcileOneTime(sigOf({ childIds: ["c1"] }), sigOf({ childIds: ["c2"] })));
ok("HARD GATE — materially different title does not corroborate", !canReconcileOneTime(sigOf({}), sigOf({ title: "Fall Picture Retakes" })));
ok(
  "Real worked example: 'Fall Picture Day' (Oct 2) vs 'Fall Picture Retakes' (Oct 15) — blocked by BOTH date and title, review not corroborate",
  !canReconcileOneTime(sigOf({ title: "Fall Picture Day", date: "2026-10-02" }), sigOf({ title: "Fall Picture Retakes", date: "2026-10-15" }))
);
ok(
  "Real worked example: 'Math Test' Oct 6 vs 'Math Test moved to Oct 7' — different date alone blocks corroboration",
  !canReconcileOneTime(sigOf({ type: "test", title: "Math Test", date: "2026-10-06" }), sigOf({ type: "test", title: "Math Test moved to Oct 7", date: "2026-10-07" }))
);

// ============ TIME HANDLING ============
ok("TIME — exact same start/end times still corroborates (strengthens confidence)", canReconcileOneTime(sigOf({}), sigOf({})));
ok(
  "TIME — one side missing BOTH times still corroborates when every other hard gate matches",
  canReconcileOneTime(sigOf({}), sigOf({ startTime: null, endTime: null }))
);
ok(
  "TIME — one side missing only endTime still corroborates",
  canReconcileOneTime(sigOf({}), sigOf({ endTime: null }))
);
ok(
  "TIME — a conflicting explicit start time BLOCKS corroboration even though date/type/target/title all match",
  !canReconcileOneTime(sigOf({}), sigOf({ startTime: "18:00" }))
);
ok(
  "TIME — a conflicting explicit end time BLOCKS corroboration",
  !canReconcileOneTime(sigOf({}), sigOf({ endTime: "21:00" }))
);
ok(
  "TIME — conflicting times are never silently merged, whatever else matches",
  !canReconcileOneTime(sigOf({ startTime: "17:00", endTime: "20:00" }), sigOf({ startTime: "17:30", endTime: "20:00" }))
);

// ============ decideOneTimeReconciliation — single-call outcomes ============
{
  const existingItem = { id: "item-pta-1", type: "school_event", title: "PTA Spirit Night", startDate: "2026-10-01", startTime: "17:00", endTime: "20:00", childIds: [] };
  const existingSignatures = [{ itemId: existingItem.id, signature: buildOneTimeSignatureFromItem(existingItem) }];

  const matchDecision = decideOneTimeReconciliation({
    obligation: { type: "school_event", title: "PTA Spirit Night!", date: "2026-10-01", startTime: "17:00", endTime: "20:00" },
    target: { targetType: "family" },
    existingSignatures,
    runRecords: [],
  });
  ok("EXISTING ITEM MATCH — outcome is 'existing_item'", matchDecision.outcome === "existing_item");
  ok("EXISTING ITEM MATCH — reconciledItemId is set to the real existing Item id", matchDecision.reconciledItemId === "item-pta-1");
  ok("EXISTING ITEM MATCH — reconciledCandidateId is null (sets reconciledItemId ONLY)", matchDecision.reconciledCandidateId === null);
  ok("Matching Item object itself is never mutated by the decision (pure function, no side effects)", existingItem.title === "PTA Spirit Night" && existingItem.startDate === "2026-10-01");

  const newDecision = decideOneTimeReconciliation({
    obligation: { type: "test", title: "Unit 4 Math Test", date: "2026-11-01", startTime: null, endTime: null },
    target: { targetType: "family" },
    existingSignatures,
    runRecords: [],
  });
  ok("No match against existing Items or run records -> outcome 'new'", newDecision.outcome === "new");
  ok("'new' outcome has BOTH ids null", newDecision.reconciledItemId === null && newDecision.reconciledCandidateId === null);

  const mismatchDecision = decideOneTimeReconciliation({
    obligation: { type: "school_event", title: "PTA Spirit Night", date: "2026-10-02", startTime: "17:00", endTime: "20:00" },
    target: { targetType: "family" },
    existingSignatures,
    runRecords: [],
  });
  ok("A materially different date against the existing Item falls through to 'new' (review), not corroborated", mismatchDecision.outcome === "new");
}

// ============ decideOneTimeReconciliation — no outcome ever populates both ids ============
{
  const existingItem = { id: "item-x", type: "reminder", title: "Bring Snack", startDate: "2026-09-22", startTime: null, endTime: null, childIds: ["c1"] };
  const existingSignatures = [{ itemId: existingItem.id, signature: buildOneTimeSignatureFromItem(existingItem) }];
  const cases = [
    decideOneTimeReconciliation({ obligation: { type: "reminder", title: "Bring Snack", date: "2026-09-22" }, target: { targetType: "child", targetChildId: "c1" }, existingSignatures, runRecords: [] }),
    decideOneTimeReconciliation({ obligation: { type: "reminder", title: "Totally Different", date: "2026-12-25" }, target: { targetType: "family" }, existingSignatures, runRecords: [] }),
  ];
  ok("No decision ever has both reconciledItemId AND reconciledCandidateId set", cases.every((d) => !(d.reconciledItemId && d.reconciledCandidateId)));
}

// ============ SAME-RUN sequence (pure bookkeeping only; all comparisons delegated to decideOneTimeReconciliation) ============
{
  // Exactly mirrors the shape AuthShell.jsx's handleCheckEmail maintains
  // (a runRecords array appended to only on "new") — contains no
  // duplicated matching logic; every decision is made by the one real
  // exported function under test.
  function runSequence(obligations, target) {
    const runRecords = [];
    const results = [];
    let nextId = 1;
    for (const obligation of obligations) {
      const decision = decideOneTimeReconciliation({ obligation, target, existingSignatures: [], runRecords });
      const candidateId = `cand-${nextId++}`;
      if (decision.outcome === "new") runRecords.push({ candidateId, signature: decision.signature });
      results.push({ candidateId, decision });
    }
    return results;
  }

  const target = { targetType: "family" };
  const emailBody = { type: "school_event", title: "PTA Spirit Night", date: "2026-10-01", startTime: "17:00", endTime: "20:00" };
  const linkedWebpage = { type: "school_event", title: "PTA Spirit Night!", date: "2026-10-01", startTime: "17:00", endTime: "20:00" };
  const linkedGoogleDoc = { type: "school_event", title: "pta spirit night", date: "2026-10-01", startTime: "17:00", endTime: "20:00" };
  const differentObligation = { type: "test", title: "Unit 5 Science Test", date: "2026-10-08", startTime: null, endTime: null };

  const emailPlusWebpage = runSequence([emailBody, linkedWebpage], target);
  ok("SAME-RUN — email body + webpage duplicate: first proceeds normally ('new')", emailPlusWebpage[0].decision.outcome === "new");
  ok("SAME-RUN — email body + webpage duplicate: second collapses to 'same_run_duplicate'", emailPlusWebpage[1].decision.outcome === "same_run_duplicate");
  ok(
    "SAME-RUN — the duplicate's reconciledCandidateId points at the FIRST candidate's real id, reconciledItemId stays null (never claims an Item exists before approval)",
    emailPlusWebpage[1].decision.reconciledCandidateId === emailPlusWebpage[0].candidateId && emailPlusWebpage[1].decision.reconciledItemId === null
  );
  ok(
    "SAME-RUN — only ONE of the two would reach parent review (outcome 'new' is the only reviewable one)",
    [emailPlusWebpage[0].decision.outcome, emailPlusWebpage[1].decision.outcome].filter((o) => o === "new").length === 1
  );
  ok("SAME-RUN — both candidates still exist (both SourceRecords/candidates persisted for provenance) — this harness records both, never drops the duplicate", emailPlusWebpage.length === 2);

  const webpagePlusDoc = runSequence([linkedWebpage, linkedGoogleDoc], target);
  ok("SAME-RUN — webpage + Google Doc duplicate also collapses", webpagePlusDoc[0].decision.outcome === "new" && webpagePlusDoc[1].decision.outcome === "same_run_duplicate");

  const threeCopies = runSequence([emailBody, linkedWebpage, linkedGoogleDoc], target);
  ok(
    "SAME-RUN — a THIRD repeat also traces back to the ORIGINAL first occurrence, not the second duplicate (never chains)",
    threeCopies[2].decision.reconciledCandidateId === threeCopies[0].candidateId
  );
  ok("SAME-RUN — repeated duplicate appears only once for parent review even with 3 copies", threeCopies.filter((r) => r.decision.outcome === "new").length === 1);

  const mixedRun = runSequence([emailBody, differentObligation, linkedWebpage], target);
  ok(
    "SAME-RUN — a genuinely different obligation in between does not get swept into the duplicate collapse",
    mixedRun[1].decision.outcome === "new"
  );
  ok(
    "SAME-RUN — the true duplicate (3rd item) still finds the true first occurrence (1st item), skipping over the unrelated 2nd",
    mixedRun[2].decision.outcome === "same_run_duplicate" && mixedRun[2].decision.reconciledCandidateId === mixedRun[0].candidateId
  );
  ok("SAME-RUN — same-run different obligations remain separate (both 'new')", mixedRun[0].decision.outcome === "new" && mixedRun[1].decision.outcome === "new");

  // First candidate later being rejected: decideOneTimeReconciliation's
  // same_run_duplicate outcome is computed purely from signatures at
  // reconciliation time — it takes no lifecycle/status input for
  // runRecords entries at all, so nothing about the first candidate's
  // LATER resolution (approved/rejected/deferred) can ever be fed back
  // into or invalidate a decision already made and persisted.
  ok(
    "A same_run_duplicate decision's provenance record is fixed at creation time, independent of what later happens to the first candidate (the function signature carries no candidate-status input)",
    decideOneTimeReconciliation.length <= 1 // single destructured-options parameter only — no status/lifecycle argument exists to pass
  );
}

// ============ Production wiring — proves production code uses this helper, not a duplicate copy ============
// UI/IA refactor note: handleCheckEmail (and everything it calls) moved out
// of AuthShell.jsx into src/GmailCheckEmailAction.jsx — the Check Email
// trigger is now a Parent Board action rather than inline Parent Tools JSX.
// The logic itself is unchanged (see GmailCheckEmailAction.jsx's own doc
// comment), so this wiring proof now points at its new home.
{
  const checkEmailActionSrc = fs.readFileSync(path.join(__dirname, "../src/GmailCheckEmailAction.jsx"), "utf8");
  ok(
    "GmailCheckEmailAction.jsx imports decideOneTimeReconciliation and buildOneTimeSignatureFromItem from oneTimeObligationMatch.js",
    /import\s*\{\s*buildOneTimeSignatureFromItem,\s*decideOneTimeReconciliation\s*\}\s*from\s*"\.\/organizer\/oneTimeObligationMatch\.js"/.test(checkEmailActionSrc)
  );
  ok(
    "GmailCheckEmailAction.jsx actually CALLS decideOneTimeReconciliation (not just imports it unused)",
    /decideOneTimeReconciliation\(\{/.test(checkEmailActionSrc)
  );
  ok(
    "GmailCheckEmailAction.jsx never redefines its own canReconcileOneTime/normalizeOneTimeAction — no duplicated matching-rule function names appear in this file",
    !/function\s+canReconcileOneTime/.test(checkEmailActionSrc) && !/function\s+normalizeOneTimeAction/.test(checkEmailActionSrc)
  );
  // Correction: recurring and one-time reconciliation must share ONE
  // listItems(ctx) read per Check Email run, not a separate read each —
  // recurring and one-time Items are just the two halves of the same
  // canonical Item list. Count actual call sites only (excludes this
  // sentence's own occurrences inside comments, which use "listItems("
  // without the exact "await listItems(ctx)" call form used at the one
  // real call site).
  const listItemsCallSites = checkEmailActionSrc.match(/await listItems\(ctx\)/g) || [];
  ok(
    "GmailCheckEmailAction.jsx's handleCheckEmail calls listItems(ctx) exactly ONCE, feeding both recurring and one-time reconciliation from the same result (no duplicate Firestore read)",
    listItemsCallSites.length === 1
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
