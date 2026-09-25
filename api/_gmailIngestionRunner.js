/* ============================== Gmail ingestion — automatic run (server-only) ==============================
 * THE SEAM api/_scheduledIngestionRunner.js's runDueHouseholds calls for a
 * due, enabled household — replaces that file's former
 * GMAIL_INGESTION_SEAM_MISSING placeholder. Performs the same core Gmail
 * ingestion work as the manual "Check Email" flow, with no browser and no
 * parent review step in between: scan approved-sender emails (reusing
 * api/_gmailIngestionCore.js's scanApprovedSenderEmails — the exact same
 * function api/gmail-check-email.js calls), persist SourceRecords/
 * IngestionCandidates server-side (api/_sourceRecordsStore.js /
 * api/_ingestionCandidatesStore.js — new write paths, same document
 * shape/defaults the client repositories already use), and hand each new
 * candidate to api/_scheduledIngestionAdapter.js's finalizeCandidateServerSide
 * — the SAME confidence-gated auto-commit decision and Calendar
 * post-commit workflow the manual path already uses (src/data/
 * ingestionFinalization.js), never reimplemented here.
 *
 * RECONCILIATION (follow-up correction — was a disclosed scope limitation,
 * now closed): before finalizing each extracted obligation, this file runs
 * the SAME obligation reconciliation the manual path
 * (src/GmailCheckEmailAction.jsx) already runs — recognizing when a
 * newly-extracted obligation corroborates an EXISTING Item, or an earlier
 * candidate from the same run, rather than describing something new. Both
 * decision modules are pure/Firestore-free and imported UNCHANGED, never
 * reimplemented: src/organizer/recurringObligationMatch.js
 * (buildObligationSignature/canReconcile, for obligations either side
 * marks recurring) and src/organizer/oneTimeObligationMatch.js
 * (buildOneTimeSignatureFromItem/decideOneTimeReconciliation, for
 * everything else). Only the environment-specific read of "this
 * household's existing Items" differs: api/_itemsStore.js's
 * listItemsServerSide (Admin SDK) here, vs. src/data/itemsRepository.js's
 * listItems(ctx) (client SDK) there — same data, same shape, read once per
 * run exactly like the client path reads it once per Check Email click.
 *
 * This is a SEPARATE layer from the Gmail-message-id source dedupe
 * scanApprovedSenderEmails already performs (see api/_gmailIngestionCore.js)
 * — that prevents reprocessing the exact same email; this prevents two
 * DIFFERENT emails (or an email and a linked page, or two runs) from
 * producing duplicate canonical Items for the same real-world obligation.
 * Neither replaces the other.
 *
 * CONFLICT DETECTION (second follow-up correction): a same-obligation
 * match that disagrees about a material detail — a conflicting date, or a
 * conflicting explicit time on a shared date — is NOT a true match
 * (oneTimeObligationMatch.js's canReconcileOneTime already refuses to
 * merge it) but was previously falling through as an ordinary "new"
 * candidate, eligible for normal automatic finalization. For unattended
 * scheduled ingestion that is unsafe: nobody is present to notice the
 * disagreement before it auto-commits. oneTimeObligationMatch.js's
 * decideOneTimeReconciliation now ADDITIONALLY exposes this case via its
 * `conflict` field (a tiny, purely additive change — see that function's
 * own doc comment; it never alters the outcome string or either
 * reconciled*Id field, so src/GmailCheckEmailAction.jsx, which does not
 * read `conflict`, is completely unaffected). When this file sees it: the
 * candidate is still created (full provenance, with a reference to the
 * related Item/candidate via the same reconciledItemId/reconciledCandidateId
 * fields corroboration already uses), stays at the default reviewStatus
 * "pending" (never "corroborated" — it disagrees, it doesn't confirm), and
 * is never handed to finalizeCandidateServerSide — it simply counts toward
 * reviewRequired, exactly like any other candidate the confidence gate
 * would have sent to Review Inbox.
 *
 * TRUST MODEL: takes `uid` as an explicit, already-verified parameter, the
 * same division of responsibility every api/_*Store.js module and
 * api/_scheduledIngestionAdapter.js already has — see that file's own doc
 * comment.
 */
