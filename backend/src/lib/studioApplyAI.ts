/**
 * Two-step AI pipeline for admin "Make Changes" in Resume Studio:
 * 1) Turn PDF annotation threads into JSON-path action items
 * 2) Merge those actions into a full resume object for the compiler
 */

import OpenAI from "openai";

const MODEL = "gpt-4.1";

function getClient(): OpenAI {
  const apiKey = process.env.OPEN_AI_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI API key not configured.");
  return new OpenAI({ apiKey });
}

export interface StudioActionItem {
  path: string;
  instruction: string;
}

/** Flat outline of dot-paths and array slots for the model to reference. */
export function buildResumeSchemaOutline(
  resume: unknown,
  maxLines = 140,
): string {
  const lines: string[] = [];
  const walk = (v: unknown, path: string, depth: number): void => {
    if (lines.length >= maxLines || depth > 12) return;
    if (v === null || v === undefined) {
      lines.push(`${path} = null`);
      return;
    }
    if (Array.isArray(v)) {
      lines.push(`${path}: array(length=${v.length})`);
      if (
        v.length > 0 &&
        typeof v[0] === "object" &&
        v[0] !== null &&
        !Array.isArray(v[0])
      ) {
        walk(v[0], `${path}[0]`, depth + 1);
      }
      return;
    }
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      for (const k of Object.keys(o)) {
        const p = path ? `${path}.${k}` : k;
        const val = o[k];
        if (
          typeof val === "string" ||
          typeof val === "number" ||
          typeof val === "boolean"
        ) {
          lines.push(`${p}`);
        } else {
          walk(val, p, depth + 1);
        }
      }
      return;
    }
    lines.push(`${path}`);
  };
  walk(resume, "root", 0);
  return lines.slice(0, maxLines).join("\n");
}

export function formatFeedbackThreads(
  highlights: Array<{
    id: string;
    content?: { text?: string };
    comments?: unknown[];
  }>,
): string {
  const parts: string[] = [];
  for (const h of highlights) {
    const selected =
      typeof h.content?.text === "string" ? h.content.text : "";
    parts.push(`\n### Highlight ${h.id}\nSelected PDF text: ${selected}\n`);
    const comments = Array.isArray(h.comments) ? h.comments : [];
    for (const c of comments as Array<{
      type?: string;
      text?: string;
      inReplyToId?: string | null;
    }>) {
      const kind = c?.type === "ai" ? "AI" : "Human";
      const t = String(c?.text ?? "");
      const rid = c?.inReplyToId
        ? ` (reply to comment ${c.inReplyToId})`
        : "";
      parts.push(`- [${kind}]${rid}: ${t}\n`);
    }
  }
  return parts.join("");
}

export async function extractActionItemsFromFeedback(
  feedbackDigest: string,
  schemaOutline: string,
): Promise<StudioActionItem[]> {
  const client = getClient();
  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You extract concrete resume edit instructions from PDF annotation threads (AI + human notes and replies).
Return JSON: { "items": [ { "path": "json.path.using.dot.notation", "instruction": "specific change" } ] }
Rules:
- Paths must match the resume object: use dot notation and array indices like experience[0].highlights[1] or projects[2].description.
- Skip meta-requests that cannot map to the schema (e.g. "make PDF prettier").
- Each item should be actionable (replace text, add bullet, fix date, etc.).
- If nothing maps cleanly, return { "items": [] }.`,
      },
      {
        role: "user",
        content: `Resume schema outline (paths/keys):\n${schemaOutline}\n\n---\nThreads:\n${feedbackDigest.slice(0, 120000)}`,
      },
    ],
  });
  const txt = completion.choices[0]?.message?.content ?? "{}";
  const data = JSON.parse(txt) as { items?: StudioActionItem[] };
  const items = Array.isArray(data.items) ? data.items : [];
  return items.filter(
    (i) =>
      typeof i.path === "string" &&
      i.path.trim() &&
      typeof i.instruction === "string" &&
      i.instruction.trim(),
  );
}

export async function generateResumeFromActions(
  currentResume: unknown,
  actionItems: StudioActionItem[],
): Promise<unknown> {
  const client = getClient();
  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.15,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You output a single JSON object with key "resume" containing the COMPLETE updated resume.
Merge ACTION ITEMS into CURRENT RESUME. Preserve structure and all sections unless an instruction removes something explicitly.
Arrays must remain valid (same object shapes). Do not return partial resumes.`,
      },
      {
        role: "user",
        content: JSON.stringify(
          { currentResume, actionItems },
          null,
          0,
        ).slice(0, 120000),
      },
    ],
  });
  const txt = completion.choices[0]?.message?.content ?? "{}";
  const data = JSON.parse(txt) as { resume?: unknown };
  if (data.resume !== undefined && typeof data.resume === "object" && data.resume !== null) {
    return data.resume;
  }
  throw new Error("Model did not return a valid { resume: object }.");
}
