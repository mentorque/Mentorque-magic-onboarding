/**
 * Backfill `questionnaire_answers` + `revamp_result` for submissions that never
 * completed the questionnaire flow (same data shape as POST /api/onboarding/save-questionnaire).
 *
 * Usage (from repo root, with env loaded):
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/backfillQuestionnaireRevamp.ts --submission-id=cmo7...
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/backfillQuestionnaireRevamp.ts --submission-id=a --submission-id=b --dry-run
 *
 * Requires: DATABASE_URL, OPEN_AI_KEY or OPENAI_API_KEY, and optionally RESUME_COMPILER_URL
 * (defaults to http://localhost:5001 like the HTTP route).
 *
 * Options:
 *   --submission-id=<id>   Repeatable. Required unless SUBMISSION_IDS is set (comma-separated).
 *   --dry-run                Print actions only; no DB write, no AI/compile calls.
 *   --force                  Overwrite non-null revamp_result / questionnaire_answers.
 *   --answers-json=<path>    Optional JSON object { [questionId]: answerString } matching QuestionsForm storage.
 *
 * Env: `DATABASE_URL` must be visible to the Node process. If you set vars on separate shell lines
 * without `export`, child processes (pnpm/tsx) will not see them — use `export DATABASE_URL=...` or
 * put values in `backend/.env` (loaded automatically before connecting).
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { RevampQuestion } from "../lib/resumeRevampAI.js";

/** Load backend/.env before @workspace/db is imported (that module throws if DATABASE_URL is unset). */
function loadEnvFileSync(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../../.env"),
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "backend/.env"),
  ];
  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    const text = readFileSync(filePath, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const noExport = trimmed.replace(/^export\s+/i, "");
      const eqIdx = noExport.indexOf("=");
      if (eqIdx === -1) continue;
      const key = noExport.slice(0, eqIdx).trim();
      let val = noExport.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (key && process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
    return;
  }
}

loadEnvFileSync();

const { eq } = await import("drizzle-orm");
const { db, onboardingSubmissionsTable, pool } = await import("@workspace/db");
const { revampResume } = await import("../lib/resumeRevampAI.js");

function sanitizeForCompiler(resume: any): any {
  const r = structuredClone(resume);
  const fallbackDate = (v: string | undefined, fallback: string) =>
    v && v.trim() ? v.trim() : fallback;
  if (Array.isArray(r.experience)) {
    r.experience = r.experience.map((exp: any) => ({
      ...exp,
      startDate: fallbackDate(exp.startDate, "Jan 2020"),
      endDate: fallbackDate(exp.endDate, "Present"),
      company: exp.company?.trim() || "Company",
      position: exp.position?.trim() || "Role",
    }));
  }
  if (Array.isArray(r.education)) {
    r.education = r.education.map((edu: any) => ({
      ...edu,
      startDate: fallbackDate(edu.startDate, "Aug 2018"),
      endDate: fallbackDate(edu.endDate, "May 2022"),
      institution: edu.institution?.trim() || "University",
      degree: edu.degree?.trim() || "Degree",
    }));
  }
  if (Array.isArray(r.projects)) {
    r.projects = r.projects.map((proj: any) => ({
      ...proj,
      name: proj.name?.trim() || "Project",
    }));
  }
  return r;
}

