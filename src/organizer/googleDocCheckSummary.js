/* ============================== Google Doc Check Email result summary ==============================
 * Pure, zero-JSX summary text for AuthShell.jsx's Check Email result
 * banner (#26, Commit 6). "Document processed successfully" and "no
 * actionable obligations" are already visible through existing means (a
 * candidate shows up in the review modal; a SourceRecord's own
 * processingStatus records "no_candidates" — same as the pre-existing
 * webpage/email precedent, no separate UI needed for either). The two
 * outcomes that previously had NO representation at all — a Google Doc
 * that needs access, or one that failed outright — get a single, concise
 * sentence here, so "Check Email should distinguish at least: requires
 * access / fetch failed" without building a full error dashboard.
 *
 * Reads only the same `results` shape checkGmailEmail() already returns
 * (specifically each result's webpagePages, tagged type:"google_doc" by
 * api/gmail-check-email.js) — no new state, no extra network call.
 */

/**
 * summarizeGoogleDocOutcomes(results) -> string | null
 * null when there's nothing worth telling the parent about (no Google
 * Doc links this run, or every one of them succeeded/had no candidates).
 */
export function summarizeGoogleDocOutcomes(results) {
  let needsAccess = 0;
  let failed = 0;

  for (const emailResult of results || []) {
    for (const page of emailResult?.webpagePages || []) {
      if (page.type !== "google_doc" || page.fetched) continue;
      if (page.failureReason === "requires_authentication") needsAccess++;
      else failed++;
    }
  }

  if (needsAccess === 0 && failed === 0) return null;

  if (needsAccess > 0 && failed === 0) {
    return needsAccess === 1
      ? `Google document requires access — share it ("Anyone with the link can view") and try Check Email again.`
      : `${needsAccess} linked Google documents require access — share them ("Anyone with the link can view") and try Check Email again.`;
  }

  if (failed > 0 && needsAccess === 0) {
    return failed === 1
      ? "A linked Google document couldn't be retrieved."
      : `${failed} linked Google documents couldn't be retrieved.`;
  }

  return "Some linked Google documents couldn't be retrieved — one or more may need access shared first.";
}
