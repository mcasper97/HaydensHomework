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
          privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(
            /\\n/g,
            "\n"
          ),
        });

    initializeApp({ credential });
  } catch (e) {
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

export async function requireFirebaseUser(req) {
  if (initError || !auth) {
    throw new Error("Firebase Admin not configured");
  }

  const header =
    req.headers?.authorization || req.headers?.Authorization || "";

  const match = /^Bearer (.+)$/.exec(header);

  if (!match) {
    throw new Error("Missing Authorization header");
  }

  const decoded = await auth.verifyIdToken(match[1]);

  if (!decoded.uid || typeof decoded.uid !== "string") {
    throw new Error("Token missing subject");
  }

  return { uid: decoded.uid };
}

const rateLimitBuckets = new Map();

export function checkRateLimit(
  uid,
  { maxRequests = 10, windowMs = 5 * 60 * 1000 } = {}
) {
  const now = Date.now();

  const timestamps = (rateLimitBuckets.get(uid) || []).filter(
    (t) => now - t < windowMs
  );

  if (timestamps.length >= maxRequests) {
    return false;
  }

  timestamps.push(now);
  rateLimitBuckets.set(uid, timestamps);

  return true;
}