async function compileRevampedPdf(revampedResume: any): Promise<string | null> {
  const compilerBaseUrl = (process.env.RESUME_COMPILER_URL || "http://localhost:5001").replace(
    /\/$/,
    "",
  );
  const sanitized = sanitizeForCompiler(revampedResume);
  try {
    const compileRes = await fetch(`${compilerBaseUrl}/api/resume/compile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sanitized),
    });
    if (!compileRes.ok) {
      const errBody = await compileRes.text();
      console.warn(`[compile] ${compileRes.status}: ${errBody.slice(0, 200)}`);
      return null;
    }
    const data = (await compileRes.json()) as { id: string; url: string };
    const url = data.url;
    if (!url) return null;
    return url.startsWith("http") ? url : `${compilerBaseUrl}${url}`;
  } catch (e: any) {
    console.warn("[compile] failed (non-fatal):", e?.message ?? e);
    return null;
  }
}

function normalizeAiQuestions(raw: unknown): RevampQuestion[] {
  if (Array.isArray(raw)) return raw as RevampQuestion[];
  if (raw && typeof raw === "object" && "questions" in raw) {
    const q = (raw as { questions?: unknown }).questions;
    if (Array.isArray(q)) return q as RevampQuestion[];
  }
  return [];
}

function isOtherLabel(label: string): boolean {
  return /^other$/i.test(label.trim());
}

/** Mirrors QuestionsForm storage: text = plain string; mcq = JSON.stringify({ selected, otherText, detail }). */
function syntheticAnswersFromQuestions(questions: RevampQuestion[]): Record<string, string> {
  const out: Record<string, string> = {};
  const placeholder =
    "[Backfilled by script — candidate did not submit questionnaire responses on file]";
  for (const q of questions) {
    if (!q?.id) continue;
    if (q.questionType === "text") {
      out[q.id] = placeholder;
      continue;
    }
    const opts = q.options ?? [];
    const firstNonOther = opts.find((o) => !isOtherLabel(o));
    if (firstNonOther) {
      out[q.id] = JSON.stringify({
        selected: [firstNonOther],
        otherText: "",
        detail: "",
      });
    } else {
      out[q.id] = JSON.stringify({
        selected: [],
        otherText: "",
        detail: placeholder,
      });
    }
  }
  return out;
}

function parseArgs(argv: string[]) {
  const submissionIds: string[] = [];
  let dryRun = false;
  let force = false;
  let answersJsonPath: string | null = null;
  for (const a of argv) {
    if (a === "--dry-run") dryRun = true;
    else if (a === "--force") force = true;
    else if (a.startsWith("--submission-id="))
      submissionIds.push(a.slice("--submission-id=".length).trim());
    else if (a.startsWith("--answers-json="))
      answersJsonPath = a.slice("--answers-json=".length).trim();
  }
  const fromEnv = process.env.SUBMISSION_IDS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  const ids = submissionIds.length ? submissionIds : fromEnv;
  return { submissionIds: ids, dryRun, force, answersJsonPath };
}

function loadAnswersFromFile(path: string): Record<string, string> {
  const abs = resolve(path);
  if (!existsSync(abs)) throw new Error(`answers file not found: ${abs}`);
  const raw = JSON.parse(readFileSync(abs, "utf8"));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("answers JSON must be a plain object of string values");
  }
  return raw as Record<string, string>;
}

async function backfillOne(
  submissionId: string,
  opts: { dryRun: boolean; force: boolean; answersJsonPath: string | null },
): Promise<void> {
  const [row] = await db
    .select()
    .from(onboardingSubmissionsTable)
    .where(eq(onboardingSubmissionsTable.id, submissionId));

  if (!row) {
    console.error(`[${submissionId}] not found`);
    return;
  }

  const parsedResume = row.parsedResume as unknown;
  if (parsedResume == null || typeof parsedResume !== "object") {
    console.error(`[${submissionId}] skip: parsed_resume is missing`);
    return;
  }

  const existingAnswers = row.questionnaireAnswers as Record<string, string> | null;
  const hasAnswers =
    existingAnswers &&
    typeof existingAnswers === "object" &&
    !Array.isArray(existingAnswers) &&
    Object.keys(existingAnswers).length > 0;

  const existingRevamp = row.revampResult as { revampedResume?: unknown } | null;
  if (existingRevamp && !opts.force) {
    console.log(`[${submissionId}] skip: revamp_result already set (use --force to overwrite)`);
    return;
  }

  let answers: Record<string, string>;
  if (opts.answersJsonPath) {
    answers = loadAnswersFromFile(opts.answersJsonPath);
  } else if (hasAnswers) {
    answers = { ...existingAnswers! };
    console.log(`[${submissionId}] using existing questionnaire_answers from DB (${Object.keys(answers).length} keys)`);
  } else {
    const questions = normalizeAiQuestions(row.aiQuestions);
    if (questions.length === 0) {
      console.warn(
        `[${submissionId}] no ai_questions in DB — using empty answers {} (same as revamp API with no context)`,
      );
      answers = {};
    } else {
      answers = syntheticAnswersFromQuestions(questions);
      console.log(
        `[${submissionId}] synthetic answers for ${questions.length} question(s) (backfill placeholder)`,
      );
    }
  }

  if (opts.dryRun) {
    console.log(`[${submissionId}] dry-run: would save answers keys=${Object.keys(answers).join(", ") || "(none)"}`);
    console.log(`[${submissionId}] dry-run: would call revampResume + compile then UPDATE row`);
    return;
  }

  console.log(`[${submissionId}] calling revampResume…`);
  const { revampedResume, changes } = await revampResume(parsedResume as any, answers);

  console.log(`[${submissionId}] compiling PDF…`);
  const compiledPdfUrl = await compileRevampedPdf(revampedResume);

  const revampResult = { revampedResume, changes, compiledPdfUrl };

  await db
    .update(onboardingSubmissionsTable)
    .set({
      questionnaireAnswers: answers as any,
      revampResult: revampResult as any,
      updatedAt: new Date(),
    })
    .where(eq(onboardingSubmissionsTable.id, submissionId));

  console.log(`[${submissionId}] done. compiledPdfUrl=${compiledPdfUrl ?? "null"}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const { submissionIds, dryRun, force, answersJsonPath } = parseArgs(argv);
  if (submissionIds.length === 0) {
    console.error(
      "Usage: tsx src/scripts/backfillQuestionnaireRevamp.ts --submission-id=<id> [--submission-id=…] [--dry-run] [--force] [--answers-json=path]\n" +
        "Or set SUBMISSION_IDS=id1,id2",
    );
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
  if (!dryRun && !process.env.OPEN_AI_KEY && !process.env.OPENAI_API_KEY) {
    console.error("OPEN_AI_KEY or OPENAI_API_KEY is required (unless --dry-run).");
    process.exit(1);
  }

  for (const id of submissionIds) {
    try {
      await backfillOne(id, { dryRun, force, answersJsonPath });
    } catch (e: any) {
      console.error(`[${id}] error:`, e?.message ?? e);
    }
  }

  await pool.end();
}

void main();
