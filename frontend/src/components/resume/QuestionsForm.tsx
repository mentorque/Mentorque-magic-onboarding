/**
 * QuestionsForm.tsx
 * Location: artifacts/mentorque-onboarding/src/components/resume/QuestionsForm.tsx
 *
 * Sub-stage 2 of the resume revamp step.
 * Shows the AI-generated questions one by one with navigation.
 * - Partial answers persisted in localStorage (restored on return)
 * - On submit: runs revamp API call, then saves answers + result to DB in one write
 */

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { BlurFade, GlassButton } from "../ui/OnboardingUI";
import { MentorqueLoader } from "./MentorqueLoader";
import type { RevampQuestion } from "../../lib/resumeRevampTypes";

const PARTIAL_ANSWERS_KEY = "mentorque_questionnaire_partial_answers";

const OTHER_RE = /^other$/i;

type McqMultiStored = {
  selected: string[];
  /** Required when an option matching "Other" is selected */
  otherText: string;
  /** Optional elaboration on choices */
  detail: string;
};

function parseMcqStored(raw: string | undefined): McqMultiStored {
  if (!raw?.trim()) return { selected: [], otherText: "", detail: "" };
  try {
    const p = JSON.parse(raw) as Partial<McqMultiStored>;
    return {
      selected: Array.isArray(p.selected) ? (p.selected as string[]) : [],
      otherText: typeof p.otherText === "string" ? p.otherText : "",
      detail: typeof p.detail === "string" ? p.detail : "",
    };
  } catch {
    return { selected: raw.trim() ? [raw.trim()] : [], otherText: "", detail: "" };
  }
}

function stringifyMcqStored(v: McqMultiStored): string {
  return JSON.stringify(v);
}

function isOtherOptionLabel(label: string): boolean {
  return OTHER_RE.test(label.trim());
}

function isMcqMulti(q: RevampQuestion): boolean {
  return q.questionType === "mcq_multi" || q.questionType === "mcq";
}

function isQuestionFilled(q: RevampQuestion, raw: string | undefined): boolean {
  if (!raw?.trim()) return false;
  if (!isMcqMulti(q)) return raw.trim().length > 0;
  const p = parseMcqStored(raw);
  const opts = q.options ?? [];
  const otherLabel = opts.find((o) => isOtherOptionLabel(o));
  const hasOtherSelected = otherLabel
    ? p.selected.includes(otherLabel)
    : p.selected.some((s) => isOtherOptionLabel(s));
  if (hasOtherSelected && !p.otherText.trim()) return false;
  return p.selected.length > 0 || p.detail.trim().length > 0;
}

interface QuestionsFormProps {
  questions: RevampQuestion[];
  parsedResume: any;
  onRevamped: (result: {
    revampedResume: any;
    changes: any[];
    compiledPdfUrl: string | null;
  }) => void | Promise<void>;
  apiBaseUrl?: string;
  /** Fires synchronously when the user submits — use for full-screen loading + `/resume-revamp-reveal`. */
  onRevampFlowStart?: () => void;
  /** Fires when the revamp request finishes (success or error). */
  onRevampFlowEnd?: () => void;
  /** Submission ID for the DB save-questionnaire call. */
  onboardingSubmissionId?: string | null;
  /** Firebase auth token for the DB save-questionnaire call. */
  authToken?: string | null;
  /** Pre-filled answers to restore partial session. */
  initialAnswers?: Record<string, string>;
}

