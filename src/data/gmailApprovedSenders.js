/* ============================== Approved Gmail sender — pure validation ==============================
 * Zero-import module (mirrors src/data/itemTypes.js's pattern) so this
 * validation logic can be shared by the client repository
 * (gmailApprovedSendersRepository.js) and unit-tested directly in Node
 * without touching firebase/firestore or ./Firebase.js.
 *
 * Exact addresses only — deliberately no domain/wildcard matching (e.g. no
 * "@schoolname.edu" catch-all). This is the actual filter that will decide
 * whose email gets read once extraction is wired up in a later commit, so
 * it stays as narrow and explicit as what the parent typed.
 */

export function normalizeSenderEmail(raw) {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}

// Deliberately simple (not a full RFC 5322 validator) — good enough to
// catch obvious typos without rejecting any real address a parent would
// plausibly type.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidSenderEmail(email) {
  return typeof email === "string" && EMAIL_PATTERN.test(email);
}
