/**
 * Pure unit tests for src/organizer/candidateToDraftItem.js — the adapter
 * that shapes an IngestionCandidate as an ItemForm `existingItem`. Kept as
 * a plain-JS module (no JSX/React) specifically so it can be unit-tested
 * directly in Node.
 *
 * Usage: node tests/candidate-to-draft-item.unit.mjs
 */
import { candidateToDraftItem } from "../src/organizer/candidateToDraftItem.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

const child = { id: "child-1", name: "Ava", emoji: "🦁" };

// ============ Due-date types (assignment/project/study_task) map date -> dueDate ============
for (const type of ["assignment", "project", "study_task"]) {
  const draft = candidateToDraftItem({ proposedType: type, title: "X", date: "2026-10-01" }, child);
  ok(`${type}: date maps to dueDate, not startDate`, draft.dueDate === "2026-10-01" && draft.startDate === null);
}

// ============ Non-due-date types map date -> startDate ============
for (const type of ["test", "quiz", "school_event", "family_event", "reminder"]) {
  const draft = candidateToDraftItem({ proposedType: type, title: "X", date: "2026-10-01" }, child);
  ok(`${type}: date maps to startDate, not dueDate`, draft.startDate === "2026-10-01" && draft.dueDate === null);
}

// ============ Child pre-selection: the single in-scope child is always
// pre-selected regardless of the AI's proposedChildName guess — there is
// only ever 0 or 1 child passed in (the one whose Parents Page is open),
// so this is a context default, not the AI silently assigning a child.
// Bug fix regression coverage: previously this only pre-selected on an
// exact proposedChildName match, which left the submit button genuinely
// disabled (ItemForm's `existingItem.childIds || fallback` never falls
// back for an explicit `[]`, since `[]` is truthy in JS) whenever the
// AI's guess didn't match — the common case for most real documents. ============
{
  const draft = candidateToDraftItem({ proposedType: "test", title: "X", proposedChildName: "Ava" }, child);
  ok("Matching proposedChildName: child is pre-selected", draft.childIds.length === 1 && draft.childIds[0] === "child-1");
}
{
  const draft = candidateToDraftItem({ proposedType: "test", title: "X", proposedChildName: "Ben" }, child);
  ok("Mismatched proposedChildName: the in-scope child is still pre-selected (only slot this screen offers)", draft.childIds.length === 1 && draft.childIds[0] === "child-1");
}
{
  const draft = candidateToDraftItem({ proposedType: "test", title: "X", proposedChildName: null }, child);
  ok("No proposedChildName at all: the in-scope child is still pre-selected", draft.childIds.length === 1 && draft.childIds[0] === "child-1");
}
{
  const draft = candidateToDraftItem({ proposedType: "test", title: "X", proposedChildName: "Ava" }, null);
  ok("No child in scope at all: never throws, selection stays empty (nothing to pre-select)", draft.childIds.length === 0);
}

// ============ Configured sender target (#26, Commit 5 — email ingestion) takes
// precedence over the single-in-scope-child case, and is never overridden by
// the AI's own proposedChildName guess. ============
{
  const draft = candidateToDraftItem(
    { proposedType: "test", title: "X", proposedChildName: "Someone Else Entirely", targetType: "child", targetChildId: "hayden-1" },
    child // an ambient "in scope" child is present too — the configured target must win
  );
  ok("targetType child: pre-selects the CONFIGURED child, ignoring the AI's proposedChildName guess", draft.childIds.length === 1 && draft.childIds[0] === "hayden-1");
  ok("targetType child: does NOT fall back to the ambient in-scope child when a target is configured", draft.childIds[0] !== "child-1");
}
{
  const draft = candidateToDraftItem({ proposedType: "school_event", title: "X", targetType: "family", targetChildId: null }, child);
  ok("targetType family: childIds is empty — the app's existing household-wide convention, no Item model change", draft.childIds.length === 0);
}
{
  const draft = candidateToDraftItem({ proposedType: "reminder", title: "X", targetType: "review", targetChildId: null }, child);
  ok("targetType review: childIds is left empty for the parent to resolve during review", draft.childIds.length === 0);
}
{
  // A candidate predating Commit 5 (photo/CSV ingestion) has no targetType
  // at all — behavior must be identical to before this field existed.
  const draft = candidateToDraftItem({ proposedType: "test", title: "X" }, child);
  ok("No targetType at all (legacy/photo/CSV candidate): falls back to the ambient in-scope child, unchanged", draft.childIds.length === 1 && draft.childIds[0] === "child-1");
}
{
  const draft = candidateToDraftItem({ proposedType: "test", title: "X", targetType: "child", targetChildId: null }, child);
  ok("targetType child with no targetChildId (shouldn't happen, but fails safe): falls through rather than assigning nothing meaningful", draft.childIds.length === 1 && draft.childIds[0] === "child-1");
}

