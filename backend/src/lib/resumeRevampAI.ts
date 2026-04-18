/**
 * resumeRevampAI.ts
 * Location: backend/src/lib/resumeRevampAI.ts
 *
 * Two AI operations for the resume revamp step:
 *   1. generateQuestionsFromResume  — produces 5-7 targeted profile questions
 *   2. revampResume                 — rewrites the resume per Mentorque guidelines
 *                                     and returns a structured per-bullet diff
 */

import OpenAI from 'openai';

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
  /** Question input type — 'text' for free-form, 'mcq' for multiple choice */
  questionType: 'text' | 'mcq';
  /** Options for MCQ questions */
  options?: string[];
  /** Which section of the resume this question targets (informational) */
  section: 'experience' | 'skills' | 'summary' | 'general';
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

export async function generateQuestionsFromResume(
  parsedResume: any,
  context?: QuestionGenerationContext,
): Promise<RevampQuestion[]> {
  const client = getClient();

  const { workExperience = {}, preferences = {} } = context ?? {};

  // Build a compact resume summary (avoid blowing token budget)
  const resumeSummary = {
    name: `${parsedResume.personalInfo?.firstName || ''} ${parsedResume.personalInfo?.lastName || ''}`.trim(),
    currentTitle: parsedResume.experience?.[0]?.position,
    summary: parsedResume.professionalSummary?.slice(0, 300),
    experienceRoles: (parsedResume.experience || []).map((e: any) => `${e.position} @ ${e.company} (${e.startDate ?? ''}–${e.endDate ?? ''})`),
    skills: (parsedResume.skills || []).slice(0, 20),
    projects: (parsedResume.projects || []).map((p: any) => p.name),
    educationInstitutions: (parsedResume.education || []).map((e: any) => e.institution),
  };

  // Build context block — what we ALREADY KNOW (so AI doesn't ask again)
  const knownContext: string[] = [];
  if (preferences.targetRole) knownContext.push(`Target role: ${preferences.targetRole}`);
  if (preferences.seniority) knownContext.push(`Target seniority: ${preferences.seniority}`);
  if (preferences.country) knownContext.push(`Target country/market: ${preferences.country}`);
  if (preferences.workStyle) knownContext.push(`Preferred work style: ${preferences.workStyle}`);
  if (workExperience.company) knownContext.push(`Current/most recent company: ${workExperience.company}`);
  if (workExperience.jobTitle) knownContext.push(`Current job title: ${workExperience.jobTitle}`);
  if (workExperience.yearsExp) knownContext.push(`Years of experience: ${workExperience.yearsExp}`);
  if (workExperience.teamSize) knownContext.push(`Team size managed/worked in: ${workExperience.teamSize}`);
  if (workExperience.impact) knownContext.push(`Self-reported key impact: ${workExperience.impact}`);
  if (workExperience.revenueImpact) knownContext.push(`Revenue/cost impact mentioned: ${workExperience.revenueImpact}`);
  if (workExperience.topStat) knownContext.push(`Top achievement stat: ${workExperience.topStat}`);

  const knownContextBlock = knownContext.length
    ? `━━━ WHAT WE ALREADY KNOW (DO NOT ASK ABOUT THESE AGAIN) ━━━\n${knownContext.join('\n')}`
    : '';

  const prompt = `You are a world-class career coach at Mentorque, a professional mentorship platform.

Your task: Generate exactly 5 laser-focused questions that will unlock information MISSING from this candidate's resume, so a human career expert can craft a truly differentiated, metrics-rich resume revamp targeting the role and seniority described below.

${knownContextBlock}

━━━ CANDIDATE RESUME SUMMARY ━━━
${JSON.stringify(resumeSummary, null, 2)}

━━━ YOUR GOAL ━━━
Generate 5 questions that surface ONLY what we DON'T already know:
- Specific measurable achievements or metrics NOT yet mentioned (numbers, %, $, scale)
- What makes this candidate stand out vs other ${preferences.seniority ?? 'senior'} ${preferences.targetRole ?? 'candidates'} in ${preferences.country ?? 'their market'}
- A notable career-defining project or win that didn't make it onto the resume
- Any domain/industry expertise or niche skills that differentiate them for this target role
- Anything a ${preferences.targetRole ?? 'hiring manager'} at a top company would immediately want to know

DO NOT ask about: target role, target country, years of experience, team size, or anything in the "WHAT WE ALREADY KNOW" section above.

MIX question types strategically:
- Use "mcq" where you can offer meaningful, role-specific choices (e.g. domain specialization, key strength category)
- Use "text" for open-ended questions requiring the candidate's personal context and specific examples

Return ONLY a JSON object with a "questions" array. No markdown, no preamble.

Schema:
{
  "questions": [
    {
      "id": "q1",
      "question": "Specific question — reference their actual companies/roles/projects where possible",
      "hint": "Short guidance or example answer (1 sentence)",
      "questionType": "text" | "mcq",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "section": "experience" | "skills" | "summary" | "general"
    }
  ]
}

Rules:
- Exactly 5 questions
- At least 2 MCQ and at least 2 text questions
- MCQ options must be tailored to THIS candidate's background and target role
- Questions must feel like they come from someone who read the resume carefully
- NO generic questions ("What are your strengths?", "Where do you want to be in 5 years?")`;

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: 'You are an expert career coach. Return only valid JSON with a "questions" array.' },
      { role: 'user', content: prompt },
    ],
    temperature: 0.45,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content || '{"questions":[]}';
  const parsed = JSON.parse(content);
  const questions: RevampQuestion[] = parsed.questions || [];

  // Ensure IDs and questionType are stable
  return questions.map((q, i) => ({
    ...q,
    id: q.id || `q${i + 1}`,
    questionType: q.questionType || 'text',
  }));
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

Be thorough — every suboptimal bullet should be improved. Quality over speed on the justifications.`;

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: 'You are an expert resume writer. Return only valid JSON, no markdown.' },
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
    changes,
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