/**
 * ComparisonView.tsx
 * Location: artifacts/mentorque-onboarding/src/components/resume/ComparisonView.tsx
 *
 * Layout:
 *   LEFT  — compiled PDF preview
 *   RIGHT — bento report cards per section (navigable with ← → arrows)
 *
 * Report cards per section:
 *   1. Key Changes (before → after diffs, with flip-to-insight panel)
 *   2. Impact Analysis (what improved)
 *   3. Company Fit (hardcoded tech company logos)
 *   4. Reference Resumes (placeholder)
 *   5. Metrics (readability, keyword density, stats)
 */
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ArrowUpRight,
  Building2,
  FileText,
  BarChart3,
  Sparkles,
  ArrowRight,
  Info,
  Lightbulb,
  Eye,
  Reply,
  LocateFixed,
  Loader2,
  Pencil,
  Check,
  X,
} from "lucide-react";
import {
  SiGoogle,
  SiMeta,
  SiStripe,
  SiShopify,
  SiNetflix,
} from "react-icons/si";
import { cn } from "@/lib/utils";
import type {
  BulletChange,
  ChangeSection,
  ChangeCategory,
  RevampResult,
} from "@/lib/resumeRevampTypes";
import { withApiBase } from "@/lib/apiBaseUrl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  PdfAnnotator,
  type AnnotationAttribution,
  type HighlightComment,
  normalizeCommentsForHighlight,
  rootComments,
  repliesToParent,
} from "./PdfAnnotator";
import { SimplePdfViewer } from "./SimplePdfViewer";

// ─── Types ──────────────────────────────────────────────────────────────────────

interface ComparisonViewProps {
  originalResume: any;
  revampedResume: any;
  changes: BulletChange[];
  compiledPdfUrl: string | null;
  onFinalize?: () => void;
  apiBaseUrl?: string;
  /** PDF note attribution (wildcard name + role, or candidate). */
  annotation?: AnnotationAttribution | null;
  /** Bearer token (Firebase or mentor access) for admin studio actions. */
  authToken?: string;
  /** Called when admin "Make Changes" produces a new revamp payload + PDF. */
  onRevampResultApplied?: (next: RevampResult) => void;
}

interface StudioThreadItem {
  highlightId: string;
  isResolved: boolean;
  selectedText?: string;
  root: {
    id: string;
    type: "ai" | "human";
    text: string;
    createdAt: string;
    authorLabel?: string;
    avatarSeed: string;
  };
  replies: Array<{
    id: string;
    type: "ai" | "human";
    text: string;
    createdAt: string;
    authorLabel?: string;
    avatarSeed: string;
  }>;
}

interface StudioAuthorFilterOption {
  key: string;
  label: string;
  shortLabel: string;
}

function normalizeStudioAuthorKey(v: string): string {
  return v.trim().toLowerCase().replace(/\s+/g, " ");
}

function commentAuthorLabel(c: {
  type: "ai" | "human";
  author?: string;
  role?: string;
}): string | undefined {
  if (c.type === "ai") return undefined;
  return [c.author, c.role].filter(Boolean).join(" · ") || undefined;
}

/** Stable per-user seed for RoboHash (same seed → same robot). */
function stableAvatarSeedForComment(
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

function StudioRoboAvatar({
  seed,
  size = "md",
}: {
  seed: string;
  size?: "md" | "sm";
}) {
  const inner = size === "sm" ? "h-7 w-7" : "h-9 w-9";
  const scale = size === "sm" ? "scale-[1.12]" : "scale-[1.15]";
  return (
    <div className="shrink-0 rounded-full bg-white p-[2px] shadow-md ring-1 ring-black/10">
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

// Section metadata
const SECTION_META: Record<string, { label: string; icon: string }> = {
  experience: { label: "Experience", icon: "💼" },
  projects: { label: "Projects", icon: "🚀" },
  summary: { label: "Summary", icon: "✦" },
  skills: { label: "Skills", icon: "🛠" },
};

const SECTION_ORDER: ChangeSection[] = [
  "experience",
  "projects",
  "summary",
  "skills",
];

// ─── Category badge styles ───────────────────────────────────────────────────

const CATEGORY_STYLES: Record<
  ChangeCategory,
  { bg: string; border: string; text: string; dot: string }
> = {
  Quantification: {
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    text: "text-emerald-400",
    dot: "bg-emerald-400",
  },
  "Action Verb": {
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    text: "text-blue-400",
    dot: "bg-blue-400",
  },
  "Impact Clarity": {
    bg: "bg-violet-500/10",
    border: "border-violet-500/30",
    text: "text-violet-400",
    dot: "bg-violet-400",
  },
  "XYZ Formula": {
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    text: "text-amber-400",
    dot: "bg-amber-400",
  },
  Brevity: {
    bg: "bg-slate-500/10",
    border: "border-slate-400/30",
    text: "text-slate-400",
    dot: "bg-slate-400",
  },
  "Tense Fix": {
    bg: "bg-orange-500/10",
    border: "border-orange-500/30",
    text: "text-orange-400",
    dot: "bg-orange-400",
  },
  "Pronoun Removal": {
    bg: "bg-pink-500/10",
    border: "border-pink-500/30",
    text: "text-pink-400",
    dot: "bg-pink-400",
  },
  "ATS Optimization": {
    bg: "bg-cyan-500/10",
    border: "border-cyan-500/30",
    text: "text-cyan-400",
    dot: "bg-cyan-400",
  },
};

function CategoryBadge({ category }: { category?: ChangeCategory }) {
  if (!category) return null;
  const styles = CATEGORY_STYLES[category] ?? CATEGORY_STYLES["Impact Clarity"];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border",
        styles.bg,
        styles.border,
        styles.text,
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", styles.dot)} />
      {category}
    </span>
  );
}

// Hardcoded company data for the Company Fit card
// Inline SVG components for real brand logos
function DeltaLogo({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <img
      src="https://media.licdn.com/dms/image/v2/C560BAQG24v1Mn2vUHA/company-logo_200_200/company-logo_200_200/0/1673854584495?e=1778716800&v=beta&t=eEncZXsP23S8RRhc_AzyvXnaf8YPuFMZKt1ksF_Zk5A"
      alt="Delta India Logo"
      className={cn(className, "object-contain rounded-md")}
      style={style}
    />
  );
}

function AIBLogo({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <img
      src="https://upload.wikimedia.org/wikipedia/en/thumb/4/4b/Allied_Irish_Banks_logo.svg/1280px-Allied_Irish_Banks_logo.svg.png"
      alt="Allied Irish Banks Logo"
      className={cn(className, "object-contain rounded-md")}
      style={style}
    />
  );
}

function TallyLogo({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <img
      src="https://resources.tallysolutions.com/wp-content/themes/tally/assets/images/tally-logo-black.svg"
      alt="Tally Logo"
      className={cn(className, "object-contain brightness-0 invert")}
      style={style}
    />
  );
}

function MerckLogo({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <img
      src="/logos/Mkgaa768x432.jpg"
      alt="Merck Logo"
      className={cn(className, "object-contain rounded-md")}
      style={style}
    />
  );
}

function AramyaLogo({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="20" fill="currentColor" fillOpacity="0.1"/>
      <text x="50%" y="54%" dominantBaseline="middle" textAnchor="middle" fontSize="48" fontWeight="bold" fill="currentColor">A</text>
    </svg>
  );
}

function DPALogo({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="20" fill="currentColor" fillOpacity="0.1"/>
      <text x="50%" y="54%" dominantBaseline="middle" textAnchor="middle" fontSize="40" fontWeight="bold" fill="currentColor">DP</text>
    </svg>
  );
}

function KushalsLogo({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" rx="20" fill="currentColor" fillOpacity="0.1"/>
      <text x="50%" y="54%" dominantBaseline="middle" textAnchor="middle" fontSize="40" fontWeight="bold" fill="currentColor">KR</text>
    </svg>
  );
}

function MicrosoftLogo({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="9" height="9" fill="#F25022"/>
      <rect x="13" y="2" width="9" height="9" fill="#7FBA00"/>
      <rect x="2" y="13" width="9" height="9" fill="#00A4EF"/>
      <rect x="13" y="13" width="9" height="9" fill="#FFB900"/>
    </svg>
  );
}


type CompanyIcon = React.ComponentType<{ className?: string; style?: React.CSSProperties }>;

const COMPANIES: Array<{ name: string; icon: CompanyIcon; color: string }> = [
  { name: "Microsoft", icon: MicrosoftLogo, color: "#00A4EF" },
  { name: "AIB", icon: AIBLogo, color: "#7F4194" },
  { name: "Tally", icon: TallyLogo, color: "#CCCCCC" },
  { name: "Delta", icon: DeltaLogo, color: "#145c34" },
  { name: "Merck", icon: MerckLogo, color: "#635BFF" },
  { name: "Aramya", icon: AramyaLogo, color: "#10B981" },
  { name: "DPA", icon: DPALogo, color: "#3B82F6" },
  { name: "Kushals", icon: KushalsLogo, color: "#F59E0B" },
];


// ─── Bento Card Base ─────────────────────────────────────────────────────────────

function BentoCard({
  title,
  icon,
  children,
  className,
  headerClassName,
  rightElement,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  headerClassName?: string;
  rightElement?: React.ReactNode;
}) {
  return (
    <motion.div
      className={cn(
        "relative rounded-[2rem] border border-blue-400/20 bg-blue-950/20 backdrop-blur-xl p-5 flex flex-col gap-4 overflow-hidden shadow-2xl transition-all duration-500 hover:bg-blue-950/30 hover:border-blue-400/30 group/card",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between shrink-0",
          headerClassName,
        )}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-white/10 text-white/70 group-hover/card:text-primary transition-colors">
            {icon}
          </div>
          <h4 className="text-[10px] font-black uppercase tracking-[0.25em] text-white/60 group-hover/card:text-white/90 transition-colors">
            {title}
          </h4>
        </div>
        {rightElement}
      </div>
      <div className="flex-1 relative">{children}</div>
    </motion.div>
  );
}

// ─── Card 1: Key Changes ─────────────────────────────────────────────────────────

const CARD_SLIDE_VARIANTS = {
  enter: ({
    direction,
    action,
  }: {
    direction: number;
    action: "slide" | "flip";
  }) => ({
    x: action === "slide" ? direction * 30 : 0,
    y: action === "flip" ? 8 : 0,
    opacity: 0,
    scale: 0.98,
    filter: "blur(4px)",
  }),
  center: {
    x: 0,
    y: 0,
    opacity: 1,
    scale: 1,
    filter: "blur(0px)",
  },
  exit: ({
    direction,
    action,
  }: {
    direction: number;
    action: "slide" | "flip";
  }) => ({
    x: action === "slide" ? direction * -30 : 0,
    y: action === "flip" ? -8 : 0,
    opacity: 0,
    scale: 0.98,
    filter: "blur(4px)",
  }),
};

const CONTENT_STAGGER_VARIANTS = {
  hidden: { opacity: 0, y: 12, filter: "blur(2px)" },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: {
      type: "spring" as const,
      stiffness: 150,
      damping: 22,
      delay: i * 0.08,
    },
  }),
  exit: {
    opacity: 0,
    y: -4,
    filter: "blur(2px)",
    transition: { duration: 0.2 },
  },
};

