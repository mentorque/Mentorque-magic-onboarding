/**
 * Upsert parsed resume JSON for an onboarding submission, compile PDF, and persist URL.
 *
 * Usage (from repo root):
 *   pnpm --filter @workspace/api-server exec tsx src/scripts/upsertParsedResumeAndCompile.ts \
 *     --submission-id=cmo71lo5mjcq321cskoafb5iovezym \
 *     --resume-json=./anumoy.json
 *
 * Optional:
 *   --compiler-url=http://localhost:5001
 *
 * Env:
 *   DATABASE_URL must be available (backend/.env is auto-loaded if present).
 *   RESUME_COMPILER_URL is used unless --compiler-url is provided.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

function parseArgs(argv: string[]) {
  let submissionId = "";
  let resumeJsonPath = "";
  let compilerUrl = "";

  for (const arg of argv) {
    if (arg.startsWith("--submission-id=")) {
      submissionId = arg.slice("--submission-id=".length).trim();
    } else if (arg.startsWith("--resume-json=")) {
      resumeJsonPath = arg.slice("--resume-json=".length).trim();
    } else if (arg.startsWith("--compiler-url=")) {
      compilerUrl = arg.slice("--compiler-url=".length).trim();
    }
  }

  return { submissionId, resumeJsonPath, compilerUrl };
}

async function main() {
  const { submissionId, resumeJsonPath, compilerUrl } = parseArgs(process.argv.slice(2));

  if (!submissionId) {
    throw new Error("Missing --submission-id=<id>");
  }
  if (!resumeJsonPath) {
    throw new Error("Missing --resume-json=<path>");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required.");
  }

  const absJsonPath = resolve(resumeJsonPath);
  if (!existsSync(absJsonPath)) {
    throw new Error(`Resume JSON file not found: ${absJsonPath}`);
  }
  const parsedResume = JSON.parse(readFileSync(absJsonPath, "utf8"));
  if (!parsedResume || typeof parsedResume !== "object" || Array.isArray(parsedResume)) {
    throw new Error("resume-json must contain a JSON object.");
  }

  const compilerBaseUrl = (
    compilerUrl ||
    process.env.RESUME_COMPILER_URL ||
    "http://localhost:5001"
  ).replace(/\/$/, "");

  const [existing] = await db
    .select()
    .from(onboardingSubmissionsTable)
    .where(eq(onboardingSubmissionsTable.id, submissionId));

  if (!existing) {
    throw new Error(`Submission not found: ${submissionId}`);
  }

  const compileRes = await fetch(`${compilerBaseUrl}/api/resume/compile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sanitizeForCompiler(parsedResume)),
  });
  if (!compileRes.ok) {
    const errBody = await compileRes.text();
    throw new Error(`Resume compiler returned ${compileRes.status}: ${errBody.slice(0, 300)}`);
  }
  const compileData = (await compileRes.json()) as { url?: string };
  if (!compileData.url) {
    throw new Error("Resume compiler did not return a URL.");
  }
  const compiledPdfUrl = compileData.url.startsWith("http")
    ? compileData.url
    : `${compilerBaseUrl}${compileData.url}`;

  const existingChanges = Array.isArray((existing as any).resumeChanges)
    ? (existing as any).resumeChanges
    : [];

  await db
    .update(onboardingSubmissionsTable)
    .set({
      parsedResume: parsedResume as any,
      revampedResume: parsedResume as any,
      resumeChanges: existingChanges as any,
      compiledPdfUrl,
      updatedAt: new Date(),
    })
    .where(eq(onboardingSubmissionsTable.id, submissionId));

  console.log(`Submission updated: ${submissionId}`);
  console.log(`compiledPdfUrl: ${compiledPdfUrl}`);

  await pool.end();
}

void main().catch(async (err: any) => {
  console.error(err?.message ?? err);
  try {
    const imported = await import("@workspace/db");
    await imported.pool.end();
  } catch {
    // ignore shutdown errors
  }
  process.exit(1);
});
