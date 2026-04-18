/**
 * resumeParser.ts
 * Location: backend/src/lib/resumeParser.ts
 *
 * Parses raw resume text → structured ResumeData using OpenAI.
 * Replicates the ResumeCompiler's parseResumeWithAI prompt exactly so both
 * apps produce structurally identical resume objects.
 */

import OpenAI from 'openai';

const MODEL = 'gpt-4.1';

function getClient(): OpenAI {
  const apiKey = process.env.OPEN_AI_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OpenAI API key not configured. Set OPEN_AI_KEY in env.');
  return new OpenAI({ apiKey });
}

const SAMPLE_SCHEMA = {
  personalInfo: {
    firstName: '', lastName: '', email: '', phoneNumber: '',
    linkedin: '', location: '', portfolio: '',
  },
  professionalSummary: '',
  education: [{ institution: '', degree: '', startDate: '', endDate: '', gpa: '', percentage: '', coursework: [] }],
  experience: [{ company: '', position: '', startDate: '', endDate: '', location: '', highlights: [] }],
  projects: [{ name: '', startDate: '', endDate: '', highlights: [], toolsUsed: '' }],
  skills: ['Python', 'JavaScript', 'React'],
  skillsDisplayMode: 'twoColumnar',
  skillsLineTime: [{ heading: 'Programming Languages', skills: 'Python, JavaScript, TypeScript' }],
  customSections: [
    { id: 'custom-1', name: 'Awards', events: [{ eventName: '', year: '', highlights: [] }] },
    { id: 'custom-2', name: 'Leadership & Achievements', events: [{ eventName: 'ISTE Students Chapter', year: '2023 – Present', highlights: ['Led X initiative impacting Y people'] }] },
  ],
  sectionOrder: ['professionalSummary', 'skills', 'experience', 'projects', 'education'],
  sectionNames: {
    professionalSummary: 'Professional Summary',
    skills: 'Technical Skills',
    experience: 'Experience',
    projects: 'Projects',
    education: 'Education',
  },
  deletedSections: [],
};

export async function parseResumeText(resumeText: string): Promise<any> {
  const client = getClient();

  const prompt = `You are an expert resume parser and data extraction system.

Convert the following raw resume text into valid JSON using exactly the same schema, keys, nesting, and structure as the sample JSON provided below.

Rules to follow strictly:
- Preserve the JSON schema (keys, arrays, object structure must match).
- Do not add new fields unless clearly required by resume data.
- Do not remove existing fields from the schema.
- For customSections: Include ANY section that is not personalInfo, professionalSummary, education, experience, projects, or skills. This explicitly includes — but is not limited to — Leadership, Leadership & Achievements, Activities, Awards, Competitions, Certifications, Publications, Volunteering, Extracurriculars, Honours, and any other named section in the resume. Map each such section as a customSection entry with a unique "id" (e.g. "custom-1", "custom-2") and its exact "name" taken from the resume heading. Preserve all bullet points in their "highlights" array. NEVER drop, skip, or omit these sections — they are critical content.
- Normalize dates into readable text (e.g., "Aug 2022", "Present").
- 🚨 CRITICAL: Preserve ALL bullet points and highlights EXACTLY as written. Do NOT shorten, truncate, or summarize in any way.
- For skills: if organized by categories, use "lineTime" mode with skillsLineTime array. If flat list, use "twoColumnar" with skills array.
- Do NOT make up dates — leave as empty string if not present.
- Return only valid JSON (no markdown, no explanations).

Sample JSON Schema:
${JSON.stringify(SAMPLE_SCHEMA, null, 2)}

Resume Text:
${resumeText}`;

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'You are an expert resume parser. Return only valid JSON, no markdown. CRITICAL: Preserve ALL bullet points exactly as written.',
      },
      { role: 'user', content: prompt },
    ],
    temperature: 0.3,
    response_format: { type: 'json_object' },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error('No response from OpenAI');

  const parsed = JSON.parse(content);

  // Defensive normalization (same as ResumeCompiler's parse-ai route)
  parsed.education = Array.isArray(parsed.education) ? parsed.education : [];
  parsed.experience = Array.isArray(parsed.experience) ? parsed.experience : [];
  parsed.projects = Array.isArray(parsed.projects) ? parsed.projects : [];
  parsed.skills = Array.isArray(parsed.skills) ? parsed.skills : [];
  parsed.skillsLineTime = Array.isArray(parsed.skillsLineTime) ? parsed.skillsLineTime : [];
  parsed.customSections = Array.isArray(parsed.customSections)
    ? parsed.customSections.filter((s: any) => s?.id && s?.name)
    : [];
  parsed.deletedSections = [];

  return parsed;
}