interface KeyChangesCardProps {
  changes: BulletChange[];
  canEdit?: boolean;
  onEditChange?: (
    changeId: string,
    payload: { original: string; revised: string },
  ) => Promise<void>;
  canGenerate?: boolean;
  isGenerating?: boolean;
  onGenerate?: () => void;
}

function KeyChangesCard({
  changes,
  canEdit = false,
  onEditChange,
  canGenerate = false,
  isGenerating = false,
  onGenerate,
}: KeyChangesCardProps) {
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState(1);
  const [isFlipped, setIsFlipped] = useState(false);
  const [animAction, setAnimAction] = useState<"slide" | "flip">("slide");
  const [displayIdx, setDisplayIdx] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [editOriginal, setEditOriginal] = useState("");
  const [editRevised, setEditRevised] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  /** Admin "Make Changes" can replace `changes` with a new array; keep index in range. */
  useEffect(() => {
    if (changes.length === 0) {
      setIdx(0);
      setDisplayIdx(0);
      setIsFlipped(false);
      setIsEditing(false);
      return;
    }
    setIdx((i) => Math.min(i, changes.length - 1));
    setDisplayIdx((i) => Math.min(i, changes.length - 1));
  }, [changes]);

  const visible = changes.length > 0 ? changes[displayIdx] : null;

  const go = (d: number) => {
    if (changes.length <= 1) return;
    const nextIdx = (idx + d + changes.length) % changes.length;
    setAnimAction("slide");
    setDir(d);
    setIdx(nextIdx);
    setDisplayIdx(nextIdx);
    // Reset to diff view when navigating
    if (isFlipped) {
      setIsFlipped(false);
    }
    setIsEditing(false);
  };

  const toggleFlip = () => {
    setAnimAction("flip");
    setIsFlipped((prev) => !prev);
    setIsEditing(false);
  };

  const beginEdit = () => {
    if (!visible) return;
    setEditOriginal(visible.original ?? "");
    setEditRevised(visible.revised ?? "");
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditOriginal("");
    setEditRevised("");
  };

  const saveEdit = async () => {
    if (!visible?.id || !onEditChange) return;
    setEditSaving(true);
    try {
      await onEditChange(visible.id, {
        original: editOriginal.trim(),
        revised: editRevised.trim(),
      });
      cancelEdit();
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <BentoCard
      title="Strategic Enhancements"
      icon={<Sparkles className="w-4 h-4" />}
      className="md:col-span-3 min-h-[260px]"
    >
      {/* Decorative background glow that shifts on flip */}
      <AnimatePresence>
        {isFlipped && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-gradient-to-br from-amber-500/5 via-transparent to-transparent pointer-events-none"
          />
        )}
      </AnimatePresence>

      <div className="h-full flex flex-col gap-5 relative z-10">
        {changes.length === 0 ? (
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 text-center py-6">
            <p className="text-sm text-white/60">
              No section-level changes yet for this view.
            </p>
          </div>
        ) : (
          <div className="flex-1 min-h-0 relative overflow-hidden">
            <AnimatePresence
              mode="popLayout"
              custom={{ direction: dir, action: animAction }}
              initial={false}
            >
              <motion.div
                key={`${displayIdx}-${isFlipped ? "insight" : "diff"}`}
                custom={{ direction: dir, action: animAction }}
                variants={CARD_SLIDE_VARIANTS}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{
                  type: "spring",
                  stiffness: 120,
                  damping: 24,
                  mass: 1,
                }}
                className="flex flex-col justify-center h-full w-full"
              >
                {!isFlipped ? (
                  /* ── FRONT FACE: original → revised diff ── */
                  <div className="flex flex-col justify-center gap-6 py-2">
                    {/* Original */}
                    <motion.div
                      custom={0}
                      variants={CONTENT_STAGGER_VARIANTS}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      className="relative pl-6"
                    >
                      <div className="absolute left-0 top-1 bottom-1 w-[2px] bg-gradient-to-b from-red-400/60 to-red-500/20 rounded-full" />
                      <p className="text-[11px] font-bold uppercase tracking-widest text-red-400/60 mb-1.5">
                        Original
                      </p>
                      {isEditing ? (
                        <textarea
                          value={editOriginal}
                          onChange={(e) => setEditOriginal(e.target.value)}
                          rows={4}
                          className="w-full resize-y rounded-xl border border-red-300/20 bg-black/30 px-3 py-2 text-sm leading-relaxed text-white/80 focus:outline-none focus:ring-2 focus:ring-red-400/30"
                        />
                      ) : (
                        <p className="text-sm leading-relaxed font-normal text-white/50 relative">
                          <span
                            className="relative z-10"
                            style={{
                              textDecoration: "line-through",
                              textDecorationColor: "rgba(248,113,113,0.8)",
                              textDecorationThickness: "2px",
                            }}
                          >
                            {visible?.original}
                          </span>
                        </p>
                      )}
                    </motion.div>

                    {/* Revised */}
                    <motion.div
                      custom={1}
                      variants={CONTENT_STAGGER_VARIANTS}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      className="relative pl-6"
                    >
                      <div className="absolute left-0 top-1 bottom-1 w-[2px] bg-gradient-to-b from-emerald-400/80 to-emerald-500/30 rounded-full shadow-[0_0_12px_rgba(16,185,129,0.4)]" />
                      <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-400/80 mb-1.5">
                        Optimized
                      </p>
                      {isEditing ? (
                        <textarea
                          value={editRevised}
                          onChange={(e) => setEditRevised(e.target.value)}
                          rows={4}
                          className="w-full resize-y rounded-xl border border-emerald-300/20 bg-black/30 px-3 py-2 text-sm leading-relaxed text-white/90 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
                        />
                      ) : (
                        <p className="text-base text-white/90 leading-relaxed font-medium relative">
                          <span className="relative z-10">
                            {visible?.revised}
                          </span>
                        </p>
                      )}
                    </motion.div>
                  </div>
                ) : (
                  /* ── BACK FACE: coaching insight panel ── */
                  <div className="flex flex-col gap-4 py-2 overflow-y-auto custom-scrollbar">
                    {/* Row 1: Category badge + Guideline ref */}
                    <motion.div
                      custom={0}
                      variants={CONTENT_STAGGER_VARIANTS}
                      initial="hidden"
                      animate="visible"
                      exit="exit"
                      className="flex flex-wrap items-center gap-2"
                    >
                      <CategoryBadge category={visible?.category} />
                      {visible?.guidelineRef && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border bg-white/5 border-white/10 text-white/50">
                          {visible.guidelineRef}
                        </span>
                      )}
                    </motion.div>

                    {/* Row 2: Metric callout (conditional) */}
                    {visible?.metricHighlight && (
                      <motion.div
                        custom={1}
                        variants={CONTENT_STAGGER_VARIANTS}
                        initial="hidden"
                        animate="visible"
                        exit="exit"
                        className="flex items-start gap-3 px-3.5 py-3 rounded-2xl bg-emerald-500/8 border border-emerald-500/20 shadow-[0_0_20px_rgba(16,185,129,0.1)]"
                      >
                        <span className="text-emerald-400 text-base leading-none mt-0.5">
                          📊
                        </span>
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400/80 mb-1">
                            Metric Added
                          </p>
                          <p className="text-sm text-emerald-300/90 font-medium leading-snug">
                            {visible.metricHighlight}
                          </p>
                        </div>
                      </motion.div>
                    )}

                    {/* Row 3: Reason */}
                    {visible?.reason && (
                      <motion.div
                        custom={2}
                        variants={CONTENT_STAGGER_VARIANTS}
                        initial="hidden"
                        animate="visible"
                        exit="exit"
                        className="flex flex-col gap-1"
                      >
                        <p className="text-[10px] font-black uppercase tracking-widest text-white/40">
                          Why this change
                        </p>
                        <p className="text-sm text-white/80 leading-relaxed">
                          {visible.reason}
                        </p>
                      </motion.div>
                    )}

                    {/* Row 4: Coach tip */}
                    {visible?.coachTip && (
                      <motion.div
                        custom={3}
                        variants={CONTENT_STAGGER_VARIANTS}
                        initial="hidden"
                        animate="visible"
                        exit="exit"
                        className="flex items-start gap-3 px-3.5 py-3 rounded-2xl bg-white/[0.04] border border-white/10"
                      >
                        <Lightbulb className="w-3.5 h-3.5 text-amber-400/80 shrink-0 mt-0.5" />
                        <p className="text-xs text-white/60 leading-relaxed italic">
                          {visible.coachTip}
                        </p>
                      </motion.div>
                    )}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        )}

        {/* ── Bottom bar: pagination counter + nav arrows + flip button ── */}
        <div className="mt-auto flex items-center justify-between border-t border-white/5 pt-4">
          {/* Counter */}
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono font-bold text-white/70">
              {String(idx + 1).padStart(2, "0")}
            </span>
            <div className="w-8 h-px bg-white/20" />
            <span className="text-[10px] font-mono text-white/40">
              {String(changes.length).padStart(2, "0")}
            </span>
          </div>

          {/* Controls: flip + pagination */}
          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <button
                  onClick={cancelEdit}
                  disabled={editSaving}
                  className="p-2.5 rounded-xl border border-white/15 bg-white/[0.05] text-white/60 hover:text-white transition-all disabled:opacity-40"
                >
                  <X className="w-4 h-4" />
                </button>
                <button
                  onClick={() => void saveEdit()}
                  disabled={
                    editSaving || !editOriginal.trim() || !editRevised.trim()
                  }
                  className="p-2.5 rounded-xl border border-emerald-400/35 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25 transition-all disabled:opacity-40"
                >
                  {editSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                </button>
              </>
            ) : (
              <>
                {canEdit && !isFlipped && (
                  <button
                    onClick={beginEdit}
                    className="p-2.5 rounded-xl border border-cyan-400/30 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 transition-all"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                )}
                {/* Flip / Insight toggle */}
                <motion.button
                  onClick={toggleFlip}
                  whileTap={{ scale: 0.88 }}
                  title={isFlipped ? "Back to diff" : "Show insight"}
                  className={cn(
                    "p-2.5 rounded-xl border transition-all",
                    isFlipped
                      ? "bg-amber-500/15 border-amber-500/40 text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.2)]"
                      : "border-white/10 bg-white/5 text-white/40 hover:text-amber-400 hover:bg-amber-500/10 hover:border-amber-500/30",
                  )}
                >
                  <Lightbulb className="w-4 h-4" />
                </motion.button>
              </>
            )}

            {/* Divider */}
            <div className="w-px h-5 bg-white/10" />

            {/* Prev */}
            <button
              onClick={() => go(-1)}
              className="p-2.5 rounded-xl border border-white/10 bg-white/5 text-white/50 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all active:scale-90"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {/* Next */}
            <button
              onClick={() => go(1)}
              className="p-2.5 rounded-xl border border-white/10 bg-white/5 text-white/50 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all active:scale-90"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </BentoCard>
  );
}