export function QuestionsForm({
  questions,
  parsedResume,
  onRevamped,
  apiBaseUrl = "",
  onRevampFlowStart,
  onRevampFlowEnd,
  onboardingSubmissionId,
  authToken,
  initialAnswers,
}: QuestionsFormProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    // Priority: initialAnswers prop (from parent/DB) → localStorage partial → empty
    if (initialAnswers && Object.keys(initialAnswers).length > 0) {
      return initialAnswers;
    }
    try {
      const stored = localStorage.getItem(PARTIAL_ANSWERS_KEY);
      if (stored) return JSON.parse(stored) as Record<string, string>;
    } catch {
      /* ignore */
    }
    return {};
  });
  const [loading, setLoading] = useState(false);
  /** Synchronous in-flight guard — prevents double-submit before React re-renders the disabled button */
  const submittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [direction, setDirection] = useState(0); // -1 for back, 1 for next

  // Persist partial answers to localStorage as user types
  useEffect(() => {
    try {
      localStorage.setItem(PARTIAL_ANSWERS_KEY, JSON.stringify(answers));
    } catch {
      /* ignore quota / private mode */
    }
  }, [answers]);

  const filledCount = questions.filter((q) =>
    isQuestionFilled(q, answers[q.id]),
  ).length;
  const required = questions.length;
  const canProceed = filledCount >= required;

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      setDirection(1);
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handleBack = () => {
    if (currentIndex > 0) {
      setDirection(-1);
      setCurrentIndex(currentIndex - 1);
    }
  };

  const handleSubmit = async () => {
    // Synchronous guard: prevents a second click from racing before React re-renders
    if (submittingRef.current) return;
    submittingRef.current = true;
    onRevampFlowStart?.();
    setError(null);
    setLoading(true);
    try {
      // Step 1: Call the revamp endpoint
      const response = await fetch(`${apiBaseUrl}/api/resume-revamp/revamp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parsedResume, answers }),
      });

      if (!response.ok) {
        const err = (await response.json()) as { message?: string };
        throw new Error(err.message || "Revamp failed.");
      }

      const data = (await response.json()) as {
        revampedResume: any;
        changes: any[];
        compiledPdfUrl: string | null;
      };

      // Step 2: Save answers + revamp result to DB in one write
      if (onboardingSubmissionId && authToken) {
        try {
          const saveRes = await fetch(
            `${apiBaseUrl}/api/onboarding/save-questionnaire`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${authToken}`,
              },
              body: JSON.stringify({
                submissionId: onboardingSubmissionId,
                answers,
                revampResult: data,
              }),
            },
          );
          if (!saveRes.ok) {
            console.warn(
              "[QuestionsForm] save-questionnaire returned non-OK:",
              saveRes.status,
            );
          }
        } catch (saveErr: any) {
          // Non-fatal — revamp result is in sessionStorage as fallback
          console.warn(
            "[QuestionsForm] save-questionnaire failed (non-fatal):",
            saveErr?.message,
          );
        }
      }

      // Step 3: Clear partial answers from localStorage
      try {
        localStorage.removeItem(PARTIAL_ANSWERS_KEY);
      } catch {
        /* ignore */
      }

      // Step 4: Notify parent
      await Promise.resolve(onRevamped(data));
    } catch (err: any) {
      setError(err.message || "Something went wrong.");
    } finally {
      submittingRef.current = false;
      setLoading(false);
      onRevampFlowEnd?.();
    }
  };

  const currentQuestion = questions[currentIndex];

  const variants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 20 : -20,
      opacity: 0,
    }),
    center: {
      zIndex: 1,
      x: 0,
      opacity: 1,
    },
    exit: (direction: number) => ({
      zIndex: 0,
      x: direction < 0 ? 20 : -20,
      opacity: 0,
    }),
  };

  return (
    <div className="w-full flex flex-col items-center space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="w-full flex flex-col items-center gap-3">
        <BlurFade delay={0.1} className="w-full">
          <p className="font-serif font-light text-3xl sm:text-5xl tracking-tight text-foreground text-center">
            A few quick questions
          </p>
        </BlurFade>
        <BlurFade delay={0.2} className="w-full">
          <p className="text-sm font-medium text-muted-foreground text-center max-w-lg mx-auto px-4">
            We read your resume with care — these questions are just to help you
            shine. Share what feels right; more detail usually means a stronger
            revamp.
          </p>
        </BlurFade>
      </div>

      <div className="w-full max-w-2xl relative min-h-[350px] sm:min-h-[450px] flex flex-col px-4 sm:px-0">
        {/* Progress bar */}
        <BlurFade delay={0.3} className="w-full">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px] sm:text-xs font-semibold uppercase tracking-widest text-muted-foreground/50">
              <span>
                Question {currentIndex + 1} of {questions.length}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-foreground/5 border border-foreground/10 overflow-hidden p-0.5">
              <motion.div
                className="h-full rounded-full bg-primary"
                // ✅ Remove `initial` — let Framer Motion track changes freely
                animate={{
                  width: `${(filledCount / questions.length) * 100}%`,
                }}
                transition={{ type: "spring", stiffness: 100, damping: 20 }}
                style={{ boxShadow: "0 0 12px hsl(var(--primary) / 0.4)" }}
              />
            </div>
          </div>
        </BlurFade>

        {loading ? (
          <div className="w-full min-h-[360px] rounded-2xl border border-blue-400/20 bg-blue-950/20 backdrop-blur-xl flex items-center justify-center mt-8">
            <MentorqueLoader size={170} />
          </div>
        ) : (
          <>
            {/* Current Question & Arrows */}
            <div className="relative pt-8 pb-32">
              {/* Navigation Arrows */}
              <div className="absolute -left-16 top-36 hidden xl:block">
                <motion.button
                  type="button"
                  onClick={handleBack}
                  disabled={currentIndex === 0 || loading}
                  className={cn(
                    "p-3 transition-all duration-300 text-foreground/40 hover:text-foreground",
                    (currentIndex === 0 || loading) &&
                      "opacity-0 pointer-events-none",
                  )}
                  whileHover={{ x: -5, scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <ChevronLeft className="w-8 h-8" />
                </motion.button>
              </div>

              <div className="absolute -right-16 top-36 hidden xl:block">
                <motion.button
                  type="button"
                  onClick={handleNext}
                  disabled={currentIndex === questions.length - 1 || loading}
                  className={cn(
                    "p-3 transition-all duration-300 text-foreground/40 hover:text-foreground",
                    (currentIndex === questions.length - 1 || loading) &&
                      "opacity-0 pointer-events-none",
                  )}
                  whileHover={{ x: 5, scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <ChevronRight className="w-8 h-8" />
                </motion.button>
              </div>

              <AnimatePresence initial={false} custom={direction} mode="wait">
                <motion.div
                  key={currentQuestion.id}
                  custom={direction}
                  variants={variants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{
                    x: { type: "spring", stiffness: 300, damping: 30 },
                    opacity: { duration: 0.2 },
                  }}
                  className="w-full"
                >
                  {isMcqMulti(currentQuestion) &&
                  currentQuestion.options &&
                  currentQuestion.options.length > 0 ? (
                    <div className="flex flex-col gap-6 w-full">
                      <div className="space-y-3">
                        <p className="text-foreground text-2xl font-medium text-center leading-tight">
                          {currentQuestion.question}
                        </p>
                        {currentQuestion.hint && (
                          <p className="text-muted-foreground/60 text-sm italic font-medium text-center">
                            {currentQuestion.hint}
                          </p>
                        )}
                        <p className="text-xs text-center text-muted-foreground/70">
                          Select all that apply — you can pick several.
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-3 w-full">
                        {currentQuestion.options.map((option) => {
                          const stored = parseMcqStored(
                            answers[currentQuestion.id],
                          );
                          const isSelected = stored.selected.includes(option);
                          return (
                            <motion.button
                              key={option}
                              type="button"
                              onClick={() => {
                                setAnswers((prev) => {
                                  const cur = parseMcqStored(
                                    prev[currentQuestion.id],
                                  );
                                  const nextSel = isSelected
                                    ? cur.selected.filter((x) => x !== option)
                                    : [...cur.selected, option];
                                  const otherText =
                                    isOtherOptionLabel(option) && isSelected
                                      ? ""
                                      : cur.otherText;
                                  return {
                                    ...prev,
                                    [currentQuestion.id]: stringifyMcqStored({
                                      ...cur,
                                      selected: nextSel,
                                      otherText,
                                    }),
                                  };
                                });
                              }}
                              whileHover={{
                                scale: 1.01,
                                borderColor:
                                  "oklch(from var(--foreground) l c h / 0.2)",
                              }}
                              whileTap={{ scale: 0.99 }}
                              className={cn(
                                "flex-1 min-w-[240px] py-4 px-6 rounded-2xl text-base font-medium transition-all duration-300 relative overflow-hidden border text-left",
                                isSelected
                                  ? "text-foreground border-primary/40 shadow-[0_0_20px_rgba(var(--primary),0.1)]"
                                  : "text-foreground/50 border-white/5 hover:text-foreground/80",
                              )}
                              style={{
                                background: isSelected
                                  ? "linear-gradient(-75deg, oklch(from var(--background) l c h / 15%), oklch(from var(--background) l c h / 30%), oklch(from var(--background) l c h / 15%))"
                                  : "linear-gradient(-75deg, oklch(from var(--background) l c h / 5%), oklch(from var(--background) l c h / 10%), oklch(from var(--background) l c h / 5%))",
                                boxShadow: isSelected
                                  ? "inset 0 0.125em 0.125em oklch(from var(--foreground) l c h / 5%), 0 0.25em 0.125em -0.125em oklch(from var(--foreground) l c h / 20%)"
                                  : "inset 0 0.125em 0.125em oklch(from var(--foreground) l c h / 2%)",
                              }}
                            >
                              <div className="flex items-center justify-start gap-3 relative z-10">
                                <div
                                  className={cn(
                                    "w-4 h-4 shrink-0 rounded border transition-all duration-300 flex items-center justify-center text-[10px] font-bold",
                                    isSelected
                                      ? "bg-primary border-primary text-background"
                                      : "bg-transparent border-foreground/25",
                                  )}
                                >
                                  {isSelected ? "✓" : ""}
                                </div>
                                <span>{option}</span>
                              </div>
                            </motion.button>
                          );
                        })}
                      </div>

                      {(() => {
                        const stored = parseMcqStored(
                          answers[currentQuestion.id],
                        );
                        const otherSelected = stored.selected.some((s) =>
                          isOtherOptionLabel(s),
                        );
                        return otherSelected ? (
                          <div className="flex flex-col gap-2 w-full">
                            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Tell us a bit about &quot;Other&quot;
                            </label>
                            <input
                              type="text"
                              value={stored.otherText}
                              onChange={(e) =>
                                setAnswers((prev) => {
                                  const cur = parseMcqStored(
                                    prev[currentQuestion.id],
                                  );
                                  return {
                                    ...prev,
                                    [currentQuestion.id]: stringifyMcqStored({
                                      ...cur,
                                      otherText: e.target.value,
                                    }),
                                  };
                                })
                              }
                              placeholder="Type your other choice here…"
                              className="w-full rounded-xl border border-white/10 bg-foreground/[0.03] px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
                            />
                          </div>
                        ) : null;
                      })()}

                      <div className="flex flex-col gap-2 w-full">
                        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Anything else you&apos;d like to add?{" "}
                          <span className="font-normal normal-case text-muted-foreground/60">
                            (optional)
                          </span>
                        </label>
                        <textarea
                          value={
                            parseMcqStored(answers[currentQuestion.id]).detail
                          }
                          onChange={(e) =>
                            setAnswers((prev) => {
                              const cur = parseMcqStored(
                                prev[currentQuestion.id],
                              );
                              return {
                                ...prev,
                                [currentQuestion.id]: stringifyMcqStored({
                                  ...cur,
                                  detail: e.target.value,
                                }),
                              };
                            })
                          }
                          placeholder="Context, nuance, or extra detail…"
                          rows={3}
                          className="w-full rounded-xl border border-white/10 bg-transparent px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/35 resize-none focus:outline-none focus:ring-2 focus:ring-primary/25"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="glass-textarea-wrap w-full">
                      <div className="glass-textarea p-6 flex flex-col gap-6 w-full">
                        <p className="text-foreground text-xl font-medium leading-tight w-full">
                          {currentQuestion.question}
                        </p>

                        {currentQuestion.hint && (
                          <p className="text-muted-foreground/60 text-sm italic font-medium bg-foreground/[0.02] border-l-2 border-primary/30 pl-4 py-1.5 w-full">
                            {currentQuestion.hint}
                          </p>
                        )}

                        <div className="flex flex-col gap-2 w-full mt-2">
                          <AnimatePresence>
                            {(answers[currentQuestion.id] || "").length > 0 && (
                              <motion.div
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                transition={{ duration: 0.2 }}
                              >
                                <label className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">
                                  Your answer
                                </label>
                              </motion.div>
                            )}
                          </AnimatePresence>
                          <textarea
                            autoFocus
                            value={answers[currentQuestion.id] || ""}
                            onChange={(e) =>
                              setAnswers((prev) => ({
                                ...prev,
                                [currentQuestion.id]: e.target.value,
                              }))
                            }
                            placeholder="Type your answer here..."
                            className="w-full bg-transparent text-foreground placeholder:text-muted-foreground/30
                                   text-lg resize-none focus:outline-none transition-all leading-relaxed min-h-[120px]
                                   [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Mobile Navigation Arrows */}
            <div className="flex xl:hidden justify-between items-center px-2">
              <button
                type="button"
                onClick={handleBack}
                disabled={currentIndex === 0 || loading}
                className={cn(
                  "flex items-center gap-1 text-sm font-medium transition-all duration-300",
                  currentIndex === 0 || loading
                    ? "opacity-0 pointer-events-none"
                    : "text-foreground/60 hover:text-foreground",
                )}
              >
                <ChevronLeft className="w-4 h-4" /> Previous
              </button>
              <button
                type="button"
                onClick={handleNext}
                disabled={currentIndex === questions.length - 1 || loading}
                className={cn(
                  "flex items-center gap-1 text-sm font-medium transition-all duration-300",
                  currentIndex === questions.length - 1 || loading
                    ? "opacity-0 pointer-events-none"
                    : "text-foreground/60 hover:text-foreground",
                )}
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Error */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex justify-center"
                >
                  <p className="text-destructive text-sm font-medium bg-destructive/10 border border-destructive/20 rounded-full px-6 py-2">
                    {error}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Generate Button Area - Fixed at bottom right */}
            <div className="absolute bottom-0 right-0">
              <BlurFade delay={0.5}>
                <GlassButton
                  disabled={!canProceed || loading}
                  onClick={handleSubmit}
                  contentClassName="flex items-center justify-center gap-2"
                  className={cn(
                    "transition-all duration-300",
                    loading ? "w-[240px]" : "w-[220px]",
                    !canProceed && !loading && "opacity-60",
                  )}
                >
                  {loading ? (
                    <div className="flex items-center gap-2">
                      <MentorqueLoader size={22} />
                    </div>
                  ) : !canProceed ? (
                    <span className="text-xs font-bold uppercase tracking-widest">
                      {Math.max(0, required - filledCount)} more to unlock
                    </span>
                  ) : (
                    <>
                      Generate Revamp
                      <ChevronRight className="w-4 h-4" />
                    </>
                  )}
                </GlassButton>
              </BlurFade>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
