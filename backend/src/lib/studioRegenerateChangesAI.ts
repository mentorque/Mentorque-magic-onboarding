import OpenAI from "openai";
import type { BulletChange } from "./resumeRevampAI.js";
import { buildPlaybookPromptContext } from "./playbookPromptContext.js";

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
  const { domain, contextBlock } = buildPlaybookPromptContext({
    resume: revampedResume ?? parsedResume,
    roleHint: adminPrompt,
  });

  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a senior resume coach for Mentorque. Generate change cards by comparing parsed original vs current revamped JSON. " +
          "Return JSON ONLY: {\"changes\":[{id,section,sectionIndex?,bulletIndex?,original,revised,reason,category,guidelineRef,metricHighlight?,coachTip}]}. " +
          "Sections: experience|projects|summary|skills. Categories: Quantification|Action Verb|Impact Clarity|XYZ Formula|Brevity|Tense Fix|Pronoun Removal|ATS Optimization. " +
          "If a PAGEINDEX PLAYBOOK block appears in the user message, use it only for emphasis and recruiter expectations — never invent facts. " +
          "original must match current text in the revamped resume where applicable; revised is the proposed text. " +
          "Skip trivial edits. reason = one specific sentence (what changed + why it helps screening). coachTip = hiring-manager insight, not a repeat of reason.",
      },
      {
        role: "user",
        content:
          (contextBlock ? `${contextBlock}\n\n` : "") +
          "Candidate raw uploaded resume text:\n" +
          uploadedResumeText.slice(0, 12000) +
          "\n\nParsed original resume JSON:\n" +
          JSON.stringify(parsedResume, null, 2).slice(0, 70000) +
          "\n\nCurrent revamped resume JSON:\n" +
          JSON.stringify(revampedResume, null, 2).slice(0, 70000) +
          (adminPrompt?.trim()
            ? `\n\nAdmin guidance (highest priority — interpret literally):\n${adminPrompt.trim().slice(0, 4000)}`
            : "") +
          "\n\nProduce 6-24 change cards, spread across experience (first), then projects, summary, skills as relevant. " +
          "Prioritize bullets that would fail a 6-second skim: weak verbs, missing outcomes, missing scale, or generic skills. " +
          "guidelineRef must match one of: \"Rule 1 — Strong past-tense action verbs\", \"Rule 2 — Quantify ALL achievements\", \"Rule 3 — XYZ formula\", \"Rule 4 — Strip filler openers\", \"Rule 5 — Show impact, not just activity\", \"Rule 6 — Professional summary\", \"Rule 7 — ATS-optimized skills\", \"Rule 8 — No personal pronouns\", \"Rule 9 — Present vs past tense\", \"Rule 10 — Concise bullets\". " +
          "Do not mention playbooks, PageIndex, or trees in reason/coachTip text.",
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
    reason: String(
      c.reason ??
        `Updated for clearer impact, readability, and stronger ${domain} alignment.`,
    ),
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