// ─── Card 3: Company Fit ─────────────────────────────────────────────────────────
// Random success stories tied to companies
const SUCCESS_STORIES: Record<string, { message: string; role: string }> = {
  Aramya: {
    message:
      "One of our similar revamps led to a selection for a Software Development Engineer role at Aramya",
    role: "→ SDE, Remote",
  },
  Tally: {
    message:
      "One of our similar revamps led to a selection for an SDE Intern role at Tally Solutions",
    role: "→ SDE Intern, Bengaluru, KA",
  },
  Merck: {
    message:
      "One of our similar revamps led to a selection for an Analyst role at Merck KGaA",
    role: "→ Analyst, Bengaluru, India",
  },
  AIB: {
    message:
      "One of our similar revamps led to a selection for a Software Developer role at AIB (Allied Irish Bank)",
    role: "→ SDE, Ireland",
  },
  DPA: {
    message:
      "One of our similar revamps led to a selection for a Business Development Representative role at Dilip Patil and Associates",
    role: "→ Business Development Representative, India",
  },
  Kushals: {
    message:
      "One of our similar revamps led to a selection for a Software Developer role at Kushal's Retail Pvt Ltd",
    role: "→ Software Developer, Bengaluru",
  },
  Microsoft: {
    message:
      "One of our similar revamps led to a selection for a Software Developer role at Microsoft",
    role: "→ Software Developer, Dublin, Ireland",
  },
  Delta: {
    message:
      "One of our similar revamps led to a selection for a Data Analyst role at Delta India",
    role: "→ Data Analyst, Pune, India",
  },
};

const SAMPLE_RESUME_PDFS: Record<string, string> = {
  Aramya: "/sample-resume/shikhar-resume_redacted.pdf",
  Tally: "/sample-resume/Snehashish_Resume_Redacted.pdf",
  Merck: "/sample-resume/vijayKumar_redacted.pdf",
  AIB: "/sample-resume/Reshu_Agarwal_redacted.pdf",
  DPA: "/sample-resume/Komal%20Joshi%20redacted.pdf",
  Kushals: "/sample-resume/Pramod%20redacted.pdf",
  Microsoft: "/sample-resume/Agniva_Microsoft.pdf",
  Delta: "/sample-resume/Prasad%20Katore%20redacted.pdf",
};

