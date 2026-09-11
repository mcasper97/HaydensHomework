// Shared server-side helper for verifying a Firebase ID token on Vercel API
// routes, using Firebase's official Admin SDK (firebase-admin) rather than
// hand-rolled JWT/JWKS verification.
//
// This module is only ever imported from files under api/ (Vercel
// serverless functions run in Node, never in the browser). It is never
// imported by anything under src/, so the service-account credential it
// initializes with is never bundled into the client and never reaches the
// browser.
//
// Firebase's own docs are explicit that this requires a service account:
// "To verify ID tokens with the Firebase Admin SDK, you must have a service
// account." — https://firebase.google.com/docs/auth/admin/verify-id-tokens
//
// Credential selection supports two paths:
//
//   1. Local dev with `vercel dev` / `gcloud auth application-default login`:
//      set GOOGLE_APPLICATION_CREDENTIALS to the path of a downloaded
//      service-account JSON file, and applicationDefault() picks it up
//      automatically. This is the standard Google Cloud local-dev pattern
//      and avoids pasting key material into shell-visible env vars locally.
//   2. Vercel Preview/Production (no local filesystem to point a path at):
//      set the three FIREBASE_* env vars below, and cert() is built from
//      them directly.
//
// Required environment variables — set whichever path applies, in Vercel
// Project Settings -> Environment Variables for prod/preview, and in a
// local .env / shell env for `vercel dev` — NEVER committed to source
// control:
//
//   GOOGLE_APPLICATION_CREDENTIALS   (local only) path to a downloaded
//                                    service-account JSON file
//   -- or --
//   FIREBASE_PROJECT_ID    e.g. "haydens-homwork" (same project as the
//                          public client config in src/Firebase.js)
//   FIREBASE_CLIENT_EMAIL  the service account's `client_email` field
//   FIREBASE_PRIVATE_KEY   the service account's `private_key` field, with
//                          real newlines escaped as literal "\n" (the
//                          standard workaround for storing a multi-line PEM
//                          key in a single-line env var). Unescaped below
//                          at runtime.
//
// Get these values by generating a new service account key in the Firebase
// Console: Project Settings -> Service Accounts -> Generate new private
// key. That downloads a JSON file containing project_id, client_email, and
// private_key. For local dev, point GOOGLE_APPLICATION_CREDENTIALS at that
// file directly; for Vercel, copy the three fields into the FIREBASE_* env
// vars instead (Vercel has no persistent filesystem path to point at). Do
// not commit the downloaded JSON file.
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

let auth = null;
let initError = null;

if (!getApps().length) {
  try {
    const credential = process.env.GOOGLE_APPLICATION_CREDENTIALS
      ? applicationDefault()
      : cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
        });

    initializeApp({ credential });
  } catch (e) {
    // Deferred: surfaced as a clean 401 on first request rather than
    // crashing the function at import time, so a missing/misconfigured
    // credential still fails closed instead of taking the endpoint down
    // with an unhandled 500.
    initError = e;
  }
}

if (!initError) {
  try {
    auth = getAuth();
  } catch (e) {
    initError = e;
  }
}

/**
 * Verifies the Firebase ID token in an Authorization: Bearer <token> header
 * using the Admin SDK's verifyIdToken(), which checks signature, kid, alg,
 * iss, aud, exp, iat, sub, and auth_time against the project configured
 * above (see Firebase's documented verification behavior:
 * https://firebase.google.com/docs/auth/admin/verify-id-tokens#verify_id_tokens_using_the_firebase_admin_sdk).
 *
 * Returns the decoded token's uid on success. Throws on any missing,
 * invalid, expired token, or on a misconfigured/uninitialized Admin SDK —
 * callers should catch and respond 401 without leaking the specific reason.
 */
export async function requireFirebaseUser(req) {
  if (initError || !auth) {
    throw new Error("Firebase Admin not configured");
  }

  const header = req.headers?.authorization || req.headers?.Authorization || "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) {
    throw new Error("Missing Authorization header");
  }
  const token = match[1];

  const decoded = await auth.verifyIdToken(token);

  if (!decoded.uid || typeof decoded.uid !== "string") {
    throw new Error("Token missing subject");
  }

  // A UID supplied elsewhere (e.g. the request body) is never trusted —
  // only this verified token's own uid is returned.
  return { uid: decoded.uid };
}

/**
 * Best-effort, single-instance in-memory rate limiter. This resets on cold
 * start and is NOT shared across concurrent serverless instances, so it is
 * a soft deterrent appropriate for the current project's scale — not a
 * hard guarantee. If real abuse shows up, replace with a durable counter
 * (e.g. a small Firestore document per uid) rather than tightening this.
 */
const rateLimitBuckets = new Map(); // uid -> number[] (request timestamps, ms)

export function checkRateLimit(uid, { maxRequests = 10, windowMs = 5 * 60 * 1000 } = {}) {
  const now = Date.now();
  const timestamps = (rateLimitBuckets.get(uid) || []).filter((t) => now - t < windowMs);
  if (timestamps.length >= maxRequests) {
    return false;
  }
  timestamps.push(now);
  rateLimitBuckets.set(uid, timestamps);
  return true;
}
