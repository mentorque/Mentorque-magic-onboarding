import { Router, Request, Response } from "express";
import {
  db,
  onboardingSubmissionsTable,
  resumeReviewersTable,
  resumeSettingsTable,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  authenticateFirebaseToken,
  authenticateFirebaseOrMentorAccess,
} from "../middlewares/auth.js";
import { parseResumeText } from "../lib/resumeParser.js";
import { generateQuestionsFromResume } from "../lib/resumeRevampAI.js";
import { regenerateStudioChanges } from "../lib/studioRegenerateChangesAI.js";

const router = Router();
const ADMIN_ACCESS_TOKEN =
  process.env.ADMIN_ACCESS_TOKEN ?? "tkn_8fK29xLmQ7pV3nZdR6cY1uHs";

/** Persisted on `onboarding_submissions.input_status` */
const ONBOARDING_INPUT_STATUS = {
  INPUT_PENDING: "input_pending",
  INPUT_COMPLETE: "input_complete",
  COMPLETED: "completed",
} as const;

function normalizeInputStatus(
  raw: unknown,
): (typeof ONBOARDING_INPUT_STATUS)[keyof typeof ONBOARDING_INPUT_STATUS] | undefined {
  if (raw === ONBOARDING_INPUT_STATUS.INPUT_PENDING) return ONBOARDING_INPUT_STATUS.INPUT_PENDING;
  if (raw === ONBOARDING_INPUT_STATUS.INPUT_COMPLETE) return ONBOARDING_INPUT_STATUS.INPUT_COMPLETE;
  if (raw === ONBOARDING_INPUT_STATUS.COMPLETED) return ONBOARDING_INPUT_STATUS.COMPLETED;
  return undefined;
}

type ReviewerRole = "user" | "admin" | "mentor";

function randomToken(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 12)}${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function encodeAccessToken(payload: {
  onboardingId: string;
  role: ReviewerRole;
  reviewerId?: string;
  userId?: string;
}): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/** Work story lives under `basic_details.workExperience` (avoids a separate DB column). */
function basicDetailsWithWork(
  basicDetails: Record<string, unknown>,
  workExperience: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!workExperience || typeof workExperience !== "object") {
    return { ...basicDetails };
  }
  return { ...basicDetails, workExperience };
}

const MENTORQUE_ONBOARDING_KEY = "mentorqueOnboarding";

type OnboardingResumeSnapshot = {
  source: "onboarding";
  basicDetails: Record<string, unknown>;
  preferencesTaken: unknown;
  uploadedResumeText: string | null;
};

function mergeCustomWithMentorqueSnapshot(
  existingCustom: unknown,
  snapshot: OnboardingResumeSnapshot,
): Record<string, unknown> {
  const prev =
    existingCustom !== null &&
    typeof existingCustom === "object" &&
    !Array.isArray(existingCustom)
      ? (existingCustom as Record<string, unknown>)
      : {};
  return { ...prev, [MENTORQUE_ONBOARDING_KEY]: snapshot };
}

function newOnboardingResumeSettingsRow(params: {
  userId: string;
  name: string;
  snapshot: OnboardingResumeSnapshot;
}) {
  const now = new Date();
  return {
    userId: params.userId,
    name: params.name,
    personalInfo: {},
    education: {},
    experience: {},
    skills: {},
    projects: {},
    sectionOrder: [] as unknown[],
    sectionNames: {},
    customSections: { [MENTORQUE_ONBOARDING_KEY]: params.snapshot },
    isOnboardingResume: true,
    updatedAt: now,
  };
}

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

