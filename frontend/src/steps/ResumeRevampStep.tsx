/**
 * ResumeRevampStep.tsx
 * Location: artifacts/mentorque-onboarding/src/steps/ResumeRevampStep.tsx
 *
 * The new onboarding step inserted between "preferences" and "experience".
 * Orchestrates resume-revamp sub-stages:
 *   1. upload       — PDF or plain-text paste
 *   2. questions    — AI-generated questions
 *   3. awaitReveal  — wait until `revealResume` is true (admin)
 *   4. comparison   — PDF preview + bento report
 *   5. done         — success, advances parent step
 *
 * Usage in your step router (e.g. App.tsx or wherever steps are defined):
 *   case 'resume-revamp':
 *     return <ResumeRevampStep onComplete={goToNextStep} />;
 */

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { UploadPanel } from "../components/resume/UploadPanel";
import { MentorqueLoader } from "../components/resume/MentorqueLoader";
import { QuestionsForm } from "../components/resume/QuestionsForm";
import { ComparisonView } from "../components/resume/ComparisonView";
import { cn } from "@/lib/utils";
import {
  type RevampStage,
  type ParseResult,
  type RevampResult,
  type RevampQuestion,
} from "../lib/resumeRevampTypes";

const STORAGE_KEY = "mentorque-revamp-data";

interface ResumeRevampStepProps {
  /** Called when the user clicks "Continue" after the comparison, or skips */
  onComplete: (finalResumeData?: any) => void;
  /** Base URL of the onboarding API server. Defaults to same origin. */
  apiBaseUrl?: string;
  /** When set (e.g. from main stepper "Upload resume"), skip internal upload stage. */
  initialParseResult?: ParseResult | null;
  /** Plain resume text saved in onboarding; AI parse runs here (not on the upload step). */
  initialRawResumeText?: string | null;
  /** Onboarding row id — required to enforce `revealResume` before showing the review. */
  onboardingSubmissionId?: string | null;
  /** Firebase-backed API token for `/api/onboarding/my-submission`. */
  authToken?: string | null;
  /** Fires when URL segment is `/resume-revamp-reveal` (loading + await mentor) vs `/resume-revamp` — parent hides global stepper on reveal. */
  onRevealPathChange?: (isRevealRoute: boolean) => void;
  /** DB `input_complete` / `completed` — skip upload & questions; go straight to reveal / comparison. */
  skipEarlierRevampStages?: boolean;
}

// ─── Step indicator ───────────────────────────────────────────────────────────
function getStages(skipUpload: boolean): { key: RevampStage; label: string }[] {
  if (skipUpload) {
    return [
      { key: "questions", label: "Profile" },
      { key: "comparison", label: "Review" },
    ];
  }
  return [
    { key: "upload", label: "Upload" },
    { key: "questions", label: "Profile" },
    { key: "comparison", label: "Review" },
  ];
}

