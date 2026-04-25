/**
 * AI helper: turn unresolved PDF annotation comments into a flat list of
 * actionable items that an admin can review and optionally send to the user.
 */

import OpenAI from "openai";

const MODEL = "gpt-4.1-mini";

function getClient(): OpenAI {
  const apiKey = process.env.OPEN_AI_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI API key not configured.");
  return new OpenAI({ apiKey });
}

export interface GenerateActionItemsInput {
  unresolvedComments: string[];
  existingActionItems?: unknown | null;
}

/**
 * Returns `{ general: string[] }` — a sections object compatible with
 * `normalizeActionItems({ sections: generated })`.
 */
export async function generateActionItemsFromUnresolvedComments({
  unresolvedComments,
  existingActionItems,
}: GenerateActionItemsInput): Promise<Record<string, string[]>> {
  const client = getClient();

  const existingBlock =
    existingActionItems && typeof existingActionItems === "object"
      ? `\n\nExisting action items (do not duplicate):\n${JSON.stringify(existingActionItems, null, 2)}`
      : "";

  const commentsBlock = unresolvedComments
    .map((c, i) => `${i + 1}. ${c}`)
    .join("\n");

  const response = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a career coaching assistant helping distill PDF annotation comments into concrete, actionable resume improvement tasks for the candidate.

Rules:
- Each action item must be a clear, standalone instruction the candidate can act on (e.g. "Add a quantified metric to your EPM Group highlight about task fulfillment").
- Be specific — reference the actual content from the comment where possible.
- Avoid vague items like "improve your resume" or duplicating existing items.
- Return a JSON object with a single key "general" whose value is an array of action item strings.
- Maximum 10 items total.${existingBlock}`,
      },
      {
        role: "user",
        content: `Here are the unresolved annotation comments from the candidate's resume PDF:\n\n${commentsBlock}\n\nGenerate concise action items.`,
      },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = {};
  }

  const sections: Record<string, string[]> = {};
  if (parsed && typeof parsed === "object") {
    for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(val)) {
        sections[key] = val
          .map((v) => (typeof v === "string" ? v.trim() : ""))
          .filter(Boolean);
      }
    }
  }

  if (Object.keys(sections).length === 0) {
    sections.general = [];
  }

  return sections;
}
