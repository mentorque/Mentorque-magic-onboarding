/**
 * ResumeRevampStep.tsx
 * Location: frontend/src/steps/ResumeRevampStep.tsx
 *
 * Orchestrates resume-revamp sub-stages (upload stage REMOVED — handled in onboarding wizard):
 *   1. questions    — AI-generated questions (loaded from DB via preGeneratedQuestions prop)
 *   2. awaitReveal  — wait until `revealResume` is true (admin toggles)
 *   3. comparison   — PDF preview + bento report
 *   4. done         — success, advances parent step
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  ClipboardList,
  Inbox,
  LayoutTemplate,
  Lightbulb,
  MessageSquare,
  Mic2,
  Radar,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import { MentorqueLoader } from "../components/resume/MentorqueLoader";
import { QuestionsForm } from "../components/resume/QuestionsForm";
import { ComparisonView } from "../components/resume/ComparisonView";
import VaporizeTextCycle, { Tag } from "../components/ui/vapour-text-effect";
import {
  type RevampStage,
  type ParseResult,
  type RevampResult,
  type RevampQuestion,
} from "../lib/resumeRevampTypes";

const STORAGE_KEY = "mentorque-revamp-data";

type RevealSlide = {
  title: string;
  items: { Icon: LucideIcon; text: string }[];
};

/** Each vapor headline + three benefits with icons (synced by index with `VaporizeTextCycle`). */
const REVEAL_SLIDES: RevealSlide[] = [
  {
    title: "2,000+ interviews landed",
    items: [
      {
        Icon: Sparkles,
        text: "Role-aligned resume and story that pass recruiter screens",
      },
      {
        Icon: Mic2,
        text: "Talking points and proof for every common interview question",
      },
      {
        Icon: RefreshCw,
        text: "A repeatable system so every application feels less random",
      },
    ],
  },
  {
    title: "Personalised outreach",
    items: [
      {
        Icon: Send,
        text: "First lines written for the role, company, and hiring manager",
      },
      {
        Icon: Inbox,
        text: "Fewer generic blasts — more replies that lead to conversations",
      },
      {
        Icon: LayoutTemplate,
        text: "Templates you can tweak in minutes, not hours",
      },
    ],
  },
  {
    title: "Job posting insights",
    items: [
      {
        Icon: Radar,
        text: "Instant read on must-have skills vs nice-to-have in each JD",
      },
      {
        Icon: Lightbulb,
        text: "Bullet ideas pulled from the posting so you sound like the hire",
      },
      {
        Icon: Target,
        text: "Faster 'should I apply?' decisions with less second-guessing",
      },
    ],
  },
  {
    title: "Mentor-backed tracking",
    items: [
      {
        Icon: ClipboardList,
        text: "One place to see every application and follow-up",
      },
      {
        Icon: MessageSquare,
        text: "Feedback loops so you adjust strategy week to week",
      },
      {
        Icon: ShieldCheck,
        text: "Accountability that keeps momentum after the revamp ships",
      },
    ],
  },
];