function CompanyFitCard({
  compiledPdfUrl,
}: {
  compiledPdfUrl?: string | null;
}) {
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [showResume, setShowResume] = useState(false);
  const story = selectedCompany ? SUCCESS_STORIES[selectedCompany] : null;

  return (
    <BentoCard
      title="Target Alignment"
      icon={<Building2 className="w-4 h-4" />}
      className="md:col-span-3"
    >
      <div className="relative h-full flex flex-col justify-center">
        <AnimatePresence mode="wait">
          {!selectedCompany ? (
            <motion.div
              key="grid"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex flex-col gap-4"
            >
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-4">
                {COMPANIES.map((c) => (
                  <button
                    key={c.name}
                    onClick={() => setSelectedCompany(c.name)}
                    className="group/logo relative flex flex-col items-center gap-2"
                  >
                    <div
                      className="w-12 h-12 flex items-center justify-center rounded-2xl border transition-all duration-300 group-hover/logo:scale-110 group-hover/logo:border-white/20"
                      style={{
                        color: c.color,
                        backgroundColor: `${c.color}18`,
                        borderColor: `${c.color}40`,
                      }}
                    >
                      <c.icon
                        className="w-6 h-6 transition-all duration-300 group-hover/logo:drop-shadow-lg"
                        style={{ filter: `drop-shadow(0 0 6px ${c.color}66)` }}
                      />
                    </div>
                    <span className="text-[9px] font-bold text-white/70 group-hover/logo:text-white transition-colors uppercase tracking-widest">
                      {c.name}
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 text-white/60">
                <Info className="w-3.5 h-3.5" />
                <p className="text-[10px] font-medium italic">
                  Click a logo to see success story
                </p>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="selected"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="grid grid-cols-4 sm:grid-cols-8 gap-4 items-center"
            >
              {/* Col 1: Logo */}
              <div className="col-span-1 flex flex-col items-center gap-2">
                {(() => {
                  const c = COMPANIES.find((co) => co.name === selectedCompany);
                  if (!c) return null;
                  return (
                    <motion.div
                      layoutId={`logo-${selectedCompany}`}
                      className="flex flex-col items-center gap-2"
                    >
                      <div
                        className="w-14 h-14 flex items-center justify-center rounded-2xl bg-white/5 border border-primary/20 shadow-[0_0_20px_rgba(var(--primary),0.1)]"
                        style={{ color: c.color }}
                      >
                        <c.icon className="w-7 h-7" />
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-white/85">
                        {selectedCompany}
                      </span>
                    </motion.div>
                  );
                })()}
              </div>

              {/* Col 2: Message */}
              <div className="col-span-2 sm:col-span-6 border-l border-white/5 pl-6">
                {story && (
                  <motion.div
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 }}
                    className="space-y-2"
                  >
                    <p className="text-white/80 text-sm leading-relaxed font-medium">
                      {story.message}
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-px bg-primary/40" />
                      <p className="text-primary/90 text-[10px] font-black uppercase tracking-widest">
                        {story.role}
                      </p>
                    </div>
                  </motion.div>
                )}
              </div>

              {/* Col 3: Unified Button */}
              <div className="col-span-1 flex items-center justify-center">
                <motion.button
                  layout
                  onClick={
                    showResume
                      ? () => {
                          setShowResume(false);
                          setSelectedCompany(null);
                        }
                      : () => setShowResume(true)
                  }
                  className={cn(
                    "group/preview flex flex-col items-center gap-2 transition-all duration-500 min-w-[110px]",
                    showResume
                      ? "text-white/40 hover:text-white"
                      : "text-white/40 hover:text-primary",
                  )}
                >
                  <motion.div
                    layout
                    className={cn(
                      "w-12 h-12 flex items-center justify-center rounded-full transition-all duration-500 relative overflow-hidden",
                      showResume
                        ? "bg-white/5 border border-white/10 group-hover/preview:bg-white/10 group-hover/preview:border-white/20 shadow-[0_0_20px_rgba(255,255,255,0.05)]"
                        : "bg-primary/10 border border-primary/20 group-hover/preview:bg-primary/20 group-hover/preview:border-primary/40 shadow-[0_0_20px_rgba(var(--primary),0.05)]",
                    )}
                  >
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.div
                        key={showResume ? "back" : "eye"}
                        initial={{
                          opacity: 0,
                          scale: 0.5,
                          rotate: showResume ? -45 : 45,
                        }}
                        animate={{ opacity: 1, scale: 1, rotate: 0 }}
                        exit={{
                          opacity: 0,
                          scale: 0.5,
                          rotate: showResume ? 45 : -45,
                        }}
                        transition={{
                          type: "spring",
                          stiffness: 400,
                          damping: 28,
                        }}
                      >
                        {showResume ? (
                          <ChevronLeft className="w-5 h-5 transition-all duration-500 group-hover/preview:-translate-x-0.5" />
                        ) : (
                          <Eye className="w-5 h-5 transition-all duration-500 group-hover/preview:scale-110" />
                        )}
                      </motion.div>
                    </AnimatePresence>
                  </motion.div>

                  <div className="h-3 flex items-center justify-center overflow-hidden">
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span
                        key={showResume ? "back" : "eye"}
                        initial={{ y: 8, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: -8, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="text-[9px] font-black uppercase tracking-[0.2em] whitespace-nowrap"
                      >
                        {showResume ? "Back" : "View Sample"}
                      </motion.span>
                    </AnimatePresence>
                  </div>
                </motion.button>
              </div>

              {/* Resume Viewer Section */}
              <AnimatePresence>
                {showResume && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    className="mt-6 pt-6 border-t border-white/10 col-span-full"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-[10px] font-black uppercase tracking-widest text-white/60">
                        One of our similar revamps
                      </span>
                    </div>

                    {/* Sample resume PDF from public/sample-resume */}
                    <div className="w-full">
                      <SimplePdfViewer
                        pdfUrl={
                          selectedCompany
                            ? (SAMPLE_RESUME_PDFS[selectedCompany] ??
                              "/sample-resume.pdf")
                            : "/sample-resume.pdf"
                        }
                        className="max-h-[600px] rounded-xl border border-white/5 shadow-2xl"
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </BentoCard>
  );
}

// ─── Card 4: Metrics ─────────────────────────────────────────────────────────────

function MetricItem({ m }: { m: any }) {
  return (
    <div className="group/metric relative flex flex-col justify-between p-4 rounded-3xl bg-white/[0.04] border border-white/10 hover:bg-white/[0.07] hover:border-white/20 transition-all duration-500 shadow-xl overflow-hidden min-h-[120px]">
      <div className="flex items-center justify-between mb-4">
        <div className="text-right ml-auto">
          <span className="text-xs font-black tracking-tighter text-white/60">
            +
            {Math.max(
              0,
              (typeof m.value === "number" ? m.value : 100) -
                (typeof m.prev === "number" ? m.prev : 0),
            )}
            %
          </span>
        </div>
      </div>
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/60 mb-1 leading-none">
          {m.label}
        </p>
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-mono font-bold text-white leading-none">
            {m.value}
          </span>
          <span className="text-sm font-mono font-bold text-white/60 leading-none">
            {m.suffix}
          </span>
        </div>
      </div>
    </div>
  );
}

function MetricsCard({
  revampedResume,
  originalResume,
}: {
  revampedResume: any;
  originalResume?: any;
}) {
  const getStats = (res: any) => {
    const allHighlights: string[] = [];
    res?.experience?.forEach((e: any) =>
      e.highlights?.forEach((h: string) => allHighlights.push(h)),
    );
    res?.projects?.forEach((p: any) =>
      p.highlights?.forEach((h: string) => allHighlights.push(h)),
    );
    const total = allHighlights.length;
    const withNumbers = allHighlights.filter((h) => /\d/.test(h)).length;
    const actionVerbs = [
      "led",
      "engineered",
      "delivered",
      "drove",
      "spearheaded",
      "optimized",
      "architected",
      "scaled",
      "transformed",
      "accelerated",
      "generated",
      "launched",
    ];
    const withVerbs = allHighlights.filter((h) =>
      actionVerbs.some((v) => h.toLowerCase().startsWith(v)),
    ).length;
    return {
      density: total > 0 ? Math.round((withNumbers / total) * 100) : 0,
      strength: total > 0 ? Math.round((withVerbs / total) * 100) : 0,
    };
  };

  const curr = getStats(revampedResume);
  const orig = getStats(originalResume);

  const items = [
    { label: "Density", value: curr.density, prev: orig.density, suffix: "%" },
    {
      label: "Strength",
      value: curr.strength,
      prev: orig.strength,
      suffix: "%",
    },
    { label: "Match", value: 94, prev: 62, suffix: "%" },
    { label: "Reading", value: "A+", prev: "B-", suffix: "" },
  ];

  return null;
}

// ─── Report Panel (Section Specific Only) ──────────────────────────────────────────

function SectionAnalysis({
  changes,
  canEdit = false,
  onEditChange,
  canGenerate,
  isGenerating,
  onGenerate,
}: {
  changes: BulletChange[];
  canEdit?: boolean;
  onEditChange?: (
    changeId: string,
    payload: { original: string; revised: string },
  ) => Promise<void>;
  canGenerate?: boolean;
  isGenerating?: boolean;
  onGenerate?: () => void;
}) {
  const sectionsWithChanges = useMemo(() => {
    return SECTION_ORDER.filter((s) => changes.some((c) => c.section === s));
  }, [changes]);

  const [sectionIdx, setSectionIdx] = useState(0);
  const [dir, setDir] = useState(1);

  useEffect(() => {
    setSectionIdx((i) =>
      sectionsWithChanges.length === 0
        ? 0
        : Math.min(i, sectionsWithChanges.length - 1),
    );
  }, [sectionsWithChanges.length, changes.length]);

  const go = (d: number) => {
    if (sectionsWithChanges.length <= 1) return;
    setDir(d);
    setSectionIdx(
      (i) => (i + d + sectionsWithChanges.length) % sectionsWithChanges.length,
    );
  };

  const currentSection = sectionsWithChanges[sectionIdx] || "experience";
  const sectionChanges = changes.filter((c) => c.section === currentSection);
  const meta = SECTION_META[currentSection] || {
    label: currentSection,
    icon: "📄",
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Section Navigation */}
      <div className="flex items-center justify-between px-6 mt-4 shrink-0">
        <div className="flex items-center gap-5">
          <div className="w-12 h-12 rounded-2xl bg-white/[0.03] border border-white/10 flex items-center justify-center text-2xl shadow-2xl">
            {meta.icon}
          </div>
          <div className="flex flex-col gap-0.5">
            <h3 className="text-lg font-bold uppercase tracking-[0.2em] text-white">
              {meta.label}
            </h3>
            <p className="text-[10px] text-white/60 font-black uppercase tracking-widest">
              Section Analysis
            </p>
          </div>
          {canGenerate && (
            <button
              type="button"
              onClick={onGenerate}
              disabled={isGenerating}
              className="ml-2 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest bg-cyan-500/20 border border-cyan-400/35 text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-40 disabled:pointer-events-none transition-all"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Generating
                </>
              ) : (
                <>
                  <Sparkles className="w-3 h-3" />
                  Generate
                </>
              )}
            </button>
          )}
        </div>

        <div className="flex items-center gap-6">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.02] border border-white/5">
            {sectionsWithChanges.map((_, i) => (
              <div
                key={i}
                className={cn(
                  "h-1 rounded-full transition-all duration-500",
                  i === sectionIdx
                    ? "bg-primary w-6 shadow-[0_0_8px_rgba(var(--primary),0.5)]"
                    : "bg-white/10 w-1.5",
                )}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => go(-1)}
              disabled={sectionsWithChanges.length <= 1}
              className="p-3 rounded-2xl border border-white/10 text-white/30 hover:text-white hover:bg-white/10 transition-all active:scale-90"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => go(1)}
              disabled={sectionsWithChanges.length <= 1}
              className="p-3 rounded-2xl border border-white/10 text-white/30 hover:text-white hover:bg-white/10 transition-all active:scale-90"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Bento Layout (Section Specific) */}
      <div className="pb-8 relative overflow-hidden">
        <AnimatePresence mode="popLayout" custom={dir}>
          <motion.div
            key={currentSection}
            custom={dir}
            variants={{
              enter: (d: number) => ({
                x: d * 40,
                opacity: 0,
              }),
              center: { x: 0, opacity: 1 },
              exit: (d: number) => ({
                x: d * -40,
                opacity: 0,
              }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: "spring", stiffness: 300, damping: 32 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full"
          >
            <KeyChangesCard
              changes={sectionChanges}
              canEdit={canEdit}
              onEditChange={onEditChange}
              canGenerate={canGenerate}
              isGenerating={isGenerating}
              onGenerate={onGenerate}
            />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────────

export function ComparisonView({
  originalResume,
  revampedResume,
  compiledPdfUrl,
  changes,
  apiBaseUrl = "",
  annotation = null,
  authToken = "",
  onRevampResultApplied,
}: ComparisonViewProps) {
  const [activeTab, setActiveTab] = useState<"analysis" | "studio">("analysis");
  const [studioThreads, setStudioThreads] = useState<StudioThreadItem[]>([]);
  const [studioReplyOpenKey, setStudioReplyOpenKey] = useState<string | null>(
    null,
  );
  const [studioReplyDraft, setStudioReplyDraft] = useState("");
  const [studioReplyPosting, setStudioReplyPosting] = useState(false);
  const [studioApplyBusy, setStudioApplyBusy] = useState(false);
  const [studioRegenerateBusy, setStudioRegenerateBusy] = useState(false);
  const [studioPdfRegenerateBusy, setStudioPdfRegenerateBusy] = useState(false);
  const [studioApplyError, setStudioApplyError] = useState<string | null>(null);
  const [regenModalOpen, setRegenModalOpen] = useState(false);
  const [regenPromptDraft, setRegenPromptDraft] = useState("");
  const [highlightsRefreshTick, setHighlightsRefreshTick] = useState(0);
  const [focusHighlightId, setFocusHighlightId] = useState<string | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  const [focusStudioHighlightId, setFocusStudioHighlightId] = useState<
    string | null
  >(null);
  const [studioAuthorFilter, setStudioAuthorFilter] = useState<string>("all");
  /** After admin "Make Changes", merge API result into UI (parent often does not pass `onRevampResultApplied`). */
  const [studioApplyResult, setStudioApplyResult] =
    useState<RevampResult | null>(null);

  const displayRevamped = studioApplyResult?.revampedResume ?? revampedResume;
  const displayChanges = studioApplyResult?.changes ?? changes;
  const displayPdf =
    studioApplyResult?.compiledPdfUrl ?? compiledPdfUrl ?? null;
  const documentId = displayPdf ?? "resume-draft";

  useEffect(() => {
    setStudioApplyResult(null);
  }, [compiledPdfUrl]);

  const isAdminAnnotator = (annotation?.role ?? "").toLowerCase() === "admin";

  const loadStudioThreads = useCallback(async () => {
    try {
      const q = new URLSearchParams();
      q.set("includeResolved", "true");
      if (annotation?.onboardingId) {
        q.set("onboardingId", annotation.onboardingId);
      } else {
        q.set("documentUrl", documentId);
      }
      const res = await fetch(withApiBase(`/api/highlights?${q.toString()}`));
      const data = await res.json();
      if (!data?.success || !Array.isArray(data.highlights)) return;

      const threads: StudioThreadItem[] = data.highlights.flatMap((h: any) => {
        const selectedText =
          typeof h?.content?.text === "string" ? h.content.text : undefined;
        const comments = normalizeCommentsForHighlight(h.id, h?.comments);
        const roots = rootComments(comments);
        return roots.map((root) => ({
          highlightId: String(h.id),
          isResolved: Boolean(h?.isResolved),
          selectedText,
          root: {
            id: root.id!,
            type: root.type,
            text: root.text,
            createdAt: root.createdAt,
            authorLabel: commentAuthorLabel(root),
            avatarSeed: stableAvatarSeedForComment(
              root,
              `comment-${root.id}`,
              annotation,
            ),
          },
          replies: repliesToParent(comments, root.id!).map((r) => ({
            id: r.id!,
            type: r.type,
            text: r.text,
            createdAt: r.createdAt,
            authorLabel: commentAuthorLabel(r),
            avatarSeed: stableAvatarSeedForComment(
              r,
              `comment-${r.id}`,
              annotation,
            ),
          })),
        }));
      });

      threads.sort((a, b) => {
        const ta = Math.max(
          +new Date(a.root.createdAt),
          ...a.replies.map((r) => +new Date(r.createdAt)),
        );
        const tb = Math.max(
          +new Date(b.root.createdAt),
          ...b.replies.map((r) => +new Date(r.createdAt)),
        );
        return tb - ta;
      });
      setStudioThreads(threads);
    } catch {
      // Ignore transient fetch errors; studio tab can still render stale entries.
    }
  }, [documentId, annotation]);

  const activeStudioThreads = useMemo(
    () => studioThreads.filter((t) => !t.isResolved),
    [studioThreads],
  );
  const resolvedStudioThreads = useMemo(
    () => studioThreads.filter((t) => t.isResolved),
    [studioThreads],
  );
  const studioAuthorOptions = useMemo<StudioAuthorFilterOption[]>(() => {
    const uniq = new Map<string, StudioAuthorFilterOption>();
    for (const thread of studioThreads) {
      const label =
        thread.root.type === "ai"
          ? "AI Revamp"
          : thread.root.authorLabel || "Note";
      const key =
        thread.root.type === "ai"
          ? "ai"
          : `human:${normalizeStudioAuthorKey(label)}`;
      if (!uniq.has(key)) {
        uniq.set(key, {
          key,
          label,
          shortLabel:
            label
              .split(/[^\w]+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((w) => w[0]?.toUpperCase() ?? "")
              .join("") || label.slice(0, 1).toUpperCase(),
        });
      }
    }
    return [
      { key: "all", label: "All", shortLabel: "All" },
      ...Array.from(uniq.values()),
    ];
  }, [studioThreads]);
  const filteredActiveStudioThreads = useMemo(() => {
    if (studioAuthorFilter === "all") return activeStudioThreads;
    return activeStudioThreads.filter((thread) => {
      if (studioAuthorFilter === "ai") return thread.root.type === "ai";
      const label = thread.root.authorLabel || "Note";
      return `human:${normalizeStudioAuthorKey(label)}` === studioAuthorFilter;
    });
  }, [activeStudioThreads, studioAuthorFilter]);
  const filteredResolvedStudioThreads = useMemo(() => {
    if (studioAuthorFilter === "all") return resolvedStudioThreads;
    return resolvedStudioThreads.filter((thread) => {
      if (studioAuthorFilter === "ai") return thread.root.type === "ai";
      const label = thread.root.authorLabel || "Note";
      return `human:${normalizeStudioAuthorKey(label)}` === studioAuthorFilter;
    });
  }, [resolvedStudioThreads, studioAuthorFilter]);

  useEffect(() => {
    loadStudioThreads();
    const interval = setInterval(loadStudioThreads, 5000);
    return () => clearInterval(interval);
  }, [loadStudioThreads]);

  useEffect(() => {
    if (!focusStudioHighlightId) return;
    const el = document.querySelector<HTMLElement>(
      `[data-highlight-id="${focusStudioHighlightId}"]`,
    );
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusStudioHighlightId, studioThreads]);

  const submitStudioReply = async (thread: StudioThreadItem) => {
    const text = studioReplyDraft.trim();
    if (!text) return;
    setStudioReplyPosting(true);
    try {
      const res = await fetch(
        withApiBase(
          `/api/highlights/${encodeURIComponent(thread.highlightId)}/comments`,
        ),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            type: "human",
            inReplyToId: thread.root.id,
            author: annotation?.displayName,
            role: annotation?.role,
          }),
        },
      );
      const data = await res.json();
      if (data.success) {
        setStudioReplyDraft("");
        setStudioReplyOpenKey(null);
        await loadStudioThreads();
      }
    } catch {
      // keep draft
    } finally {
      setStudioReplyPosting(false);
    }
  };

  const applyMakeChangesFromStudio = useCallback(async () => {
    if (!authToken?.trim()) {
      setStudioApplyError(
        "Sign in with a valid access token to apply changes.",
      );
      return;
    }
    if (!annotation?.onboardingId) {
      setStudioApplyError("Missing onboarding context.");
      return;
    }
    if (activeStudioThreads.length === 0) {
      setStudioApplyError("No open feedback threads to apply.");
      return;
    }
    setStudioApplyBusy(true);
    setStudioApplyError(null);
    try {
      const res = await fetch(
        withApiBase("/api/resume-revamp/apply-studio-feedback"),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authToken.trim()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            documentUrl: documentId,
            onboardingId: annotation.onboardingId,
            currentRevampedResume: displayRevamped,
          }),
        },
      );
      const data = await res.json();
      if (!data.success) {
        setStudioApplyError(
          typeof data.message === "string" ? data.message : "Request failed.",
        );
        return;
      }
      const next = data.revampResult as RevampResult;
      setStudioApplyResult(next);
      onRevampResultApplied?.(next);

      const saveRes = await fetch(
        withApiBase("/api/onboarding/save-revamp-result"),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authToken.trim()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ revampResult: next }),
        },
      );
      const saveData = await saveRes.json();
      if (!saveRes.ok || !saveData.success) {
        setStudioApplyError(
          typeof saveData.message === "string"
            ? `${saveData.message} (PDF updated in session — refresh may be needed.)`
            : "Could not persist revamp to the server.",
        );
      }

      setHighlightsRefreshTick((n) => n + 1);
      await loadStudioThreads();
    } catch (e: unknown) {
      setStudioApplyError(
        e instanceof Error
          ? e.message
          : "Network error while applying changes.",
      );
    } finally {
      setStudioApplyBusy(false);
    }
  }, [
    authToken,
    annotation?.onboardingId,
    activeStudioThreads.length,
    documentId,
    displayRevamped,
    onRevampResultApplied,
    loadStudioThreads,
  ]);

  const regenerateStudioChangesFromContext = useCallback(
    async (prompt?: string) => {
      if (!authToken?.trim()) {
        setStudioApplyError(
          "Sign in with a valid access token to regenerate changes.",
        );
        return;
      }
      if (!annotation?.onboardingId) {
        setStudioApplyError("Missing onboarding context.");
        return;
      }
      setStudioRegenerateBusy(true);
      setStudioApplyError(null);
      try {
        const res = await fetch(
          withApiBase("/api/onboarding/regenerate-changes"),
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${authToken.trim()}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              onboardingId: annotation.onboardingId,
              prompt: prompt ?? "",
            }),
          },
        );
        const data = await res.json();
        if (!res.ok || !data?.success || !data?.revampResult) {
          setStudioApplyError(
            typeof data?.message === "string"
              ? data.message
              : "Could not regenerate change cards.",
          );
          return;
        }
        const next = data.revampResult as RevampResult;
        setStudioApplyResult(next);
        onRevampResultApplied?.(next);
      } catch (e: unknown) {
        setStudioApplyError(
          e instanceof Error
            ? e.message
            : "Network error while regenerating changes.",
        );
      } finally {
        setStudioRegenerateBusy(false);
      }
    },
    [authToken, annotation?.onboardingId, onRevampResultApplied],
  );

  const regenerateStudioPdf = useCallback(async () => {
    if (!authToken?.trim()) {
      setStudioApplyError(
        "Sign in with a valid access token to regenerate PDF.",
      );
      return;
    }
    if (!annotation?.onboardingId) {
      setStudioApplyError("Missing onboarding context.");
      return;
    }
    setStudioPdfRegenerateBusy(true);
    setStudioApplyError(null);
    try {
      const res = await fetch(withApiBase("/api/onboarding/regenerate-pdf"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ onboardingId: annotation.onboardingId }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        setStudioApplyError(
          typeof data?.message === "string"
            ? data.message
            : "Could not regenerate PDF.",
        );
        return;
      }
      if (typeof data.compiledPdfUrl === "string") {
        setStudioApplyResult((prev) => ({
          revampedResume: prev?.revampedResume ?? displayRevamped,
          changes: Array.isArray(data?.changes)
            ? data.changes
            : (prev?.changes ?? displayChanges),
          compiledPdfUrl: data.compiledPdfUrl,
        }));
      }
    } catch (e: unknown) {
      setStudioApplyError(
        e instanceof Error
          ? e.message
          : "Network error while regenerating PDF.",
      );
    } finally {
      setStudioPdfRegenerateBusy(false);
    }
  }, [authToken, annotation?.onboardingId, displayChanges, displayRevamped]);

  const updateStrategicEnhancementText = useCallback(
    async (
      changeId: string,
      payload: { original: string; revised: string },
    ) => {
      const nextChanges = displayChanges.map((c) =>
        c.id === changeId
          ? {
              ...c,
              original: payload.original,
              revised: payload.revised,
            }
          : c,
      );
      setStudioApplyResult((prev) => ({
        revampedResume: prev?.revampedResume ?? displayRevamped,
        changes: nextChanges,
        compiledPdfUrl: prev?.compiledPdfUrl ?? displayPdf,
      }));
      if (!authToken?.trim() || !annotation?.onboardingId) {
        setStudioApplyError(
          "Missing auth/onboarding context for saving changes.",
        );
        return;
      }
      const res = await fetch(
        withApiBase("/api/onboarding/update-resume-changes"),
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authToken.trim()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            onboardingId: annotation.onboardingId,
            changes: nextChanges,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(
          typeof data?.message === "string"
            ? data.message
            : "Could not save strategic enhancement edits.",
        );
      }
    },
    [
      annotation?.onboardingId,
      authToken,
      displayChanges,
      displayPdf,
      displayRevamped,
    ],
  );

  function renderStudioThreadCard(
    thread: StudioThreadItem,
    resolvedLook: boolean,
  ) {
    const cardKey = `${thread.highlightId}-${thread.root.id}`;
    const replyOpen = studioReplyOpenKey === cardKey;
    return (
      <div
        key={cardKey}
        data-highlight-id={thread.highlightId}
        className={cn(
          "w-full rounded-2xl border bg-white/[0.04] p-4 transition-all",
          resolvedLook && "opacity-90",
          focusStudioHighlightId === thread.highlightId || replyOpen
            ? "border-cyan-400/35 ring-1 ring-cyan-400/20 shadow-[0_0_24px_rgba(34,211,238,0.08)]"
            : "border-white/10 hover:bg-white/[0.07] hover:border-white/20",
        )}
      >
        <div className="flex items-start gap-2.5 mb-2">
          <StudioRoboAvatar seed={thread.root.avatarSeed} />
          <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
            <span
              className={cn(
                "text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full border",
                thread.root.type === "ai"
                  ? "text-violet-200 border-violet-300/30 bg-violet-500/10"
                  : "text-amber-200 border-amber-300/30 bg-amber-500/10",
              )}
            >
              {thread.root.type === "ai"
                ? "AI Revamp"
                : thread.root.authorLabel || "Note"}
            </span>
            <span className="text-[10px] text-white/40 shrink-0">
              {new Date(thread.root.createdAt).toLocaleString()}
            </span>
          </div>
        </div>
        {thread.selectedText && (
          <p className="text-xs text-white/50 italic border-l-2 border-white/15 pl-3 mb-2 line-clamp-2">
            "{thread.selectedText}"
          </p>
        )}
        <p className="text-sm text-white/85 leading-relaxed">
          {thread.root.text}
        </p>
        {thread.replies.length > 0 && (
          <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
            {thread.replies.map((r) => (
              <div
                key={r.id}
                className="flex gap-2 rounded-xl border border-white/5 bg-black/25 py-2 pl-2 pr-2 border-l-2 border-l-cyan-400/40"
              >
                <StudioRoboAvatar seed={r.avatarSeed} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[10px] font-black uppercase tracking-widest text-cyan-200/90">
                      {r.type === "ai" ? "AI" : r.authorLabel || "Reply"}
                    </span>
                    <span className="text-[10px] text-white/35 shrink-0">
                      {new Date(r.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-xs text-white/80 leading-relaxed">
                    {r.text}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setStudioReplyOpenKey((prev) =>
                prev === cardKey ? null : cardKey,
              );
              setStudioReplyDraft("");
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[10px] font-black uppercase tracking-widest transition-all",
              replyOpen
                ? "bg-cyan-500/20 text-cyan-100 border border-cyan-400/40"
                : "bg-white/[0.06] text-white/70 border border-white/10 hover:bg-white/[0.1] hover:text-white",
            )}
          >
            <Reply className="w-3.5 h-3.5" />
            Reply
          </button>
          {!resolvedLook && (
            <button
              type="button"
              onClick={() => {
                setFocusHighlightId(thread.highlightId);
                setFocusSignal((n) => n + 1);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[10px] font-black uppercase tracking-widest bg-white/[0.06] text-white/70 border border-white/10 hover:bg-white/[0.1] hover:text-white transition-all"
            >
              <LocateFixed className="w-3.5 h-3.5" />
              On PDF
            </button>
          )}
        </div>

        {replyOpen && (
          <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
            <textarea
              value={studioReplyDraft}
              onChange={(e) => setStudioReplyDraft(e.target.value)}
              placeholder="Write a reply…"
              rows={3}
              className="w-full resize-y rounded-xl border border-white/15 bg-black/40 px-3 py-2.5 text-sm text-white/90 placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-cyan-400/30 min-h-[5rem]"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={studioReplyPosting || !studioReplyDraft.trim()}
                onClick={() => submitStudioReply(thread)}
                className="rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-widest bg-cyan-500/25 text-cyan-100 border border-cyan-400/40 hover:bg-cyan-500/35 disabled:opacity-40 disabled:pointer-events-none transition-all"
              >
                {studioReplyPosting ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStudioReplyOpenKey(null);
                  setStudioReplyDraft("");
                }}
                className="rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-widest text-white/50 border border-white/10 hover:bg-white/[0.06] hover:text-white/80 transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full flex-1 flex flex-col min-h-0">
      {/* Two-panel layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1 min-h-0 p-4">
        {/* LEFT — Annotatable PDF */}
        <div className="flex flex-col items-center justify-start overflow-y-auto overflow-x-auto custom-scrollbar px-1 py-2">
          <PdfAnnotator
            pdfUrl={
              displayPdf
                ? `${apiBaseUrl}/api/resume-revamp/proxy-pdf?url=${encodeURIComponent(displayPdf)}`
                : null
            }
            revampedResume={displayRevamped}
            documentId={documentId}
            focusHighlightId={focusHighlightId}
            focusSignal={focusSignal}
            focusedInsightText={null}
            annotation={annotation}
            highlightsRefreshSignal={highlightsRefreshTick}
            onHighlightClick={(highlightId) => {
              setFocusHighlightId(highlightId);
              setFocusSignal((n) => n + 1);
              setFocusStudioHighlightId(highlightId);
              setActiveTab("studio");
            }}
          />
        </div>

        {/* RIGHT — Analysis + Studio */}
        <div className="overflow-y-auto overflow-x-hidden flex flex-col gap-4 pr-6 custom-scrollbar h-full">
          {/* Tabs */}
          <div className="sticky top-0 z-20 pt-2 pb-3">
            <div className="w-full grid grid-cols-2 rounded-2xl border border-blue-400/20 bg-blue-950/20 backdrop-blur-xl p-1 shadow-[0_8px_30px_rgba(0,0,0,0.35)]">
              <button
                onClick={() => setActiveTab("analysis")}
                className={cn(
                  "px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all",
                  activeTab === "analysis"
                    ? "bg-white/12 border border-white/20 text-white shadow-[0_0_20px_rgba(125,211,252,0.15)]"
                    : "text-white/50 hover:text-white/80 hover:bg-white/[0.04]",
                )}
              >
                Analysis
              </button>
              <button
                onClick={() => setActiveTab("studio")}
                className={cn(
                  "px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all",
                  activeTab === "studio"
                    ? "bg-white/12 border border-white/20 text-white shadow-[0_0_20px_rgba(125,211,252,0.15)]"
                    : "text-white/50 hover:text-white/80 hover:bg-white/[0.04]",
                )}
              >
                Resume Studio
              </button>
            </div>
          </div>

          {activeTab === "analysis" ? (
            <>
              {/* Header */}
              <div className="flex items-end justify-between px-2 shrink-0">
                <div className="space-y-2">
                  <div className="flex items-center gap-4">
                    <div className="px-2.5 py-1.5 rounded-lg bg-primary/20 shadow-[0_0_15px_rgba(var(--primary),0.2)] flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-widest text-primary">
                        Revamp V1.0
                      </span>
                    </div>
                    <h2 className="text-3xl font-bold tracking-tight text-white">
                      Resume Analysis
                    </h2>
                  </div>
                  <p className="text-white/40 text-sm font-medium">
                    Strategic enhancements and competitive benchmarking
                  </p>
                </div>

                {displayPdf && (
                  <a
                    href={displayPdf}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center gap-2.5 px-4 py-2 rounded-xl bg-white/[0.05] border border-white/10 hover:bg-white/[0.1] hover:border-white/20 transition-all active:scale-95 shadow-lg"
                  >
                    <FileText className="w-4 h-4 text-white/60 group-hover:text-white transition-colors" />
                    <span className="text-xs font-bold uppercase tracking-widest text-white/60 group-hover:text-white transition-colors">
                      Export PDF
                    </span>
                  </a>
                )}
              </div>

              {/* Global Analysis Modules */}
              <div className="grid grid-cols-1 gap-6 shrink-0">
                <MetricsCard
                  revampedResume={displayRevamped}
                  originalResume={originalResume}
                />
                <CompanyFitCard compiledPdfUrl={displayPdf} />
              </div>

              {/* Section-specific Analysis */}
              <div className="shrink-0">
                <SectionAnalysis
                  changes={displayChanges}
                  canEdit={isAdminAnnotator}
                  onEditChange={updateStrategicEnhancementText}
                  canGenerate={isAdminAnnotator}
                  isGenerating={studioRegenerateBusy}
                  onGenerate={() => {
                    setRegenModalOpen(true);
                  }}
                />
              </div>

              {/* Proceed button — bottom of scroll */}
              <button
                disabled
                className="relative w-full flex items-center justify-center mt-4 gap-8 px-8 py-5
                         rounded-2xl text-sm font-bold uppercase tracking-[0.3em]
                         bg-white/5 text-white/20 border border-white/5 cursor-not-allowed shadow-inner mb-8"
              >
                Finalize Resume
                <ArrowRight className="w-5 h-5" />
              </button>
            </>
          ) : (
            <div className="relative rounded-[2rem] border border-blue-400/20 bg-blue-950/20 p-6 overflow-hidden">
              {/* Rotating glow */}
              <div className="pointer-events-none absolute -top-20 -right-20 h-56 w-56 rounded-full bg-gradient-to-br from-blue-400/35 via-indigo-400/20 to-cyan-300/20 blur-2xl animate-[spin_12s_linear_infinite]" />

              <div className="relative z-10">
                <h2 className="text-2xl font-bold tracking-tight text-white mb-1">
                  Resume Studio
                </h2>
                <p className="text-white/60 text-sm mb-5">
                  All AI revamps and note comments from your PDF annotations.
                </p>

                {isAdminAnnotator && (
                  <div className="mb-5 space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => void applyMakeChangesFromStudio()}
                        disabled={
                          studioApplyBusy ||
                          activeStudioThreads.length === 0 ||
                          !authToken?.trim()
                        }
                        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-400/35 bg-emerald-500/15 px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-emerald-100 shadow-[0_0_24px_rgba(16,185,129,0.12)] transition-all hover:bg-emerald-500/25 disabled:pointer-events-none disabled:opacity-40"
                      >
                        {studioApplyBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Sparkles className="h-4 w-4" />
                        )}
                        Make Changes
                      </button>
                      <a
                        href={
                          annotation?.onboardingId
                            ? `https://tools.mentorquedu.com/?onboardinsubmisionid=${encodeURIComponent(annotation.onboardingId)}&token=tkn_8fK29xLmQ7pV3nZdR6cY1uHs`
                            : undefined
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(
                          "inline-flex w-full items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-xs font-black uppercase tracking-[0.2em] transition-all",
                          annotation?.onboardingId
                            ? "border-cyan-400/35 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25"
                            : "border-white/15 bg-white/[0.05] text-white/40 pointer-events-none",
                        )}
                      >
                        <ArrowUpRight className="h-4 w-4" />
                        Edit Resume
                      </a>
                    </div>
                    <button
                      type="button"
                      onClick={() => void regenerateStudioPdf()}
                      disabled={studioPdfRegenerateBusy || !authToken?.trim()}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-blue-400/35 bg-blue-500/15 px-4 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-blue-100 transition-all hover:bg-blue-500/25 disabled:pointer-events-none disabled:opacity-40"
                    >
                      {studioPdfRegenerateBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <FileText className="h-3.5 w-3.5" />
                      )}
                      Regenerate PDF
                    </button>
                    {studioApplyError && (
                      <p className="text-xs text-red-300/95 leading-relaxed">
                        {studioApplyError}
                      </p>
                    )}
                    {!authToken?.trim() && (
                      <p className="text-[10px] text-white/35">
                        Sign in with a mentor access link to use Make Changes.
                      </p>
                    )}
                  </div>
                )}

                {studioAuthorOptions.length > 1 && (
                  <div className="mb-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-white/45 mb-2">
                      Filter by author
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      {studioAuthorOptions.map((option) => {
                        const isActive = studioAuthorFilter === option.key;
                        return (
                          <button
                            key={option.key}
                            type="button"
                            onClick={() => setStudioAuthorFilter(option.key)}
                            className={cn(
                              "group relative h-8 min-w-8 px-2 rounded-full border text-[9px] font-black uppercase tracking-widest transition-all",
                              isActive
                                ? "bg-cyan-500/25 border-cyan-300/60 text-cyan-100 shadow-[0_0_16px_rgba(34,211,238,0.22)]"
                                : "bg-white/[0.05] border-white/15 text-white/70 hover:bg-white/[0.1] hover:text-white",
                            )}
                          >
                            {option.shortLabel}
                            <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/15 bg-black/90 px-2 py-1 text-[10px] font-semibold normal-case tracking-normal text-white/90 opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
                              {option.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="space-y-3 max-h-[65vh] overflow-y-auto pr-1 custom-scrollbar">
                  {filteredActiveStudioThreads.length === 0 &&
                  filteredResolvedStudioThreads.length === 0 ? (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/60">
                      No comments yet. Select text in the PDF and use{" "}
                      <span className="text-white/90 font-semibold">
                        Ask AI
                      </span>{" "}
                      or{" "}
                      <span className="text-white/90 font-semibold">Note</span>.
                    </div>
                  ) : (
                    <>
                      {filteredActiveStudioThreads.length === 0 && (
                        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-xs text-white/50">
                          No open feedback threads. Resolved items are below.
                        </div>
                      )}
                      {filteredActiveStudioThreads.map((thread) =>
                        renderStudioThreadCard(thread, false),
                      )}

                      {filteredResolvedStudioThreads.length > 0 && (
                        <details className="group rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden">
                          <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-2 text-sm font-semibold text-white/70 hover:bg-white/[0.04] [&::-webkit-details-marker]:hidden">
                            <span>
                              Resolved feedback (
                              {filteredResolvedStudioThreads.length})
                            </span>
                            <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
                          </summary>
                          <div className="space-y-3 px-4 pb-4 pt-2 border-t border-white/10 max-h-[42vh] overflow-y-auto custom-scrollbar">
                            {filteredResolvedStudioThreads.map((thread) =>
                              renderStudioThreadCard(thread, true),
                            )}
                          </div>
                        </details>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={regenModalOpen} onOpenChange={setRegenModalOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Generate Changes</DialogTitle>
            <DialogDescription>
              Add guidance on what to highlight more (metrics, ATS keywords,
              leadership impact, etc). This regenerates all change cards.
            </DialogDescription>
          </DialogHeader>
          <textarea
            value={regenPromptDraft}
            onChange={(e) => setRegenPromptDraft(e.target.value)}
            placeholder="Example: Focus more on quantified business impact and data analytics achievements; de-emphasize generic tooling text."
            rows={6}
            className="w-full resize-y rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-white/90 placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-cyan-400/30"
          />
          <DialogFooter>
            <button
              type="button"
              onClick={() => setRegenModalOpen(false)}
              className="rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-widest border border-white/15 text-white/70 hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={studioRegenerateBusy}
              onClick={() => {
                void regenerateStudioChangesFromContext(regenPromptDraft);
                setRegenModalOpen(false);
              }}
              className="rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-widest bg-cyan-500/20 border border-cyan-400/35 text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-40"
            >
              {studioRegenerateBusy ? "Generating..." : "Generate"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
