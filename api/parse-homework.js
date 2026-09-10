import Anthropic from "@anthropic-ai/sdk";

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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { fileData, mimeType, fileName } = req.body;

  if (!fileData || !mimeType) {
    return res.status(400).json({ error: "Missing fileData or mimeType" });
  }

  try {
    let content;

    if (mimeType === "text/plain") {
      // Plain text — send as text
      const text = Buffer.from(fileData, "base64").toString("utf-8");
      content = [{ type: "text", text: `Homework document (${fileName}):\n\n${text}` }];
    } else if (mimeType === "application/pdf") {
      // PDF — use Claude's document block
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
    } else if (mimeType.startsWith("image/")) {
      // Image — use vision
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
    } else {
      // Fallback: try to read as text
      const text = Buffer.from(fileData, "base64").toString("utf-8");
      content = [{ type: "text", text: `Homework document (${fileName}):\n\n${text}` }];
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
    const parsed = JSON.parse(jsonStr);

    return res.status(200).json({ ok: true, data: parsed });
  } catch (err) {
    console.error("parse-homework error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
