import React, { useEffect, useState } from "react";
import { checkGmailEmail, fetchGmailStatus } from "./data/gmailConnection.js";
import { subscribeApprovedSenders } from "./data/gmailApprovedSendersRepository.js";
import { createSourceRecord } from "./data/sourceRecordsRepository.js";
import { createIngestionCandidate } from "./data/ingestionCandidatesRepository.js";
import { listItems } from "./data/itemsRepository.js";
import { buildObligationSignature, canReconcile } from "./organizer/recurringObligationMatch.js";
import { buildOneTimeSignatureFromItem, decideOneTimeReconciliation } from "./organizer/oneTimeObligationMatch.js";
import { summarizeGoogleDocOutcomes } from "./organizer/googleDocCheckSummary.js";
import { summarizeCheckEmailResult } from "./organizer/checkEmailSummary.js";
import CandidateReviewModal from "./organizer/CandidateReviewModal.jsx";

/* ─────────────────────── Check Email / Import (Parent Home action) ───────────────────────
 * Extracted out of AuthShell.jsx's former GmailApprovedSendersPanel as
 * part of the UI/IA refactor — the manual "Check Email" trigger is now a
 * primary Parent Home action (per the task spec) while approved-sender
 * management moved to Settings (see GmailApprovedSendersPanel.jsx). The
 * handleCheckEmail logic itself, and everything it does, is byte-for-byte
 * unchanged from the original — only its home moved.
 *
 * Independently subscribes to the approved-senders list (same cheap-read
 * precedent already used elsewhere in this app for a status/count check)
 * purely to know whether any sender is configured yet, so this action can
 * point the parent at Settings instead of silently doing nothing.
 */
