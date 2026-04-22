/**
 * resumeRevampAI.ts
 * Location: backend/src/lib/resumeRevampAI.ts
 *
 * Two AI operations for the resume revamp step:
 *   1. generateQuestionsFromResume  — produces 7-10 targeted profile questions
 *   2. revampResume                 — rewrites the resume per Mentorque guidelines
 *                                     and returns a structured per-bullet diff
 */

import OpenAI from 'openai';
import { buildPlaybookPromptContext } from "./playbookPromptContext.js";

const MODEL = 'gpt-4.1';

function getClient(): OpenAI {
  const apiKey = process.env.OPEN_AI_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OpenAI API key not configured.');
  return new OpenAI({ apiKey });
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RevampQuestion {
  id: string;
  question: string;
  hint: string;
  /**
   * `text` — free-form answer.
   * `mcq_multi` — pick **all** that apply; options shown as multi-select. Legacy `mcq` is treated as multi-select in the UI.
   */
  questionType: 'text' | 'mcq' | 'mcq_multi';
  /** Options for MCQ / multi-select; **last option should be exactly `Other`** when choices need a catch‑all */
  options?: string[];
  /** Which section of the resume this question targets (informational) */
  section: 'experience' | 'skills' | 'summary' | 'general' | 'transition' | 'achievements';
}

export type ChangeSection = 'experience' | 'projects' | 'summary' | 'skills';

/** The type of writing improvement applied to the bullet */
export type ChangeCategory =
  | 'Quantification'
  | 'Action Verb'
  | 'Impact Clarity'
  | 'XYZ Formula'
  | 'Brevity'
  | 'Tense Fix'
  | 'Pronoun Removal'
  | 'ATS Optimization';

export interface BulletChange {
  /** Stable ID for React keying and accept/reject tracking */
  id: string;
  section: ChangeSection;
  /** Index into resume.experience[] or resume.projects[] (undefined for summary/skills) */
  sectionIndex?: number;
  /** Index into the highlights[] array (undefined for summary/skills) */
  bulletIndex?: number;
  original: string;
  revised: string;

  // ─── Rich justification fields ───────────────────────────────────────────────

  /** One-sentence explanation of what was improved and why */
  reason: string;
  /** Primary category of improvement — drives the UI badge colour */
  category: ChangeCategory;
  /**
   * Which of the 10 Mentorque guidelines was the primary driver.
   * Format: "Rule N — <short rule name>"
   * e.g. "Rule 2 — Quantify ALL achievements"
   */
  guidelineRef: string;
  /**
   * If a specific metric was introduced or made more precise, quote it here.
   * Include its source in parentheses: "(from candidate answer)" or "(inferred from role)".
   * Omit the field entirely if no metric was added/changed.
   */
  metricHighlight?: string;
  /**
   * 1-2 sentences from a hiring-manager perspective explaining why this
   * category of change matters during resume screening.
   */
  coachTip: string;
}

export interface RevampResult {
  revampedResume: any;
  changes: BulletChange[];
}

// ── Context types ─────────────────────────────────────────────────────────────

export interface QuestionGenerationContext {
  workExperience?: {
    company?: string;
    jobTitle?: string;
    yearsExp?: string;
    teamSize?: string;
    impact?: string;
    revenueImpact?: string;
    topStat?: string;
  };
  preferences?: {
    targetRole?: string;
    country?: string;
    seniority?: string;
    workStyle?: string;
  };
}

// ─── 1. Question generation ───────────────────────────────────────────────────

// ── helpers ──────────────────────────────────────────────────────────────────

/** Pull bullets that contain a measurable stat (%, $, x multiplier, or a bare number) */
function extractStatBullets(experience: any[]): { bullet: string; company: string; role: string }[] {
  const statPattern = /(\d+\s*%|[\$£€]\s*\d+|\d+x|\d+X|\b\d{2,}\b)/;
  const hits: { bullet: string; company: string; role: string }[] = [];

  for (const exp of (experience || []).slice(0, 2)) {
    for (const bullet of (exp.highlights || [])) {
      if (statPattern.test(bullet)) {
        hits.push({ bullet, company: exp.company ?? '', role: exp.position ?? '' });
        if (hits.length >= 4) return hits; // cap early
      }
    }
  }
  return hits;
}

// ── main function ─────────────────────────────────────────────────────────────

export async function generateQuestionsFromResume(
  parsedResume: any,
  context?: QuestionGenerationContext,
): Promise<RevampQuestion[]> {
  const client = getClient();

  const { workExperience = {}, preferences = {} } = context ?? {};

  const latestExp    = parsedResume.experience?.[0];
  const latestRole   = latestExp?.position ?? workExperience.jobTitle ?? '';
  const latestCompany = latestExp?.company ?? workExperience.company ?? '';
  const anchorBullet = latestExp?.highlights?.[0] ?? '';
  const targetRole   = preferences.targetRole ?? '';
  const isPivot      =
    targetRole &&
    latestRole &&
    !targetRole.toLowerCase().includes(latestRole.toLowerCase().split(' ')[0]);

  // Pull up to 4 bullets that already contain a measurable stat
  const statBullets = extractStatBullets(parsedResume.experience || []);
  // Pick the 2 best ones for the "business impact translation" questions
  const impactTargets = statBullets.slice(0, 2);

  const snapshot = {
    latestRole,
    latestCompany,
    anchorBullet,
    statBulletsFound: statBullets.map(b => `"${b.bullet}" (${b.role} @ ${b.company})`),
    previousRoles: (parsedResume.experience || [])
      .slice(1, 3)
      .map((e: any) => `${e.position} @ ${e.company}`),
    skills: (parsedResume.skills || []).slice(0, 15),
    projects: (parsedResume.projects || []).map((p: any) => p.name).slice(0, 4),
    education: (parsedResume.education || []).map((e: any) => e.institution),
    hasCertifications: (parsedResume.certifications || []).length > 0,
    certifications: (parsedResume.certifications || []).map((c: any) => c.name).slice(0, 3),
    targetRole,
  };

  const known: string[] = [];
  if (preferences.targetRole)       known.push(`Target role: ${preferences.targetRole}`);
  if (preferences.seniority)        known.push(`Target seniority: ${preferences.seniority}`);
  if (preferences.country)          known.push(`Target country: ${preferences.country}`);
  if (workExperience.yearsExp)      known.push(`Years of experience: ${workExperience.yearsExp}`);
  if (workExperience.teamSize)      known.push(`Team size: ${workExperience.teamSize}`);
  if (workExperience.revenueImpact) known.push(`Revenue impact: ${workExperience.revenueImpact}`);

  const knownBlock = known.length
    ? `DO NOT ask about any of the following — we already have this:\n${known.join('\n')}`
    : '';

  const roleHintForPlaybook = [preferences.targetRole, workExperience.jobTitle, latestRole]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 2000);
  const { contextBlock: fullPlaybookBlock } = buildPlaybookPromptContext({
    resume: parsedResume,
    roleHint: roleHintForPlaybook,
  });
  const playbookQuestionBlock = fullPlaybookBlock.trim()
    ? `━━━ RESUME TRACK HINT (for tailoring only — not a fact source) ━━━
${fullPlaybookBlock.slice(0, 2800)}
Use this to steer vocabulary, sector options, and what "good" looks like for their path. Never quote playbook headings in the questions themselves. Do not mention PageIndex, trees, or playbooks to the candidate.\n\n`
    : '';

  // Build the two stat-translation question specs inline so the AI just fills them in
  const statQuestionSpecs = impactTargets.length > 0
    ? impactTargets.map(({ bullet, company, role }, i) =>
        `[STAT IMPACT ${i + 1}] They wrote: "${bullet}" (${role} @ ${company}). In a warm, curious tone (not an audit), ask what that number meant for the business — revenue, cost, growth, churn, etc. One sentence; quote their exact stat so they feel seen.`,
      ).join('\n\n')
    : `[STAT IMPACT 1] Warmly ask what the most significant metric in their latest role at ${latestCompany} meant for the company in human terms.
[STAT IMPACT 2] Warmly ask about a second result they drove — what mattered downstream?`;

  /** Domain depth + target role: pivot vs aligned vs unknown target */
  const domainAndTargetSlot = (() => {
    const tr = targetRole.trim();
    if (!tr) {
      return `[DOMAIN EXPERIENCE] Ask one warm, readable question about where their **domain** experience runs deepest — the problem space, users, or technical slice they truly understand (you can lightly reference "${latestRole || 'their work'}" if it helps). Not jargon for jargon's sake. questionType "text".`;
    }
    if (isPivot) {
      return `[DOMAIN & WHY THIS TARGET] They chose target role "${tr}" while their recent focus is "${latestRole || 'their background'}". Ask **one** kind question that blends: (a) what draws them toward "${tr}", and (b) what from their **domain** experience they want to bring forward — or what they're honest about learning next. Curious, never skeptical. questionType "text".`;
    }
    return `[DOMAIN CRAFT & TARGET] Their target "${tr}" fits their path from "${latestRole || 'their experience'}". Ask one warm question about the **substance** of their domain experience — what they've really learned to do well in that world (systems, judgment, context) that should show up on the resume. questionType "text".`;
  })();

  const mentorVoice = `VOICE (apply to every question and hint):
You are a warm, encouraging career mentor at Mentorque helping this candidate put their best foot forward.
Sound like a trusted senior colleague who read their resume carefully and genuinely wants them to shine — curious, never cold.
Never interrogate. Questions should not beat around the bush or shouldn't be hard to read & understand, optimal length and nice. Never audit. Human, conversational — one or two sentences per question.`;

  const prompt = `${mentorVoice}

Generate 8–10 questions to enrich this candidate's resume for Mentorque.

${knownBlock}

━━━ CANDIDATE SNAPSHOT ━━━
${JSON.stringify(snapshot, null, 2)}

${playbookQuestionBlock}━━━ QUESTION SLOTS — cover all of these in order ━━━

${statQuestionSpecs}

[TEAM SIZE] Ask in a friendly way how many people were on their team or they managed at ${latestCompany}. But it should not be like you are just asking Team size. It should be about understanding candidate's experience and context.

[TOOLS & TECH] Ask which tools or platforms they use day-to-day that aren't listed or deserve more detail — specific to their domain (${latestRole}). Conversational.

[SECTORS & DOMAIN] Ask which industries or verticals they have the deepest expertise in.
  → Use questionType "mcq_multi" with **3–4 options** tailored to their background, plus **"Other" as the LAST option** so they can multi-select all that apply and elaborate elsewhere.

${domainAndTargetSlot}

[CERTIFICATIONS & ACHIEVEMENTS] ${
    snapshot.hasCertifications
      ? `They have certifications (${snapshot.certifications.join(', ')}). Warmly ask if there are other awards, certs, talks, publications, or honours not on the resume.`
      : `Warmly ask if they have certifications, awards, or recognition (publications, patents, speaking, honours) not yet on the resume.`
  }

[CAREER-DEFINING WIN] Ask for one achievement they're most proud of that's missing or undersold — encouraging, not pressuring.

━━━ RULES ━━━
- Follow VOICE above for every "question" and "hint"
- When RESUME TRACK HINT is present: make [SECTORS & DOMAIN], [TOOLS & TECH], and MCQ options feel native to that path — still strictly grounded in the snapshot (no invented employers or tools they did not plausibly use).
- For STAT IMPACT: quote their exact stat or phrase from the bullet so it's clear you read it
- Do not ask about anything listed under DO NOT ask about
- Hints: one concrete example sentence, still warm (not formal)
- **At least 2 questions** must use questionType **"mcq_multi"** (multi-select — candidate can pick several). Each must include **"Other"** as the **last** option in "options"
- **At least 3 questions** must use questionType **"text"** (include the DOMAIN & TARGET / DOMAIN EXPERIENCE slot as one of them)
- Total: 8–10 questions
- For **mcq_multi** only: provide "options" array (strings). Last item must be exactly **Other**

━━━ OUTPUT ━━━
Return ONLY valid JSON. No markdown, no preamble.

{
  "questions": [
    {
      "id": "q1",
      "question": "...",
      "hint": "warm one-sentence example of a great answer",
      "questionType": "text" | "mcq_multi",
      "options": ["only when questionType is mcq_multi — 4–5 tailored options ending with Other"],
      "section": "experience" | "skills" | "summary" | "transition" | "achievements" | "general"
    }
  ]
}`;

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content:
          'You are a warm Mentorque career mentor. Return only valid JSON with a "questions" array (8–10 items). No markdown, no code fences, no text outside the JSON. Use questionType "mcq_multi" for multi-select questions; include "Other" as the last option when you use options. If a resume track hint appears in the user message, use it only to tailor tone and choices — never as a source of facts about the candidate.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.35,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content || '{"questions":[]}';
  const parsed  = JSON.parse(content);
  const raw: RevampQuestion[] = parsed.questions || [];

  return raw.slice(0, 10).map((q, i) => normalizeGeneratedQuestion(q, i));
}