async function ensureCompiledPdfForSubmission<T extends { id: string; revampResult: any }>(
  submission: T,
): Promise<T> {
  const rr = submission?.revampResult;
  if (!rr || typeof rr !== "object" || !rr.revampedResume) {
    return submission;
  }

  const existingUrl =
    typeof rr.compiledPdfUrl === "string" && rr.compiledPdfUrl.trim()
      ? rr.compiledPdfUrl.trim()
      : null;

  let needsRecompile = !existingUrl;
  if (existingUrl) {
    try {
      const upstream = await fetch(existingUrl);
      needsRecompile = !upstream.ok;
    } catch {
      needsRecompile = true;
    }
  }
  if (!needsRecompile) return submission;

  const compilerBaseUrl = (process.env.RESUME_COMPILER_URL || "http://localhost:5001").replace(
    /\/$/,
    "",
  );
  const compileRes = await fetch(`${compilerBaseUrl}/api/resume/compile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sanitizeForCompiler(rr.revampedResume)),
  });
  if (!compileRes.ok) {
    const errBody = await compileRes.text();
    throw new Error(`ResumeCompiler returned ${compileRes.status}: ${errBody.slice(0, 300)}`);
  }
  const data = (await compileRes.json()) as { url: string };
  const compiledPdfUrl = data.url?.startsWith("http")
    ? data.url
    : `${compilerBaseUrl}${data.url}`;

  const nextRevampResult = { ...rr, compiledPdfUrl };
  const [updated] = await db
    .update(onboardingSubmissionsTable)
    .set({ revampResult: nextRevampResult as any, updatedAt: new Date() } as any)
    .where(eq(onboardingSubmissionsTable.id, submission.id))
    .returning();

  return (updated ?? { ...submission, revampResult: nextRevampResult }) as T;
}

router.post("/submissions", authenticateFirebaseToken, async (req: Request, res: Response) => {
  const {
    id,
    userId,
    basicDetails = {},
    workExperience = {},
    preferencesTaken = {},
    revealResume = false,
    resumeSettingId = null,
  } = req.body ?? {};

  if (!userId || typeof userId !== "string") {
    return res
      .status(400)
      .json({ success: false, message: "userId is required." });
  }
  if (userId !== (req.user as { id: string }).id) {
    return res.status(403).json({
      success: false,
      message: "userId must match the authenticated Mentorque user.",
    });
  }

  try {
    const mergedBasic = basicDetailsWithWork(
      basicDetails as Record<string, unknown>,
      workExperience as Record<string, unknown> | undefined,
    );
    const [submission] = await db
      .insert(onboardingSubmissionsTable)
      .values({
        ...(id ? { id } : {}),
        userId,
        basicDetails: mergedBasic,
        preferencesTaken,
        revealResume,
        resumeSettingId,
        inputStatus: ONBOARDING_INPUT_STATUS.INPUT_PENDING,
      })
      .returning();

    return res.json({ success: true, submission });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/** One-shot save: basics, resume text, work story, preferences + creates/updates Prisma `ResumeSettings` and links `resume_setting_id`. */
router.post("/form-submission", authenticateFirebaseToken, async (req: Request, res: Response) => {
  const authUser = req.user as { id: string };
  const authId = authUser.id;
  const {
    submissionId,
    basicDetails = {},
    uploadedResumeText,
    workExperience = {},
    preferencesTaken = {},
    revealResume = false,
  } = req.body ?? {};

  const mergedBasic = basicDetailsWithWork(
    basicDetails as Record<string, unknown>,
    workExperience as Record<string, unknown> | undefined,
  );

  const resumeDataPayload = {
    source: "onboarding" as const,
    basicDetails: mergedBasic,
    preferencesTaken,
    uploadedResumeText:
      uploadedResumeText !== undefined && uploadedResumeText !== null
        ? String(uploadedResumeText)
        : null,
  };

  const firstName =
    typeof (basicDetails as { firstName?: string }).firstName === "string"
      ? (basicDetails as { firstName: string }).firstName.trim()
      : "";
  const settingName = firstName ? `Onboarding — ${firstName}` : "Onboarding resume";

  // Guard: resume text is required for the AI pipeline
  const rawResumeText =
    uploadedResumeText !== undefined && uploadedResumeText !== null
      ? String(uploadedResumeText).trim()
      : "";
  if (!rawResumeText) {
    return res.status(400).json({
      success: false,
      message: "Resume text is required. Please upload your resume before proceeding.",
    });
  }

  try {
    const result = await db.transaction(async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
      if (submissionId && typeof submissionId === "string") {
        const [existing] = await tx
          .select()
          .from(onboardingSubmissionsTable)
          .where(eq(onboardingSubmissionsTable.id, submissionId));
        if (!existing || existing.userId !== authId) {
          throw new Error("FORBIDDEN");
        }

        let resumeSettingId = existing.resumeSettingId;

        if (resumeSettingId) {
          const [existingSetting] = await tx
            .select({ customSections: resumeSettingsTable.customSections })
            .from(resumeSettingsTable)
            .where(eq(resumeSettingsTable.id, resumeSettingId));
          await tx
            .update(resumeSettingsTable)
            .set({
              name: settingName,
              customSections: mergeCustomWithMentorqueSnapshot(
                existingSetting?.customSections,
                resumeDataPayload,
              ),
              updatedAt: new Date(),
            })
            .where(eq(resumeSettingsTable.id, resumeSettingId));
        } else {
          const [created] = await tx
            .insert(resumeSettingsTable)
            .values(
              newOnboardingResumeSettingsRow({
                userId: authId,
                name: settingName,
                snapshot: resumeDataPayload,
              }),
            )
            .returning();
          resumeSettingId = created.id;
        }

        const [submission] = await tx
          .update(onboardingSubmissionsTable)
          .set({
            basicDetails: mergedBasic,
            uploadedResumeText: rawResumeText,
            preferencesTaken,
            revealResume,
            resumeSettingId,
            inputStatus: ONBOARDING_INPUT_STATUS.INPUT_COMPLETE,
            updatedAt: new Date(),
          })
          .where(eq(onboardingSubmissionsTable.id, submissionId))
          .returning();

        return { submission, resumeSettingId };
      }

      // ── No submissionId provided: check if user already has a submission ──────
      // This handles returning users whose localStorage was cleared or who opened
      // an incognito session — avoids creating a duplicate row.
      const [existingByUser] = await tx
        .select()
        .from(onboardingSubmissionsTable)
        .where(eq(onboardingSubmissionsTable.userId, authId))
        .orderBy(desc(onboardingSubmissionsTable.updatedAt))
        .limit(1);

      if (existingByUser) {
        // Re-use the existing row (same logic as the submissionId UPDATE path)
        let resumeSettingId = existingByUser.resumeSettingId;

        if (resumeSettingId) {
          const [existingSetting] = await tx
            .select({ customSections: resumeSettingsTable.customSections })
            .from(resumeSettingsTable)
            .where(eq(resumeSettingsTable.id, resumeSettingId));
          await tx
            .update(resumeSettingsTable)
            .set({
              name: settingName,
              customSections: mergeCustomWithMentorqueSnapshot(
                existingSetting?.customSections,
                resumeDataPayload,
              ),
              updatedAt: new Date(),
            })
            .where(eq(resumeSettingsTable.id, resumeSettingId));
        } else {
          const [created] = await tx
            .insert(resumeSettingsTable)
            .values(
              newOnboardingResumeSettingsRow({
                userId: authId,
                name: settingName,
                snapshot: resumeDataPayload,
              }),
            )
            .returning();
          resumeSettingId = created.id;
        }

        const [submission] = await tx
          .update(onboardingSubmissionsTable)
          .set({
            basicDetails: mergedBasic,
            uploadedResumeText: rawResumeText,
            preferencesTaken,
            revealResume,
            resumeSettingId,
            inputStatus: ONBOARDING_INPUT_STATUS.INPUT_COMPLETE,
            updatedAt: new Date(),
          })
          .where(eq(onboardingSubmissionsTable.id, existingByUser.id))
          .returning();

        return { submission, resumeSettingId };
      }

      // ── Truly new user: fresh INSERT ─────────────────────────────────────
      const [createdSetting] = await tx
        .insert(resumeSettingsTable)
        .values(
          newOnboardingResumeSettingsRow({
            userId: authId,
            name: settingName,
            snapshot: resumeDataPayload,
          }),
        )
        .returning();

      const [submission] = await tx
        .insert(onboardingSubmissionsTable)
        .values({
          userId: authId,
          basicDetails: mergedBasic,
          uploadedResumeText: rawResumeText,
          preferencesTaken,
          revealResume,
          resumeSettingId: createdSetting.id,
          inputStatus: ONBOARDING_INPUT_STATUS.INPUT_COMPLETE,
        })
        .returning();

      return { submission, resumeSettingId: createdSetting.id };
    });

    // ── Step 2: AI pipeline — parse resume + generate context-aware questions ─────
    console.log(`[form-submission] Running AI pipeline for submission ${result.submission.id}...`);
    let parsedResume: unknown = null;
    let aiQuestions: unknown[] = [];
    try {
      parsedResume = await parseResumeText(rawResumeText);
      aiQuestions = await generateQuestionsFromResume(parsedResume, {
        workExperience: workExperience as Record<string, string>,
        preferences: preferencesTaken as Record<string, string>,
      });
      console.log(`[form-submission] AI pipeline done. ${aiQuestions.length} questions generated.`);
    } catch (aiErr: any) {
      console.error("[form-submission] AI pipeline failed:", aiErr?.message);
      return res.status(500).json({
        success: false,
        message: "Failed to generate personalized questions. Please try again.",
      });
    }

    // ── Step 3: Store AI results back onto the submission row ─────────────────────
    await db
      .update(onboardingSubmissionsTable)
      .set({ parsedResume, aiQuestions, updatedAt: new Date() } as any)
      .where(eq(onboardingSubmissionsTable.id, result.submission.id));

    return res.json({
      success: true,
      submission: { ...result.submission, parsedResume, aiQuestions },
      resumeSettingId: result.resumeSettingId,
    });
  } catch (err: any) {
    if (err?.message === "FORBIDDEN") {
      return res.status(403).json({ success: false, message: "Forbidden or submission not found." });
    }
    console.error("[form-submission]", err?.code, err?.detail, err?.message);
    return res.status(500).json({
      success: false,
      message: err?.message ?? "Form submission failed.",
      ...(process.env.NODE_ENV !== "production" && err?.detail
        ? { detail: String(err.detail) }
        : {}),
    });
  }
});

/** Save questionnaire answers + revamp result in a single atomic write. */
router.post("/save-questionnaire", authenticateFirebaseToken, async (req: Request, res: Response) => {
  const authId = (req.user as { id: string }).id;
  const { submissionId, answers, revampResult } = req.body ?? {};

  if (!submissionId || typeof submissionId !== "string") {
    return res.status(400).json({ success: false, message: "submissionId is required." });
  }
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    return res.status(400).json({ success: false, message: "answers must be a non-null object." });
  }
  if (!revampResult || typeof revampResult !== "object") {
    return res.status(400).json({ success: false, message: "revampResult is required." });
  }

  try {
    const [existing] = await db
      .select({ id: onboardingSubmissionsTable.id, userId: onboardingSubmissionsTable.userId })
      .from(onboardingSubmissionsTable)
      .where(eq(onboardingSubmissionsTable.id, submissionId));

    if (!existing || existing.userId !== authId) {
      return res.status(403).json({ success: false, message: "Forbidden or submission not found." });
    }

    const [submission] = await db
      .update(onboardingSubmissionsTable)
      .set({ questionnaireAnswers: answers, revampResult, updatedAt: new Date() } as any)
      .where(eq(onboardingSubmissionsTable.id, submissionId))
      .returning();

    return res.json({ success: true, submission });
  } catch (err: any) {
    console.error("[save-questionnaire]", err?.message);
    return res.status(500).json({ success: false, message: err?.message ?? "Failed to save questionnaire." });
  }
});

/** Mentor admin: persist `revamp_result` after studio AI apply (wildcard token). */
router.post("/save-revamp-result", authenticateFirebaseOrMentorAccess, async (req: Request, res: Response) => {
  const { revampResult } = req.body ?? {};
  if (!revampResult || typeof revampResult !== "object") {
    return res.status(400).json({ success: false, message: "revampResult is required." });
  }
  try {
    if (req.authMode === "mentor" && req.mentorAccess) {
      const role = String(req.mentorAccess.payload.role ?? "").toLowerCase();
      if (role !== "admin") {
        return res.status(403).json({ success: false, message: "Admin reviewer role required." });
      }
      const oid = req.mentorAccess.payload.onboardingId;
      const [submission] = await db
        .update(onboardingSubmissionsTable)
        .set({ revampResult, updatedAt: new Date() } as any)
        .where(eq(onboardingSubmissionsTable.id, oid))
        .returning();
      if (!submission) {
        return res.status(404).json({ success: false, message: "Submission not found." });
      }
      return res.json({ success: true, submission });
    }
    return res.status(403).json({
      success: false,
      message: "Mentor access required.",
    });
  } catch (err: any) {
    console.error("[save-revamp-result]", err?.message);
    return res.status(500).json({ success: false, message: err?.message ?? "Failed to save revamp result." });
  }
});

/** Mentor admin: regenerate high-quality `revamp_result.changes` from resume context. */
router.post(
  "/regenerate-changes",
  authenticateFirebaseOrMentorAccess,
  async (req: Request, res: Response) => {
    try {
      if (req.authMode !== "mentor" || !req.mentorAccess) {
        return res.status(403).json({ success: false, message: "Mentor access required." });
      }
      const role = String(req.mentorAccess.payload.role ?? "").toLowerCase();
      if (role !== "admin") {
        return res.status(403).json({ success: false, message: "Admin reviewer role required." });
      }

      const tokenOid = req.mentorAccess.payload.onboardingId;
      const bodyOid =
        typeof req.body?.onboardingId === "string" ? req.body.onboardingId.trim() : "";
      const oid = bodyOid || tokenOid;
      if (oid !== tokenOid) {
        return res.status(403).json({ success: false, message: "onboardingId mismatch." });
      }

      const [submission] = await db
        .select()
        .from(onboardingSubmissionsTable)
        .where(eq(onboardingSubmissionsTable.id, oid));
      if (!submission) {
        return res.status(404).json({ success: false, message: "Submission not found." });
      }

      const uploadedResumeText =
        typeof submission.uploadedResumeText === "string" ? submission.uploadedResumeText : "";
      const parsedResume = submission.parsedResume;
      const revamp = submission.revampResult as any;
      const revampedResume = revamp?.revampedResume;
      const adminPrompt =
        typeof req.body?.prompt === "string" ? req.body.prompt : "";

      if (!uploadedResumeText.trim() || !parsedResume || !revampedResume) {
        return res.status(400).json({
          success: false,
          message:
            "Missing uploadedResumeText, parsedResume, or revampResult.revampedResume for regeneration.",
        });
      }

      const changes = await regenerateStudioChanges({
        uploadedResumeText,
        parsedResume,
        revampedResume,
        adminPrompt,
      });

      const nextRevampResult = {
        ...(revamp ?? {}),
        revampedResume,
        compiledPdfUrl:
          typeof revamp?.compiledPdfUrl === "string" ? revamp.compiledPdfUrl : null,
        changes,
      };

      const [updated] = await db
        .update(onboardingSubmissionsTable)
        .set({ revampResult: nextRevampResult as any, updatedAt: new Date() } as any)
        .where(eq(onboardingSubmissionsTable.id, oid))
        .returning();

      return res.json({
        success: true,
        submission: updated ?? submission,
        revampResult: nextRevampResult,
      });
    } catch (err: any) {
      console.error("[regenerate-changes]", err?.message);
      return res
        .status(500)
        .json({ success: false, message: err?.message ?? "Failed to regenerate changes." });
    }
  },
);

/** Authenticated: onboarding row — `revealResume`, `inputStatus`, full payload. */
async function handleGetMySubmission(req: Request, res: Response) {
  const authId = (req.user as { id: string }).id;
  const submissionId =
    typeof req.query.submissionId === "string" ? req.query.submissionId.trim() : "";

  try {
    if (submissionId) {
      const [submission] = await db
        .select()
        .from(onboardingSubmissionsTable)
        .where(eq(onboardingSubmissionsTable.id, submissionId));
      if (!submission || submission.userId !== authId) {
        return res.status(403).json({
          success: false,
          message: "Forbidden or submission not found.",
        });
      }
      return res.json({ success: true, submission });
    }

    const [latest] = await db
      .select()
      .from(onboardingSubmissionsTable)
      .where(eq(onboardingSubmissionsTable.userId, authId))
      .orderBy(desc(onboardingSubmissionsTable.updatedAt))
      .limit(1);

    return res.json({ success: true, submission: latest ?? null });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
}

router.get("/my-submission", authenticateFirebaseToken, handleGetMySubmission);

/** Alias: same as `GET /my-submission` — onboarding details for the signed-in user. */
router.get("/details", authenticateFirebaseToken, handleGetMySubmission);

/**
 * Unified payload for `/revamp-space`: Firebase (owner) or mentor wildcard token.
 * Returns `annotation` for PDF note author labels (name + role from wildcard creation).
 */
router.get("/revamp-space-data", authenticateFirebaseOrMentorAccess, async (req: Request, res: Response) => {
  try {
    if (req.authMode === "firebase" && req.user) {
      const authId = (req.user as { id: string }).id;
      const [latest] = await db
        .select()
        .from(onboardingSubmissionsTable)
        .where(eq(onboardingSubmissionsTable.userId, authId))
        .orderBy(desc(onboardingSubmissionsTable.updatedAt))
        .limit(1);
      if (!latest) {
        return res.json({ success: true, submission: null });
      }
      const ok =
        latest.revealResume === true && latest.inputStatus === ONBOARDING_INPUT_STATUS.INPUT_COMPLETE;
      if (!ok) {
        return res.status(403).json({
          success: false,
          message: "Revamp space is not available for your account yet.",
        });
      }
      const hydrated = await ensureCompiledPdfForSubmission(latest as any);
      const u = req.user as { name?: string; fullName?: string; email?: string | null };
      const displayName =
        (typeof u.name === "string" && u.name.trim()) ||
        (typeof u.fullName === "string" && u.fullName.trim()) ||
        (typeof u.email === "string" && u.email.trim()) ||
        "You";
      return res.json({
        success: true,
        submission: hydrated,
        annotation: {
          displayName,
          role: "candidate",
          onboardingId: hydrated.id,
          reviewerId: null as string | null,
        },
      });
    }

    if (req.authMode === "mentor" && req.mentorAccess) {
      const { payload, reviewer } = req.mentorAccess;
      const [submission] = await db
        .select()
        .from(onboardingSubmissionsTable)
        .where(eq(onboardingSubmissionsTable.id, payload.onboardingId));
      if (!submission) {
        return res.status(404).json({ success: false, message: "Submission not found." });
      }
      const hydrated = await ensureCompiledPdfForSubmission(submission as any);
      return res.json({
        success: true,
        submission: hydrated,
        annotation: {
          displayName: reviewer.name,
          role: payload.role,
          onboardingId: reviewer.onboardingId,
          reviewerId: reviewer.id,
        },
      });
    }

    return res.status(500).json({ success: false, message: "Unknown auth mode." });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/submissions/:id", async (req: Request, res: Response) => {
  const id = req.params.id as string;

  try {
    const [submission] = await db
      .select()
      .from(onboardingSubmissionsTable)
      .where(eq(onboardingSubmissionsTable.id, id));

    if (!submission) {
      return res
        .status(404)
        .json({ success: false, message: "Onboarding submission not found." });
    }

    return res.json({ success: true, submission });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.patch("/submissions/:id", authenticateFirebaseToken, async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const {
    basicDetails,
    workExperience,
    preferencesTaken,
    revealResume,
    resumeSettingId,
    uploadedResumeText,
    inputStatus: inputStatusBody,
  } = req.body ?? {};
  const authId = (req.user as { id: string }).id;

  try {
    const [existing] = await db
      .select()
      .from(onboardingSubmissionsTable)
      .where(eq(onboardingSubmissionsTable.id, id));
    if (!existing || existing.userId !== authId) {
      return res.status(403).json({
        success: false,
        message: "Forbidden or submission not found.",
      });
    }

    let nextBasic = existing.basicDetails as Record<string, unknown>;
    if (basicDetails !== undefined && typeof basicDetails === "object") {
      nextBasic = { ...nextBasic, ...(basicDetails as Record<string, unknown>) };
    }
    if (workExperience !== undefined && typeof workExperience === "object") {
      nextBasic = { ...nextBasic, workExperience };
    }

    const nextInputStatus = normalizeInputStatus(inputStatusBody);

    const [submission] = await db
      .update(onboardingSubmissionsTable)
      .set({
        ...(basicDetails !== undefined || workExperience !== undefined
          ? { basicDetails: nextBasic }
          : {}),
        ...(preferencesTaken !== undefined ? { preferencesTaken } : {}),
        ...(revealResume !== undefined ? { revealResume } : {}),
        ...(resumeSettingId !== undefined ? { resumeSettingId } : {}),
        ...(uploadedResumeText !== undefined
          ? { uploadedResumeText: String(uploadedResumeText) }
          : {}),
        ...(nextInputStatus !== undefined ? { inputStatus: nextInputStatus } : {}),
        updatedAt: new Date(),
      })
      .where(eq(onboardingSubmissionsTable.id, id))
      .returning();

    if (!submission) {
      return res
        .status(404)
        .json({ success: false, message: "Onboarding submission not found." });
    }

    return res.json({ success: true, submission });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/reviewers", async (req: Request, res: Response) => {
  const { onboardingId, name, role, userId } = req.body ?? {};
  if (!onboardingId || typeof onboardingId !== "string") {
    return res
      .status(400)
      .json({ success: false, message: "onboardingId is required." });
  }
  if (!name || typeof name !== "string") {
    return res.status(400).json({ success: false, message: "name is required." });
  }
  const normalizedRole: ReviewerRole =
    role === "admin" || role === "user" || role === "mentor" ? role : "mentor";

  try {
    const [reviewer] = await db
      .insert(resumeReviewersTable)
      .values({
        onboardingId,
        name,
        role: normalizedRole,
        userId: userId ?? null,
        inviteToken: normalizedRole === "mentor" ? randomToken("mtr") : null,
      })
      .returning();
    return res.json({ success: true, reviewer });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/reviewers", async (req: Request, res: Response) => {
  const onboardingId = req.query.onboardingId as string | undefined;
  if (!onboardingId) {
    return res
      .status(400)
      .json({ success: false, message: "onboardingId query param is required." });
  }

  try {
    const reviewers = await db
      .select()
      .from(resumeReviewersTable)
      .where(eq(resumeReviewersTable.onboardingId, onboardingId));
    return res.json({ success: true, reviewers });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/reviewers/:id", async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const onboardingId = req.query.onboardingId as string | undefined;
  try {
    const where = onboardingId
      ? and(
          eq(resumeReviewersTable.id, id),
          eq(resumeReviewersTable.onboardingId, onboardingId),
        )
      : eq(resumeReviewersTable.id, id);

    await db.delete(resumeReviewersTable).where(where);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/admin/:token/submissions/:submissionId", async (req: Request, res: Response) => {
  const token = req.params.token as string;
  const submissionId = req.params.submissionId as string;

  if (token !== ADMIN_ACCESS_TOKEN) {
    return res.status(403).json({ success: false, message: "Invalid admin token." });
  }

  try {
    const [submission] = await db
      .delete(onboardingSubmissionsTable)
      .where(eq(onboardingSubmissionsTable.id, submissionId))
      .returning();

    if (!submission) {
      return res.status(404).json({ success: false, message: "Submission not found." });
    }

    if (submission.resumeSettingId) {
      await db
        .delete(resumeSettingsTable)
        .where(eq(resumeSettingsTable.id, submission.resumeSettingId))
        .execute();
    }

    await db
      .delete(resumeReviewersTable)
      .where(eq(resumeReviewersTable.onboardingId, submissionId))
      .execute();

    return res.json({ success: true, submission });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/admin/:token/list", async (req: Request, res: Response) => {
  const token = req.params.token as string;
  if (token !== ADMIN_ACCESS_TOKEN) {
    return res.status(403).json({ success: false, message: "Invalid admin token." });
  }

  try {
    const result = await db.execute(sql<{
      onboardingId: string;
      userId: string;
      userName: string | null;
      userEmail: string | null;
      revealResume: boolean;
      inputStatus: string;
      aiQuestions: unknown;
      questionnaireAnswers: unknown;
      revampResult: unknown;
      updatedAt: string;
    }>`
      select
        os.id as "onboardingId",
        os.user_id as "userId",
        u."fullName" as "userName",
        u.email as "userEmail",
        os.reveal_resume as "revealResume",
        os.input_status as "inputStatus",
        os.ai_questions as "aiQuestions",
        os.questionnaire_answers as "questionnaireAnswers",
        os.revamp_result as "revampResult",
        os.updated_at as "updatedAt"
      from onboarding_submissions os
      left join "User" u on u.id = os.user_id
    `);
    const rows = result.rows as Array<{
      onboardingId: string;
      userId: string;
      userName: string | null;
      userEmail: string | null;
      revealResume: boolean;
      inputStatus: string;
      aiQuestions: unknown;
      questionnaireAnswers: unknown;
      revampResult: unknown;
      updatedAt: string;
    }>;

    const items = rows.map((row: (typeof rows)[number]) => {
      const hasAiQuestions = Array.isArray(row.aiQuestions) && row.aiQuestions.length > 0;
      const hasQuestionnaireAnswers =
        row.questionnaireAnswers && typeof row.questionnaireAnswers === "object" && Object.keys(row.questionnaireAnswers).length > 0;
      const hasRevampResult = row.revampResult && typeof row.revampResult === "object" && Object.keys(row.revampResult).length > 0;

      let progressStep: string;
      if (row.inputStatus === "input_complete" && hasRevampResult) {
        progressStep = "Revamp ready";
      } else if (row.inputStatus === "input_complete" && hasQuestionnaireAnswers) {
        progressStep = "Questionnaire answered";
      } else if (row.inputStatus === "input_complete" && hasAiQuestions) {
        progressStep = "Questionnaire generated";
      } else if (row.inputStatus === "input_complete") {
        progressStep = "Form complete";
      } else {
        progressStep = "Input pending";
      }

      return {
        onboardingId: row.onboardingId,
        userId: row.userId,
        userName: row.userName ?? row.userEmail ?? "Unknown User",
        wildcardLinks: {
          resumeRevamp: `/resume-revamp?onboardingId=${encodeURIComponent(
            row.onboardingId,
          )}`,
        },
        revealResume: row.revealResume,
        progress: progressStep,
        hasAiQuestions,
        hasQuestionnaireAnswers,
        hasRevampResult,
        updatedAt: row.updatedAt,
      };
    });

    return res.json({ success: true, items });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/** Admin: toggle `reveal_resume` for a submission (yes ↔ no). */
router.patch("/admin/:token/submissions/:submissionId/reveal", async (req: Request, res: Response) => {
  const token = req.params.token as string;
  const submissionId = req.params.submissionId as string;
  const { revealResume } = req.body ?? {};

  if (token !== ADMIN_ACCESS_TOKEN) {
    return res.status(403).json({ success: false, message: "Invalid admin token." });
  }
  if (typeof revealResume !== "boolean") {
    return res
      .status(400)
      .json({ success: false, message: "revealResume (boolean) is required." });
  }

  try {
    const [submission] = await db
      .update(onboardingSubmissionsTable)
      .set({ revealResume, updatedAt: new Date() } as any)
      .where(eq(onboardingSubmissionsTable.id, submissionId))
      .returning();

    if (!submission) {
      return res.status(404).json({ success: false, message: "Submission not found." });
    }
    return res.json({ success: true, submission, revealResume: submission.revealResume });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/admin/:token/mentor-links", async (req: Request, res: Response) => {
  const token = req.params.token as string;
  const { onboardingId, name, role } = req.body ?? {};
  if (token !== ADMIN_ACCESS_TOKEN) {
    return res.status(403).json({ success: false, message: "Invalid admin token." });
  }
  if (!onboardingId || typeof onboardingId !== "string") {
    return res
      .status(400)
      .json({ success: false, message: "onboardingId is required." });
  }
  if (!name || typeof name !== "string") {
    return res.status(400).json({ success: false, message: "name is required." });
  }
  const normalizedRole: ReviewerRole =
    role === "admin" || role === "user" || role === "mentor" ? role : "mentor";

  try {
    const [reviewer] = await db
      .insert(resumeReviewersTable)
      .values({
        onboardingId,
        name,
        role: normalizedRole,
        inviteToken: randomToken("acc"),
      })
      .returning();

    return res.json({
      success: true,
      reviewer,
      wildcardLink: `/mentor/${reviewer.inviteToken}`,
      role: normalizedRole,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/mentor/claim", async (req: Request, res: Response) => {
  const { inviteToken } = req.body ?? {};
  if (!inviteToken || typeof inviteToken !== "string") {
    return res
      .status(400)
      .json({ success: false, message: "inviteToken is required." });
  }

  try {
    const [reviewer] = await db
      .select()
      .from(resumeReviewersTable)
      .where(eq(resumeReviewersTable.inviteToken, inviteToken));

    if (!reviewer) {
      return res
        .status(404)
        .json({ success: false, message: "Invalid or expired invite link." });
    }

    const claimedRole: ReviewerRole =
      reviewer.role === "admin" ||
      reviewer.role === "user" ||
      reviewer.role === "mentor"
        ? reviewer.role
        : "mentor";

    const accessToken = encodeAccessToken({
      onboardingId: reviewer.onboardingId,
      role: claimedRole,
      reviewerId: reviewer.id,
    });

    return res.json({
      success: true,
      reviewer,
      token: accessToken,
      payload: {
        onboardingId: reviewer.onboardingId,
        role: claimedRole,
        reviewerId: reviewer.id,
        name: reviewer.name,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
