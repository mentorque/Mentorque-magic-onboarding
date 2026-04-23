/**
 * PdfAnnotator.tsx
 *
 * Drop-in replacement for PdfPanel that adds:
 *   - Text selection → floating popup with [Ask AI] and [Add Note]
 *   - Highlights rendered as colour overlays on the PDF page
 *   - AI review via POST /api/highlights/ai-review
 *   - Persist/delete highlights via POST|DELETE /api/highlights; replies via PATCH /api/highlights/:id/comments
 *   - Click a highlight to view its saved comments
 *
 * Uses react-pdf for rendering (already installed) + a transparent
 * selection/overlay layer — no second PDF.js instance.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2,
  Sparkles,
  MessageSquare,
  X,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Bot,
  Send,
  Reply,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { withApiBase } from "@/lib/apiBaseUrl";

// ─── Worker ──────────────────────────────────────────────────────────────────

if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@5.4.296/build/pdf.worker.min.mjs`;
}

// ─── Types ───────────────────────────────────────────────────────────────────

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

export interface HighlightComment {
  id?: string;
  inReplyToId?: string | null;
  type: "ai" | "human";
  text: string;
  author?: string;
  role?: string;
  createdAt: string;
}

function generateCommentId(): string {
  const ts = Date.now().toString(36);
  const r = Math.random().toString(36).substring(2, 11);
  return `c${ts}${r}`;
}

export function normalizeCommentsForHighlight(
  highlightId: string,
  raw: unknown,
): HighlightComment[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((c: any, i: number) => ({
    type: c?.type === "ai" ? "ai" : "human",
    text: String(c?.text ?? ""),
    author: typeof c?.author === "string" ? c.author : undefined,
    role: typeof c?.role === "string" ? c.role : undefined,
    createdAt: String(c?.createdAt ?? new Date().toISOString()),
    id:
      typeof c?.id === "string" && c.id.trim()
        ? c.id.trim()
        : `${highlightId}-c${i}`,
    inReplyToId:
      typeof c?.inReplyToId === "string" && c.inReplyToId.trim()
        ? c.inReplyToId.trim()
        : null,
  }));
}

export function commentAuthorLabel(c: {
  type: "ai" | "human";
  author?: string;
  role?: string;
}): string | undefined {
  if (c.type === "ai") return undefined;
  return [c.author, c.role].filter(Boolean).join(" · ") || undefined;
}

/** Stable per-user seed for RoboHash (same seed → same robot). */
export function stableAvatarSeedForComment(
  c: HighlightComment,
  fallback: string,
  annotation: AnnotationAttribution | null | undefined,
): string {
  if (c.type === "ai") return "mentorque-ai";
  const author = c.author?.trim();
  const role = c.role?.trim();
  if (
    annotation?.reviewerId &&
    author &&
    annotation.displayName.trim() === author
  ) {
    return annotation.reviewerId;
  }
  if (author || role) {
    return [author, role].filter(Boolean).join("|");
  }
  return fallback;
}

function studioRobohashSrc(seed: string): string {
  const safe = seed.slice(0, 240);
  return `https://robohash.org/${encodeURIComponent(safe)}.png?set=set3&bgset=bg2&size=128x128`;
}

export function StudioRoboAvatar({
  seed,
  size = "md",
  className,
}: {
  seed: string;
  size?: "md" | "sm";
  className?: string;
}) {
  const inner = size === "sm" ? "h-5 w-5" : "h-7 w-7";
  const scale = size === "sm" ? "scale-[1.1]" : "scale-[1.15]";
  return (
    <div
      className={cn(
        "shrink-0 self-start rounded-full bg-white p-[1px] shadow-sm ring-1 ring-black/5",
        className,
      )}
    >
      <div
        className={cn("relative overflow-hidden rounded-full bg-white", inner)}
      >
        <img
          src={studioRobohashSrc(seed)}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className={cn("h-full w-full object-cover object-center", scale)}
        />
      </div>
    </div>
  );
}

export function normalizeHighlight(raw: any): Highlight {
  const id = String(raw?.id ?? "");
  return {
    id,
    documentUrl: String(raw?.documentUrl ?? ""),
    position: raw.position,
    content: raw.content ?? {},
    comments: normalizeCommentsForHighlight(id, raw?.comments),
  };
}

export function repliesToParent(
  all: HighlightComment[],
  parentId: string,
): HighlightComment[] {
  return all
    .filter((c) => c.inReplyToId === parentId)
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
}

export function rootComments(all: HighlightComment[]): HighlightComment[] {
  return all
    .filter((c) => !c.inReplyToId)
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
}

export interface Highlight {
  id: string;
  documentUrl: string;
  position: HighlightPosition;
  content: { text?: string };
  comments: HighlightComment[];
}

interface PendingSelection {
  /** Popup x,y in px relative to the page wrapper div */
  popupX: number;
  popupY: number;
  text: string;
  position: HighlightPosition;
}