import { scanApprovedSenderEmails, SCAN_ERROR_CODES } from "./_gmailIngestionCore.js";
import { createSourceRecordServerSide } from "./_sourceRecordsStore.js";
import { createIngestionCandidateServerSide } from "./_ingestionCandidatesStore.js";
import { finalizeCandidateServerSide } from "./_scheduledIngestionAdapter.js";
import { listItemsServerSide } from "./_itemsStore.js";
import { buildObligationSignature, canReconcile } from "../src/organizer/recurringObligationMatch.js";
import { buildOneTimeSignatureFromItem, decideOneTimeReconciliation } from "../src/organizer/oneTimeObligationMatch.js";
import { notifyGmailReconnectRequired } from "./_gmailReconnectNotificationTrigger.js";
import { notifyReviewBatchRequired } from "./_reviewBatchNotificationTrigger.js";

// Re-exported for callers that want to distinguish WHY a run didn't
// process any messages (e.g. a future status UI) — same codes
// scanApprovedSenderEmails itself returns, since this file adds no new
// scan-level failure modes of its own.
export const INGESTION_RUN_ERROR_CODES = SCAN_ERROR_CODES;

/**
 * runHouseholdEmailIngestion(uid, deps?) -> concise run summary
 *   { ok:true, messagesScanned, messagesProcessed, messagesSkipped,
 *     candidatesCreated, itemsCommitted, reviewRequired, errors }
 *   | { ok:false, code, message, needsReconnect? }
 *
 * The ok:false shape is returned immediately whenever
 * scanApprovedSenderEmails itself fails to even begin scanning — not
 * connected, no approved senders configured, or (task Section 5) an
 * expired/invalid Gmail authorization. In every one of those cases this
 * function stops without creating a single SourceRecord or
 * IngestionCandidate — no messages are ever examined, so there is nothing
 * that could produce Review Inbox noise. code === "GMAIL_RECONNECT_REQUIRED"
 * (with needsReconnect: true) is specifically the auth-failure case task
 * Section 5 asks be clearly distinguishable; api/_scheduledIngestionRunner.js's
 * runDueHouseholds records any ok:false outcome as a normal, retry-eligible
 * FAILED run (same as every other failure it already handles) — no
 * special-casing needed there.
 *
 * `deps` lets tests override any collaborator, mirroring the {deps={}}
 * pattern already established by runDueHouseholds and
 * finalizeCandidateServerSide. `deps.scanDeps` is passed through to
 * scanApprovedSenderEmails unchanged, so a test can fake the Gmail/
 * extraction layer without needing to fake this file's own
 * create/finalize collaborators too.
 *
 * GMAIL RECONNECT NOTIFICATION (task: notify the parent when this
 * transition happens): exactly when scanResult.needsReconnect is true —
 * the SAME reconnect-required transition this function already surfaces
 * on its ok:false result, no second detector — deps.notifyGmailReconnect
 * (api/_gmailReconnectNotificationTrigger.js's notifyGmailReconnectRequired
 * by default) is called best-effort, wrapped in its own try/catch here
 * too for defense in depth even though that function is itself designed
 * to never throw. The returned ok:false result is built and returned
 * completely unchanged by this — the notification is a pure side effect.
 *
 * REVIEW INBOX BATCH NOTIFICATION (task: ONE email per source, never one
 * per candidate): a per-email `reviewRequiredThisEmail` counter tracks
 * exactly the same two cases that already increment the run-wide
 * `summary.reviewRequired` below (a genuine conflict, and a
 * non-auto-committed finalization outcome) — never a second counting
 * rule. Once that email's obligations loop finishes, if the count is > 0,
 * deps.notifyReviewBatch (api/_reviewBatchNotificationTrigger.js's
 * notifyReviewBatchRequired by default) is called ONCE for that email,
 * keyed by its own emailSourceRecord.id (never a candidate id, never a
 * timestamp) — best-effort, wrapped here too for the same
 * defense-in-depth reason as the Gmail reconnect notification above.
 */