// ============ Field passthrough ============
{
  const draft = candidateToDraftItem(
    {
      proposedType: "test",
      title: "Math Test",
      subject: "Math",
      academicTopic: "Fractions",
      academicUnit: "Unit 3",
      preparationRequired: true,
      description: "Study pages 12-15",
    },
    child
  );
  ok("title passes through", draft.title === "Math Test");
  ok("subject passes through", draft.subject === "Math");
  ok("academicTopic passes through", draft.academicTopic === "Fractions");
  ok("academicUnit passes through", draft.academicUnit === "Unit 3");
  ok("preparationRequired passes through", draft.preparationRequired === true);
  ok("description maps to notes", draft.notes === "Study pages 12-15");
}

// ============ Missing optional fields default sanely, never throw ============
{
  const draft = candidateToDraftItem({ proposedType: "reminder", title: "Bring lunch money" }, child);
  ok("Missing subject defaults to null", draft.subject === null);
  ok("Missing description defaults to empty notes string (matches ItemForm's own default)", draft.notes === "");
  ok("Missing date defaults to null on the relevant date field", draft.startDate === null);
}

// ============ No source/provenance metadata leaks into the canonical Item draft
// (#26, Commit 5 live-validation fix — the review UI's new "Source" section is
// read directly from SourceRecord provenance; candidateToDraftItem.js's output
// is exactly what becomes the Item, so it must never carry sender/subject/page
// fields, even though the candidate it was given may itself have them). ============
{
  // NOTE: candidate.subject is the Item's own ACADEMIC subject (e.g.
  // "Language Arts") — a real, existing, unrelated field. The provenance
  // fields probed as "forbidden" below (senderEmail, senderName, an
  // email's subject LINE, receivedAt, gmailMessageId, sourceUrl,
  // pageTitle) live only on SourceRecord.metadata / the transient Check
  // Email response — AuthShell.jsx's createIngestionCandidate call never
  // copies any of them onto an IngestionCandidate in the first place, so
  // they can never legitimately reach this function at all. Included
  // anyway here as a defensive contamination probe.
  const emailCandidate = {
    proposedType: "school_event",
    title: "Back to School Night",
    subject: "Language Arts - Reading/Comprehension",
    targetType: "review",
    targetChildId: null,
    senderEmail: "mmanson@school.org",
    senderName: "Michelle Manson",
    emailSubjectLine: "Weekly Classroom Update",
    receivedAt: "2026-09-18T15:30:00.000Z",
    gmailMessageId: "gmail-msg-123",
    sourceUrl: "https://school.edu/signup",
    pageTitle: "Ms. Rivera's Classroom",
  };
  const draft = candidateToDraftItem(emailCandidate, null);
  const draftKeys = Object.keys(draft);
  const forbidden = ["senderEmail", "senderName", "emailSubjectLine", "receivedAt", "gmailMessageId", "sourceUrl", "pageTitle"];
  ok("The draft item's keys are exactly the expected Item fields, nothing extra", JSON.stringify(draftKeys.sort()) === JSON.stringify(["academicTopic", "academicUnit", "childIds", "dueDate", "notes", "preparationRequired", "startDate", "subject", "title", "type"].sort()));
  ok("No sender/subject-line/received/source/webpage field ever appears on the draft item", forbidden.every((key) => !(key in draft)));
  ok("The draft's own 'subject' field is still correctly the Item's academic subject (unaffected, legitimately passed through)", draft.subject === "Language Arts - Reading/Comprehension");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
