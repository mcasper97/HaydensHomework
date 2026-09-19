/**
 * Unit tests for api/_googleDocFetch.js — anonymous public-export
 * retrieval of a Google Doc's text (#26, Commit 6). DNS and fetch are
 * both injected/faked (same pattern as tests/url-safety.unit.mjs, which
 * this module's safeFetch call reuses under the hood), so these tests
 * need no real network access.
 *
 * Usage: node tests/google-doc-fetch.unit.mjs
 */
import { extractGoogleDocId, buildGoogleDocExportUrl, fetchGoogleDocText } from "../api/_googleDocFetch.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

function fakeResponse({ status, headers = {}, chunks = [] }) {
  const headerMap = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  let i = 0;
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => headerMap.get(k.toLowerCase()) ?? null },
    body: {
      getReader: () => ({
        read: async () => {
          if (i < chunks.length) return { done: false, value: chunks[i++] };
          return { done: true, value: undefined };
        },
        cancel: async () => {},
      }),
    },
  };
}

const PUBLIC_IP_LOOKUP = async () => [{ address: "93.184.216.34", family: 4 }];

// ============ extractGoogleDocId ============
ok(
  "Extracts the id from a normal edit URL",
  extractGoogleDocId("https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit") === "1AbCdEfGhIjKlMnOp"
);
ok(
  "Extracts the id from a view URL",
  extractGoogleDocId("https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/view") === "1AbCdEfGhIjKlMnOp"
);
ok(
  "Extracts the id when there's a trailing fragment (#heading=...)",
  extractGoogleDocId("https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit#heading=h.abc123") === "1AbCdEfGhIjKlMnOp"
);
ok(
  "Extracts the id with no trailing segment at all",
  extractGoogleDocId("https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp") === "1AbCdEfGhIjKlMnOp"
);
ok(
  "Extracts an id containing hyphens and underscores",
  extractGoogleDocId("https://docs.google.com/document/d/1Ab-Cd_Ef/edit") === "1Ab-Cd_Ef"
);

// ============ extractGoogleDocId: malformed/unsupported Google URLs rejected ============
ok("Rejects a Google Sheets URL (not /document/)", extractGoogleDocId("https://docs.google.com/spreadsheets/d/1AbC/edit") === null);
ok("Rejects a Google Slides URL (not /document/)", extractGoogleDocId("https://docs.google.com/presentation/d/1AbC/edit") === null);
ok("Rejects a Drive file URL (wrong host+path entirely)", extractGoogleDocId("https://drive.google.com/file/d/1AbC/view") === null);
ok("Rejects a completely different host claiming a /document/ path", extractGoogleDocId("https://evil.example/document/d/1AbC/edit") === null);
ok("Rejects a /document/ URL missing the id segment entirely", extractGoogleDocId("https://docs.google.com/document/") === null);
ok("Rejects docs.google.com root with no path at all", extractGoogleDocId("https://docs.google.com/") === null);
ok("Rejects a malformed URL string", extractGoogleDocId("not a url at all") === null);
ok("Rejects empty string", extractGoogleDocId("") === null);
ok("Rejects null without throwing", extractGoogleDocId(null) === null);
ok("Rejects undefined without throwing", extractGoogleDocId(undefined) === null);

// ============ buildGoogleDocExportUrl ============
ok(
  "Builds the anonymous plain-text export URL exactly",
  buildGoogleDocExportUrl("1AbCdEfGhIjKlMnOp") === "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/export?format=txt"
);

// ============ fetchGoogleDocText: invalid URL never reaches the network ============
{
  let fetchCalled = false;
  const fetchFn = async () => { fetchCalled = true; throw new Error("should never be called"); };
  const r = await fetchGoogleDocText("https://docs.google.com/spreadsheets/d/1AbC/edit", { fetchFn, lookupFn: PUBLIC_IP_LOOKUP });
  ok("A non-document Google URL fails without ever calling fetch", r.status === "failed" && r.reason === "invalid_doc_url" && fetchCalled === false);
  ok("docId is null for an unparseable doc URL", r.docId === null);
}

