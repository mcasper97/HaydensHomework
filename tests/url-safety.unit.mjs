/**
 * Unit tests for api/_urlSafety.js — the SSRF-safe URL fetching utility
 * that will underpin email-led ingestion's website/Google-Doc fetching
 * (#26, Commit 1). Fully offline: DNS and fetch are both injected/faked,
 * so these tests need no real network access and don't depend on this
 * sandbox's ability to reach arbitrary external domains.
 *
 * Usage: node tests/url-safety.unit.mjs
 */
import { isBlockedIp, checkUrlSafety, safeFetch, DEFAULT_MAX_REDIRECTS } from "../api/_urlSafety.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

// ============ isBlockedIp: IPv4 ============
ok("Blocks loopback 127.0.0.1", isBlockedIp("127.0.0.1", 4));
ok("Blocks 10.x private range", isBlockedIp("10.1.2.3", 4));
ok("Blocks 172.16-31.x private range", isBlockedIp("172.16.0.5", 4));
ok("Blocks 172.31.x (top of the private range)", isBlockedIp("172.31.255.254", 4));
ok("Does NOT block 172.32.x (just outside the private range)", !isBlockedIp("172.32.0.1", 4));
ok("Blocks 192.168.x private range", isBlockedIp("192.168.1.1", 4));
ok("Blocks link-local 169.254.x", isBlockedIp("169.254.1.1", 4));
ok("Blocks the cloud metadata service address specifically", isBlockedIp("169.254.169.254", 4));
ok("Blocks 0.0.0.0", isBlockedIp("0.0.0.0", 4));
ok("Blocks the broadcast address 255.255.255.255", isBlockedIp("255.255.255.255", 4));
ok("Blocks CGNAT 100.64.x", isBlockedIp("100.64.0.1", 4));
ok("Blocks multicast 224.x", isBlockedIp("224.0.0.1", 4));
ok("Allows a real public IPv4 (Google DNS, 8.8.8.8)", !isBlockedIp("8.8.8.8", 4));
ok("Allows another real public IPv4 (Cloudflare DNS, 1.1.1.1)", !isBlockedIp("1.1.1.1", 4));

// ============ isBlockedIp: IPv6 ============
ok("Blocks IPv6 loopback ::1", isBlockedIp("::1", 6));
ok("Blocks IPv6 unspecified ::", isBlockedIp("::", 6));
ok("Blocks IPv6 unique-local fc00::/7", isBlockedIp("fd00::1", 6));
ok("Blocks IPv6 link-local fe80::/10", isBlockedIp("fe80::1", 6));
ok("Blocks IPv6 multicast ff00::/8", isBlockedIp("ff02::1", 6));
ok("Blocks IPv4-mapped IPv6 wrapping a private address (bypass vector)", isBlockedIp("::ffff:127.0.0.1", 6));
ok("Blocks IPv4-mapped IPv6 wrapping the metadata service", isBlockedIp("::ffff:169.254.169.254", 6));
ok("Allows a real public IPv6 address (Google DNS)", !isBlockedIp("2001:4860:4860::8888", 6));

// ============ isBlockedIp: fails closed on malformed/unrecognized input ============
ok("Fails closed on a malformed IPv4-looking string", isBlockedIp("999.999.999.999", 4));
ok("Fails closed on garbage input with no recognizable family", isBlockedIp("not-an-ip", undefined));

// ============ checkUrlSafety: scheme validation ============
{
  const r = await checkUrlSafety("ftp://example.com/file");
  ok("Rejects non-http(s) scheme (ftp)", !r.safe && r.reason === "unsupported_scheme");
}
{
  const r = await checkUrlSafety("file:///etc/passwd");
  ok("Rejects file:// scheme", !r.safe && r.reason === "unsupported_scheme");
}
{
  const r = await checkUrlSafety("not a url at all");
  ok("Rejects an unparseable URL", !r.safe && r.reason === "invalid_url");
}

// ============ checkUrlSafety: embedded credentials (userinfo) ============
{
  const r = await checkUrlSafety("https://user@example.com/page");
  ok("Rejects a URL with an embedded username", !r.safe && r.reason === "embedded_credentials");
}
{
  const r = await checkUrlSafety("https://user:password@example.com/page");
  ok("Rejects a URL with an embedded username and password", !r.safe && r.reason === "embedded_credentials");
}
{
  const lookupFn = async () => [{ address: "93.184.216.34", family: 4 }];
  const r = await checkUrlSafety("https://example.com/page", { lookupFn });
  ok("An ordinary public URL with no userinfo is unaffected by the credentials check", r.safe === true);
}

