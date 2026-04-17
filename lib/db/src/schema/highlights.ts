import { pgTable, text, varchar, json, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

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
  type: "ai" | "human";
  text: string;
  author?: string;
  createdAt: string;
}

export const highlightsTable = pgTable("pdf_highlights", {
  id: varchar("id", { length: 50 })
    .primaryKey()
    .$defaultFn(() => generateCuid()),
  userId: varchar("user_id", { length: 128 }),
  documentUrl: text("document_url").notNull(),
  pageNumber: integer("page_number").notNull().default(1),
  position: json("position").$type<HighlightPosition>().notNull(),
  content: json("content").$type<HighlightContent>().notNull(),
  comments: json("comments").$type<HighlightComment[]>().notNull().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertHighlightSchema = createInsertSchema(highlightsTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertHighlight = z.infer<typeof insertHighlightSchema>;
export type Highlight = typeof highlightsTable.$inferSelect;