// ============ fetchGoogleDocText: successful text retrieval ============
{
  const fetchFn = async (url) => {
    ok("Fetches exactly the anonymous export URL for the given doc id", url.toString() === "https://docs.google.com/document/d/1AbC123/export?format=txt");
    return fakeResponse({ status: 200, headers: { "content-type": "text/plain; charset=UTF-8" }, chunks: [Buffer.from("Reading log due Friday.")] });
  };
  const r = await fetchGoogleDocText("https://docs.google.com/document/d/1AbC123/edit", { fetchFn, lookupFn: PUBLIC_IP_LOOKUP });
  ok("Reports success", r.status === "success");
  ok("Returns the doc id", r.docId === "1AbC123");
  ok("Returns the exported plain text", r.text === "Reading log due Friday.");
}

// ============ 1. A 200 text/plain response succeeds even when the final URL
// is NOT docs.google.com — classification is by response behavior, never a
// hostname allowlist. safeFetch has already SSRF-validated every hop, so a
// legitimate Google content/download host serving the actual export text
// must not be treated as a failure just because of where it came from. ============
{
  const lookupFn = async (hostname) =>
    hostname === "doc-0-docs.googleusercontent.com" ? [{ address: "93.184.216.34", family: 4 }] : PUBLIC_IP_LOOKUP();
  const fetchFn = async (url) => {
    if (url.toString().includes("docs.google.com")) {
      return fakeResponse({ status: 302, headers: { location: "https://doc-0-docs.googleusercontent.com/export/abc123?format=txt" } });
    }
    return fakeResponse({ status: 200, headers: { "content-type": "text/plain; charset=UTF-8" }, chunks: [Buffer.from("Unit 3 covers fractions.")] });
  };
  const r = await fetchGoogleDocText("https://docs.google.com/document/d/1AbC123/edit", { fetchFn, lookupFn });
  ok("A 200 text/plain response succeeds even served from a different (SSRF-validated) Google content host", r.status === "success" && r.text === "Unit 3 covers fractions.");
}

// ============ 2. accounts.google.com redirect is requires_authentication ============
{
  // Google redirects an unauthenticated request for a restricted doc to
  // its own sign-in page — never followed as if it were the doc's text.
  // This is the one specific, well-known case where the final hostname
  // itself genuinely is the signal (not a broader allowlist).
  const lookupFn = async (hostname) =>
    hostname === "accounts.google.com" ? [{ address: "93.184.216.34", family: 4 }] : PUBLIC_IP_LOOKUP();
  const fetchFn = async (url) => {
    if (url.toString().includes("docs.google.com")) {
      return fakeResponse({ status: 302, headers: { location: "https://accounts.google.com/ServiceLogin?service=wise" } });
    }
    return fakeResponse({ status: 200, headers: { "content-type": "text/html" }, chunks: [Buffer.from("<html><body>Generic sign-in landing page</body></html>")] });
  };
  const r = await fetchGoogleDocText("https://docs.google.com/document/d/1AbC123/edit", { fetchFn, lookupFn });
  ok("A redirect to accounts.google.com is reported as requires_authentication, never followed as real content", r.status === "requires_authentication");
}

// ============ 3. 401/403 is requires_authentication ============
{
  const fetchFn = async () => fakeResponse({ status: 401, headers: {} });
  const r = await fetchGoogleDocText("https://docs.google.com/document/d/1AbC123/edit", { fetchFn, lookupFn: PUBLIC_IP_LOOKUP });
  ok("A 401 response is reported as requires_authentication", r.status === "requires_authentication" && r.docId === "1AbC123");
}
{
  const fetchFn = async () => fakeResponse({ status: 403, headers: {} });
  const r = await fetchGoogleDocText("https://docs.google.com/document/d/1AbC123/edit", { fetchFn, lookupFn: PUBLIC_IP_LOOKUP });
  ok("A 403 response is reported as requires_authentication", r.status === "requires_authentication");
}

