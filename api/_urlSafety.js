/* ============================== SSRF-safe URL fetching utility ==============================
 * Server-side-only helper for safely fetching an external URL (email-linked
 * websites, Google Doc export URLs) without exposing the server to
 * Server-Side Request Forgery: an attacker-controlled or attacker-influenced
 * URL (or redirect target) pointing at loopback/private/link-local
 * addresses — including cloud metadata services like 169.254.169.254 —
 * could otherwise be used to reach internal infrastructure the public
 * internet cannot.
 *
 * Deliberately built on Node's built-in `dns`/`net`/`fetch` only — no new
 * npm dependency. The core pattern (resolve DNS, reject non-public IPs,
 * never auto-follow redirects, re-validate every hop) is the same
 * well-understood approach dedicated SSRF-protection libraries implement;
 * for this app's scale, adding an external dependency for it isn't
 * justified when Node's standard library already provides every primitive
 * needed, and avoids a new supply-chain/version-pinning surface.
 *
 * Known, explicitly accepted limitation: there is a narrow
 * time-of-check-to-time-of-use (TOCTOU) window between resolving a
 * hostname's IP here and the actual TCP connection fetch() makes — a "DNS
 * rebinding" attack could in principle swap the DNS answer in that window.
 * Fully closing this requires pinning the resolved IP for the actual
 * socket connection (a custom low-level http(s) agent), which is real
 * additional complexity not justified for this app's first slice. If this
 * class of attack becomes a real concern, that hardening is a contained,
 * isolated follow-up to this one file — not a reason to avoid shipping
 * the protection this file already provides against the far more likely
 * "obviously internal/private target" case.
 */
import { promises as dnsPromises } from "node:dns";
import net from "node:net";

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_REDIRECTS = 5;
export const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2MB

// --- IPv4 ranges that must never be fetched (private/reserved/loopback/
// link-local/multicast/documentation ranges — a standard, well-known list). ---
const IPV4_BLOCKED_RANGES = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local — includes the 169.254.169.254 cloud metadata service
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
  ["255.255.255.255", 32],
];

function ipv4ToLong(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isBlockedIPv4(ip) {
  const value = ipv4ToLong(ip);
  if (value === null) return true; // malformed — fail closed
  return IPV4_BLOCKED_RANGES.some(([base, prefix]) => {
    const baseValue = ipv4ToLong(base);
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return (value & mask) === (baseValue & mask);
  });
}

// --- IPv6: loopback, unspecified, unique-local, link-local, multicast, and
// IPv4-mapped addresses (unwrapped and re-checked against the IPv4 list —
// a well-known SSRF bypass vector: encoding a private IPv4 as ::ffff:x.x.x.x). ---
function isBlockedIPv6(ip) {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // fc00::/7 unique-local
  if (["fe8", "fe9", "fea", "feb"].some((p) => normalized.startsWith(p))) return true; // fe80::/10 link-local
  if (normalized.startsWith("ff")) return true; // ff00::/8 multicast

  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped) return isBlockedIPv4(mapped[1]);

  return false;
}

/**
 * Pure, network-free classification of a single resolved IP address.
 * Exported for direct unit testing without any DNS/network dependency.
 * Fails closed: anything not recognizable as a public IPv4/IPv6 address is
 * treated as blocked.
 */
export function isBlockedIp(ip, family) {
  if (family === 4 || net.isIPv4(ip)) return isBlockedIPv4(ip);
  if (family === 6 || net.isIPv6(ip)) return isBlockedIPv6(ip);
  return true;
}

/**
 * Resolves a URL's hostname and checks every resolved address against the
 * blocked-range list. `lookupFn` is injectable (defaults to
 * dns.promises.lookup) so this — and safeFetch below — can be unit tested
 * with fake DNS answers, with no real network access required.
 */
export async function checkUrlSafety(urlString, { lookupFn = dnsPromises.lookup } = {}) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return { safe: false, reason: "invalid_url" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { safe: false, reason: "unsupported_scheme" };
  }

  // Reject embedded userinfo (https://user:pass@host/...). There is no
  // legitimate use case for credentials embedded in an email-supplied URL
  // for this app, and it's a known vector for host-confusion/credential
  // exfiltration tricks.
  if (parsed.username || parsed.password) {
    return { safe: false, reason: "embedded_credentials" };
  }

  let addresses;
  try {
    addresses = await lookupFn(parsed.hostname, { all: true });
  } catch {
    return { safe: false, reason: "dns_resolution_failed" };
  }
  if (!Array.isArray(addresses) || addresses.length === 0) {
    return { safe: false, reason: "dns_resolution_failed" };
  }

  const hasUnsafeAddress = addresses.some(({ address, family }) => isBlockedIp(address, family));
  if (hasUnsafeAddress) {
    return { safe: false, reason: "private_or_reserved_address" };
  }

  return { safe: true, url: parsed };
}

/**
 * SSRF-safe GET fetch. Re-validates every redirect hop (never trusts
 * fetch()'s own automatic redirect following), enforces a timeout and a
 * response-size cap read incrementally from the stream (never trusts a
 * possibly-absent-or-lying Content-Length header), and never sends
 * cookies or credentials of any kind — this function accepts no headers
 * parameter at all, by design, so a caller cannot accidentally attach an
 * Authorization/Cookie header to a request going to an arbitrary
 * email-supplied URL.
 *
 * `fetchFn` and `lookupFn` are both injectable for unit testing without
 * real network access.
 */
export async function safeFetch(
  urlString,
  {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
    lookupFn,
    fetchFn = fetch,
  } = {}
) {
  let currentUrl = urlString;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const check = await checkUrlSafety(currentUrl, { lookupFn });
    if (!check.safe) {
      return { ok: false, reason: check.reason, url: currentUrl };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchFn(check.url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        credentials: "omit",
      });
    } catch (err) {
      return { ok: false, reason: err?.name === "AbortError" ? "timeout" : "fetch_failed", url: currentUrl };
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { ok: false, reason: "redirect_without_location", url: currentUrl };
      currentUrl = new URL(location, check.url).toString();
      continue;
    }

    if (!response.ok) {
      return { ok: false, reason: `http_${response.status}`, url: currentUrl };
    }

    const reader = response.body?.getReader?.();
    if (!reader) {
      return { ok: false, reason: "no_response_body", url: currentUrl };
    }

    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxResponseBytes) {
        reader.cancel?.().catch(() => {});
        return { ok: false, reason: "response_too_large", url: currentUrl };
      }
      chunks.push(value);
    }

    return {
      ok: true,
      url: currentUrl,
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      body: Buffer.concat(chunks.map((c) => Buffer.from(c))),
    };
  }

  return { ok: false, reason: "too_many_redirects", url: currentUrl };
}
