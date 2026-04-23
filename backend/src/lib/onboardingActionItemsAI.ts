import OpenAI from "openai";

const MODEL = "gpt-4.1";

function getClient(): OpenAI {
  const apiKey = process.env.OPEN_AI_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI API key not configured.");
  return new OpenAI({ apiKey });
}

export type ActionItemsBySection = {
  personal: Array<{ text: string }>;
  skills: Array<{ text: string }>;
  experience: Array<{ text: string }>;
  projects: Array<{ text: string }>;
  education: Array<{ text: string }>;
};

export async function generateActionItemsFromUnresolvedComments(input: {
  unresolvedComments: string[];
  existingActionItems?: unknown;
}): Promise<ActionItemsBySection> {
  const client = getClient();
  const completion = await client.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are an expert resume editor assistant for the onboarding revamp studio.
Turn ONLY unresolved comments into concise, practical action items.
Output JSON with exactly these keys:
- personal: [{ "text": "..." }]
- skills: [{ "text": "..." }]
- experience: [{ "text": "..." }]
- projects: [{ "text": "..." }]
- education: [{ "text": "..." }]

Rules:
- Use unresolved comments only.
- Do not include resolved or generic advice.
- Keep each action item edit-focused and specific ("what to change").
- Keep wording concise and scannable.
- If nothing maps to a section, return [] for that section.
- Return JSON only.`,
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            unresolvedComments: input.unresolvedComments,
            existingActionItems: input.existingActionItems ?? null,
          },
          null,
          2,
        ),
      },
    ],
  });

  const txt = completion.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(txt) as Partial<ActionItemsBySection>;
  return {
    personal: Array.isArray(parsed.personal) ? parsed.personal : [],
    skills: Array.isArray(parsed.skills) ? parsed.skills : [],
    experience: Array.isArray(parsed.experience) ? parsed.experience : [],
    projects: Array.isArray(parsed.projects) ? parsed.projects : [],
    education: Array.isArray(parsed.education) ? parsed.education : [],
  };
}