/** Ensure multi-select shape and trailing Other for choice questions */
function normalizeGeneratedQuestion(q: RevampQuestion, i: number): RevampQuestion {
  let questionType = q.questionType || 'text';
  if (questionType === 'mcq') questionType = 'mcq_multi';

  let options = q.options?.map((o) => String(o).trim()).filter(Boolean);
  if (questionType === 'mcq_multi' && options?.length) {
    const hasOther = options.some((o) => /^other$/i.test(o));
    if (!hasOther) options = [...options, 'Other'];
  }

  return {
    ...q,
    id: q.id || `q${i + 1}`,
    questionType,
    options,
    section: q.section || 'general',
  };
}
// ─── 2. Resume revamp + diff ──────────────────────────────────────────────────

export async function revampResume(
  parsedResume: any,
  answers: Record<string, string>,
): Promise<RevampResult> {
  const client = getClient();

  const answersText = Object.keys(answers).length
    ? Object.entries(answers).map(([id, ans]) => `${id}: ${ans}`).join('\n')
    : 'No additional context provided.';
  const roleHint = Object.values(answers)
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 4000);
  const { domain, contextBlock } = buildPlaybookPromptContext({
    resume: parsedResume,
    roleHint,
  });
  const playbookCoachBlock = contextBlock.trim()
    ? `When writing reason and coachTip fields: tie improvements to what reviewers in this track look for (scope, outcomes, credibility signals) — still grounded in the candidate's facts. Do not mention "playbook", "PageIndex", or "tree" in user-facing strings.`
    : '';

  const prompt = `You are an expert resume writer for Mentorque, a professional mentorship platform.

Revamp the following resume following Mentorque's strict resume guidelines, then output the full revamped resume AND a detailed list of every bullet-level change with rich justification metadata.

━━━ MENTORQUE RESUME GUIDELINES ━━━
Rule 1:  Every bullet must open with a strong past-tense action verb (Developed, Led, Reduced, Built, Delivered, etc.)
Rule 2:  Quantify ALL achievements — add specific numbers, percentages, scale, team size, revenue impact where inferable or stated in candidate's answers
Rule 3:  Use the XYZ formula: "Accomplished [X] as measured by [Y], by doing [Z]"
Rule 4:  Strip filler openers: "responsible for", "helped with", "worked on", "assisted in", "participated in"
Rule 5:  Show impact, not just activity — every bullet must answer "so what?"
Rule 6:  Professional summary: 2-3 sentences, role-targeted, leading with top 3 value propositions, no personal pronouns
Rule 7:  Skills: ATS-optimized, industry-standard terminology
Rule 8:  No personal pronouns anywhere (I, my, we, our)
Rule 9:  Present tense for current role, past tense for all previous
Rule 10: Each bullet 1-2 lines — trim padding, no redundancy

━━━ CHANGE CATEGORY TAXONOMY ━━━
Every change must be classified as exactly one of these categories:
- "Quantification"   → a metric, number, %, $, scale, or team size was added or made more precise
- "Action Verb"      → the opening verb was replaced with a stronger, more specific one
- "Impact Clarity"   → the "so what?" was added — outcome or business impact made explicit
- "XYZ Formula"      → restructured to accomplished [X] measured by [Y] by doing [Z]
- "Brevity"          → filler phrases removed, bullet made tighter without losing meaning
- "Tense Fix"        → verb tense corrected (past for old roles, present for current)
- "Pronoun Removal"  → personal pronouns (I, my, we, our) removed
- "ATS Optimization" → skill or keyword rewritten to industry-standard ATS terminology

━━━ ADDITIONAL CONTEXT FROM CANDIDATE ━━━
${answersText}

${contextBlock}

━━━ ORIGINAL RESUME ━━━
${JSON.stringify(parsedResume, null, 2)}

━━━ OUTPUT REQUIREMENTS ━━━
Return a single JSON object with exactly this structure (no markdown):

{
  "revampedResume": { /* full resume data in the EXACT same schema as the input — all fields preserved */ },
  "changes": [
    {
      "id": "chg-exp-0-0",
      "section": "experience",
      "sectionIndex": 0,
      "bulletIndex": 0,
      "original": "Original bullet text",
      "revised": "Revamped bullet text",
      "reason": "One clear sentence: what specifically was changed and what problem it fixes",
      "category": "Quantification",
      "guidelineRef": "Rule 2 — Quantify ALL achievements",
      "metricHighlight": "Added: 40% reduction in load time (from candidate answer about performance work)",
      "coachTip": "Hiring managers at top tech companies spend 6 seconds on a resume — numbers are the fastest signal of real impact."
    }
  ]
}

━━━ RULES FOR THE CHANGES ARRAY ━━━
Structural rules:
- For experience bullets: section="experience", sectionIndex=index into experience[], bulletIndex=index into highlights[]
- For project bullets: section="projects", sectionIndex=index into projects[], bulletIndex=index into highlights[]
- For summary: section="summary", omit sectionIndex and bulletIndex, original=old summary, revised=new summary
- For individual skills (if changed/added): section="skills", sectionIndex=index in skills[], omit bulletIndex
- id format: "chg-{section}-{sectionIndex??0}-{bulletIndex??0}" — must be unique
- Only include entries where the text was actually changed

Justification rules (CRITICAL — these power the coaching UI):
- reason: 1 sentence, be specific about WHAT was changed ("'responsible for' replaced with 'Engineered'") and WHY ("eliminates passive voice flagged by ATS parsers")
- category: must be exactly one value from the taxonomy above — pick the PRIMARY improvement if multiple apply
- guidelineRef: must be in format "Rule N — <exact rule name from the guidelines above>"
- metricHighlight: ONLY include if a concrete number/% was introduced or made more precise. Quote the exact metric and note its source: "(from candidate answer)", "(inferred from role level)", or "(industry benchmark)". OMIT the field entirely if no metric change occurred.
- coachTip: 1-2 sentences written as if a senior recruiter/hiring manager is speaking. Should explain WHY this category of change improves screening outcomes — not just restate what was done. Make it feel like insider knowledge.
${playbookCoachBlock ? `\n${playbookCoachBlock}\n` : ''}
Summary and skills: mirror the inferred track (${domain}) — lead with the sharpest differentiators for that path, but only when supported by experience or answers.

Be thorough — every suboptimal bullet should be improved. Quality over speed on the justifications.`;

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content:
          'You are an expert resume writer for Mentorque. Return only valid JSON, no markdown. ' +
          'Honor the playbook block in the user message as emphasis and vocabulary only — never fabricate employers, dates, tools, or metrics not implied by the resume or questionnaire.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.5,
    response_format: { type: 'json_object' },
    max_tokens: 8000,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('No response from OpenAI during revamp');

  const result = JSON.parse(content);

  // Guarantee every change has a stable unique id and required fields
  const changes: BulletChange[] = (result.changes || []).map((c: any, i: number) => ({
    ...c,
    id: c.id || `chg-${i}`,
    category: c.category || 'Impact Clarity',
    guidelineRef: c.guidelineRef || 'Rule 5 — Show impact, not just activity',
    coachTip: c.coachTip || 'Strong bullets combine a clear action, a measurable result, and context that shows scope.',
  }));

  return {
    revampedResume: result.revampedResume || parsedResume,
    changes: changes.map((c) => ({
      ...c,
      reason:
        typeof c.reason === "string" && c.reason.trim()
          ? c.reason
          : `Updated for stronger ${domain} resume alignment and clearer impact.`,
    })),
  };
}