/** When set, human notes are attributed with this name + role (wildcard / owner). */
export interface AnnotationAttribution {
  displayName: string;
  role: string;
  onboardingId: string;
  reviewerId: string | null;
}

interface PdfAnnotatorProps {
  pdfUrl: string | null;
  revampedResume: any;
  documentId: string;
  focusHighlightId?: string | null;
  focusSignal?: number;
  focusedInsightText?: string | null;
  annotation?: AnnotationAttribution | null;
  /** Increment to refetch highlights from the API (e.g. after bulk resolve). */
  highlightsRefreshSignal?: number;
  /** Called when a highlight block is clicked (used to focus Studio card). */
  onHighlightClick?: (highlightId: string) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toRelativePct(rect: DOMRect, container: DOMRect): HighlightRect {
  const x1 = ((rect.left - container.left) / container.width) * 100;
  const y1 = ((rect.top - container.top) / container.height) * 100;
  const x2 = ((rect.right - container.left) / container.width) * 100;
  const y2 = ((rect.bottom - container.top) / container.height) * 100;
  return { x1, y1, x2, y2, width: x2 - x1, height: y2 - y1 };
}

// ─── HighlightLayer ───────────────────────────────────────────────────────────

function HighlightLayer({
  highlights,
  pageNumber,
  onClickHighlight,
  activeId,
}: {
  highlights: Highlight[];
  pageNumber: number;
  onClickHighlight: (h: Highlight) => void;
  activeId: string | null;
}) {
  return (
    <>
      {highlights
        .filter((h) => h.position.pageNumber === pageNumber)
        .map((h) =>
          h.position.rects.map((rect, i) => (
            <div
              key={`${h.id}-${i}`}
              onClick={() => onClickHighlight(h)}
              style={{
                position: "absolute",
                left: `${rect.x1}%`,
                top: `${rect.y1}%`,
                width: `${rect.width}%`,
                height: `${rect.height}%`,
                zIndex: 20,
                cursor: "pointer",
                borderRadius: 2,
              }}
              className={cn(
                "transition-all duration-300 border-l-2",
                "bg-cyan-500/20 border-cyan-400/40 hover:bg-cyan-500/30",
                activeId === h.id && "ring-2 ring-white/40 shadow-[0_0_15px_rgba(255,255,255,0.1)]",
              )}
            />
          )),
        )}
    </>
  );
}

// ─── SelectionPopup ───────────────────────────────────────────────────────────

type PopupMode = "menu" | "note" | "ai-loading" | "ai-done";

function SelectionPopup({
  x,
  y,
  mode,
  aiText,
  onAskAI,
  onAddNote,
  onDismiss,
}: {
  x: number;
  y: number;
  mode: PopupMode;
  aiText: string;
  onAskAI: () => void;
  onAddNote: (note: string) => void;
  onDismiss: () => void;
}) {
  const [noteVal, setNoteVal] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSaveNote = async () => {
    if (!noteVal.trim() || saving) return;
    setSaving(true);
    await onAddNote(noteVal);
    setSaving(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, y: -4 }}
      transition={{ duration: 0.15 }}
      style={{ position: "absolute", left: x, top: y, zIndex: 50 }}
      className="w-72 rounded-2xl border border-white/15 bg-black/90 backdrop-blur-xl shadow-2xl p-4 text-sm flex flex-col gap-3"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-0.5">
        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/30">
          {mode === "menu" && "Annotate"}
          {mode === "note" && "Add Note"}
          {mode === "ai-loading" && "Asking AI…"}
          {mode === "ai-done" && "AI Review"}
        </span>
        <button
          onClick={onDismiss}
          className="p-1 rounded-lg text-white/30 hover:text-white hover:bg-white/10 transition-all"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Menu */}
      {mode === "menu" && (
        <div className="flex gap-2">
          <button
            onClick={onAskAI}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-500/20 border border-violet-500/30 text-violet-300 hover:bg-violet-500/30 transition-all text-[10px] font-black uppercase tracking-widest"
          >
            <Bot className="w-3.5 h-3.5" />
            Ask AI
          </button>
          <button
            onClick={() => {
              /* switch mode handled in parent */ onAddNote("__switch__");
            }}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-300 hover:bg-amber-500/30 transition-all text-[10px] font-black uppercase tracking-widest"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Note
          </button>
        </div>
      )}

      {/* Note input */}
      {mode === "note" && (
        <div className="flex flex-col gap-2">
          <textarea
            autoFocus
            value={noteVal}
            onChange={(e) => setNoteVal(e.target.value)}
            placeholder="Write your note…"
            rows={3}
            disabled={saving}
            className="w-full rounded-xl bg-white/5 border border-white/10 text-white/80 text-xs p-3 resize-none placeholder:text-white/20 focus:outline-none focus:border-white/20 disabled:opacity-50"
          />
          <button
            onClick={handleSaveNote}
            disabled={!noteVal.trim() || saving}
            className="flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-300 hover:bg-amber-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all text-[10px] font-black uppercase tracking-widest"
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            {saving ? "Saving" : "Save Note"}
          </button>
        </div>
      )}

