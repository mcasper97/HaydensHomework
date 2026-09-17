import Anthropic from "@anthropic-ai/sdk";
import { requireFirebaseUser, checkRateLimit } from "./_auth.js";
import { FORM_TYPES, SUBJECT_OPTIONS } from "../src/data/itemTypes.js";

/* ============================== Photo/Image Ingestion — Extraction Endpoint ==============================
 * First real ingestion vertical slice: parent uploads a single image (photo
 * of a homework sheet/newsletter/etc.), this endpoint extracts candidate
 * "obligations" (assignments, tests, projects, events...) as structured
 * JSON. It does NOT create SourceRecords, IngestionCandidates, or canonical
 * items — those are all client-side writes (itemsRepository.js pattern),
 * made only after explicit parent review/approval. This endpoint's job ends
 * at "here is a validated, sanitized extraction result."
 *
 * Reuses api/_auth.js exactly as api/parse-homework.js does (real Firebase
 * ID token required, same soft in-memory rate limiter). FORM_TYPES is
 * imported directly from src/data/itemTypes.js — that module has zero
 * imports and no browser/UI dependency, so it is safe to reuse as-is here
 * rather than maintaining a second copy of the item-type enum. "chore" is
 * excluded from FORM_TYPES already (chores aren't creatable through the
 * manual form either), which is exactly the right restriction for an
 * ingestion candidate too.
 */

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TYPE_ENUM_LIST = FORM_TYPES.join(" | ");
const SUBJECT_ENUM_LIST = SUBJECT_OPTIONS.join(" | ");

const SYSTEM_PROMPT = `You are a homework/school-document parser for a family organizer app.
Given a photo of a school document (teacher letter, weekly newsletter, homework sheet, permission slip, etc.),
extract every distinct obligation (something a parent/student needs to know, do, or prepare for) into structured JSON.

Return ONLY valid JSON with this exact shape — no markdown, no explanation:
{
  "obligations": [
    {
      "type": "${TYPE_ENUM_LIST}",
      "title": "string",
      "childName": "string or null",
      "date": "YYYY-MM-DD or null",
      "subject": "${SUBJECT_ENUM_LIST} | null",
      "academicTopic": "string or null",
      "academicUnit": "string or null",
      "preparationRequired": true/false/null,
      "description": "string or null"
    }
  ]
}

Rules:
- type must be one of: ${TYPE_ENUM_LIST}. If unsure, pick the closest match.
- title is required and should be short and specific (e.g. "Friday Spelling Quiz", not "Quiz").
- childName: only fill in if a specific child's name is visibly written on the document; otherwise null. Never guess.
- date: only output a real calendar date in YYYY-MM-DD format if one is stated or clearly computable from the document; otherwise null. Never invent a date.
- subject: must be exactly one of: ${SUBJECT_ENUM_LIST}. Base it strictly on the actual academic content of THIS document, not on assumptions or on what a typical worksheet is about. Examples: a page of sight words, phonics patterns, or reading passages/comprehension questions is "Language Arts - Reading/Comprehension"; a spelling word list is "Language Arts - Spelling"; only use "Math" when the content is actually arithmetic/numbers/math problems. If the obligation has no clear academic subject at all (e.g. a school event, permission slip, or reminder), use null — never default to "Math" or any other subject when you are unsure.
- preparationRequired: true only for test/quiz-like obligations that need studying; otherwise null.
- description: a short plain-language summary of any instructions/details not captured by the other fields; otherwise null.
- If the document contains no useful obligations, return { "obligations": [] }.
- Do not invent obligations that aren't actually in the document.`;

// --- Request validation limits ---
// Image-only for this vertical slice (no PDF, no text/plain — see the
// ingestion planning report). Client is required to downscale/recompress
// before upload; this cap is deliberately well under Vercel's serverless
// function request-body ceiling (~4.5MB) to leave headroom for JSON
// wrapper overhead, not just the base64 payload itself.
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BASE64_LENGTH = 3_500_000; // ~2.6MB raw image content
const MAX_FILENAME_LENGTH = 200;

