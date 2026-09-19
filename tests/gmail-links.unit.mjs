/**
 * Focused unit tests for api/_extractLinks.js — pure link extraction and
 * classification from an email's HTML body. No network calls (safe
 * fetching itself is api/_urlSafety.js, tested separately).
 *
 * Usage: node tests/gmail-links.unit.mjs
 */
import { extractQualifyingLinks, extractLinksFromPlainText } from "../api/_extractLinks.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

// ============ Basic extraction ============
{
  const html = `<p>See <a href="https://school.edu/newsletter">this week's newsletter</a> for details.</p>`;
  const links = extractQualifyingLinks(html);
  ok("Extracts a plain absolute https link", links.length === 1 && links[0].url === "https://school.edu/newsletter");
  ok("Classifies an ordinary URL as webpage", links[0].type === "webpage");
}
{
  const html = `<a href="http://school.edu/plain-http">link</a>`;
  ok("Accepts plain http (not just https)", extractQualifyingLinks(html)[0].url === "http://school.edu/plain-http");
}

// ============ Non-http(s) / malformed hrefs are dropped ============
{
  ok("Drops a mailto: link", extractQualifyingLinks(`<a href="mailto:teacher@school.edu">email us</a>`).length === 0);
  ok("Drops a tel: link", extractQualifyingLinks(`<a href="tel:+15551234567">call us</a>`).length === 0);
  ok("Drops a relative link (no scheme, nothing to resolve it against in an email)", extractQualifyingLinks(`<a href="/newsletter">link</a>`).length === 0);
  ok("Drops a bare #anchor link", extractQualifyingLinks(`<a href="#top">back to top</a>`).length === 0);
  ok("Drops a malformed href without throwing", (() => {
    try { return extractQualifyingLinks(`<a href="ht!tp://bad">x</a>`).length === 0; } catch { return false; }
  })());
}

// ============ Google Doc classification ============
{
  const html = `<a href="https://docs.google.com/document/d/abc123/edit">permission slip</a>`;
  const links = extractQualifyingLinks(html);
  ok("Classifies a docs.google.com/document/... link as google_doc", links[0].type === "google_doc");
}
{
  const html = `<a href="https://docs.google.com/spreadsheets/d/abc123/edit">signup sheet</a>`;
  const links = extractQualifyingLinks(html);
  ok("A Google Sheets link (not /document/) is classified as an ordinary webpage, not google_doc", links[0].type === "webpage");
}

// ============ Junk-link filtering ============
{
  const cases = [
    "https://school.edu/unsubscribe?id=123",
    "https://mail.school.edu/opt-out",
    "https://school.edu/email-preferences",
    "https://school.edu/manage-subscription",
    "https://school.edu/preference-center",
    "https://school.edu/privacy-policy",
    "https://school.edu/terms-of-service",
    "https://school.edu/view-in-browser?x=1",
  ];
  for (const url of cases) {
    const html = `<a href="${url}">link</a>`;
    ok(`Filters out an obvious junk link (${url})`, extractQualifyingLinks(html).length === 0);
  }
}
{
  const html = `<a href="https://school.edu/UNSUBSCRIBE">Unsubscribe</a>`;
  ok("Junk-keyword matching is case-insensitive", extractQualifyingLinks(html).length === 0);
}

// ============ Dedupe ============
{
  const html = `<a href="https://school.edu/page">first</a> ... <a href="https://school.edu/page">same link again</a>`;
  ok("The same URL appearing twice is only returned once", extractQualifyingLinks(html).length === 1);
}

// ============ 5-link cap ============
{
  const html = Array.from({ length: 8 }, (_, i) => `<a href="https://school.edu/page-${i}">link ${i}</a>`).join(" ");
  const links = extractQualifyingLinks(html);
  ok("Caps qualifying links at 5 even when more are present", links.length === 5);
  ok("Keeps the links in document order (first 5, not last 5 or random)", links[0].url === "https://school.edu/page-0" && links[4].url === "https://school.edu/page-4");
}

// ============ Real-world-shaped HTML (attributes before/after href, single/double quotes) ============
{
  const html = `<a class="btn" href='https://school.edu/rsvp' target="_blank">RSVP here</a>`;
  const links = extractQualifyingLinks(html);
  ok("Extracts href regardless of attribute order or single-quote style", links.length === 1 && links[0].url === "https://school.edu/rsvp");
}

// ============ Empty / no-link input ============
ok("Empty string input returns an empty array", extractQualifyingLinks("").length === 0);
ok("HTML with no <a> tags returns an empty array", extractQualifyingLinks("<p>No links here.</p>").length === 0);
ok("Non-string input returns an empty array, without throwing", extractQualifyingLinks(null).length === 0);

// ============ Tracking/redirect hostnames are NOT blanket-dropped (#26, Commit 5 correction) ============
// A legitimate content link routed through a school communication
// platform's own click-tracking/redirect domain must remain eligible —
// only obvious junk (unsubscribe/legal boilerplate) is filtered, never a
// link merely because its hostname looks like a tracker/redirector.
// safeFetch (api/_urlSafety.js) is what actually follows and revalidates
// each redirect hop; this module never makes a hostname-based judgment.
{
  const cases = [
    "https://click.schoolmessenger.com/f/a/abc123/1/xyz",
    "https://trk.icontact.com/icp/relay.php?r=123&msgid=456",
    "https://links.mailchimp.com/track/click?u=abc&id=def",
    "https://r.mtsend.com/rt/abc123",
  ];
  for (const url of cases) {
    const html = `<a href="${url}">See this week's permission slip</a>`;
    const links = extractQualifyingLinks(html);
    ok(`A content-looking link on a tracking/redirect-shaped hostname is kept, not dropped (${new URL(url).hostname})`, links.length === 1 && links[0].url === url);
  }
}

// ============ extractLinksFromPlainText (#26, Commit 5 correction — plain-text-only emails) ============
{
  const text = "Please see the newsletter: https://school.edu/newsletter for details.";
  const links = extractLinksFromPlainText(text);
  ok("Extracts a bare https URL from plain text", links.length === 1 && links[0].url === "https://school.edu/newsletter");
  ok("Strips trailing sentence punctuation that isn't part of the URL", !links[0].url.endsWith("."));
}
{
  const text = "Two links: https://school.edu/a and https://school.edu/b, check them both.";
  const links = extractLinksFromPlainText(text);
  ok("Extracts multiple bare URLs from plain text", links.length === 2 && links[0].url === "https://school.edu/a" && links[1].url === "https://school.edu/b");
}
{
  const text = "See https://docs.google.com/document/d/abc123/edit for the form.";
  const links = extractLinksFromPlainText(text);
  ok("Classifies a bare Google Doc URL in plain text the same way as in HTML", links[0].type === "google_doc");
}
{
  const text = "Unsubscribe: https://school.edu/unsubscribe?id=1";
  ok("Junk-keyword filtering applies to plain-text-extracted links too", extractLinksFromPlainText(text).length === 0);
}
{
  const text = Array.from({ length: 8 }, (_, i) => `https://school.edu/p${i}`).join(" ");
  ok("Plain-text extraction is capped at 5 links too", extractLinksFromPlainText(text).length === 5);
}
ok("Plain text with no URLs at all returns an empty array", extractLinksFromPlainText("Just some text, no links.").length === 0);
ok("Empty string input returns an empty array", extractLinksFromPlainText("").length === 0);
ok("Non-string input returns an empty array, without throwing", extractLinksFromPlainText(null).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
