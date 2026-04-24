/**
 * highlights.ts  (Express router)
 * Location: backend/src/routes/highlights.ts
 *
 * Endpoints:
 *   GET    /api/highlights?documentUrl=...  — fetch all review comments for a PDF
 *   POST   /api/highlights                  — save a new review comment
 *   PATCH  /api/highlights/:id/comments    — append a reply (requires inReplyToId → parent comment id)
 *   DELETE /api/highlights/:id              — delete a highlight
 *   PATCH  /api/highlights/:id/resolve      — resolve/unresolve thread
 *   POST   /api/highlights/ai-review        — AI review of selected text
 */

import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { highlightsTable } from "@workspace/db";
import type { HighlightComment } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import OpenAI from "openai";

const router = Router();

/** Matches `highlightsTable` PK generator — explicit id on POST must use the same shape. */
function generateHighlightId(): string {
  const ts = Date.now().toString(36);
  const r1 = Math.random().toString(36).substring(2, 15);
  const r2 = Math.random().toString(36).substring(2, 15);
  return `c${ts}${r1}${r2}`;
}

/**
 * Deterministic ids for comments missing `id` so they match the frontend
 * (`PdfAnnotator` uses `${highlightId}-c${index}`) and PATCH parent lookup succeeds.
 */
function ensureCommentIds(
  highlightId: string,
  comments: HighlightComment[],
): HighlightComment[] {
  return comments.map((c, i) => ({
    ...c,
    id:
      c.id && String(c.id).trim()
        ? String(c.id).trim()
        : `${highlightId}-c${i}`,
  }));
}

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPEN_AI_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OpenAI API key not configured.");
  return new OpenAI({ apiKey });
}