// ============ 4. Google sign-in/access HTML (200, non text/plain, served
// directly from docs.google.com — no redirect at all) is
// requires_authentication, detected by its content, not its hostname. ============
{
  const fetchFn = async () => fakeResponse({ status: 200, headers: { "content-type": "text/html; charset=UTF-8" }, chunks: [Buffer.from("<html><body>You need permission to access this document.<br>Request access</body></html>")] });
  const r = await fetchGoogleDocText("https://docs.google.com/document/d/1AbC123/edit", { fetchFn, lookupFn: PUBLIC_IP_LOOKUP });
  ok("A Google access-required HTML page (still on docs.google.com, no redirect) is reported as requires_authentication", r.status === "requires_authentication");
}
{
  const fetchFn = async () => fakeResponse({ status: 200, headers: { "content-type": "text/html; charset=UTF-8" }, chunks: [Buffer.from("<html><title>Sign in - Google Accounts</title><body>Sign in to continue</body></html>")] });
  const r = await fetchGoogleDocText("https://docs.google.com/document/d/1AbC123/edit", { fetchFn, lookupFn: PUBLIC_IP_LOOKUP });
  ok("A Google sign-in-titled HTML page is reported as requires_authentication", r.status === "requires_authentication");
}

// ============ 5. Unrelated HTML/non-text response is fetch_failed, NOT
// requires_authentication — the earlier (corrected) implementation treated
// any non-text/plain 200 as an access issue; that was too broad. ============
{
  const fetchFn = async () => fakeResponse({ status: 200, headers: { "content-type": "text/html; charset=UTF-8" }, chunks: [Buffer.from("<html><body>Something unexpected happened. Try again later.</body></html>")] });
  const r = await fetchGoogleDocText("https://docs.google.com/document/d/1AbC123/edit", { fetchFn, lookupFn: PUBLIC_IP_LOOKUP });
  ok("An unrelated/generic HTML response (no auth signal) is reported as failed, not requires_authentication", r.status === "failed" && r.reason === "unexpected_response");
}
{
  const fetchFn = async () => fakeResponse({ status: 200, headers: { "content-type": "application/json" }, chunks: [Buffer.from('{"error":"not found"}')] });
  const r = await fetchGoogleDocText("https://docs.google.com/document/d/1AbC123/edit", { fetchFn, lookupFn: PUBLIC_IP_LOOKUP });
  ok("An unexpected non-text response type with no auth signal is reported as failed", r.status === "failed" && r.reason === "unexpected_response");
}

// ============ fetchGoogleDocText: failed fetch behavior (not an access issue) ============
{
  const fetchFn = async () => { throw new Error("network down"); };
  const r = await fetchGoogleDocText("https://docs.google.com/document/d/1AbC123/edit", { fetchFn, lookupFn: PUBLIC_IP_LOOKUP });
  ok("A network-level failure is reported as failed, not requires_authentication", r.status === "failed" && r.reason === "fetch_failed");
}
{
  const fetchFn = async () => fakeResponse({ status: 500, headers: {} });
  const r = await fetchGoogleDocText("https://docs.google.com/document/d/1AbC123/edit", { fetchFn, lookupFn: PUBLIC_IP_LOOKUP });
  ok("A 500 server error is reported as failed, not requires_authentication", r.status === "failed" && r.reason === "http_500");
}
{
  const lookupFn = async () => { throw new Error("NXDOMAIN"); };
  const r = await fetchGoogleDocText("https://docs.google.com/document/d/1AbC123/edit", { fetchFn: async () => { throw new Error("unreachable"); }, lookupFn });
  ok("DNS resolution failure is reported as failed", r.status === "failed" && r.reason === "dns_resolution_failed");
}

// ============ fetchGoogleDocText: never uses OAuth/credentials ============
{
  const fetchFn = async (url, options) => {
    ok("No headers option is ever passed (no Authorization/OAuth token possible)", options.headers === undefined);
    ok("credentials: omit — no Google account cookies sent", options.credentials === "omit");
    return fakeResponse({ status: 200, headers: { "content-type": "text/plain" }, chunks: [Buffer.from("text")] });
  };
  await fetchGoogleDocText("https://docs.google.com/document/d/1AbC123/edit", { fetchFn, lookupFn: PUBLIC_IP_LOOKUP });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
