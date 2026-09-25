/**
 * Focused unit tests for api/_emailNotificationTransport.js — the ONE
 * provider-specific (Resend) module in the notification slice. `fetchFn`
 * is injected throughout, so no real network call is ever made — same
 * convention as tests covering api/_googleOAuth.js.
 *
 * Usage: node tests/email-notification-transport.unit.mjs
 */
import { sendParentNotificationEmail } from "../api/_emailNotificationTransport.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

const ORIGINAL_API_KEY = process.env.RESEND_API_KEY;
const ORIGINAL_FROM = process.env.RESEND_FROM_EMAIL;
function setEnv({ apiKey, from }) {
  if (apiKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = apiKey;
  if (from === undefined) delete process.env.RESEND_FROM_EMAIL; else process.env.RESEND_FROM_EMAIL = from;
}
function restoreEnv() {
  setEnv({ apiKey: ORIGINAL_API_KEY, from: ORIGINAL_FROM });
}

// ============ Missing configuration fails safe, never throws ============
{
  setEnv({ from: "notifications@example.com" }); // no API key
  const result = await sendParentNotificationEmail({ to: "parent@example.com", subject: "s", text: "t" });
  ok("Missing RESEND_API_KEY: returns { ok: false } rather than throwing", result.ok === false);
  ok("... error mentions the missing key", /RESEND_API_KEY/.test(result.error));
  restoreEnv();
}
{
  setEnv({ apiKey: "key_123" }); // no from address
  const result = await sendParentNotificationEmail({ to: "parent@example.com", subject: "s", text: "t" });
  ok("Missing RESEND_FROM_EMAIL: returns { ok: false } rather than throwing", result.ok === false);
  ok("... error mentions the missing from address", /RESEND_FROM_EMAIL/.test(result.error));
  restoreEnv();
}
{
  setEnv({ apiKey: "key_123", from: "notifications@example.com" });
  const result = await sendParentNotificationEmail({ to: "", subject: "s", text: "t" });
  ok("Missing/empty recipient: returns { ok: false } rather than throwing or calling the network", result.ok === false);
  restoreEnv();
}

// ============ Success path ============
{
  setEnv({ apiKey: "key_123", from: "notifications@example.com" });
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200 };
  };
  const result = await sendParentNotificationEmail({ to: "parent@example.com", subject: "Hi", text: "Body" }, { fetchFn });

  ok("Provider success: returns { ok: true }", result.ok === true);
  ok("Calls the Resend emails endpoint", calls[0].url === "https://api.resend.com/emails");
  ok("Uses POST", calls[0].options.method === "POST");
  ok("Sends the API key as a Bearer Authorization header (never in the body/URL)", calls[0].options.headers.Authorization === "Bearer key_123");
  const body = JSON.parse(calls[0].options.body);
  ok("Request body carries from/to/subject/text exactly as given", body.from === "notifications@example.com" && body.to === "parent@example.com" && body.subject === "Hi" && body.text === "Body");
  ok("Request body has no 'html' field (plain text only, per MVP scope)", !("html" in body));
  restoreEnv();
}

// ============ Provider failure (non-2xx) ============
{
  setEnv({ apiKey: "key_123", from: "notifications@example.com" });
  const fetchFn = async () => ({ ok: false, status: 422, text: async () => "Invalid `to` field" });
  const result = await sendParentNotificationEmail({ to: "parent@example.com", subject: "Hi", text: "Body" }, { fetchFn });

  ok("Non-2xx provider response: returns { ok: false }, never throws", result.ok === false);
  ok("... error carries the provider's status", /422/.test(result.error));
  restoreEnv();
}

// ============ Network-level failure ============
{
  setEnv({ apiKey: "key_123", from: "notifications@example.com" });
  const fetchFn = async () => { throw new Error("ECONNRESET"); };
  const result = await sendParentNotificationEmail({ to: "parent@example.com", subject: "Hi", text: "Body" }, { fetchFn });

  ok("A thrown network error is caught and reported as { ok: false }, never propagated", result.ok === false);
  ok("... error message is preserved", result.error === "ECONNRESET");
  restoreEnv();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
