import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type PlaybookDomain =
  | "sales"
  | "sde"
  | "data"
  | "pm"
  | "analyst"
  | "baseline";

type DomainConfig = {
  key: Exclude<PlaybookDomain, "baseline">;
  scoreTokens: string[];
};

const DOMAIN_CONFIGS: DomainConfig[] = [
  {
    key: "sales",
    scoreTokens: [
      "sales",
      "account executive",
      "business development",
      "pipeline",
      "quota",
      "crm",
      "customer success",
      "lead generation",
      "revenue",
      "inside sales",
      "outside sales",
      "closing",
    ],
  },
  {
    key: "sde",
    scoreTokens: [
      "software engineer",
      "developer",
      "backend",
      "frontend",
      "full stack",
      "api",
      "microservice",
      "cloud",
      "kubernetes",
      "aws",
      "gcp",
      "azure",
      "typescript",
      "java",
      "python",
      "node",
      "react",
    ],
  },
  {
    key: "data",
    scoreTokens: [
      "data scientist",
      "machine learning",
      "ml",
      "ai",
      "analytics",
      "data engineer",
      "sql",
      "python",
      "tableau",
      "power bi",
      "forecast",
      "model",
      "experimentation",
      "ab test",
      "etl",
    ],
  },
  {
    key: "pm",
    scoreTokens: [
      "product manager",
      "project manager",
      "program manager",
      "scrum",
      "agile",
      "roadmap",
      "stakeholder",
      "requirement",
      "go to market",
      "gantt",
      "jira",
      "delivery",
      "pmp",
    ],
  },
  {
    key: "analyst",
    scoreTokens: [
      "analyst",
      "business analyst",
      "financial analyst",
      "operations analyst",
      "reporting",
      "dashboard",
      "kpi",
      "excel",
      "insights",
      "variance",
      "forecasting",
      "market research",
    ],
  },
];

const TREE_BASE_CANDIDATES = [
  resolve(process.cwd(), "src/playbooks/trees"),
  resolve(process.cwd(), "backend/src/playbooks/trees"),
  resolve(dirname(fileURLToPath(import.meta.url)), "../../backend/src/playbooks/trees"),
  resolve(dirname(fileURLToPath(import.meta.url)), "../../src/playbooks/trees"),
];

function scoreText(text: string, tokens: string[]): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (!token) continue;
    if (lower.includes(token)) score += 1;
  }
  return score;
}

function resumeToSearchText(resume: any, roleHint?: string): string {
  const experiences = Array.isArray(resume?.experience) ? resume.experience : [];
  const skills = Array.isArray(resume?.skills) ? resume.skills : [];
  const projects = Array.isArray(resume?.projects) ? resume.projects : [];
  const chunks: string[] = [];
  if (typeof roleHint === "string" && roleHint.trim()) chunks.push(roleHint.trim());
  for (const e of experiences.slice(0, 4)) {
    chunks.push(String(e?.position ?? ""));
    chunks.push(String(e?.company ?? ""));
    const hs = Array.isArray(e?.highlights) ? e.highlights : [];
    chunks.push(hs.slice(0, 4).join(" "));
  }
  chunks.push(skills.slice(0, 30).join(" "));
  for (const p of projects.slice(0, 3)) {
    chunks.push(String(p?.name ?? ""));
    const hs = Array.isArray(p?.highlights) ? p.highlights : [];
    chunks.push(hs.slice(0, 3).join(" "));
  }
  chunks.push(String(resume?.professionalSummary ?? ""));
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

export function inferPlaybookDomain(params: {
  resume: unknown;
  roleHint?: string;
}): PlaybookDomain {
  const resume = params.resume as any;
  const text = resumeToSearchText(resume, params.roleHint);
  let best: PlaybookDomain = "baseline";
  let bestScore = 0;
  for (const cfg of DOMAIN_CONFIGS) {
    const s = scoreText(text, cfg.scoreTokens);
    if (s > bestScore) {
      bestScore = s;
      best = cfg.key;
    }
  }
  return bestScore >= 2 ? best : "baseline";
}

function resolveTreePath(domain: PlaybookDomain): string | null {
  const fileName = `${domain}_tree.json`;
  for (const base of TREE_BASE_CANDIDATES) {
    const p = resolve(base, fileName);
    if (existsSync(p)) return p;
  }
  return null;
}

function flattenTitles(nodes: any[], out: string[]): void {
  for (const node of nodes) {
    if (out.length >= 20) return;
    const title = typeof node?.title === "string" ? node.title.trim() : "";
    if (title) out.push(title);
    if (Array.isArray(node?.nodes) && node.nodes.length) {
      flattenTitles(node.nodes, out);
    }
  }
}

function readTreeGuidance(domain: PlaybookDomain, label: string): string {
  const p = resolveTreePath(domain);
  if (!p) return "";
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as any;
    const resultNodes = Array.isArray(raw?.result) ? raw.result : [];
    const titles: string[] = [];
    flattenTitles(resultNodes, titles);
    const topTitles = titles.slice(0, 12);
    if (topTitles.length === 0) return "";
    return `${label} (${domain})
Section outline from indexed playbook (order ≈ importance in that playbook):
- ${topTitles.join("\n- ")}`;
  } catch {
    return "";
  }
}

const PLAYBOOK_USAGE_RULES = `How to use this (strict):
1) Truth order: only facts supported by the resume JSON, raw text, or questionnaire answers. The playbook is a rubric, not a source of biographical facts.
2) Section titles are themes: weight bullets, summary, and skills toward those themes using vocabulary and emphasis that fit what the candidate actually did.
3) No copying: never paste playbook headings or template sentences into the resume. Paraphrase ideas into candidate-specific language.
4) Metrics: add or sharpen numbers only when the candidate or answers already imply scale, or when rewording existing numbers — do not invent benchmarks or results.
5) Baseline block (when present) is universal Mentorque structure; domain block adds role-specific depth. If they conflict, prefer baseline for structure and domain for emphasis.`;

export function buildPlaybookPromptContext(params: {
  resume: unknown;
  roleHint?: string;
}): { domain: PlaybookDomain; contextBlock: string } {
  const domain = inferPlaybookDomain(params);
  const domainGuidance = readTreeGuidance(domain, "Primary playbook");
  const baselineGuidance =
    domain === "baseline" ? "" : readTreeGuidance("baseline", "Universal baseline playbook");
  const contextParts = [domainGuidance, baselineGuidance].filter(Boolean);
  const contextBlock = contextParts.length
    ? `━━━ PAGEINDEX PLAYBOOK (structure + emphasis only) ━━━
Inferred track for this candidate: **${domain}** (heuristic from resume + hints; if wrong, still follow candidate facts).

${contextParts.join("\n\n")}

${PLAYBOOK_USAGE_RULES}`
    : "";
  return { domain, contextBlock };
}

