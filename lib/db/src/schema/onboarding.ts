import {
  boolean,
  integer,
  json,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

function generateCuid(): string {
  const ts = Date.now().toString(36);
  const r1 = Math.random().toString(36).substring(2, 15);
  const r2 = Math.random().toString(36).substring(2, 15);
  return `c${ts}${r1}${r2}`;
}

/**
 * Prisma `ResumeSettings` (PascalCase table). Onboarding snapshot is stored under
 * `customSections.mentorqueOnboarding` (see form-submission route).
 */
export const resumeSettingsTable = pgTable("ResumeSettings", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => generateCuid()),
  userId: text("userId").notNull(),
  apiKeyId: text("apiKeyId"),
  personalInfo: json("personalInfo").notNull().default({}),
  professionalSummary: text("professionalSummary"),
  education: json("education").notNull().default({}),
  experience: json("experience").notNull().default({}),
  skills: json("skills").notNull().default({}),
  projects: json("projects").notNull().default({}),
  customSections: json("customSections"),
  skillsDisplayMode: text("skillsDisplayMode").notNull().default("twoColumnar"),
  skillsLineTime: json("skillsLineTime"),
  sectionOrder: json("sectionOrder").notNull().default([]),
  sectionNames: json("sectionNames").notNull().default({}),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  deletedAt: timestamp("deletedAt"),
  deletedSections: json("deletedSections"),
  name: text("name"),
  shareToken: text("shareToken"),
  isPrimary: boolean("isPrimary").notNull().default(false),
  resumeTemplate: integer("resumeTemplate").notNull().default(1),
  isOnboardingResume: boolean("isOnboardingResume").notNull().default(false),
});

export const onboardingSubmissionsTable = pgTable("onboarding_submissions", {
  id: varchar("id", { length: 50 })
    .primaryKey()
    .$defaultFn(() => generateCuid()),
  userId: varchar("user_id", { length: 50 }).notNull(),
  basicDetails: json("basic_details").notNull().default({}),
  preferencesTaken: json("preferences_taken").notNull().default({}),
  uploadedResumeText: text("uploaded_resume_text"),
  revealResume: boolean("reveal_resume").notNull().default(false),
  /** input_pending | input_complete | completed — see migration 002_onboarding_input_status.sql */
  inputStatus: text("input_status").notNull().default("input_pending"),
  resumeSettingId: varchar("resume_setting_id", { length: 50 }).references(
    () => resumeSettingsTable.id,
    { onDelete: "set null" },
  ),
  /** AI-structured resume JSON from parseResumeText() — generated at form-submission time */
  parsedResume: json("parsed_resume"),
  /** RevampQuestion[] enriched with work experience + preferences context */
  aiQuestions: json("ai_questions"),
  /** Record<questionId, answer> submitted by user after reviewing AI questions */
  questionnaireAnswers: json("questionnaire_answers"),
  /** Revamped resume JSON used for compiler/review rendering. */
  revampedResume: json("revamped_resume"),
  /** Bullet-level change metadata for analysis cards. */
  resumeChanges: json("resume_changes"),
  /** Latest compiled PDF URL for the revamped resume. */
  compiledPdfUrl: text("compiled_pdf_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const resumeReviewersTable = pgTable("resume_reviewers", {
  id: varchar("id", { length: 50 })
    .primaryKey()
    .$defaultFn(() => generateCuid()),
  onboardingId: varchar("onboarding_id", { length: 50 })
    .notNull()
    .references(() => onboardingSubmissionsTable.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 50 }),
  name: varchar("name", { length: 255 }).notNull(),
  role: varchar("role", { length: 20 }).notNull().default("mentor"),
  inviteToken: varchar("invite_token", { length: 100 }).unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertResumeSettingSchema = createInsertSchema(resumeSettingsTable).omit({
  createdAt: true,
  updatedAt: true,
});

export const insertOnboardingSubmissionSchema = createInsertSchema(
  onboardingSubmissionsTable,
).omit({
  createdAt: true,
  updatedAt: true,
});

export const insertResumeReviewerSchema = createInsertSchema(resumeReviewersTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertResumeSetting = z.infer<typeof insertResumeSettingSchema>;
export type ResumeSetting = typeof resumeSettingsTable.$inferSelect;

export type InsertOnboardingSubmission = z.infer<
  typeof insertOnboardingSubmissionSchema
>;
export type OnboardingSubmission = typeof onboardingSubmissionsTable.$inferSelect;

export type InsertResumeReviewer = z.infer<typeof insertResumeReviewerSchema>;
export type ResumeReviewer = typeof resumeReviewersTable.$inferSelect;
