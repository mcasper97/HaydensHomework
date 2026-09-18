/* ============================== Gmail connection (client) ==============================
 * Thin client wrapper around the Commit 3 Gmail-connection API endpoints
 * (api/gmail-oauth-start.js, api/gmail-status.js, api/gmail-disconnect.js).
 * The client never talks to Firestore or Google directly for any of
 * this — every call goes through our own server, which is the only thing
 * that ever holds the OAuth credential (see api/_gmailConnectionsStore.js).
 * No mail-reading capability lives here yet — status/connect/disconnect only.
 */
import { auth } from "../Firebase.js";

async function authedFetch(path, options = {}) {
  const idToken = await auth.currentUser.getIdToken();
  const res = await fetch(path, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${idToken}` },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || "Request failed");
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
