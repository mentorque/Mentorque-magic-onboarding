import {
  boolean,
  foreignKey,
  integer,
  json,
  pgTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { onboardingSubmissionsTable, resumeReviewersTable } from "./onboarding";

function generateCuid(): string {
  const ts = Date.now().toString(36);
  const r1 = Math.random().toString(36).substring(2, 15);
  const r2 = Math.random().toString(36).substring(2, 15);
  return `c${ts}${r1}${r2}`;
}

export interface HighlightRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  height: number;
}

export interface HighlightPosition {
  boundingRect: HighlightRect;
  rects: HighlightRect[];
  pageNumber: number;
}

export interface HighlightContent {
  text?: string;
  image?: string;
}

export interface HighlightComment {
  /** Stable id within this highlight's comments JSON (required for new data; backfilled for legacy rows). */
  id?: string;
  /** When set, this comment is a reply to another comment in the same highlight (by that comment's id). */
  inReplyToId?: string | null;
  type: "ai" | "human";
  text: string;
  author?: string;
  /** e.g. mentor | admin | candidate — shown next to author in UI */
  role?: string;
  createdAt: string;
}

export const highlightsTable = pgTable(
  "review_comments",
  {
    id: varchar("id", { length: 50 })
      .primaryKey()
      .$defaultFn(() => generateCuid()),
    /** Prisma `"User".id` — FK in DB migration. */
    userId: varchar("user_id", { length: 50 }),
    onboardingId: varchar("onboarding_id", { length: 50 }).references(
      () => onboardingSubmissionsTable.id,
      { onDelete: "cascade" },
    ),
    reviewerId: varchar("reviewer_id", { length: 50 }).references(
      () => resumeReviewersTable.id,
      { onDelete: "set null" },
    ),
    inReplyToId: varchar("in_reply_to_id", { length: 50 }),
    isResolved: boolean("is_resolved").notNull().default(false),
    documentUrl: text("document_url").notNull(),
    pageNumber: integer("page_number").notNull().default(1),
    position: json("position").$type<HighlightPosition>().notNull(),
    content: json("content").$type<HighlightContent>().notNull(),
    comments: json("comments").$type<HighlightComment[]>().notNull().default([]),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "review_comments_in_reply_to_fk",
      columns: [table.inReplyToId],
      foreignColumns: [table.id],
    }),
  ],
);

export const insertHighlightSchema = createInsertSchema(highlightsTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertHighlight = z.infer<typeof insertHighlightSchema>;
export type Highlight = typeof highlightsTable.$inferSelect;
