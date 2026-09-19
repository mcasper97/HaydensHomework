/**
 * Unit tests for api/_htmlToText.js — the shared, source-agnostic
 * HTML→readable-text utility for email-led ingestion's website/Google-Doc
 * text extraction (#26, Commit 2). Fully offline: pure string in, string
 * out, no network/DOM dependency at all.
 *
 * Usage: node tests/html-to-text.unit.mjs
 */
import { htmlToReadableText, extractPageTitle } from "../api/_htmlToText.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

// ============ Normal paragraphs ============
{
  const out = htmlToReadableText("<p>First paragraph.</p><p>Second paragraph.</p>");
  ok("Paragraphs are separated (not run together)", out.includes("First paragraph.") && out.includes("Second paragraph.") && !out.includes("paragraph.Second"));
}

// ============ <br> handling ============
{
  const out = htmlToReadableText("Line one<br>Line two<br/>Line three");
  ok("<br> and <br/> both become line breaks", out === "Line one\nLine two\nLine three");
}

// ============ Lists ============
{
  const out = htmlToReadableText("<ul><li>Apples</li><li>Bananas</li><li>Cherries</li></ul>");
  const lines = out.split("\n").filter(Boolean);
  ok("List items appear as separate lines", lines.includes("Apples") && lines.includes("Bananas") && lines.includes("Cherries"));
}

// ============ Headings ============
{
  const out = htmlToReadableText("<h1>Title</h1><p>Body text.</p>");
  ok("Headings are separated from following content", out.includes("Title") && out.includes("Body text.") && !out.includes("TitleBody"));
}

// ============ HTML entities ============
{
  const out = htmlToReadableText("Tom &amp; Jerry isn&#39;t that &quot;fun&quot;&nbsp;today&gt;&lt;?");
  ok("Common named entities decode correctly", out.includes("Tom & Jerry"));
  ok("Numeric entity decodes correctly", out.includes("isn't that"));
  ok("Quot entity decodes correctly", out.includes('"fun"'));
  ok("An entity outside the required set doesn't crash extraction", typeof htmlToReadableText("A &mdash; B") === "string");
}

// ============ Script/style removal ============
{
  const out = htmlToReadableText(
    "<html><head><style>body{color:red}</style></head><body><script>alert('hi')</script><p>Real content.</p></body></html>"
  );
  ok("Script content is removed entirely", !out.includes("alert"));
  ok("Style content is removed entirely", !out.includes("color:red"));
  ok("Real visible content survives script/style removal", out.includes("Real content."));
}
{
  const out = htmlToReadableText("<noscript>Enable JavaScript</noscript><p>Visible.</p>");
  ok("noscript content is removed entirely", !out.includes("Enable JavaScript"));
}

// ============ nav/header/footer removal ============
{
  const out = htmlToReadableText(
    "<header>Site Nav Home About</header><nav>Menu Link Link</nav><main><p>The actual page content.</p></main><footer>Copyright 2024</footer>"
  );
  ok("header content is removed", !out.includes("Site Nav"));
  ok("nav content is removed", !out.includes("Menu Link"));
  ok("footer content is removed", !out.includes("Copyright 2024"));
  ok("Main content survives boilerplate removal", out.includes("The actual page content."));
}

// ============ Table text preservation ============
{
  const out = htmlToReadableText(
    "<table><tr><td>Name</td><td>Due Date</td></tr><tr><td>Book Report</td><td>Friday</td></tr></table>"
  );
  ok("Table header cell text preserved", out.includes("Name"));
  ok("Table cells on the same row are separated, not concatenated", out.includes("Book Report") && out.includes("Friday") && !out.includes("Book ReportFriday"));
  ok("Different rows are distinguishable", out.split("\n").some((l) => l.includes("Book Report")));
}

// ============ Malformed / basic imperfect HTML ============
{
  const out = htmlToReadableText("<p>Unclosed paragraph <b>bold text<div>New block</p>");
  ok("Malformed/unclosed HTML doesn't throw and still yields readable text", out.includes("Unclosed paragraph") && out.includes("bold text") && out.includes("New block"));
}
{
  const out = htmlToReadableText("<p>Stray < angle bracket and > another</p>");
  ok("Stray angle brackets that aren't real tags don't crash extraction", typeof out === "string");
}

// ============ Whitespace collapsing ============
{
  const out = htmlToReadableText("<p>Lots     of      spaces</p>\n\n\n\n<p>and\n\n\n\nblank lines</p>");
  ok("Repeated spaces collapse to one", out.includes("Lots of spaces"));
  ok("Excessive blank lines collapse (no 3+ consecutive newlines)", !/\n{3,}/.test(out));
}
{
  const out = htmlToReadableText("   <p>  padded content  </p>   ");
  ok("Leading/trailing whitespace of the whole result is trimmed", out === out.trim() && out.length > 0);
}

// ============ Empty input ============
{
  ok("Empty string input returns empty string", htmlToReadableText("") === "");
  ok("null input returns empty string (fails closed, doesn't throw)", htmlToReadableText(null) === "");
  ok("undefined input returns empty string (fails closed, doesn't throw)", htmlToReadableText(undefined) === "");
}

// ============ Very large input handling / truncation ============
{
  const bigHtml = "<p>" + "word ".repeat(100000) + "</p>"; // ~500KB
  const out = htmlToReadableText(bigHtml, { maxLength: 1000 });
  ok("maxLength option truncates output to at most that many characters", out.length <= 1000);
}
{
  const bigHtml = "<p>" + "word ".repeat(50000) + "</p>";
  const out = htmlToReadableText(bigHtml);
  ok("Without maxLength, large input is still processed without throwing", typeof out === "string" && out.length > 0);
}

// ============ Source-agnosticism / determinism sanity ============
{
  const html = "<p>Same input, twice.</p>";
  ok("Output is deterministic for the same input", htmlToReadableText(html) === htmlToReadableText(html));
}

// ============ extractPageTitle (#26, Commit 5 live-validation fix — compact source context) ============
ok("Extracts a plain <title>", extractPageTitle("<html><head><title>Ms. Rivera's Classroom</title></head><body></body></html>") === "Ms. Rivera's Classroom");
ok("Decodes HTML entities inside the title", extractPageTitle("<title>Tom &amp; Jerry</title>") === "Tom & Jerry");
ok("Collapses excess whitespace inside the title", extractPageTitle("<title>  Weekly    Update  </title>") === "Weekly Update");
ok("Returns null when there's no <title> tag at all", extractPageTitle("<html><body><p>No title here</p></body></html>") === null);
ok("Returns null for an empty <title></title>", extractPageTitle("<title></title>") === null);
ok("Returns null for a whitespace-only <title>", extractPageTitle("<title>   </title>") === null);
ok("Handles a <title> with attributes", extractPageTitle('<title lang="en">Classroom Page</title>') === "Classroom Page");
ok("Empty string input returns null", extractPageTitle("") === null);
ok("Non-string input returns null, without throwing", extractPageTitle(null) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