export async function runHouseholdEmailIngestion(uid, deps = {}) {
  const {
    scan = scanApprovedSenderEmails,
    createSourceRecord = createSourceRecordServerSide,
    createCandidate = createIngestionCandidateServerSide,
    finalizeCandidate = finalizeCandidateServerSide,
    listItems = listItemsServerSide,
    notifyGmailReconnect = notifyGmailReconnectRequired,
    notifyReviewBatch = notifyReviewBatchRequired,
    scanDeps,
  } = deps;

  const scanResult = await scan(uid, scanDeps);
  if (!scanResult.ok) {
    if (scanResult.needsReconnect) {
      try {
        await notifyGmailReconnect(uid);
      } catch (err) {
        // Belt-and-suspenders — notifyGmailReconnectRequired's own
        // implementation already catches everything internally; this
        // guarantees a change to that function (or a test double that
        // doesn't) can never turn a notification failure into an
        // ingestion-run failure.
        console.error(`gmailIngestionRunner: Gmail reconnect notification trigger threw for ${uid}`, err);
      }
    }
    return {
      ok: false,
      code: scanResult.code,
      message: scanResult.error,
      ...(scanResult.needsReconnect ? { needsReconnect: true } : {}),
    };
  }

  const summary = {
    ok: true,
    messagesScanned: scanResult.matchedCount,
    messagesProcessed: 0,
    // Messages that matched the search but could not be fetched/decoded —
    // scanApprovedSenderEmails silently drops those from `results` (see
    // its own doc comment); this is the only place that gap is surfaced
    // as a count, for the scheduler's basic run status.
    messagesSkipped: Math.max(0, scanResult.matchedCount - scanResult.results.length),
    candidatesCreated: 0,
    itemsCommitted: 0,
    reviewRequired: 0,
    errors: [],
  };

  // Reconciliation (task Section 1/2/3) — ONE listItems() call per run
  // feeds BOTH reconciliation paths below, mirroring
  // src/GmailCheckEmailAction.jsx's handleCheckEmail exactly (same single
  // read, same recurring/one-time split). Best-effort: a read failure here
  // must never block ingestion itself — it falls back to "no existing
  // Items known," same fail-open behavior the client path already has
  // (a candidate that would have corroborated an existing Item instead
  // becomes a normal pending review candidate — never lost, never silently
  // duplicated as an auto-committed Item, since finalizeCandidateServerSide's
  // own confidence gate still applies to it).
  let existingItems = [];
  try {
    existingItems = await listItems(uid);
  } catch (err) {
    console.error("gmailIngestionRunner: listItems (reconciliation) failed", err);
  }
  const existingRecurringItems = existingItems.filter((it) => it.schedule?.recurring);
  const existingOneTimeItems = existingItems.filter((it) => !it.schedule?.recurring);
  const existingRecurringSignatures = existingRecurringItems.map((it) => ({
    itemId: it.id,
    signature: buildObligationSignature({ type: it.type, title: it.title, recurring: true, target: { childIds: it.childIds } }),
  }));
  const existingOneTimeSignatures = existingOneTimeItems.map((it) => ({
    itemId: it.id,
    signature: buildOneTimeSignatureFromItem(it),
  }));
  // Same-run duplicate collapse state — accumulates across every message
  // in this run, exactly like the client path's per-Check-Email-click run
  // state (never persisted, never shared across separate runs).
  const runRecurringSignatures = [];
  const runOneTimeRecords = [];

  for (const emailResult of scanResult.results) {
    // One "gmail_email" SourceRecord per qualifying email — same
    // provenance shape src/GmailCheckEmailAction.jsx has always created,
    // now written server-side via createSourceRecordServerSide instead of
    // the client repository.
    let emailSourceRecord;
    try {
      emailSourceRecord = await createSourceRecord(uid, {
        sourceType: "gmail_email",
        title: emailResult.subject || "(no subject)",
        processingStatus: emailResult.extractionFailed
          ? "failed"
          : emailResult.obligations.length === 0
          ? "no_candidates"
          : "extracted",
        metadata: {
          gmailMessageId: emailResult.gmailMessageId,
          gmailThreadId: emailResult.gmailThreadId,
          senderEmail: emailResult.senderEmail,
          senderName: emailResult.senderName,
          subject: emailResult.subject,
          receivedAt: emailResult.receivedAt,
          targetType: emailResult.targetType,
          targetChildId: emailResult.targetChildId,
          linkedUrls: emailResult.linkedUrls,
        },
      });
    } catch (err) {
      // Error isolation (task Section 4) — one message's persistence
      // failure must not abort the household's whole run. This message
      // was never marked processed (no SourceRecord exists for it), so
      // it's naturally retried on a later run, same as a fetch/decode
      // failure already is.
      console.error("gmailIngestionRunner: createSourceRecord (email) failed", err);
      summary.errors.push({ gmailMessageId: emailResult.gmailMessageId, error: err?.message || String(err) });
      continue;
    }
    summary.messagesProcessed += 1;

    // One "webpage" or "google_doc" SourceRecord per qualifying link,
    // fetched or not — mirrors src/GmailCheckEmailAction.jsx exactly.
    const linkedSourceRecordIdByUrl = new Map();
    for (const page of emailResult.webpagePages || []) {
      const obligationsFromThisPage = emailResult.obligations.filter((o) => o.sourceUrl === page.url);
      const isGoogleDoc = page.type === "google_doc";
      try {
        const linkedSourceRecord = await createSourceRecord(uid, {
          sourceType: isGoogleDoc ? "google_doc" : "webpage",
          title: page.title || null,
          processingStatus: !page.fetched ? "failed" : obligationsFromThisPage.length === 0 ? "no_candidates" : "extracted",
          metadata: {
            sourceUrl: page.url,
            parentEmailSourceRecordId: emailSourceRecord.id,
            ...(isGoogleDoc ? { documentId: page.documentId || null, failureReason: page.failureReason || null } : {}),
          },
        });
        linkedSourceRecordIdByUrl.set(page.url, linkedSourceRecord.id);
      } catch (err) {
        console.error("gmailIngestionRunner: createSourceRecord (linked page) failed", page.url, err);
        summary.errors.push({ gmailMessageId: emailResult.gmailMessageId, url: page.url, error: err?.message || String(err) });
        // No entry in the map for this URL — any obligation attributed to
        // it below falls back to the email's own SourceRecord rather than
        // being lost.
      }
    }

    // Review Inbox batch notification (task) — counts ONLY candidates
    // this email's own processing leaves review-required: incremented
    // alongside (never instead of) the two summary.reviewRequired += 1
    // sites below, so this is never a second counting rule, just a
    // per-email scope on the same one. Auto-committed and
    // corroborated/skipped-as-duplicate candidates never increment it.
    let reviewRequiredThisEmail = 0;

    for (const o of emailResult.obligations) {
      const sourceRecordId =
        o.sourceUrl && linkedSourceRecordIdByUrl.has(o.sourceUrl) ? linkedSourceRecordIdByUrl.get(o.sourceUrl) : emailSourceRecord.id;

      // Reconciliation — same branching as src/GmailCheckEmailAction.jsx's
      // handleCheckEmail, using the same imported pure decision functions.
      // Recurring obligations use recurringObligationMatch.js's hard
      // exact-match gate; everything else uses oneTimeObligationMatch.js's
      // decideOneTimeReconciliation. Neither is reimplemented here.
      let reconciledItemId = null;
      let reconciledCandidateId = null;
      let skipAsRunDuplicate = false;
      let oneTimeDecision = null;
      // Follow-up correction — a detected CONFLICT (see
      // oneTimeObligationMatch.js's additive classifyOneTimeMatch/
      // decideOneTimeReconciliation `conflict` field): almost certainly the
      // same real-world obligation as an existing Item or same-run
      // candidate, but disagreeing about WHEN it is. Only ever set
      // alongside outcome "new" — a true match/duplicate always already
      // set reconciledItemId/reconciledCandidateId above. This never
      // affects the manual "Check Email" path, which does not read this
      // field.
      let conflict = null;
      const target = { targetType: emailResult.targetType, targetChildId: emailResult.targetChildId };
      if (o.recurring) {
        const signature = buildObligationSignature({ type: o.type, title: o.title, recurring: true, target });
        const existingMatch = existingRecurringSignatures.find((s) => canReconcile(signature, s.signature));
        if (existingMatch) {
          reconciledItemId = existingMatch.itemId;
        } else if (runRecurringSignatures.some((s) => canReconcile(signature, s))) {
          // Same standing instruction already produced a candidate earlier
          // in this same run — never create a second one.
          skipAsRunDuplicate = true;
        } else {
          runRecurringSignatures.push(signature);
        }
      } else {
        oneTimeDecision = decideOneTimeReconciliation({
          obligation: { type: o.type, title: o.title, date: o.date, startTime: o.startTime, endTime: o.endTime },
          target,
          existingSignatures: existingOneTimeSignatures,
          runRecords: runOneTimeRecords,
        });
        reconciledItemId = oneTimeDecision.reconciledItemId;
        reconciledCandidateId = oneTimeDecision.reconciledCandidateId;
        conflict = oneTimeDecision.conflict;
      }
      if (skipAsRunDuplicate) continue;

      const recurrenceSuggestion = o.recurring
        ? { recurring: true, weekdays: o.weekdays || [], timeMode: o.timeMode || null, daypart: o.daypart || null, time: o.time || null }
        : null;

      try {
        const candidate = await createCandidate(uid, {
          sourceRecordId,
          proposedType: o.type,
          title: o.title,
          proposedChildName: o.childName,
          date: o.date,
          subject: o.subject,
          academicTopic: o.academicTopic,
          academicUnit: o.academicUnit,
          preparationRequired: o.preparationRequired,
          description: o.description,
          extractionConfidence: o.extractionConfidence,
          startTime: o.startTime,
          endTime: o.endTime,
          // The sender's configured target — never the AI's own guess,
          // same rule the manual path enforces (see candidateToDraftItem.js).
          targetType: emailResult.targetType,
          targetChildId: emailResult.targetChildId,
          recurrenceSuggestion,
          // A corroborated candidate preserves full provenance (this
          // SourceRecord + candidate both persist) without ever entering
          // the parent's review queue or writing to whatever it
          // corroborates — same semantics as the manual path. The two
          // reconciled*Id fields are never both non-null.
          //
          // A CONFLICT (follow-up correction) also preserves a reference
          // to the related Item/candidate, reusing the same two fields —
          // but deliberately does NOT set reviewStatus: "corroborated"
          // (this candidate does not corroborate anything; it disagrees
          // with it) — reviewStatus stays at its normal "pending" default,
          // same as any other candidate awaiting parent review.
          ...(reconciledItemId
            ? { reviewStatus: "corroborated", reconciledItemId }
            : reconciledCandidateId
            ? { reviewStatus: "corroborated", reconciledCandidateId }
            : conflict?.itemId
            ? { reconciledItemId: conflict.itemId }
            : conflict?.candidateId
            ? { reconciledCandidateId: conflict.candidateId }
            : {}),
        });
        summary.candidatesCreated += 1;

        // A one-time obligation with no match ("new") is the earliest
        // point a LATER same-run duplicate can be compared against —
        // record its real candidate id + signature now, exactly like the
        // manual path does, so a subsequent obligation in this same run
        // can be recognized as corroborating it. A conflict is still
        // "new" (see above) so it is recorded here too — a THIRD source
        // restating this exact obligation can still be compared against it.
        if (oneTimeDecision?.outcome === "new") {
          runOneTimeRecords.push({ candidateId: candidate.id, signature: oneTimeDecision.signature });
        }

        // Corroborated candidates are deliberately never handed to the
        // finalizer — they already point at an existing Item/candidate and
        // must never enter any commit path a second time (same rule the
        // manual path enforces).
        if (reconciledItemId || reconciledCandidateId) continue;

        // A detected conflict never reaches automatic finalization either
        // — for unattended scheduled ingestion, a material conflict
        // between two sources for what looks like the same obligation
        // always requires human review, never an auto-commit confidence
        // check. The candidate stays "pending" (surfaced by the existing
        // Review Inbox, same as any other pending candidate); no separate
        // review queue or new reviewStatus value was needed.
        if (conflict) {
          summary.reviewRequired += 1;
          reviewRequiredThisEmail += 1;
          continue;
        }

        // The one shared finalization entry point — same confidence-gated
        // auto-commit decision and Calendar post-commit workflow the
        // manual path uses (src/data/ingestionFinalization.js), never
        // reimplemented here.
        const result = await finalizeCandidate(uid, candidate);
        if (result.outcome === "auto_committed") {
          summary.itemsCommitted += 1;
        } else {
          // "pending" (not eligible) or "auto_commit_failed" both leave
          // the candidate exactly where the manual path's own Review
          // Inbox already surfaces it — no separate review queue needed
          // here.
          summary.reviewRequired += 1;
          reviewRequiredThisEmail += 1;
        }
      } catch (err) {
        // Error isolation (task Section 4) — one obligation's failure
        // must not stop the rest of this email's obligations, or any
        // other message in this run.
        console.error("gmailIngestionRunner: candidate creation/finalization failed", err);
        summary.errors.push({ gmailMessageId: emailResult.gmailMessageId, error: err?.message || String(err) });
      }
    }

    if (reviewRequiredThisEmail > 0) {
      try {
        await notifyReviewBatch(uid, emailSourceRecord.id, reviewRequiredThisEmail);
      } catch (err) {
        // Belt-and-suspenders — notifyReviewBatchRequired's own
        // implementation already catches everything internally; this
        // guarantees a notification failure can never turn into an
        // ingestion-run failure regardless of how it's invoked.
        console.error(`gmailIngestionRunner: Review Inbox batch notification trigger threw for ${uid}/${emailSourceRecord.id}`, err);
      }
    }
  }

  return summary;
}