const GmailCheckEmailAction = ({ ctx, childProfiles }) => {
  const [gmailStatus, setGmailStatus] = useState(null); // null = loading
  const [senders, setSenders] = useState([]);
  const [checkResult, setCheckResult] = useState(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [ingestionCandidates, setIngestionCandidates] = useState([]);

  // Independently checks Gmail connection status — same lightweight-read
  // precedent already used elsewhere (e.g. GoogleCalendarRoutingPanel
  // calling getCalendarStatus() itself rather than requiring it as a
  // prop) — so this action behaves correctly wherever it's rendered
  // (Parent Home or Settings) without depending on GmailConnectionPanel's
  // own internal state.
  useEffect(() => {
    let cancelled = false;
    fetchGmailStatus()
      .then((s) => { if (!cancelled) setGmailStatus(s); })
      .catch(() => { if (!cancelled) setGmailStatus({ connected: false }); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const unsub = subscribeApprovedSenders(ctx, setSenders);
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.uid, ctx.isAdmin]);

  const handleCheckEmail = async () => {
    setError("");
    setCheckResult(null);
    setChecking(true);
    try {
      const result = await checkGmailEmail();
      setCheckResult(result);

      // Mirrors App.jsx's handleImageIngestionUpload — the server only
      // ever returns validated extraction results; SourceRecord and
      // IngestionCandidate creation, and the mandatory parent review
      // before anything becomes a canonical Item, stay entirely
      // client-side here too.
      //
      // Two-tier provenance: one "gmail_email" SourceRecord per
      // qualifying email, plus one "webpage" or "google_doc" SourceRecord
      // per qualifying linked page (whether it was successfully fetched
      // or not — a failed fetch, or one that requires access, is still
      // recorded, same "kept, not discarded" philosophy as every other
      // capture type's processingStatus), linked back via
      // metadata.parentEmailSourceRecordId. Each obligation is attributed
      // to whichever one it actually came from via its sourceUrl (see
      // api/_emailExtraction.js) — the email's own SourceRecord when
      // null/unmatched, or the matching linked page's.
      const newCandidates = [];
      // Reconciliation (recurring + one-time obligations) — ONE
      // listItems(ctx) call per Check Email run feeds BOTH reconciliation
      // paths below, since recurring and one-time Items are just the two
      // halves of the same canonical Item list (schedule?.recurring true
      // vs. not) — no separate Firestore read is needed for either.
      let existingItems = [];
      try {
        existingItems = await listItems(ctx);
      } catch (err) {
        console.error("Check Email: listItems (reconciliation) failed", err);
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
      const runRecurringSignatures = [];
      const runOneTimeRecords = [];
      // Persistence failures: surfaced as a visible banner alongside
      // whatever candidates DID make it through, so a real write failure
      // (permission/network/quota) is diagnosable from the UI itself
      // instead of requiring devtools.
      let hadPersistenceError = false;
      for (const emailResult of result.results) {
        let emailSourceRecord;
        try {
          emailSourceRecord = await createSourceRecord(ctx, {
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
              // Display name only (e.g. "Michelle Manson") — null when the
              // From header had no separate display name (see
              // api/_gmailMime.js). Purely cosmetic, for the review UI's
              // compact source context; sender approval/matching is
              // address-only and unaffected by this field.
              senderName: emailResult.senderName,
              subject: emailResult.subject,
              receivedAt: emailResult.receivedAt,
              targetType: emailResult.targetType,
              targetChildId: emailResult.targetChildId,
              linkedUrls: emailResult.linkedUrls,
            },
          });
        } catch (err) {
          // Provenance is best-effort — one email's SourceRecord failing
          // to save must never block the rest of this batch — but it must
          // no longer be invisible (see hadPersistenceError above).
          console.error("Check Email: createSourceRecord (email) failed", err);
          hadPersistenceError = true;
          continue;
        }

        // One "webpage" or "google_doc" SourceRecord per qualifying link,
        // fetched or not.
        const linkedSourceRecordIdByUrl = new Map();
        for (const page of emailResult.webpagePages || []) {
          const obligationsFromThisPage = emailResult.obligations.filter((o) => o.sourceUrl === page.url);
          const isGoogleDoc = page.type === "google_doc";
          try {
            const linkedSourceRecord = await createSourceRecord(ctx, {
              sourceType: isGoogleDoc ? "google_doc" : "webpage",
              // The page's actual <title> when one was found; null
              // otherwise (a failed fetch, a page with no <title>, or any
              // Google Doc — title is deliberately never fetched for a
              // Google Doc, see api/_googleDocFetch.js) — the review UI
              // falls back to displaying the URL's hostname in that case
              // (see sourceContext.js).
              title: page.title || null,
              processingStatus: !page.fetched ? "failed" : obligationsFromThisPage.length === 0 ? "no_candidates" : "extracted",
              metadata: {
                sourceUrl: page.url,
                parentEmailSourceRecordId: emailSourceRecord.id,
                // Google-Doc-only fields — existing metadata bag, no new
                // top-level SourceRecord schema. Both are simply omitted
                // (not written as null) for a "webpage" record, since
                // they have no meaning there.
                ...(isGoogleDoc ? { documentId: page.documentId || null, failureReason: page.failureReason || null } : {}),
              },
            });
            linkedSourceRecordIdByUrl.set(page.url, linkedSourceRecord.id);
          } catch (err) {
            console.error("Check Email: createSourceRecord (linked page) failed", page.url, err);
            hadPersistenceError = true;
            // No entry in the map for this URL — any obligation attributed
            // to it below falls back to the email's own SourceRecord
            // rather than being lost.
          }
        }

        for (const o of emailResult.obligations) {
          const sourceRecordId = o.sourceUrl && linkedSourceRecordIdByUrl.has(o.sourceUrl)
            ? linkedSourceRecordIdByUrl.get(o.sourceUrl)
            : emailSourceRecord.id;

          // Recurring-obligation reconciliation — only ever applied to an
          // obligation the extraction itself marked recurring; one-time
          // reconciliation below runs only in the `else` branch, and
          // never touches skipAsRunDuplicate/reconciledItemId here.
          let reconciledItemId = null;
          let reconciledCandidateId = null;
          let skipAsRunDuplicate = false;
          let oneTimeDecision = null;
          if (o.recurring) {
            const target = { targetType: emailResult.targetType, targetChildId: emailResult.targetChildId };
            const signature = buildObligationSignature({ type: o.type, title: o.title, recurring: true, target });
            const existingMatch = existingRecurringSignatures.find((s) => canReconcile(signature, s.signature));
            if (existingMatch) {
              reconciledItemId = existingMatch.itemId;
            } else if (runRecurringSignatures.some((s) => canReconcile(signature, s))) {
              // Same standing instruction already produced a candidate
              // earlier in this same run (e.g. repeated across an email
              // body and a linked page) — never ask the parent to approve
              // the same recurring obligation twice in one review batch.
              skipAsRunDuplicate = true;
            } else {
              runRecurringSignatures.push(signature);
            }
          } else {
            // One-time obligation reconciliation — the ONE decision
            // point; every comparison rule lives inside
            // decideOneTimeReconciliation itself (organizer/
            // oneTimeObligationMatch.js), never reimplemented here. Unlike
            // recurring's same-run handling above, a one-time same-run
            // duplicate always still produces a real, persisted
            // (corroborated) candidate — see reconciledCandidateId below —
            // rather than being silently skipped, so its own SourceRecord
            // provenance is never left looking like "nothing was found."
            const target = { targetType: emailResult.targetType, targetChildId: emailResult.targetChildId };
            oneTimeDecision = decideOneTimeReconciliation({
              obligation: { type: o.type, title: o.title, date: o.date, startTime: o.startTime, endTime: o.endTime },
              target,
              existingSignatures: existingOneTimeSignatures,
              runRecords: runOneTimeRecords,
            });
            reconciledItemId = oneTimeDecision.reconciledItemId;
            reconciledCandidateId = oneTimeDecision.reconciledCandidateId;
          }
          if (skipAsRunDuplicate) continue;

          const recurrenceSuggestion = o.recurring
            ? { recurring: true, weekdays: o.weekdays || [], timeMode: o.timeMode || null, daypart: o.daypart || null, time: o.time || null }
            : null;

          try {
            const candidate = await createIngestionCandidate(ctx, {
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
              // The sender's configured target — never the AI's own guess
              // (o.childName above is informational only, same as photo
              // ingestion; see candidateToDraftItem.js).
              targetType: emailResult.targetType,
              targetChildId: emailResult.targetChildId,
              recurrenceSuggestion,
              // A corroborated candidate preserves full provenance (this
              // SourceRecord + candidate both persist) without ever
              // entering the parent's review queue or writing to whatever
              // it corroborates — the parent's own chosen schedule (or a
              // still-pending/rejected earlier candidate, for a same-run
              // one-time duplicate) is never touched by a later source.
              // reviewStatus is omitted (not set to undefined) for a
              // non-corroborated candidate so it keeps createIngestionCandidate's
              // own "pending" default rather than overwriting it. The two
              // reconciled*Id fields are never both non-null.
              ...(reconciledItemId
                ? { reviewStatus: "corroborated", reconciledItemId }
                : reconciledCandidateId
                ? { reviewStatus: "corroborated", reconciledCandidateId }
                : {}),
            });
            // A one-time obligation with no match ("new") is the earliest
            // point a LATER same-run duplicate can be compared against —
            // record its real candidate id + signature now, so
            // decideOneTimeReconciliation can find it on a subsequent
            // obligation in this same run. Never recorded for a recurring
            // candidate (oneTimeDecision stays null for those) or for an
            // already-corroborated one-time candidate (a duplicate must
            // always trace back to the ORIGINAL first occurrence, never
            // chain onto another duplicate).
            if (oneTimeDecision?.outcome === "new") {
              runOneTimeRecords.push({ candidateId: candidate.id, signature: oneTimeDecision.signature });
            }
            // Corroborated candidates are deliberately never added to the
            // review queue.
            if (!reconciledItemId && !reconciledCandidateId) newCandidates.push(candidate);
          } catch (err) {
            console.error("Check Email: createIngestionCandidate failed", err);
            hadPersistenceError = true;
          }
        }
      }

      if (newCandidates.length > 0) {
        setIngestionCandidates(newCandidates);
      }
      if (hadPersistenceError) {
        setError(
          newCandidates.length > 0
            ? "Some items couldn't be saved and are missing from review below — please try Check Email again in a moment."
            : "Couldn't save what was found — please try Check Email again in a moment."
        );
      }
    } catch (e) {
      setError(e.message || "Could not check email.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div data-testid="gmail-check-email-action" className="rounded-3xl p-5 mb-6 border border-gray-700" style={{ background: "#2a2a2c" }}>
      <h3 className="text-white font-display text-lg mb-1">Check Email</h3>
      {gmailStatus === null ? (
        <p className="text-gray-400 text-sm">Checking connection…</p>
      ) : !gmailStatus.connected ? (
        <p className="text-gray-400 text-sm">
          Connect Gmail in Settings to enable email import.
        </p>
      ) : senders.length === 0 ? (
        <p className="text-gray-400 text-sm">
          Add approved senders in Settings to enable email import.
        </p>
      ) : (
        <>
          <p className="text-gray-400 text-sm mb-3">
            Check approved senders for new homework and school emails.
          </p>
          <button
            onClick={handleCheckEmail}
            disabled={checking}
            className="w-full px-4 py-3 rounded-xl font-semibold text-white text-sm transition hover:opacity-90 disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #2d6b3f, #1f4a2c)" }}
          >
            {checking ? "Checking…" : "Check Email"}
          </button>
        </>
      )}

      {/* Only ever says "review below" when a real obligation was actually
          found somewhere in this run — see checkEmailSummary.js. */}
      {checkResult && <p className="text-gray-400 text-xs mt-2">{summarizeCheckEmailResult(checkResult)}</p>}
      {/* Google Doc access/fetch-failure summary — a concise sentence, not
          an error dashboard; a doc that fetched successfully (with or
          without obligations) needs no mention here. */}
      {checkResult && summarizeGoogleDocOutcomes(checkResult.results) && (
        <p className="text-yellow-400 text-xs mt-1">{summarizeGoogleDocOutcomes(checkResult.results)}</p>
      )}
      {error && <p className="text-red-400 text-sm mt-2">{error}</p>}

      {ingestionCandidates.length > 0 && (
        <CandidateReviewModal
          ctx={ctx}
          candidates={ingestionCandidates}
          familyChildren={childProfiles}
          onClose={() => setIngestionCandidates([])}
        />
      )}
    </div>
  );
};

export default GmailCheckEmailAction;