      {/* AI loading */}
      {mode === "ai-loading" && (
        <div className="flex items-center justify-center py-4 gap-3 text-violet-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">Reviewing…</span>
        </div>
      )}

      {/* AI result */}
      {mode === "ai-done" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2 p-2.5 rounded-xl bg-violet-500/10 border border-violet-500/20">
            <Sparkles className="w-3.5 h-3.5 text-violet-400 mt-0.5 shrink-0" />
            <p className="text-xs text-white/70 leading-relaxed italic">{aiText}</p>
          </div>
          <p className="text-[9px] font-black uppercase tracking-widest text-white/20 px-1">
            Saved to highlights
          </p>
        </div>
      )}
    </motion.div>
  );
}

// ─── HighlightDetail ──────────────────────────────────────────────────────────

function CommentBubble({
  comment,
  allComments,
  depth,
  expandedThreads,
  toggleReplies,
  replyingToId,
  setReplyingToId,
  replyDraft,
  setReplyDraft,
  postReply,
  posting,
  deleteComment,
  deleting,
  annotation,
  highlightId,
}: {
  comment: HighlightComment;
  allComments: HighlightComment[];
  depth: number;
  expandedThreads: Record<string, boolean>;
  toggleReplies: (commentId: string) => void;
  replyingToId: string | null;
  setReplyingToId: (id: string | null) => void;
  replyDraft: string;
  setReplyDraft: (s: string) => void;
  postReply: (parentCommentId: string) => void;
  posting: boolean;
  deleteComment: (commentId: string) => void;
  deleting: boolean;
  annotation: AnnotationAttribution | null | undefined;
  highlightId: string;
}) {
  const cid = comment.id ?? "";
  const childComments = repliesToParent(allComments, cid);
  const hasReplies = childComments.length > 0;
  const repliesOpen = expandedThreads[cid] === true;
  const showReplyBox = replyingToId === cid;

  return (
    <div className={cn("flex flex-col", depth > 0 ? "mt-3" : "mt-1")}>
      <div className="group/bubble flex gap-3">
        <StudioRoboAvatar
          seed={stableAvatarSeedForComment(
            comment,
            `comment-${comment.id}`,
            annotation,
          )}
          size="sm"
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-baseline gap-1.5 min-w-0 overflow-hidden">
              <span
                className={cn(
                  "text-[9px] font-black uppercase tracking-widest truncate",
                  comment.type === "ai" ? "text-violet-300" : "text-cyan-300",
                )}
              >
                {comment.type === "ai"
                  ? "AI"
                  : commentAuthorLabel(comment) || "User"}
              </span>
              <span className="text-[9px] text-white/20 shrink-0">•</span>
              <span className="text-[9px] font-medium text-white/30 whitespace-nowrap shrink-0">
                {new Date(comment.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover/bubble:opacity-100 transition-opacity shrink-0">
              {comment.inReplyToId && (
                <button
                  type="button"
                  onClick={() => deleteComment(cid)}
                  disabled={deleting}
                  className="p-1 rounded-md text-red-400/40 hover:text-red-400 hover:bg-red-400/10 disabled:opacity-40 transition-colors"
                  title="Delete comment"
                >
                  {deleting ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Trash2 className="w-3 h-3" />
                  )}
                </button>
              )}
            </div>
          </div>

          <div className="relative">
            <p className="text-xs text-white/80 leading-relaxed bg-white/[0.03] border border-white/5 rounded-2xl px-3 py-2">
              {comment.text}
            </p>

            <div className="mt-1.5 flex items-center gap-3 px-1">
              <button
                type="button"
                onClick={() => {
                  setReplyingToId(showReplyBox ? null : cid);
                  if (!showReplyBox) setReplyDraft("");
                }}
                className={cn(
                  "flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest transition-colors",
                  showReplyBox
                    ? "text-cyan-400"
                    : "text-white/40 hover:text-white/70",
                )}
              >
                <Reply className="w-3 h-3" />
                Reply
              </button>
              {hasReplies && (
                <button
                  type="button"
                  onClick={() => toggleReplies(cid)}
                  className="text-[9px] font-black uppercase tracking-widest text-white/30 hover:text-white/60 transition-colors"
                >
                  {repliesOpen
                    ? `Hide ${childComments.length}`
                    : `Show ${childComments.length} ${childComments.length === 1 ? "reply" : "replies"}`}
                </button>
              )}
            </div>
          </div>

          {showReplyBox && (
            <div className="mt-3 space-y-2 pl-2">
              <textarea
                autoFocus
                value={replyDraft}
                onChange={(e) => setReplyDraft(e.target.value)}
                placeholder="Type your reply..."
                rows={2}
                disabled={posting}
                className="w-full resize-none rounded-xl border border-cyan-500/30 bg-cyan-500/5 px-3 py-2 text-xs text-white/90 placeholder:text-white/20 focus:outline-none focus:ring-1 focus:ring-cyan-500/50 disabled:opacity-50"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setReplyingToId(null);
                    setReplyDraft("");
                  }}
                  className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white/70 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={posting || !replyDraft.trim()}
                  onClick={() => postReply(cid)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500/20 border border-cyan-400/30 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-40 transition-all active:scale-95"
                >
                  {posting ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Send className="w-3 h-3" />
                  )}
                  {posting ? "Sending" : "Send Reply"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {hasReplies && repliesOpen && (
        <div className="mt-1 space-y-1 pl-9">
          {childComments.map((child) => (
            <CommentBubble
              key={child.id}
              comment={child}
              allComments={allComments}
              depth={depth + 1}
              expandedThreads={expandedThreads}
              toggleReplies={toggleReplies}
              replyingToId={replyingToId}
              setReplyingToId={setReplyingToId}
              replyDraft={replyDraft}
              setReplyDraft={setReplyDraft}
              postReply={postReply}
              posting={posting}
              deleteComment={deleteComment}
              deleting={deleting}
              annotation={annotation}
              highlightId={highlightId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HighlightDetail({
  highlight,
  anchor,
  onDelete,
  onClose,
  annotation,
  onHighlightUpdated,
  isDeleting = false,
}: {
  highlight: Highlight;
  anchor: { leftPct: number; topPct: number; placement: "right" | "below" };
  onDelete: () => void;
  onClose: () => void;
  annotation: AnnotationAttribution | null | undefined;
  onHighlightUpdated: (h: Highlight) => void;
  isDeleting?: boolean;
}) {
  const [expandedThreads, setExpandedThreads] = useState<Record<string, boolean>>(
    {},
  );
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const toggleReplies = useCallback((commentId: string) => {
    setExpandedThreads((prev) => ({
      ...prev,
      [commentId]: !prev[commentId],
    }));
  }, []);

  const deleteComment = useCallback(
    async (commentId: string) => {
      setDeleting(true);
      try {
        const res = await fetch(
          withApiBase(`/api/highlights/${encodeURIComponent(highlight.id)}/comments/${encodeURIComponent(commentId)}`),
          {
            method: "DELETE",
          },
        );
        const data = await res.json();
        if (data.success && data.highlight) {
          onHighlightUpdated(normalizeHighlight(data.highlight));
        }
      } catch {
        // keep state
      } finally {
        setDeleting(false);
      }
    },
    [highlight.id, onHighlightUpdated],
  );

  const postReply = useCallback(
    async (parentCommentId: string) => {
      const text = replyDraft.trim();
      if (!text) return;
      setPosting(true);
      try {
        const res = await fetch(
          withApiBase(`/api/highlights/${encodeURIComponent(highlight.id)}/comments`),
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text,
              type: "human",
              inReplyToId: parentCommentId,
              author: annotation?.displayName,
              role: annotation?.role,
            }),
          },
        );
        const data = await res.json();
        if (data.success && data.highlight) {
          onHighlightUpdated(normalizeHighlight(data.highlight));
          setReplyDraft("");
          setReplyingToId(null);
          setExpandedThreads((prev) => ({ ...prev, [parentCommentId]: true }));
        }
      } catch {
        // keep draft
      } finally {
        setPosting(false);
      }
    },
    [
      highlight.id,
      replyDraft,
      annotation,
      onHighlightUpdated,
    ],
  );

  const roots = rootComments(highlight.comments);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.97, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, y: 4 }}
      className="absolute w-80 max-w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-white/15 bg-black/90 backdrop-blur-xl shadow-2xl p-4 z-50 flex flex-col gap-3"
      style={{
        left: `${anchor.leftPct}%`,
        top: `${anchor.topPct}%`,
        transform:
          anchor.placement === "below" ? "translateX(-50%)" : undefined,
      }}
    >
      {/* caret */}
      {anchor.placement === "right" ? (
        <div className="absolute -left-2 top-4 w-0 h-0 border-t-8 border-b-8 border-r-8 border-t-transparent border-b-transparent border-r-white/15" />
      ) : (
        <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-0 h-0 border-l-8 border-r-8 border-b-8 border-l-transparent border-r-transparent border-b-white/15" />
      )}
      <div className="flex items-center justify-between px-0.5">
        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white/30">
          Annotation
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={onDelete}
            disabled={isDeleting}
            className="p-1 rounded text-red-400/40 hover:text-red-400 hover:bg-red-400/10 transition-all disabled:opacity-40"
            title="Delete comment"
          >
            {isDeleting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Trash2 className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded text-white/30 hover:text-white hover:bg-white/10 transition-all"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {highlight.content.text && (
        <blockquote className="border-l-2 border-white/10 pl-3 text-xs text-white/50 leading-relaxed line-clamp-3">
          {highlight.content.text}
        </blockquote>
      )}

      <div className="flex flex-col gap-2 max-h-[min(70vh,32rem)] overflow-y-auto custom-scrollbar pr-1">
        {roots.map((c) => (
          <CommentBubble
            key={c.id}
            comment={c}
            allComments={highlight.comments}
            depth={0}
            expandedThreads={expandedThreads}
            toggleReplies={toggleReplies}
            replyingToId={replyingToId}
            setReplyingToId={setReplyingToId}
            replyDraft={replyDraft}
            setReplyDraft={setReplyDraft}
            postReply={postReply}
            posting={posting}
            deleteComment={deleteComment}
            deleting={deleting}
            annotation={annotation}
            highlightId={highlight.id}
          />
        ))}
      </div>
    </motion.div>
  );
}

// ─── TextFallback ─────────────────────────────────────────────────────────────

function TextFallback({ resume: r }: { resume: any }) {
  if (!r) return null;
  const name =
    `${r.personalInfo?.firstName ?? ""} ${r.personalInfo?.lastName ?? ""}`.trim();
  const contact = [
    r.personalInfo?.email,
    r.personalInfo?.location,
    r.personalInfo?.phoneNumber,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="w-full text-[13px] leading-relaxed text-white/60 font-mono space-y-2">
      {name && (
        <div className="text-center pb-6 mb-8 border-b border-white/10">
          <p className="text-white/90 font-bold text-2xl tracking-tight">
            {name}
          </p>
          {contact && <p className="text-white/40 text-xs mt-2">{contact}</p>}
        </div>
      )}
      {r.professionalSummary && (
        <div className="mb-8">
          <p className="text-xs font-bold uppercase tracking-widest text-white/40 mb-3">
            Summary
          </p>
          <p className="text-white/70 leading-relaxed">
            {r.professionalSummary}
          </p>
        </div>
      )}
      {r.experience?.map((exp: any, i: number) => (
        <div key={i} className="mb-8">
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-xs font-bold uppercase tracking-widest text-white/50">
              {exp.position} · {exp.company}
            </p>
            <p className="text-[11px] text-white/30">
              {exp.startDate} – {exp.endDate || "Present"}
            </p>
          </div>
          {exp.highlights?.map((h: string, hi: number) => (
            <p
              key={hi}
              className="pl-5 border-l-2 border-white/10 text-white/50 mb-2 text-sm leading-relaxed"
            >
              {h}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── PdfAnnotator ─────────────────────────────────────────────────────────────

export function PdfAnnotator({
  pdfUrl,
  revampedResume,
  documentId,
  focusHighlightId,
  focusSignal = 0,
  focusedInsightText,
  annotation = null,
  highlightsRefreshSignal = 0,
  onHighlightClick,
}: PdfAnnotatorProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [containerWidth, setContainerWidth] = useState(400);

  const outerRef = useRef<HTMLDivElement>(null); // responsive width measurement
  const pageWrapperRef = useRef<HTMLDivElement>(null); // for selection rect calculation

  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [popupMode, setPopupMode] = useState<PopupMode>("menu");
  const [aiText, setAiText] = useState("");
  const [activeHighlight, setActiveHighlight] = useState<Highlight | null>(
    null,
  );
  const [detailAnchor, setDetailAnchor] = useState<{
    leftPct: number;
    topPct: number;
    placement: "right" | "below";
  }>({
    leftPct: 70,
    topPct: 8,
    placement: "right",
  });

  const [insightRects, setInsightRects] = useState<HighlightRect[]>([]);

  // ── Responsive width — fill the container as much as possible ──────────────
  useEffect(() => {
    const update = () => {
      const parent = outerRef.current?.parentElement;
      if (!parent) return;
      const w = parent.clientWidth - 16;
      setContainerWidth(Math.max(w, 300));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // ── Fetch existing highlights ───────────────────────────────────────────────
  useEffect(() => {
    const q = new URLSearchParams();
    // Annotator should show only active/open highlights.
    // Resolved threads remain visible in Resume Studio cards.
    if (annotation?.onboardingId) {
      q.set("onboardingId", annotation.onboardingId);
    } else if (documentId) {
      q.set("documentUrl", documentId);
    } else {
      return;
    }
    fetch(withApiBase(`/api/highlights?${q.toString()}`))
      .then((r) => r.json())
      .then((d) => {
        if (d.success && Array.isArray(d.highlights)) {
          setHighlights(d.highlights.map(normalizeHighlight));
        }
      })
      .catch(() => {});
  }, [documentId, annotation?.onboardingId, highlightsRefreshSignal]);

  const dismissPending = useCallback(() => {
    setPending(null);
    setPopupMode("menu");
    setAiText("");
    window.getSelection()?.removeAllRanges();
  }, []);

  const focusHighlight = useCallback((h: Highlight) => {
    const b = h.position.boundingRect;
    // Prefer right-side placement. If there isn't enough room, place below the highlight point.
    const canPlaceRight = b.x2 < 68;
    if (canPlaceRight) {
      const leftPct = Math.min(70, Math.max(4, b.x2 + 1.8));
      const topPct = Math.min(70, Math.max(2, b.y1 - 1));
      setDetailAnchor({ leftPct, topPct, placement: "right" });
    } else {
      const leftPct = Math.min(92, Math.max(8, (b.x1 + b.x2) / 2));
      const topPct = Math.min(78, Math.max(6, b.y2 + 2));
      setDetailAnchor({ leftPct, topPct, placement: "below" });
    }
    setActiveHighlight(h);
  }, []);

  // ── External focus request (from Resume Studio list) ───────────────────────
  useEffect(() => {
    if (!focusHighlightId || highlights.length === 0) return;
    const target = highlights.find((h) => h.id === focusHighlightId);
    if (!target) return;

    setPageNumber(target.position.pageNumber || 1);
    focusHighlight(target);
    dismissPending();
    pageWrapperRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [
    focusHighlightId,
    focusSignal,
    highlights,
    dismissPending,
    focusHighlight,
  ]);

  // ── Insight focus from ComparisonView ───────────────────────────────────────
  useEffect(() => {
    if (!focusedInsightText || !pageWrapperRef.current) {
      setInsightRects([]);
      return;
    }

    const timer = setTimeout(() => {
      const textLayer = pageWrapperRef.current?.querySelector(
        ".react-pdf__Page__textContent",
      );
      if (!textLayer) return;

      const spans = Array.from(textLayer.querySelectorAll("span"));

      const targetClean = focusedInsightText
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      if (!targetClean) return;

      const containerRect = pageWrapperRef.current!.getBoundingClientRect();

      const spanData = spans.map((span, index) => {
        const rect = span.getBoundingClientRect();
        const spanText = (span.textContent || "")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
        return {
          index,
          rect,
          spanText,
          top: rect.top,
          left: rect.left,
          matchScore:
            spanText.length > 0
              ? targetClean.includes(spanText)
                ? spanText.length
                : 0
              : 0,
        };
      });

      const matchedSpans = spanData.filter((s) => s.matchScore > 0);

      if (matchedSpans.length === 0) {
        setInsightRects([]);
        return;
      }

      matchedSpans.sort((a, b) => {
        if (Math.abs(a.top - b.top) < 10) {
          return a.left - b.left;
        }
        return a.top - b.top;
      });

      const mergedRects: { x1: number; y1: number; x2: number; y2: number }[] =
        [];
      let currentGroup = matchedSpans[0] ? [matchedSpans[0]] : [];

      for (let i = 1; i < matchedSpans.length; i++) {
        const prev = currentGroup[currentGroup.length - 1];
        const curr = matchedSpans[i];

        const isSameLine = Math.abs(curr.top - prev.top) < 15;
        const isAdjacent = curr.left < prev.rect.right + 20;

        if (isSameLine && isAdjacent) {
          currentGroup.push(curr);
        } else {
          if (currentGroup.length > 0) {
            const x1 = Math.min(...currentGroup.map((s) => s.left));
            const y1 = Math.min(...currentGroup.map((s) => s.top));
            const x2 = Math.max(...currentGroup.map((s) => s.rect.right));
            const y2 = Math.max(...currentGroup.map((s) => s.rect.bottom));
            mergedRects.push({ x1, y1, x2, y2 });
          }
          currentGroup = [curr];
        }
      }

      if (currentGroup.length > 0) {
        const x1 = Math.min(...currentGroup.map((s) => s.left));
        const y1 = Math.min(...currentGroup.map((s) => s.top));
        const x2 = Math.max(...currentGroup.map((s) => s.rect.right));
        const y2 = Math.max(...currentGroup.map((s) => s.rect.bottom));
        mergedRects.push({ x1, y1, x2, y2 });
      }

      const relativeRects = mergedRects.map((r) => {
        const top = ((r.y1 - containerRect.top) / containerRect.height) * 100;
        const left = ((r.x1 - containerRect.left) / containerRect.width) * 100;
        const width = ((r.x2 - r.x1) / containerRect.width) * 100;
        const height = ((r.y2 - r.y1) / containerRect.height) * 100;
        return {
          x1: left,
          y1: top,
          x2: left + width,
          y2: top + height,
          width,
          height,
        };
      });

      setInsightRects(relativeRects);

      if (mergedRects.length > 0) {
        const firstRect = mergedRects[0];
        const wrapper = outerRef.current;
        if (wrapper) {
          const relativeTop = firstRect.y1 - containerRect.top;
          wrapper.scrollTo({
            top: Math.max(0, relativeTop - 100),
            behavior: "smooth",
          });
        }
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [focusedInsightText, pageNumber]);

  // ── Text selection → pending annotation ────────────────────────────────────
  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;

    const text = sel.toString().trim();
    if (!text || text.length < 5) return;

    const pageWrapper = pageWrapperRef.current;
    if (!pageWrapper) return;

    const range = sel.getRangeAt(0);
    const containerRect = pageWrapper.getBoundingClientRect();
    const clientRects = Array.from(range.getClientRects()) as DOMRect[];

    const rects = clientRects
      .filter((r) => r.width > 2 && r.height > 2)
      .map((r) => toRelativePct(r, containerRect));

    if (!rects.length) return;

    const bounding: HighlightRect = {
      x1: Math.min(...rects.map((r) => r.x1)),
      y1: Math.min(...rects.map((r) => r.y1)),
      x2: Math.max(...rects.map((r) => r.x2)),
      y2: Math.max(...rects.map((r) => r.y2)),
      width: 0,
      height: 0,
    };
    bounding.width = bounding.x2 - bounding.x1;
    bounding.height = bounding.y2 - bounding.y1;

    const lastRect = clientRects[clientRects.length - 1];
    const popupX = Math.min(
      lastRect.left - containerRect.left,
      containerRect.width - 288,
    );
    const popupY = lastRect.bottom - containerRect.top + 8;

    setPending({
      popupX,
      popupY,
      text,
      position: { boundingRect: bounding, rects, pageNumber },
    });
    setPopupMode("menu");
    setAiText("");
    setActiveHighlight(null);
  }, [pageNumber]);

  // ── Save highlight to backend ───────────────────────────────────────────────
  const saveHighlight = useCallback(
    async (comment: HighlightComment, pos: HighlightPosition, text: string) => {
      const withId: HighlightComment = {
        ...comment,
        id: comment.id ?? generateCommentId(),
      };
      const humanNote =
        withId.type === "human" && annotation
          ? {
              ...withId,
              author: annotation.displayName,
              role: annotation.role,
            }
          : withId;
      const res = await fetch(withApiBase("/api/highlights"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentUrl: documentId,
          position: pos,
          content: { text },
          comments: [humanNote],
          onboardingId: annotation?.onboardingId ?? undefined,
          reviewerId: annotation?.reviewerId ?? undefined,
        }),
      });
      const data = await res.json();
      if (data.success && data.highlight) {
        setHighlights((h) => [...h, normalizeHighlight(data.highlight)]);
      }
    },
    [documentId, annotation],
  );

  const updateHighlightInState = useCallback((h: Highlight) => {
    setHighlights((list) => list.map((x) => (x.id === h.id ? h : x)));
    setActiveHighlight((cur) => (cur?.id === h.id ? h : cur));
  }, []);

  // ── Ask AI ──────────────────────────────────────────────────────────────────
  const handleAskAI = useCallback(async () => {
    if (!pending) return;
    setPopupMode("ai-loading");

    try {
      const res = await fetch(withApiBase("/api/highlights/ai-review"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pending.text }),
      });
      const data = await res.json();
      const suggestion = data.suggestion ?? "No suggestion available.";
      setAiText(suggestion);
      setPopupMode("ai-done");

      await saveHighlight(
        { type: "ai", text: suggestion, createdAt: new Date().toISOString() },
        pending.position,
        pending.text,
      );
    } catch {
      setAiText("Failed to get AI review. Please try again.");
      setPopupMode("ai-done");
    }
  }, [pending, saveHighlight]);

  // ── Add note ─────────────────────────────────────────────────────────────────
  const handleAddNote = useCallback(
    async (note: string) => {
      if (note === "__switch__") {
        setPopupMode("note");
        return;
      }
      if (!pending || !note.trim()) return;
      await saveHighlight(
        {
          type: "human",
          text: note.trim(),
          createdAt: new Date().toISOString(),
        },
        pending.position,
        pending.text,
      );
      dismissPending();
    },
    [pending, saveHighlight, dismissPending],
  );

  const [deletingHighlightId, setDeletingHighlightId] = useState<string | null>(
    null,
  );

  // ── Delete highlight ─────────────────────────────────────────────────────────
  const deleteHighlight = useCallback(async (id: string) => {
    setDeletingHighlightId(id);
    try {
      await fetch(withApiBase(`/api/highlights/${id}`), { method: "DELETE" });
      setHighlights((h) => h.filter((x) => x.id !== id));
      setActiveHighlight(null);
    } finally {
      setDeletingHighlightId(null);
    }
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────────

  if (!pdfUrl) {
    return (
      <div className="w-full max-w-2xl mx-auto">
        <TextFallback resume={revampedResume} />
      </div>
    );
  }

  return (
    <div ref={outerRef} className="flex flex-col items-center gap-2 w-full">
      {/* Instruction badge */}
      <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.04] border border-white/10 text-white/30 shrink-0">
        <Sparkles className="w-3 h-3" />
        <span className="text-[10px] font-bold uppercase tracking-widest">
          Select text to annotate or ask AI
        </span>
      </div>

      {/* Page wrapper — highlight overlays + selection live here */}
      <div
        ref={pageWrapperRef}
        className="relative"
        style={{ width: containerWidth }}
        onMouseUp={handleMouseUp}
      >
        <Document
          file={pdfUrl}
          onLoadSuccess={({ numPages }) => {
            setNumPages(numPages);
            setPageNumber(1);
          }}
          loading={
            <div
              className="flex flex-col items-center justify-center bg-white/5 rounded-2xl border border-white/5 gap-3"
              style={{ width: containerWidth, height: containerWidth * 1.4 }}
            >
              <Loader2 className="w-8 h-8 animate-spin text-white/20" />
              <span className="text-xs font-bold uppercase tracking-widest text-white/20">
                Rendering…
              </span>
            </div>
          }
          error={
            <div
              className="flex items-center justify-center bg-red-500/10 rounded-2xl"
              style={{ width: containerWidth, height: containerWidth * 1.4 }}
            >
              <span className="text-red-400 text-sm">Failed to load PDF</span>
            </div>
          }
        >
          <div className="shadow-[0_20px_60px_rgba(0,0,0,0.6)] rounded-sm overflow-hidden border border-white/5 relative">
            <Page
              pageNumber={pageNumber}
              width={containerWidth}
              renderAnnotationLayer={false}
              renderTextLayer={true}
            />

            {/* Highlight overlays */}
            <HighlightLayer
              highlights={highlights}
              pageNumber={pageNumber}
              onClickHighlight={(h) => {
                onHighlightClick?.(h.id);
                if (activeHighlight?.id === h.id) {
                  setActiveHighlight(null);
                } else {
                  focusHighlight(h);
                }
                dismissPending();
              }}
              activeId={activeHighlight?.id ?? null}
            />

            {/* Persistent Insight Block Overlay */}
            <AnimatePresence>
              {insightRects.length > 0 &&
                insightRects.map((rect, i) => (
                  <motion.div
                    key={`insight-${i}`}
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    style={{
                      position: "absolute",
                      left: `${rect.x1}%`,
                      top: `${rect.y1}%`,
                      width: `${rect.width}%`,
                      height: `${rect.height}%`,
                      zIndex: 15,
                      pointerEvents: "none",
                    }}
                    className="bg-emerald-500/20 border-l-2 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.1)]"
                  />
                ))}
            </AnimatePresence>
          </div>
        </Document>

        {/* Selection popup */}
        <AnimatePresence>
          {pending && (
            <SelectionPopup
              key="selection-popup"
              x={pending.popupX}
              y={pending.popupY}
              mode={popupMode}
              aiText={aiText}
              onAskAI={handleAskAI}
              onAddNote={handleAddNote}
              onDismiss={dismissPending}
            />
          )}
        </AnimatePresence>

        {/* Active highlight detail */}
        <AnimatePresence>
          {activeHighlight && (
            <HighlightDetail
              key={activeHighlight.id}
              highlight={activeHighlight}
              anchor={detailAnchor}
              annotation={annotation ?? null}
              onHighlightUpdated={updateHighlightInState}
              onDelete={() => deleteHighlight(activeHighlight.id)}
              onClose={() => setActiveHighlight(null)}
              isDeleting={deletingHighlightId === activeHighlight.id}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Page navigation */}
      {numPages && numPages > 1 && (
        <div className="flex items-center gap-8 px-6 py-2.5 rounded-2xl bg-white/[0.05] border border-white/10 backdrop-blur-md shadow-xl">
          <button
            onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
            disabled={pageNumber <= 1}
            className={cn(
              "p-2.5 rounded-xl transition-all duration-300",
              pageNumber <= 1
                ? "text-white/5 cursor-not-allowed"
                : "text-white/40 hover:text-white hover:bg-white/10 active:scale-90",
            )}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-white/70">
            Page {pageNumber} of {numPages}
          </span>
          <button
            onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
            disabled={pageNumber >= numPages}
            className={cn(
              "p-2.5 rounded-xl transition-all duration-300",
              pageNumber >= numPages
                ? "text-white/5 cursor-not-allowed"
                : "text-white/40 hover:text-white hover:bg-white/10 active:scale-90",
            )}
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Highlight legend */}
      {highlights.length > 0 && (
        <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-widest text-white/30">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-cyan-400/40" />
            Annotations ({highlights.length})
          </div>
        </div>
      )}
    </div>
  );
}
