import OpenAI from "openai";
import type { BulletChange } from "./resumeRevampAI.js";

const MODEL = "gpt-4.1";

function getClient(): OpenAI {
  const apiKey = process.env.OPEN_AI_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI API key not configured.");
  return new OpenAI({ apiKey });
}

export async function regenerateStudioChanges(params: {
  uploadedResumeText: string;
  parsedResume: unknown;
  revampedResume: unknown;
  adminPrompt?: string;
}): Promise<BulletChange[]> {
  const client = getClient();
  const { uploadedResumeText, parsedResume, revampedResume, adminPrompt } = params;

  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a senior resume coach for Mentorque. Generate high-quality, specific resume change cards by comparing original vs revamped resume content. " +
          "Return JSON ONLY in this shape: {\"changes\":[{id,section,sectionIndex?,bulletIndex?,original,revised,reason,category,guidelineRef,metricHighlight?,coachTip}]}. " +
          "Rules: section in [experience,projects,summary,skills]. category in [Quantification,Action Verb,Impact Clarity,XYZ Formula,Brevity,Tense Fix,Pronoun Removal,ATS Optimization]. " +
          "Only include meaningful changes (no trivial punctuation-only edits). Keep reason/coachTip concrete, not generic.",
      },
      {
        role: "user",
        content:
          "Candidate raw uploaded resume text:\n" +
          uploadedResumeText.slice(0, 12000) +
          "\n\nParsed original resume JSON:\n" +
          JSON.stringify(parsedResume, null, 2).slice(0, 70000) +
          "\n\nCurrent revamped resume JSON:\n" +
          JSON.stringify(revampedResume, null, 2).slice(0, 70000) +
          (adminPrompt?.trim()
            ? `\n\nAdmin guidance (prioritize this):\n${adminPrompt.trim().slice(0, 4000)}`
            : "") +
          "\n\nGenerate 6-24 strongest, user-facing changes across sections. Prefer quantifiable and clarity improvements.",
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("No response from OpenAI while regenerating changes.");
  const parsed = JSON.parse(raw) as { changes?: any[] };
  const list = Array.isArray(parsed.changes) ? parsed.changes : [];

  return list.map((c, i) => ({
    id: typeof c.id === "string" && c.id.trim() ? c.id : `regen-${i}`,
    section: c.section,
    sectionIndex:
      typeof c.sectionIndex === "number" ? c.sectionIndex : undefined,
    bulletIndex: typeof c.bulletIndex === "number" ? c.bulletIndex : undefined,
    original: String(c.original ?? ""),
    revised: String(c.revised ?? ""),
    reason: String(c.reason ?? "Updated for clearer impact and readability."),
    category: c.category ?? "Impact Clarity",
    guidelineRef: String(
      c.guidelineRef ?? "Rule 5 — Show impact, not just activity",
    ),
    metricHighlight:
      typeof c.metricHighlight === "string" ? c.metricHighlight : undefined,
    coachTip: String(
      c.coachTip ??
        "Lead with action, include measurable impact, and keep bullets concise.",
    ),
  }));
}

