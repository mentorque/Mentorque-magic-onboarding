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
  section: 'experience' | 'skills' | 'summary' | 'general' | 'transition';
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

  // Detect whether this is a career pivot or same-track progression
  const currentRole = parsedResume.experience?.[0]?.position ?? workExperience.jobTitle ?? '';
  const targetRole  = preferences.targetRole ?? '';
  const isPivot     = targetRole && currentRole &&
    !targetRole.toLowerCase().includes(currentRole.toLowerCase().split(' ')[0]);

  // Build a compact resume summary (avoid blowing token budget)
  const resumeSummary = {
    name: `${parsedResume.personalInfo?.firstName || ''} ${parsedResume.personalInfo?.lastName || ''}`.trim(),
    currentTitle: currentRole,
    previousRoles: (parsedResume.experience || []).slice(1, 4).map(
      (e: any) => `${e.position} @ ${e.company} (${e.startDate ?? ''}–${e.endDate ?? ''})`,
    ),
    summary: parsedResume.professionalSummary?.slice(0, 300),
    skills: (parsedResume.skills || []).slice(0, 20),
    projects: (parsedResume.projects || []).map((p: any) => p.name),
    educationInstitutions: (parsedResume.education || []).map((e: any) => e.institution),
    // Surface top 3 experience bullets so the AI can spot gaps precisely
    sampleBullets: (parsedResume.experience || []).slice(0, 2).flatMap(
      (e: any) => (e.highlights || []).slice(0, 3),
    ),
  };

  // Build context block — what we ALREADY KNOW (so AI doesn't ask again)
  const knownContext: string[] = [];
  if (preferences.targetRole)    knownContext.push(`Target role: ${preferences.targetRole}`);
  if (preferences.seniority)     knownContext.push(`Target seniority: ${preferences.seniority}`);
  if (preferences.country)       knownContext.push(`Target country/market: ${preferences.country}`);
  if (preferences.workStyle)     knownContext.push(`Preferred work style: ${preferences.workStyle}`);
  if (workExperience.company)    knownContext.push(`Current/most recent company: ${workExperience.company}`);
  if (workExperience.jobTitle)   knownContext.push(`Current job title: ${workExperience.jobTitle}`);
  if (workExperience.yearsExp)   knownContext.push(`Years of experience: ${workExperience.yearsExp}`);
  if (workExperience.teamSize)   knownContext.push(`Team size managed/worked in: ${workExperience.teamSize}`);
  if (workExperience.impact)     knownContext.push(`Self-reported key impact: ${workExperience.impact}`);
  if (workExperience.revenueImpact) knownContext.push(`Revenue/cost impact mentioned: ${workExperience.revenueImpact}`);
  if (workExperience.topStat)    knownContext.push(`Top achievement stat: ${workExperience.topStat}`);

  const knownContextBlock = knownContext.length
    ? `━━━ WHAT WE ALREADY KNOW (DO NOT ASK ABOUT THESE AGAIN) ━━━\n${knownContext.join('\n')}`
    : '';

  const pivotInstructions = isPivot
    ? `
━━━ CAREER PIVOT DETECTED ━━━
This candidate is moving from "${currentRole}" into "${targetRole}" — a meaningful role change.
You MUST include exactly 2 questions in the "transition" section that:
  (a) Uncover specific transferable skills, experiences, or domain knowledge from their background that are directly relevant to "${targetRole}" — ask them to connect the dots explicitly.
  (b) Capture what they are seeking in "${targetRole}" that their previous path didn't offer — motivations, new problems they want to solve, skills they want to build. This should be forward-looking and aspirational, NOT anchored to past experience.
These 2 questions must feel natural and encouraging, not interrogative.`
    : `
━━━ SAME-TRACK PROGRESSION ━━━
The candidate is progressing within the same function (${currentRole} → ${targetRole}).
Include 1 "transition" question that captures what specifically draws them to this next level — what problems they want to own that they haven't fully owned before.`;

  const prompt = `You are a world-class career coach at Mentorque, a professional mentorship platform.

Your task: Generate between 7 and 10 laser-focused questions that extract the MISSING information needed to write a truly differentiated, metrics-rich resume for this candidate. A senior resume expert will use these answers to craft every bullet and the summary from scratch.

${knownContextBlock}

━━━ CANDIDATE RESUME SUMMARY ━━━
${JSON.stringify(resumeSummary, null, 2)}
${pivotInstructions}

━━━ MANDATORY QUESTION COVERAGE ━━━
You MUST generate questions that collectively cover ALL of the following areas. Each question should belong to exactly one area — do not double up on an area unless you have remaining question slots.

[AREA 1 — TEAM & ORGANISATIONAL SCOPE] (section: "experience")
Ask about team size managed or closely collaborated with, reporting structure, and the scale of the organisation they operated in (startup / scale-up / enterprise). Reference their actual companies by name.

[AREA 2 — REVENUE, COST & BUSINESS OUTCOMES] (section: "experience")
Ask for the single most impactful business outcome they drove — revenue generated or protected, costs reduced, efficiency gains, or customer/user growth. Push for a concrete number or range. Reference a specific role or project from their resume.

[AREA 3 — PROBLEM STATEMENT & BUSINESS CONTEXT] (section: "experience")
Ask them to describe the core business problem or challenge they were hired/assigned to solve in their most significant role. What was broken, missing, or at risk before they stepped in? This gives the "by doing [Z]" part of the XYZ formula.

[AREA 4 — TOOLS, TECHNOLOGIES & AI PROFICIENCY] (section: "skills")
Ask about the specific tools, platforms, and technologies — including any AI/LLM tools — they use day-to-day that are NOT listed on the resume, or that are listed but used in a way that deserves elaboration. Make the question specific to their domain (e.g. don't ask a designer about DevOps tools).

[AREA 5 — SECTORS & DOMAIN EXPERTISE] (section: "skills")
Ask which industries, verticals, or problem domains they have the deepest expertise in, and which they are most excited to continue working in. Offer MCQ options tailored to their background.

[AREA 6 — STANDOUT ACHIEVEMENT OR CAREER-DEFINING WIN] (section: "experience")
Ask for one achievement or project that is NOT on the resume (or is heavily undersold) that they are most proud of — something that demonstrates their ceiling, not just their average performance.

[AREA 7 — ORGANISATIONAL-LEVEL IMPACT] (section: "summary")
Ask how their work connected to the organisation's top-level goals — e.g. did their work feed into a company OKR, a product launch, a compliance milestone, or a strategic initiative? This surfaces the "so what?" at the company level, not just the team level.

${isPivot ? `[AREA 8 — CAREER TRANSITION: TRANSFERABLE STRENGTHS] (section: "transition")
[AREA 9 — CAREER TRANSITION: FORWARD-LOOKING MOTIVATION] (section: "transition")
(See CAREER PIVOT DETECTED instructions above — these 2 are required.)` : `[AREA 8 — CAREER PROGRESSION MOTIVATION] (section: "transition")
(See SAME-TRACK PROGRESSION instructions above — this 1 is required.)`}

━━━ QUESTION QUALITY RULES ━━━
- Every question must reference THIS candidate's actual roles, companies, or projects where possible — no generic questions
- Questions must feel like they come from someone who read the resume carefully
- Hints must be specific, actionable, and give a concrete example of a great answer
- MCQ options must be tailored to this candidate's domain and target role
- NO questions about: target role, target country, years of experience, or anything in "WHAT WE ALREADY KNOW"
- At least 3 MCQ questions and at least 3 text questions in the output
- Total question count: minimum 7, maximum 10

━━━ OUTPUT FORMAT ━━━
Return ONLY a JSON object with a "questions" array. No markdown, no preamble.

Schema:
{
  "questions": [
    {
      "id": "q1",
      "question": "Specific question referencing their actual resume content",
      "hint": "Short example of an ideal answer (1 sentence, concrete)",
      "questionType": "text" | "mcq",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "section": "experience" | "skills" | "summary" | "general" | "transition"
    }
  ]
}

Note: "options" is only required when questionType is "mcq".`;

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content:
          'You are an expert career coach at Mentorque. Return only valid JSON with a "questions" array. Produce between 7 and 10 questions. Do not include markdown, code fences, or any text outside the JSON object.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.45,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content || '{"questions":[]}';
  const parsed = JSON.parse(content);
  const questions: RevampQuestion[] = parsed.questions || [];

  // Enforce 7–10 range and stable IDs / questionType defaults
  const capped = questions.slice(0, 10);
  return capped.map((q, i) => ({
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