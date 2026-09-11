import Anthropic from "@anthropic-ai/sdk";
import { requireFirebaseUser, checkRateLimit } from "./_auth.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a homework parser for an elementary school learning app.
Given a homework document (teacher letter, weekly newsletter, homework sheet, etc.),
extract all learning content into structured JSON.

Return ONLY valid JSON with this exact shape — no markdown, no explanation:
{
  "sightWords": ["string"],
  "spellingWords": ["string"],
  "vocabWords": [{ "word": "string", "definition": "string" }],
  "phonicsWords": [{ "word": "string", "pattern": "string" }],
  "tests": [{ "name": "string", "subject": "string", "date": "string" }]
}

Rules:
- sightWords: simple high-frequency words to recognize by sight (the, and, is, etc.)
- spellingWords: words the student needs to learn to spell
- vocabWords: words with meanings/definitions; infer a simple kid-friendly definition if not given
- phonicsWords: words that illustrate a phonics pattern (sh, ch, silent-e, etc.); infer the pattern from the word if not labeled
- tests: any upcoming quizzes, tests, or assessments with name, subject, and date (ISO format YYYY-MM-DD if possible)
- If a list isn't present in the document, return an empty array for that field
- Clean up words: lowercase, trimmed, no punctuation
- Do not duplicate words across lists`;

// --- Request validation limits ---
const ALLOWED_MIME_TYPES = new Set([
  "text/plain",
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
// Base64 is ~1.33x the raw byte size; cap around ~8MB raw content.
const MAX_BASE64_LENGTH = 11_000_000;
const MAX_FILENAME_LENGTH = 200;

// --- Output validation limits ---
const MAX_LIST_LENGTH = 200;
const MAX_STRING_LENGTH = 200;

function isCleanString(value, maxLength = MAX_STRING_LENGTH) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function sanitizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => isCleanString(v)).slice(0, MAX_LIST_LENGTH);
}

function sanitizeVocabArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => v && typeof v === "object" && isCleanString(v.word))
    .map((v) => ({
      word: v.word,
      definition: isCleanString(v.definition, 500) ? v.definition : "",
    }))
    .slice(0, MAX_LIST_LENGTH);
}

function sanitizePhonicsArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => v && typeof v === "object" && isCleanString(v.word))
    .map((v) => ({
      word: v.word,
      pattern: isCleanString(v.pattern) ? v.pattern : "",
    }))
    .slice(0, MAX_LIST_LENGTH);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function sanitizeTestsArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => v && typeof v === "object" && isCleanString(v.name))
    .map((v) => ({
      name: v.name,
      subject: isCleanString(v.subject) ? v.subject : "General",
      date: isCleanString(v.date, 20) && DATE_RE.test(v.date) ? v.date : "",
    }))
    .slice(0, MAX_LIST_LENGTH);
}

/**
 * Validates and clamps the AI's extracted output before it's ever returned
 * to the client for merge into app state. This endpoint does not decide
 * what gets applied — the client's existing preview/apply UX still does
 * that. This is boundary validation only: reject shapes that don't match,
 * clamp everything else to sane limits.
 */
function sanitizeExtraction(parsed) {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Model output was not a JSON object");
  }
  return {
    sightWords: sanitizeStringArray(parsed.sightWords),
    spellingWords: sanitizeStringArray(parsed.spellingWords),
    vocabWords: sanitizeVocabArray(parsed.vocabWords),
    phonicsWords: sanitizePhonicsArray(parsed.phonicsWords),
    tests: sanitizeTestsArray(parsed.tests),
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // --- Auth ---
  // A UID supplied in the request body is never trusted for identity — only
  // a verified Firebase ID token is. See api/_auth.js.
  let uid;
  try {
    ({ uid } = await requireFirebaseUser(req));
  } catch {
    return res.status(401).json({ ok: false, error: "Authentication required" });
  }

  if (!checkRateLimit(uid)) {
    return res.status(429).json({ ok: false, error: "Too many requests — please wait a few minutes and try again." });
  }

  const { fileData, mimeType, fileName } = req.body || {};

  if (!fileData || !mimeType) {
    return res.status(400).json({ ok: false, error: "Missing fileData or mimeType" });
  }
  if (typeof fileData !== "string" || fileData.length > MAX_BASE64_LENGTH) {
    return res.status(400).json({ ok: false, error: "File is too large" });
  }
  if (typeof mimeType !== "string" || !ALLOWED_MIME_TYPES.has(mimeType)) {
    return res.status(400).json({ ok: false, error: "Unsupported file type" });
  }
  if (fileName !== undefined && (typeof fileName !== "string" || fileName.length > MAX_FILENAME_LENGTH)) {
    return res.status(400).json({ ok: false, error: "Invalid file name" });
  }
  const safeFileName = fileName || "upload";

  try {
    let content;

    if (mimeType === "text/plain") {
      const text = Buffer.from(fileData, "base64").toString("utf-8");
      content = [{ type: "text", text: `Homework document (${safeFileName}):\n\n${text}` }];
    } else if (mimeType === "application/pdf") {
      content = [
        {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: fileData,
          },
        },
        { type: "text", text: "Extract all homework content from this document." },
      ];
    } else {
      // image/jpeg, image/png, image/webp, image/gif — the only remaining
      // allowed types (see ALLOWED_MIME_TYPES above).
      content = [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: mimeType,
            data: fileData,
          },
        },
        { type: "text", text: "Extract all homework content from this image." },
      ];
    }

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    });

    const raw = message.content[0].text.trim();

    // Strip any accidental markdown fences
    const jsonStr = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return res.status(502).json({ ok: false, error: "Could not parse document — please try a clearer scan or a different file." });
    }

    let data;
    try {
      data = sanitizeExtraction(parsed);
    } catch {
      return res.status(502).json({ ok: false, error: "Document parsing returned an unexpected result — please try again." });
    }

    return res.status(200).json({ ok: true, data });
  } catch (err) {
    console.error("parse-homework error:", err);
    return res.status(500).json({ ok: false, error: "Something went wrong processing this document. Please try again." });
  }
}