// ============ checkUrlSafety: DNS-driven safety (fully offline via injected lookupFn) ============
{
  const lookupFn = async () => [{ address: "192.168.1.1", family: 4 }];
  const r = await checkUrlSafety("https://internal.example/", { lookupFn });
  ok("Rejects a hostname that resolves to a private IP", !r.safe && r.reason === "private_or_reserved_address");
}
{
  const lookupFn = async () => [{ address: "169.254.169.254", family: 4 }];
  const r = await checkUrlSafety("https://looks-legit.example/", { lookupFn });
  ok("Rejects a hostname that resolves to the metadata service, regardless of hostname text", !r.safe && r.reason === "private_or_reserved_address");
}
{
  // Multi-answer DNS: if ANY resolved address is unsafe, reject the whole thing.
  const lookupFn = async () => [
    { address: "8.8.8.8", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ];
  const r = await checkUrlSafety("https://mixed-answers.example/", { lookupFn });
  ok("Rejects when ANY resolved address (of several) is unsafe", !r.safe && r.reason === "private_or_reserved_address");
}
{
  const lookupFn = async () => [{ address: "93.184.216.34", family: 4 }];
  const r = await checkUrlSafety("https://public-example.test/", { lookupFn });
  ok("Accepts a hostname that resolves only to public addresses", r.safe === true);
}
{
  const lookupFn = async () => { throw new Error("NXDOMAIN"); };
  const r = await checkUrlSafety("https://does-not-resolve.example/", { lookupFn });
  ok("Rejects when DNS resolution fails", !r.safe && r.reason === "dns_resolution_failed");
}

// ============ safeFetch: unsafe URL is rejected WITHOUT ever calling fetch ============
{
  let fetchCalled = false;
  const fetchFn = async () => { fetchCalled = true; throw new Error("should never be called"); };
  const lookupFn = async () => [{ address: "127.0.0.1", family: 4 }];
  const r = await safeFetch("https://internal.example/", { lookupFn, fetchFn });
  ok("safeFetch rejects an unsafe target without invoking fetchFn at all", !r.ok && r.reason === "private_or_reserved_address" && fetchCalled === false);
}

// ============ safeFetch: redirect handling ============
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
          if (i < chunks.length) {
            const value = chunks[i++];
            return { done: false, value };
          }
          return { done: true, value: undefined };
        },
        cancel: async () => {},
      }),
    },
  };
}

{
  const lookupFn = async () => [{ address: "93.184.216.34", family: 4 }];
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url.toString());
    if (calls.length === 1) return fakeResponse({ status: 302, headers: { location: "/final" } });
    return fakeResponse({ status: 200, headers: { "content-type": "text/html" }, chunks: [Buffer.from("<p>hello</p>")] });
  };
  const r = await safeFetch("https://public-example.test/start", { lookupFn, fetchFn });
  ok("Follows a single redirect to a safe target and succeeds", r.ok === true && r.body.toString() === "<p>hello</p>");
  ok("Redirect target is re-validated (same safe lookupFn applied to both hops)", calls.length === 2);
}

{
  // Redirect target resolves to a private IP — must be rejected, not followed.
  let hopCount = 0;
  const lookupFn = async (hostname) => {
    hopCount++;
    if (hostname === "public-example.test") return [{ address: "93.184.216.34", family: 4 }];
    return [{ address: "10.0.0.5", family: 4 }]; // the redirect target — internal
  };
  const fetchFn = async () => fakeResponse({ status: 302, headers: { location: "https://internal-target.example/" } });
  const r = await safeFetch("https://public-example.test/", { lookupFn, fetchFn, maxRedirects: 3 });
  ok("Rejects a redirect whose target resolves to a private IP, never follows it", !r.ok && r.reason === "private_or_reserved_address");
  ok("The redirect target really was checked (lookupFn called for both hostnames)", hopCount === 2);
}

{
  const lookupFn = async () => [{ address: "93.184.216.34", family: 4 }];
  const fetchFn = async () => fakeResponse({ status: 302, headers: { location: "https://public-example.test/loop" } });
  const r = await safeFetch("https://public-example.test/", { lookupFn, fetchFn, maxRedirects: 2 });
  ok("Enforces the redirect cap (too_many_redirects) rather than looping forever", !r.ok && r.reason === "too_many_redirects");
}

// ============ safeFetch: response-size cap ============
{
  const lookupFn = async () => [{ address: "93.184.216.34", family: 4 }];
  const bigChunk = Buffer.alloc(1024, "a");
  const fetchFn = async () =>
    fakeResponse({
      status: 200,
      headers: { "content-type": "text/html" },
      chunks: [bigChunk, bigChunk, bigChunk], // 3KB total
    });
  const r = await safeFetch("https://public-example.test/big", { lookupFn, fetchFn, maxResponseBytes: 2048 });
  ok("Enforces the response-size cap read incrementally from the stream", !r.ok && r.reason === "response_too_large");
}

// ============ safeFetch: never sends credentials/cookies ============
{
  const lookupFn = async () => [{ address: "93.184.216.34", family: 4 }];
  let capturedOptions = null;
  const fetchFn = async (url, options) => {
    capturedOptions = options;
    return fakeResponse({ status: 200, headers: { "content-type": "text/plain" }, chunks: [Buffer.from("ok")] });
  };
  await safeFetch("https://public-example.test/", { lookupFn, fetchFn });
  ok("safeFetch never passes an Authorization header (no headers option accepted at all)", capturedOptions.headers === undefined);
  ok("safeFetch explicitly requests credentials: omit", capturedOptions.credentials === "omit");
  ok("safeFetch uses redirect: manual (never auto-follows)", capturedOptions.redirect === "manual");
}

// ============ Defaults sanity ============
ok("Default max redirects is a small, sane number", DEFAULT_MAX_REDIRECTS === 5);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