function StageIndicator({
  current,
  skipUpload,
}: {
  current: RevampStage;
  skipUpload: boolean;
}) {
  const STAGES = getStages(skipUpload);
  const activeIndex = STAGES.findIndex((s) => s.key === current);
  return (
    <div className="flex justify-center mb-12">
      <div className="stepper-bar">
        {STAGES.map((s, i) => {
          const isDone = i < activeIndex;
          const isActive = i === activeIndex;
          return (
            <div key={s.key} className="flex items-center">
              {i > 0 && <div className="stepper-divider" />}
              <div
                className={cn("stepper-step", {
                  active: isActive,
                  done: isDone && !isActive,
                })}
              >
                <span className="stepper-num">
                  {isDone && !isActive ? (
                    <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none">
                      <path
                        d="M2 6l3 3 5-5"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    i + 1
                  )}
                </span>
                <span>{s.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ResumeRevampStep({
  onComplete,
  apiBaseUrl = "",
  initialParseResult = null,
  initialRawResumeText = null,
  onboardingSubmissionId = null,
  authToken = null,
  onRevealPathChange,
  skipEarlierRevampStages = false,
}: ResumeRevampStepProps) {
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
  const hasPrefilledParse = Boolean(initialParseResult?.parsedResume);
  const hasRawFromOnboarding = Boolean(initialRawResumeText?.trim());
  const [parseFromRawFailed, setParseFromRawFailed] = useState(false);
  const skipUpload =
    hasPrefilledParse || (hasRawFromOnboarding && !parseFromRawFailed);

  const [bootstrapFromRaw, setBootstrapFromRaw] = useState(
    () =>
      !skipEarlierRevampStages && hasRawFromOnboarding && !hasPrefilledParse,
  );

  const [stage, setStage] = useState<RevampStage>(() => {
    if (skipEarlierRevampStages) return "awaitReveal";
    if (typeof window === "undefined") return skipUpload ? "questions" : "upload";
    const hash = window.location.hash;
    // Only restore state if there's an explicit hash (meaning user refreshed)
    if (hash) {
      try {
        const saved = sessionStorage.getItem(STORAGE_KEY);
        if (saved) {
          const data = JSON.parse(saved);
          if (hash === "#result" && data.parseResult && data.revampResult)
            return "awaitReveal";
          if (hash === "#questions" && data.parseResult) return "questions";
        }
      } catch {
        /* ignore */
      }
    }
    return skipUpload ? "questions" : "upload";
  });
  const [parseResult, setParseResult] = useState<ParseResult | null>(() => {
    if (initialParseResult?.parsedResume) return initialParseResult;
    if (typeof window === "undefined") return null;
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved).parseResult;
    } catch {
      /* ignore */
    }
    return null;
  });
  /** Full-screen load overlay from submit click through revamp API + reveal check. */
  const [revampFlowBusy, setRevampFlowBusy] = useState(false);

  const [revampResult, setRevampResult] = useState<RevampResult | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved).revampResult;
    } catch {
      /* ignore */
    }
    return null;
  });

  // Run AI parse once when onboarding collected raw text (upload step does not parse).
  useEffect(() => {
    if (skipEarlierRevampStages) return;
    if (hasPrefilledParse || !hasRawFromOnboarding || parseFromRawFailed) return;

    let cancelled = false;

    const run = async () => {
      try {
        const saved = sessionStorage.getItem(STORAGE_KEY);
        if (saved) {
          const data = JSON.parse(saved) as { parseResult?: ParseResult };
          if (data.parseResult?.parsedResume) {
            setParseResult(data.parseResult);
            setStage("questions");
            setBootstrapFromRaw(false);
            return;
          }
        }
      } catch {
        /* ignore */
      }

      const text = initialRawResumeText!.trim();
      try {
        const res = await fetch(`${apiBaseUrl}/api/resume-revamp/parse`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        const data = (await res.json()) as {
          parsedResume?: unknown;
          questions?: unknown[];
          rawText?: string;
          message?: string;
        };
        if (!res.ok) {
          throw new Error(data.message || "Failed to parse resume.");
        }
        if (!data.parsedResume || cancelled) return;
        const next: ParseResult = {
          parsedResume: data.parsedResume,
          questions: Array.isArray(data.questions)
            ? (data.questions as RevampQuestion[])
            : [],
          rawText: data.rawText ?? text,
        };
        setParseResult(next);
        setStage("questions");
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setParseFromRawFailed(true);
          setStage("upload");
        }
      } finally {
        if (!cancelled) setBootstrapFromRaw(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    apiBaseUrl,
    hasPrefilledParse,
    hasRawFromOnboarding,
    initialRawResumeText,
    skipEarlierRevampStages,
  ]);

  // Persist to sessionStorage when stage changes
  useEffect(() => {
    if (stage === "questions" && parseResult) {
      window.location.hash = "questions";
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
    if (!skipEarlierRevampStages && (!parseResult || !revampResult)) return;
    if (!authToken?.trim()) {
      if (!skipEarlierRevampStages) setStage("comparison");
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
    skipEarlierRevampStages,
  ]);

  // `/resume-revamp-reveal` while generating or waiting for mentor reveal; `/resume-revamp` otherwise.
  useEffect(() => {
    const useRevealPath = revampFlowBusy || stage === "awaitReveal";
    onRevealPathChange?.(useRevealPath);
    if (typeof window === "undefined") return;
    const next = useRevealPath ? "/resume-revamp-reveal" : "/resume-revamp";
    if (window.location.pathname !== next) {
      window.history.replaceState(null, "", next);
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

  // ── Stage 1 → 2: resume parsed ──────────────────────────────────────────
  const handleParsed = (result: ParseResult) => {
    // Skip was pressed (parsedResume is null) or no questions → skip to next onboarding step
    if (!result.parsedResume || result.questions.length === 0) {
      onComplete(undefined);
      return;
    }
    setParseResult(result);
    setStage("questions");
  };

  // ── Stage 2 → awaitReveal or comparison (gated by `revealResume`) ─────────
  const handleRevamped = async (result: RevampResult) => {
    setRevampResult(result);
    const allowed = await fetchRevealResumeAllowed();
    setStage(allowed ? "comparison" : "awaitReveal");
  };

  // ── Stage 3 → done: user finalises ────────────────────────────────────────

  if (
    !skipEarlierRevampStages &&
    bootstrapFromRaw &&
    hasRawFromOnboarding &&
    !hasPrefilledParse
  ) {
    return (
      <div className="flex w-full flex-1 flex-col items-center justify-center gap-4 py-24">
        <MentorqueLoader size={170} />
        <p className="text-sm text-muted-foreground text-center max-w-sm">
          Preparing your profile from your resume text…
        </p>
      </div>
    );
  }

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
              Building your revamped resume…
            </p>
            <p className="text-sm text-muted-foreground">
              This usually takes a few seconds. Hang tight.
            </p>
          </div>
        </div>
      )}
      {/* Stage indicator — hidden on reveal route (loading / await mentor) and on comparison */}
      <AnimatePresence>
        {!revampFlowBusy &&
          stage !== "comparison" &&
          stage !== "awaitReveal" && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
          >
            <StageIndicator current={stage} skipUpload={skipUpload} />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {!skipUpload && stage === "upload" && (
          <motion.div
            key="upload"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
          >
            <UploadPanel onParsed={handleParsed} apiBaseUrl={apiBaseUrl} />
          </motion.div>
        )}

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
            />
          </motion.div>
        )}

        {stage === "awaitReveal" &&
          (skipEarlierRevampStages || (parseResult && revampResult)) && (
          <motion.div
            key="awaitReveal"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="flex w-full flex-1 flex-col items-center justify-center gap-6 px-4 py-16 text-center"
          >
            <MentorqueLoader size={140} />
            <div className="max-w-md space-y-3">
              <h2 className="text-2xl font-serif font-light tracking-tight text-foreground">
                Your resume is almost ready
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {skipEarlierRevampStages && (!parseResult || !revampResult)
                  ? "Your onboarding details are saved. Your mentor will unlock your full review here when it is ready. This page updates automatically."
                  : "We have saved your answers and generated your upgraded profile. Your detailed review will unlock here once your mentor marks your resume as ready to share. This page updates automatically — you can keep it open."}
              </p>
            </div>
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
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