interface ResumeRevampStepProps {
  /** Called when the user clicks "Continue" after the comparison, or skips */
  onComplete: (finalResumeData?: any) => void;
  /** Base URL of the onboarding API server. Defaults to same origin. */
  apiBaseUrl?: string;
  /** Onboarding row id — required to enforce `revealResume` before showing the review. */
  onboardingSubmissionId?: string | null;
  /** Firebase-backed API token for `/api/onboarding/my-submission`. */
  authToken?: string | null;
  /** Fires when URL segment is `/resume-revamp-reveal` — parent hides global stepper on reveal. */
  onRevealPathChange?: (isRevealRoute: boolean) => void;
  /**
   * When true: skip upload + questions; go straight to awaitReveal.
   * Set when returning user has already submitted questionnaire answers.
   */
  skipEarlierRevampStages?: boolean;
  /**
   * AI-generated questions loaded from DB (ai_questions column).
   * When provided, the questionnaire starts immediately without an upload step.
   */
  preGeneratedQuestions?: RevampQuestion[] | null;
  /**
   * Structured resume JSON from DB (parsed_resume column).
   * Required for the revamp API call; loaded alongside preGeneratedQuestions.
   */
  preGeneratedParsedResume?: any | null;
  /**
   * Revamp result loaded from DB (revamp_result column).
   * Used for returning users who already answered the questionnaire.
   */
  preLoadedRevampResult?: RevampResult | null;
  /**
   * When true: the user has ALREADY submitted questionnaire answers (from DB).
   * Forces the component straight to awaitReveal/comparison — never shows questionnaire.
   */
  questionnaireDone?: boolean;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ResumeRevampStep({
  onComplete,
  apiBaseUrl = "",
  onboardingSubmissionId = null,
  authToken = null,
  onRevealPathChange,
  skipEarlierRevampStages = false,
  preGeneratedQuestions = null,
  preGeneratedParsedResume = null,
  preLoadedRevampResult = null,
  questionnaireDone = false,
}: ResumeRevampStepProps) {
  /** Direct navigation to `/resume-revamp-reveal` shows waiting UI */
  const [enteredViaRevealUrl] = useState(
    () =>
      typeof window !== "undefined" &&
      window.location.pathname === "/resume-revamp-reveal",
  );

  const hasPreloadedQuestions =
    (preGeneratedQuestions && preGeneratedQuestions.length > 0);

  const hasPreloadedRevamp = !!preLoadedRevampResult;

  // questionnaireDone=true means answers already exist in DB — never show questionnaire again.
  // revealOnlyFlow covers both the skip flag and direct URL navigation to /resume-revamp-reveal.
  const revealOnlyFlow = questionnaireDone || skipEarlierRevampStages || enteredViaRevealUrl;

  // Show questionnaire only when: we're in reveal-only mode (form done), questions are available,
  // revamp hasn't happened yet, AND the questionnaire hasn't been submitted yet.
  const shouldShowQuestionnaire =
    !questionnaireDone && revealOnlyFlow && !hasPreloadedRevamp && hasPreloadedQuestions;

  const revealTitles = useMemo(() => REVEAL_SLIDES.map((s) => s.title), []);
  const [revealSlideIndex, setRevealSlideIndex] = useState(0);

  const fetchRevealResumeAllowed = useCallback(async (): Promise<boolean> => {
    if (!authToken?.trim()) {
      return true;
    }
    try {
      const q = onboardingSubmissionId?.trim()
        ? `?submissionId=${encodeURIComponent(onboardingSubmissionId)}`
        : "";
      const url = `${apiBaseUrl}/api/onboarding/my-submission${q}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) return false;
      const data = (await res.json()) as {
        success?: boolean;
        submission?: { revealResume?: boolean } | null;
      };
      return Boolean(data.success && data.submission?.revealResume);
    } catch {
      return false;
    }
  }, [apiBaseUrl, onboardingSubmissionId, authToken]);

  /** Full-screen load overlay from submit click through revamp API + reveal check. */
  const [revampFlowBusy, setRevampFlowBusy] = useState(false);

  // Derive parseResult from pre-loaded props or sessionStorage
  const [parseResult, setParseResult] = useState<ParseResult | null>(() => {
    // Use DB-loaded data when available
    if (preGeneratedQuestions?.length && preGeneratedParsedResume) {
      return {
        parsedResume: preGeneratedParsedResume,
        questions: preGeneratedQuestions,
        rawText: "",
      };
    }
    // Fallback: sessionStorage (same-session navigation)
    if (typeof window === "undefined") return null;
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved).parseResult;
    } catch {
      /* ignore */
    }
    return null;
  });

  const [revampResult, setRevampResult] = useState<RevampResult | null>(() => {
    // Use DB-loaded revamp result for returning users
    if (preLoadedRevampResult) return preLoadedRevampResult;
    // Fallback: sessionStorage
    if (typeof window === "undefined") return null;
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved).revampResult;
    } catch {
      /* ignore */
    }
    return null;
  });

  const [stage, setStage] = useState<RevampStage>(() => {
    // User already answered questionnaire → always go to awaitReveal (or comparison if revamp loaded)
    if (questionnaireDone) {
      return "awaitReveal";
    }
    // On the reveal URL without questionnaire done — show questionnaire if questions available
    if (revealOnlyFlow && !shouldShowQuestionnaire) return "awaitReveal";
    if (
      typeof window !== "undefined" &&
      window.location.pathname === "/resume-revamp-reveal"
    ) {
      if (shouldShowQuestionnaire) return "questions";
      return "awaitReveal";
    }
    // URL hash #questionnaire is an explicit intent signal
    if (
      typeof window !== "undefined" &&
      window.location.hash === "#questionnaire" &&
      hasPreloadedQuestions &&
      !questionnaireDone
    ) {
      return "questions";
    }
    return "questions";
  });

  // Persist to sessionStorage when stage changes
  useEffect(() => {
    if (stage === "questions" && parseResult) {
      window.location.hash = "questionnaire";
      try {
        sessionStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ parseResult, revampResult: null }),
        );
      } catch {
        /* ignore */
      }
    }
    if (
      (stage === "comparison" || stage === "awaitReveal") &&
      parseResult &&
      revampResult
    ) {
      window.location.hash = "result";
      try {
        sessionStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ parseResult, revampResult }),
        );
      } catch {
        /* ignore */
      }
    }
  }, [stage, parseResult, revampResult]);

  // Poll until admin sets `revealResume` on the onboarding submission
  useEffect(() => {
    if (stage !== "awaitReveal") return;
    if (!revealOnlyFlow && (!parseResult || !revampResult)) return;
    if (!authToken?.trim()) {
      if (!revealOnlyFlow) setStage("comparison");
      return;
    }
    let cancelled = false;
    const tick = async () => {
      const ok = await fetchRevealResumeAllowed();
      if (cancelled) return;
      if (ok && revampResult) setStage("comparison");
    };
    void tick();
    const interval = window.setInterval(() => void tick(), 8000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    stage,
    parseResult,
    revampResult,
    onboardingSubmissionId,
    authToken,
    fetchRevealResumeAllowed,
    revealOnlyFlow,
  ]);

  // Update URL based on current stage
  useEffect(() => {
    const useRevealPath = revampFlowBusy || stage === "awaitReveal";
    onRevealPathChange?.(useRevealPath);
    if (typeof window === "undefined") return;

    let nextPath: string;
    let hash = "";

    if (useRevealPath) {
      nextPath = "/resume-revamp-reveal";
    } else if (stage === "questions") {
      nextPath = "/resume-revamp";
      hash = "#questionnaire";
    } else {
      nextPath = "/resume-revamp";
    }

    const fullPath = hash ? `${nextPath}${hash}` : nextPath;
    if (window.location.pathname !== nextPath || window.location.hash !== hash.replace("#", "")) {
      window.history.replaceState(null, "", fullPath);
    }
  }, [stage, revampFlowBusy, onRevealPathChange]);

  // Clear persisted data when going to done
  useEffect(() => {
    if (stage === "done") {
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      window.location.hash = "";
    }
  }, [stage]);

  // ── Stage 1 → awaitReveal or comparison (gated by `revealResume`) ─────────
  const handleRevamped = async (result: RevampResult) => {
    setRevampResult(result);
    const allowed = await fetchRevealResumeAllowed();
    setStage(allowed ? "comparison" : "awaitReveal");
  };

  // ── Done ─────────────────────────────────────────────────────────────────
  if (stage === "done") {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center justify-center gap-6 py-20 text-center"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 15 }}
          className="w-20 h-20 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center"
        >
          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground shadow-lg">
            <svg viewBox="0 0 12 12" className="w-6 h-6" fill="none">
              <path
                d="M2 6l3 3 5-5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </motion.div>
        <div className="space-y-2">
          <h2 className="text-3xl font-serif font-light tracking-tight text-foreground">
            Resume revamped!
          </h2>
          <p className="text-muted-foreground font-medium">
            Taking you to the next step…
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="relative w-full h-full flex flex-col">
      {revampFlowBusy && (
        <div
          className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-5 bg-background/85 backdrop-blur-md px-6"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <MentorqueLoader size={160} />
          <div className="max-w-sm text-center space-y-2">
            <p className="text-base font-medium text-foreground">
            AI is setting things up for you...
            </p>
            <p className="text-sm text-muted-foreground">
            Please wait, you’ll be redirected shortly...
            </p>
          </div>
        </div>
      )}

      <AnimatePresence mode="popLayout">
        {stage === "questions" && parseResult && (
          <motion.div
            key="questions"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
          >
            <QuestionsForm
              questions={parseResult.questions}
              parsedResume={parseResult.parsedResume}
              onRevamped={handleRevamped}
              onRevampFlowStart={() => setRevampFlowBusy(true)}
              onRevampFlowEnd={() => setRevampFlowBusy(false)}
              apiBaseUrl={apiBaseUrl}
              onboardingSubmissionId={onboardingSubmissionId}
              authToken={authToken}
            />
          </motion.div>
        )}

        {stage === "awaitReveal" && (
          <motion.div
            key="awaitReveal"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex w-full flex-1 flex-col items-center justify-center gap-8 px-6 py-12"
          >
            {/* Eyebrow + loader */}
            <div className="flex flex-col items-center gap-3">
              <MentorqueLoader size={56} />
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/35">
                Your resume is being cooked
              </p>
            </div>

            {/* Vapor headline */}
            <div className="w-full max-w-4xl" style={{ height: "5.5rem" }}>
              <VaporizeTextCycle
                texts={revealTitles}
                onTextIndexChange={setRevealSlideIndex}
                font={{
                  fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
                  fontSize: "58px",
                  fontWeight: 700,
                }}
                color="rgb(255, 255, 255)"
                spread={5}
                density={5}
                animation={{
                  vaporizeDuration: 2,
                  fadeInDuration: 1,
                  waitDuration: 6,
                }}
                direction="left-to-right"
                alignment="center"
                tag={Tag.H2}
              />
            </div>

            {/* Subtitle */}
            <p className="max-w-md text-center text-base leading-relaxed text-white/45">
              Getting every detail right to showcase the best of your profile.
            </p>

            {/* Synced feature cards */}
            <AnimatePresence mode="wait">
              <motion.ul
                key={revealSlideIndex}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="w-full max-w-xl space-y-3"
              >
                {REVEAL_SLIDES[revealSlideIndex]?.items.map(
                  ({ Icon, text }, i) => (
                    <motion.li
                      key={i}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{
                        duration: 0.3,
                        ease: "easeOut",
                        delay: i * 0.1,
                      }}
                      className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.06] px-5 py-4 shadow-md backdrop-blur-sm"
                    >
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/12 bg-white/[0.07]">
                        <Icon
                          className="h-5 w-5 text-emerald-300"
                          strokeWidth={1.75}
                          aria-hidden
                        />
                      </span>
                      <span className="text-base font-medium leading-snug tracking-tight text-white/88">
                        {text}
                      </span>
                    </motion.li>
                  ),
                )}
              </motion.ul>
            </AnimatePresence>
          </motion.div>
        )}

        {stage === "comparison" && parseResult && revampResult && (
          <motion.div
            key="comparison"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.4, ease: [0.25, 1, 0.5, 1] }}
            className="flex-1 flex flex-col min-h-0"
          >
            <ComparisonView
              originalResume={parseResult.parsedResume}
              revampedResume={revampResult.revampedResume}
              changes={revampResult.changes}
              compiledPdfUrl={revampResult.compiledPdfUrl}
              apiBaseUrl={apiBaseUrl}
              authToken={authToken ?? undefined}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