// ─── GET /api/highlights ──────────────────────────────────────────────────────
router.get("/", async (req: Request, res: Response) => {
  const { documentUrl, onboardingId, reviewerId, inReplyToId, includeResolved } =
    req.query;

  try {
    const filters = [];
    if (typeof documentUrl === "string" && documentUrl.trim()) {
      filters.push(eq(highlightsTable.documentUrl, documentUrl));
    }
    if (typeof onboardingId === "string" && onboardingId.trim()) {
      filters.push(eq(highlightsTable.onboardingId, onboardingId));
    }
    if (typeof reviewerId === "string" && reviewerId.trim()) {
      filters.push(eq(highlightsTable.reviewerId, reviewerId));
    }
    if (typeof inReplyToId === "string" && inReplyToId.trim()) {
      filters.push(eq(highlightsTable.inReplyToId, inReplyToId));
    }
    if (includeResolved !== "true") {
      filters.push(eq(highlightsTable.isResolved, false));
    }

    const whereExpr =
      filters.length === 0
        ? undefined
        : filters.length === 1
          ? filters[0]
          : and(...filters);

    const highlights = whereExpr
      ? await db.select().from(highlightsTable).where(whereExpr)
      : await db.select().from(highlightsTable);
    return res.json({ success: true, highlights });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/highlights ─────────────────────────────────────────────────────
router.post("/", async (req: Request, res: Response) => {
  const {
    documentUrl,
    position,
    content,
    comments,
    userId,
    onboardingId,
    reviewerId,
    inReplyToId,
    isResolved,
  } = req.body;

  if (!documentUrl || !position || !content) {
    return res.status(400).json({
      success: false,
      message: "documentUrl, position, and content are required.",
    });
  }

  try {
    const highlightId = generateHighlightId();
    const normalizedComments = ensureCommentIds(
      highlightId,
      Array.isArray(comments) ? (comments as HighlightComment[]) : [],
    );

    const [highlight] = await db
      .insert(highlightsTable)
      .values({
        id: highlightId,
        userId: userId ?? null,
        onboardingId: onboardingId ?? null,
        reviewerId: reviewerId ?? null,
        inReplyToId: inReplyToId ?? null,
        isResolved: Boolean(isResolved),
        documentUrl,
        pageNumber: position.pageNumber ?? 1,
        position,
        content,
        comments: normalizedComments,
      })
      .returning();
    return res.json({ success: true, highlight });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/highlights/ai-review ──────────────────────────────────────────
// Must be defined BEFORE /:id to avoid route conflict
router.post("/ai-review", async (req: Request, res: Response) => {
  const { text } = req.body;
  if (!text || typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ success: false, message: "text is required." });
  }

  try {
    const client = getOpenAI();
    const completion = await client.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        {
          role: "system",
          content: `You are a professional resume reviewer and career coach. 
You review selected resume text and give concise, actionable suggestions to improve impact, clarity, and ATS alignment.
Keep feedback under 3 sentences. Be specific — reference the exact wording and suggest a concrete improvement.`,
        },
        {
          role: "user",
          content: `Review this resume text and suggest an improvement:\n\n"${text.trim()}"`,
        },
      ],
      temperature: 0.4,
      max_tokens: 200,
    });

    const suggestion = completion.choices[0]?.message?.content?.trim() ?? "No suggestion available.";
    return res.json({ success: true, suggestion });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── PATCH /api/highlights/:highlightId/comments ─────────────────────────────
// Append a reply (or top-level comment) to an existing highlight's comments JSON.
router.patch("/:id/comments", async (req: Request, res: Response) => {
  const highlightId =
    typeof req.params.id === "string" ? req.params.id : req.params.id?.[0];
  if (!highlightId) {
    return res.status(400).json({ success: false, message: "id is required." });
  }

  const { text, type, author, role, inReplyToId } = req.body ?? {};
  if (typeof text !== "string" || !text.trim()) {
    return res
      .status(400)
      .json({ success: false, message: "text is required for the new comment." });
  }

  try {
    const [row] = await db
      .select()
      .from(highlightsTable)
      .where(eq(highlightsTable.id, highlightId));
    if (!row) {
      return res.status(404).json({ success: false, message: "Highlight not found." });
    }

    let existing = ensureCommentIds(
      highlightId,
      Array.isArray(row.comments) ? (row.comments as HighlightComment[]) : [],
    );

    const parentId =
      typeof inReplyToId === "string" && inReplyToId.trim()
        ? inReplyToId.trim()
        : null;
    if (!parentId) {
      return res.status(400).json({
        success: false,
        message: "inReplyToId is required (reply to which comment).",
      });
    }
    if (!existing.some((c) => c.id === parentId)) {
      return res.status(400).json({
        success: false,
        message: "inReplyToId must reference an existing comment on this highlight.",
      });
    }

    const newComment: HighlightComment = {
      id: `${highlightId}-c${existing.length}`,
      type: type === "ai" ? "ai" : "human",
      text: text.trim(),
      author: typeof author === "string" ? author : undefined,
      role: typeof role === "string" ? role : undefined,
      createdAt: new Date().toISOString(),
      inReplyToId: parentId,
    };

    existing = [...existing, newComment];

    const [updated] = await db
      .update(highlightsTable)
      .set({
        comments: existing,
        updatedAt: new Date(),
      })
      .where(eq(highlightsTable.id, highlightId))
      .returning();

    return res.json({ success: true, highlight: updated });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── DELETE /api/highlights/:id ───────────────────────────────────────────────
router.delete("/:id", async (req: Request, res: Response) => {
  const id = typeof req.params.id === "string" ? req.params.id : req.params.id?.[0];
  if (!id) {
    return res.status(400).json({ success: false, message: "id is required." });
  }
  try {
    await db.delete(highlightsTable).where(eq(highlightsTable.id, id));
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── DELETE /api/highlights/:highlightId/comments/:commentId ─────────────────
router.delete("/:highlightId/comments/:commentId", async (req: Request, res: Response) => {
  const highlightId = typeof req.params.highlightId === "string" 
    ? req.params.highlightId 
    : req.params.highlightId?.[0];
  const commentId = typeof req.params.commentId === "string" 
    ? req.params.commentId 
    : req.params.commentId?.[0];

  if (!highlightId || !commentId) {
    return res.status(400).json({ 
      success: false, 
      message: "highlightId and commentId are required." 
    });
  }

  try {
    const [row] = await db
      .select()
      .from(highlightsTable)
      .where(eq(highlightsTable.id, highlightId));
    
    if (!row) {
      return res.status(404).json({ success: false, message: "Highlight not found." });
    }

    const existing = Array.isArray(row.comments) ? row.comments : [];
    
    const commentToDelete = existing.find((c) => c.id === commentId);
    if (!commentToDelete) {
      return res.status(404).json({ success: false, message: "Comment not found." });
    }

    if (!commentToDelete.inReplyToId) {
      return res.status(400).json({ 
        success: false, 
        message: "Cannot delete root comments. Delete the entire highlight instead." 
      });
    }

    const updatedComments = existing.filter((c) => c.id !== commentId);

    const [updated] = await db
      .update(highlightsTable)
      .set({
        comments: updatedComments,
        updatedAt: new Date(),
      })
      .where(eq(highlightsTable.id, highlightId))
      .returning();

    return res.json({ success: true, highlight: updated });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── PATCH /api/highlights/:id/resolve ─────────────────────────────────────────
router.patch("/:id/resolve", async (req: Request, res: Response) => {
  const id = typeof req.params.id === "string" ? req.params.id : req.params.id?.[0];
  if (!id) {
    return res.status(400).json({ success: false, message: "id is required." });
  }
  const { isResolved } = req.body ?? {};
  if (typeof isResolved !== "boolean") {
    return res
      .status(400)
      .json({ success: false, message: "isResolved boolean is required." });
  }

  try {
    const [highlight] = await db
      .update(highlightsTable)
      .set({
        isResolved,
        updatedAt: new Date(),
      })
      .where(eq(highlightsTable.id, id))
      .returning();
    return res.json({ success: true, highlight });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
