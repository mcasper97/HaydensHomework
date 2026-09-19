/* ============================== Check Email result summary ==============================
 * Pure, zero-JSX summary text for AuthShell.jsx's Check Email result
 * banner (live-failure follow-up fix). Previously the banner said
 * "Checked N new emails... — review below" whenever any email was found
 * at all, regardless of whether extraction actually succeeded or
 * produced anything — misleading when an email was found but its
 * extraction failed (or succeeded with zero actionable obligations),
 * since there would be nothing to "review below."
 *
 * Mixed-batch correction: an earlier version of this file let "review
 * below" (candidates exist) silently take priority over a co-occurring
 * extraction failure on a DIFFERENT email in the same batch — the parent
 * would see only "review below" and have no way to know one email's
 * school information was never extracted at all. Candidates and failures
 * are no longer mutually exclusive in the message: both conditions are
 * reported together when both are true.
 *
 * Reads only the same `results` shape checkGmailEmail() already returns
 * (each result's own `obligations` array and `extractionFailed` flag) —
 * no new state, no extra network call. Mirrors the existing
 * googleDocCheckSummary.js's pattern (a small, independent, concise
 * banner), and is rendered alongside it, not merged into it.
 */

/**
 * summarizeCheckEmailResult(checkResult) -> string | null
 * null only when checkResult itself is missing (nothing to say yet —
 * Check Email hasn't been run this session).
 *
 * Priority, in order:
 *   1. No new emails found at all.
 *   2. At least one real obligation was found anywhere in this run —
 *      "review below" is shown, since there is genuinely something to
 *      review. If one or more OTHER emails in the same batch had
 *      extractionFailed === true, a second sentence names exactly how
 *      many, so the parent never infers the whole batch succeeded.
 *   3. No obligations at all, and at least one email's extraction
 *      failed — a concise, parent-facing failure message ("review
 *      below" is never shown here, since there is nothing to review).
 *   4. No obligations, no failures — extraction genuinely found nothing
 *      actionable.
 */
export function summarizeCheckEmailResult(checkResult) {
  if (!checkResult) return null;

  const results = Array.isArray(checkResult.results) ? checkResult.results : [];
  if (results.length === 0) {
    return `No new emails found from your ${checkResult.senderCount} approved sender${checkResult.senderCount === 1 ? "" : "s"} in the last ${checkResult.lookbackDays} days.`;
  }

  const n = results.length;
  const plural = n === 1 ? "" : "s";
  const totalObligations = results.reduce((sum, r) => sum + (Array.isArray(r?.obligations) ? r.obligations.length : 0), 0);
  const failedCount = results.filter((r) => r?.extractionFailed === true).length;

  if (totalObligations > 0) {
    const reviewMessage = `Checked ${n} new email${plural} from the last ${checkResult.lookbackDays} days — review below.`;
    if (failedCount === 0) return reviewMessage;
    // Candidates exist AND at least one other email in the batch failed
    // extraction — both facts are reported, never just the good news.
    const failedPlural = failedCount === 1 ? "" : "s";
    return `${reviewMessage} We couldn't extract school information from ${failedCount} email${failedPlural}; please try again.`;
  }

  if (failedCount > 0) {
    return `Checked ${n} new email${plural}, but we couldn't extract ${n === 1 ? "its" : "their"} school information. Please try again.`;
  }

  return `Checked ${n} new email${plural}. No actionable items found.`;
}
