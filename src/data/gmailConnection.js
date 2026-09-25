/* ============================== Gmail connection (client) ==============================
 * Thin client wrapper around the Gmail-connection API endpoints
 * (api/gmail-oauth-start.js, api/gmail-status.js, api/gmail-disconnect.js,
 * api/gmail-check-email.js). The client never talks to Google directly for
 * any of this — every call goes through our own server, which is the only
 * thing that ever holds the OAuth credential (see
 * api/_gmailConnectionsStore.js). The client DOES talk to Firestore
 * directly to persist what the server returns (SourceRecords,
 * IngestionCandidates) — see src/AuthShell.jsx — exactly like the existing
 * photo-ingestion flow.
 */
import { auth } from "../Firebase.js";

// Exported (observability/manual-validation follow-up) so
// src/data/emailIngestionScheduleRepository.js's runEmailIngestionNow can
// reuse the exact same ID-token-attaching fetch wrapper rather than a
// second copy of it — every authenticated client call in this app already
// attaches the parent's real Firebase ID token this same way, never
// CRON_SECRET or any other server-only secret.
export async function authedFetch(path, options = {}) {
  const idToken = await auth.currentUser.getIdToken();
  const res = await fetch(path, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${idToken}` },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    const err = new Error(data?.error || "Request failed");
    if (data?.needsReconnect) err.needsReconnect = true;
    throw err;
  }
  return data;
}

export async function fetchGmailStatus() {
  const data = await authedFetch("/api/gmail-status", { method: "GET" });
  return {
    connected: !!data.connected,
    emailAddress: data.emailAddress || null,
    needsReconnect: !!data.needsReconnect,
    connectedAt: data.connectedAt || null,
  };
}

/** Starts the OAuth flow and navigates the browser to Google's consent screen. */
export async function startGmailConnect() {
  const data = await authedFetch("/api/gmail-oauth-start", { method: "POST" });
  window.location.href = data.authUrl;
}

export async function disconnectGmail() {
  await authedFetch("/api/gmail-disconnect", { method: "POST" });
}

/**
 * Manual "Check Email" action (#26, Commit 5). Runs the full server-side
 * pipeline (Gmail fetch, link discovery, safe webpage fetch, extraction)
 * and returns one result per qualifying, not-yet-processed email — the
 * caller (see src/AuthShell.jsx) is responsible for turning each result
 * into a SourceRecord + IngestionCandidate(s) and opening the review
 * modal; this function never writes to Firestore itself.
 */
export async function checkGmailEmail() {
  const data = await authedFetch("/api/gmail-check-email", { method: "POST" });
  return {
    connectedEmail: data.connectedEmail || null,
    senderCount: data.senderCount || 0,
    lookbackDays: data.lookbackDays,
    sinceIso: data.sinceIso || null,
    results: Array.isArray(data.results) ? data.results : [],
  };
}

/**
 * Parent testing control (Settings -> Email Import -> Testing Tools).
 * Makes previously processed Gmail messages eligible to be scanned again —
 * see api/gmail-reset-processing.js / api/_gmailProcessingResetStore.js.
 * Never deletes SourceRecords/Items/candidates, and never itself triggers
 * Check Email — the caller decides whether/when to check again.
 */
export async function resetGmailProcessingHistory() {
  const data = await authedFetch("/api/gmail-reset-processing", { method: "POST" });
  return { resetCount: data.resetCount || 0 };
}