// ─── 3. Apply accepted changes back onto a base resume ───────────────────────

/**
 * Given the original parsedResume and the user's accept/reject decisions,
 * build the final merged resume ready for compilation.
 */
export function applyAcceptedChanges(
  originalResume: any,
  revampedResume: any,
  changes: BulletChange[],
  acceptedIds: Set<string>,
): any {
  // Start from a deep clone of the original
  const final = JSON.parse(JSON.stringify(originalResume));

  for (const change of changes) {
    if (!acceptedIds.has(change.id)) continue; // user rejected

    if (change.section === 'summary') {
      final.professionalSummary = change.revised;

    } else if (change.section === 'experience' && change.sectionIndex !== undefined && change.bulletIndex !== undefined) {
      if (final.experience?.[change.sectionIndex]?.highlights) {
        final.experience[change.sectionIndex].highlights[change.bulletIndex] = change.revised;
      }

    } else if (change.section === 'projects' && change.sectionIndex !== undefined && change.bulletIndex !== undefined) {
      if (final.projects?.[change.sectionIndex]?.highlights) {
        final.projects[change.sectionIndex].highlights[change.bulletIndex] = change.revised;
      }

    } else if (change.section === 'skills' && change.sectionIndex !== undefined) {
      if (Array.isArray(final.skills)) {
        final.skills[change.sectionIndex] = change.revised;
      }
    }
  }

  return final;
}