// --- Output validation limits ---
const MAX_OBLIGATIONS = 20;
const MAX_TITLE_LENGTH = 200;
const MAX_STRING_LENGTH = 500;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isCleanString(value, maxLength = MAX_STRING_LENGTH) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

/**
 * Validates and sanitizes one obligation entry. Returns null if the entry
 * is missing a required field or has an invalid type — dropped, never
 * defaulted/guessed. Partial extraction is expected and fine: a response
 * with 3 obligations where one is malformed still yields 2 valid ones.
 */
function sanitizeObligation(value) {
  if (!value || typeof value !== "object") return null;
  if (!isCleanString(value.type, 40) || !FORM_TYPES.includes(value.type)) return null;
  if (!isCleanString(value.title, MAX_TITLE_LENGTH)) return null;

  const confidence =
    typeof value.extractionConfidence === "number" &&
    Number.isFinite(value.extractionConfidence) &&
    value.extractionConfidence >= 0 &&
    value.extractionConfidence <= 1
      ? value.extractionConfidence
      : null;

  return {
    type: value.type,
    title: value.title.trim(),
    childName: isCleanString(value.childName, 100) ? value.childName.trim() : null,
    date: isCleanString(value.date, 20) && DATE_RE.test(value.date) ? value.date : null,
    // Enum-validated against the app's actual subject list, same pattern as
    // `type` above — a value outside SUBJECT_OPTIONS (or missing/malformed)
    // is dropped to null rather than trusted as free text, so a prompt
    // regression or model drift can't silently write an unreviewable
    // subject string into the dropdown the parent edits before approval.
    subject: SUBJECT_OPTIONS.includes(value.subject) ? value.subject : null,
    academicTopic: isCleanString(value.academicTopic, 100) ? value.academicTopic.trim() : null,
    academicUnit: isCleanString(value.academicUnit, 100) ? value.academicUnit.trim() : null,
    preparationRequired: typeof value.preparationRequired === "boolean" ? value.preparationRequired : null,
    description: isCleanString(value.description, MAX_STRING_LENGTH) ? value.description.trim() : null,
    extractionConfidence: confidence,
  };
}

/**
 * Boundary validation only, same philosophy as api/parse-homework.js's
 * sanitizeExtraction: reject shapes that don't match, clamp everything else.
 * This function's output is a candidate-worthy extraction result — it is
 * never itself a canonical write, and the caller (client) still requires an
 * explicit parent approval before any item is created.
 */
export function sanitizeObligationsResponse(parsed) {
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.obligations)) {
    throw new Error("Model output was not a JSON object with an obligations array");
  }
  const obligations = parsed.obligations
    .map(sanitizeObligation)
    .filter(Boolean)
    .slice(0, MAX_OBLIGATIONS);
  return { obligations };
}

export function isAllowedMimeType(mimeType) {
  return ALLOWED_MIME_TYPES.has(mimeType);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // --- Auth ---
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
    return res.status(400).json({ ok: false, error: "Image is too large — please retake or use a smaller photo." });
  }
  if (typeof mimeType !== "string" || !isAllowedMimeType(mimeType)) {
    return res.status(400).json({ ok: false, error: "Unsupported file type — only JPEG, PNG, or WebP images are supported." });
  }
  if (fileName !== undefined && (typeof fileName !== "string" || fileName.length > MAX_FILENAME_LENGTH)) {
    return res.status(400).json({ ok: false, error: "Invalid file name" });
  }

  try {
    const content = [
      {
        type: "image",
        source: { type: "base64", media_type: mimeType, data: fileData },
      },
      { type: "text", text: "Extract every obligation from this photo of a school document." },
    ];

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    });

    const raw = message.content[0].text.trim();
    const jsonStr = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return res.status(502).json({ ok: false, error: "Could not read this photo — please try a clearer picture." });
    }

    let data;
    try {
      data = sanitizeObligationsResponse(parsed);
    } catch {
      return res.status(502).json({ ok: false, error: "Document parsing returned an unexpected result — please try again." });
    }

    return res.status(200).json({ ok: true, obligations: data.obligations });
  } catch (err) {
    console.error("extract-obligations error:", err);
    return res.status(500).json({ ok: false, error: "Something went wrong processing this photo. Please try again." });
  }
}
