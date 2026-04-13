/**
 * ResumeRevampStep.tsx
 * Location: artifacts/mentorque-onboarding/src/steps/ResumeRevampStep.tsx
 *
 * The new onboarding step inserted between "preferences" and "experience".
 * Orchestrates three sub-stages:
 *   1. upload    — PDF or plain-text paste
 *   2. questions — AI-generated static questions form
 *   3. comparison — side-by-side diff with per-bullet accept/reject
 *   4. done      — success state, advances to next step
 *
 * Usage in your step router (e.g. App.tsx or wherever steps are defined):
 *   case 'resume-revamp':
 *     return <ResumeRevampStep onComplete={goToNextStep} />;
 */

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { UploadPanel } from '../components/resume/UploadPanel';
import { QuestionsForm } from '../components/resume/QuestionsForm';
import { ComparisonView } from '../components/resume/ComparisonView';
import { cn } from "@/lib/utils";
import { BlurFade } from "../components/ui/OnboardingUI";
import {
  type RevampStage,
  type ParseResult,
  type RevampResult,
} from '../lib/resumeRevampTypes';

const STORAGE_KEY = 'mentorque-revamp-data';

interface ResumeRevampStepProps {
  /** Called when the user clicks "Continue" after the comparison, or skips */
  onComplete: (finalResumeData?: any) => void;
  /** Base URL of the onboarding API server. Defaults to same origin. */
  apiBaseUrl?: string;
}

// ─── Step indicator ───────────────────────────────────────────────────────────
const STAGES: { key: RevampStage; label: string }[] = [
  { key: 'upload', label: 'Upload' },
  { key: 'questions', label: 'Profile' },
  { key: 'comparison', label: 'Review' },
];

function StageIndicator({ current }: { current: RevampStage }) {
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
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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

export function ResumeRevampStep({ onComplete, apiBaseUrl = '' }: ResumeRevampStepProps) {
  const [stage, setStage] = useState<RevampStage>(() => {
    if (typeof window === 'undefined') return 'upload';
    const hash = window.location.hash;
    // Only restore state if there's an explicit hash (meaning user refreshed)
    if (hash) {
      try {
        const saved = sessionStorage.getItem(STORAGE_KEY);
        if (saved) {
          const data = JSON.parse(saved);
          if (hash === '#result' && data.parseResult && data.revampResult) return 'comparison';
          if (hash === '#questions' && data.parseResult) return 'questions';
        }
      } catch { /* ignore */ }
    }
    return 'upload';
  });
  const [parseResult, setParseResult] = useState<ParseResult | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved).parseResult;
    } catch { /* ignore */ }
    return null;
  });
  const [revampResult, setRevampResult] = useState<RevampResult | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved).revampResult;
    } catch { /* ignore */ }
    return null;
  });

  // Persist to sessionStorage when stage changes
  useEffect(() => {
    if (stage === 'questions' && parseResult) {
      window.location.hash = 'questions';
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ parseResult, revampResult: null }));
      } catch { /* ignore */ }
    }
    if (stage === 'comparison' && parseResult && revampResult) {
      window.location.hash = 'result';
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ parseResult, revampResult }));
      } catch { /* ignore */ }
    }
  }, [stage, parseResult, revampResult]);

  // Clear persisted data when going to done
  useEffect(() => {
    if (stage === 'done') {
      try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      window.location.hash = '';
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
    setStage('questions');
  };

  // ── Stage 2 → 3: revamp generated ───────────────────────────────────────
  const handleRevamped = (result: RevampResult) => {
    setRevampResult(result);
    setStage('comparison');
  };

  // ── Stage 3 → done: user finalises accept/reject ─────────────────────────
  // ComparisonView calls this with the final accepted-IDs set.
  // We apply them client-side (PDF compile is done inside ComparisonView on demand).
  const handleFinalize = useCallback(async (acceptedIds: string[]) => {
    if (!parseResult?.parsedResume || !revampResult) {
      setStage('done');
      setTimeout(() => onComplete(undefined), 1200);
      return;
    }

    // Merge accepted changes onto the original resume data
    const { applyAcceptedChanges } = await import('../lib/applyChanges');
    const merged = applyAcceptedChanges(
      parseResult.parsedResume,
      revampResult.revampedResume,
      revampResult.changes,
      new Set(acceptedIds),
    );
    setStage('done');
    setTimeout(() => onComplete(merged), 1200);
  }, [parseResult, revampResult, onComplete]);

  // ── Done ─────────────────────────────────────────────────────────────────
  if (stage === 'done') {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center justify-center gap-6 py-20 text-center"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 15 }}
          className="w-20 h-20 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center"
        >
          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground shadow-lg">
            <svg viewBox="0 0 12 12" className="w-6 h-6" fill="none">
              <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </motion.div>
        <div className="space-y-2">
          <h2 className="text-3xl font-serif font-light tracking-tight text-foreground">Resume revamped!</h2>
          <p className="text-muted-foreground font-medium">Taking you to the next step…</p>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col">
      {/* Stage indicator — hide on comparison (needs full width) */}
      <AnimatePresence>
        {stage !== 'comparison' && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
          >
            <StageIndicator current={stage} />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {stage === 'upload' && (
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

        {stage === 'questions' && parseResult && (
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
              apiBaseUrl={apiBaseUrl}
            />
          </motion.div>
        )}

        {stage === 'comparison' && parseResult && revampResult && (
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
              onFinalize={handleFinalize}
              apiBaseUrl={apiBaseUrl}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

