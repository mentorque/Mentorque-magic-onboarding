import { Router, Request, Response } from "express";
import {
  db,
  onboardingSubmissionsTable,
  resumeReviewersTable,
  resumeSettingsTable,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { authenticateFirebaseToken } from "../middlewares/auth.js";

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
            uploadedResumeText:
              uploadedResumeText !== undefined && uploadedResumeText !== null
                ? String(uploadedResumeText)
                : null,
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
          uploadedResumeText:
            uploadedResumeText !== undefined && uploadedResumeText !== null
              ? String(uploadedResumeText)
              : null,
          preferencesTaken,
          revealResume,
          resumeSettingId: createdSetting.id,
          inputStatus: ONBOARDING_INPUT_STATUS.INPUT_COMPLETE,
        })
        .returning();

      return { submission, resumeSettingId: createdSetting.id };
    });

    return res.json({ success: true, submission: result.submission, resumeSettingId: result.resumeSettingId });
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

router.get("/admin/:token/list", async (req: Request, res: Response) => {
  const token = req.params.token as string;
  if (token !== ADMIN_ACCESS_TOKEN) {
    return res.status(403).json({ success: false, message: "Invalid admin token." });
  }

  try {
    // Prisma "User" table uses fullName (camelCase column), not name.
    const result = await db.execute(sql<{
      onboardingId: string;
      userId: string;
      userName: string | null;
      userEmail: string | null;
      revealResume: boolean;
      inputStatus: string;
    }>`
      select
        os.id as "onboardingId",
        os.user_id as "userId",
        u."fullName" as "userName",
        u.email as "userEmail",
        os.reveal_resume as "revealResume",
        os.input_status as "inputStatus"
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
    }>;

    const items = rows.map((row: (typeof rows)[number]) => ({
      onboardingId: row.onboardingId,
      userId: row.userId,
      userName: row.userName ?? row.userEmail ?? "Unknown User",
      wildcardLinks: {
        resumeRevamp: `/resume-revamp?onboardingId=${encodeURIComponent(
          row.onboardingId,
        )}`,
      },
      revealResume: row.revealResume,
      inputStatus: row.inputStatus,
    }));

    return res.json({ success: true, items });
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
  const { inviteToken, userId, name } = req.body ?? {};
  if (!inviteToken || typeof inviteToken !== "string") {
    return res
      .status(400)
      .json({ success: false, message: "inviteToken is required." });
  }
  if (!userId || typeof userId !== "string") {
    return res.status(400).json({ success: false, message: "userId is required." });
  }

  try {
    const [existingByToken] = await db
      .select()
      .from(resumeReviewersTable)
      .where(eq(resumeReviewersTable.inviteToken, inviteToken));

    if (!existingByToken) {
      return res
        .status(404)
        .json({ success: false, message: "Invalid mentor invite link." });
    }

    let reviewer = existingByToken;
    if (!existingByToken.userId) {
      const [updated] = await db
        .update(resumeReviewersTable)
        .set({
          userId,
          name: typeof name === "string" && name.trim() ? name : existingByToken.name,
          updatedAt: new Date(),
        })
        .where(eq(resumeReviewersTable.id, existingByToken.id))
        .returning();
      reviewer = updated;
    }

    // Ensure reviewer entry exists for this mentor + onboarding pair.
    const [reviewerExists] = await db
      .select({ count: sql<number>`count(*)` })
      .from(resumeReviewersTable)
      .where(
        and(
          eq(resumeReviewersTable.onboardingId, reviewer.onboardingId),
          eq(resumeReviewersTable.userId, userId),
        ),
      );

    if (Number(reviewerExists?.count ?? 0) === 0) {
      const [created] = await db
        .insert(resumeReviewersTable)
        .values({
          onboardingId: reviewer.onboardingId,
          userId,
          name: reviewer.name,
          role: "mentor",
          inviteToken,
        })
        .returning();
      reviewer = created;
    }

    const claimedRole: ReviewerRole =
      existingByToken.role === "admin" ||
      existingByToken.role === "user" ||
      existingByToken.role === "mentor"
        ? existingByToken.role
        : "mentor";

    const accessToken = encodeAccessToken({
      onboardingId: reviewer.onboardingId,
      role: claimedRole,
      reviewerId: reviewer.id,
      userId,
    });

    return res.json({
      success: true,
      reviewer,
      token: accessToken,
      payload: {
        onboardingId: reviewer.onboardingId,
        role: claimedRole,
        reviewerId: reviewer.id,
        userId,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
