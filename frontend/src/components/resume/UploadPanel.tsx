/**
 * UploadPanel.tsx
 * Location: artifacts/mentorque-onboarding/src/components/resume/UploadPanel.tsx
 *
 * Sub-stage 1 of the Resume Revamp step.
 * Lets the user either drag-and-drop a PDF or paste plain text.
 */

import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileText, X, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { BlurFade, GlassButton } from "../ui/OnboardingUI";
import { MentorqueLoader } from "./MentorqueLoader";

interface UploadPanelProps {
  onParsed: (result: {
    parsedResume: any;
    questions: any[];
    rawText: string;
  }) => void;
  apiBaseUrl?: string;
}

type Tab = "upload" | "paste";

export function UploadPanel({ onParsed, apiBaseUrl = "" }: UploadPanelProps) {
  const [tab, setTab] = useState<Tab>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    if (f.type !== "application/pdf") {
      setError("Only PDF files are supported.");
      return;
    }
    setFile(f);
    setError(null);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, []);

  const canProceed = tab === "upload" ? !!file : text.trim().length > 100;

  const handleSubmit = async () => {
    setError(null);
    setLoading(true);
    try {
      let response: Response;

      if (tab === "upload" && file) {
        const formData = new FormData();
        formData.append("file", file);
        response = await fetch(`${apiBaseUrl}/api/resume-revamp/parse`, {
          method: "POST",
          body: formData,
        });
      } else {
        response = await fetch(`${apiBaseUrl}/api/resume-revamp/parse`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
      }

      if (!response.ok) {
        const err = (await response.json()) as { message?: string };
        throw new Error(err.message || "Failed to parse resume.");
      }

      const data = (await response.json()) as {
        parsedResume: any;
        questions: any[];
        rawText: string;
      };
      onParsed(data);
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full flex flex-col items-center space-y-12">
      {/* Header */}
      <div className="w-full flex flex-col items-center gap-4">
        <BlurFade delay={0.1} className="w-full">
          <p className="font-serif font-light text-4xl sm:text-5xl tracking-tight text-foreground text-center">
            Upload Your Current Resume
          </p>
        </BlurFade>
        <BlurFade delay={0.2} className="w-full">
          <p className="text-sm font-medium text-muted-foreground text-center max-w-lg mx-auto">
            We'll analyse it, ask a few quick questions, and generate a
            Mentorque-optimised version — with every change explained.
          </p>
        </BlurFade>
      </div>

      <div className="w-full max-w-2xl space-y-8">
        {loading ? (
          <div className="w-full min-h-[320px] rounded-2xl border border-blue-400/20 bg-blue-950/20 backdrop-blur-xl flex items-center justify-center">
            <MentorqueLoader size={170} />
          </div>
        ) : (
          <>
        {/* Tab switcher */}
        <BlurFade delay={0.3} className="w-full">
          <div className="flex justify-center">
            <div className="stepper-bar p-1 gap-1">
              {(["upload", "paste"] as Tab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setTab(t);
                    setError(null);
                  }}
                  className={cn("stepper-step px-8 py-2.5 justify-center", {
                    active: tab === t,
                  })}
                >
                  <span className="relative z-10 flex items-center gap-2">
                    {t === "upload" ? (
                      <Upload className="w-3.5 h-3.5" />
                    ) : (
                      <FileText className="w-3.5 h-3.5" />
                    )}
                    {t === "upload" ? "Upload PDF" : "Paste Text"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </BlurFade>

        <AnimatePresence mode="wait">
          {tab === "upload" ? (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="w-full"
            >
              <BlurFade delay={0.4} className="w-full">
                {/* Drop zone */}
                <div className="glass-textarea-wrap w-full">
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={onDrop}
                    onClick={() => !file && inputRef.current?.click()}
                    className={cn(
                      "glass-textarea relative flex flex-col !items-center !justify-center gap-4 rounded-2xl min-h-[260px] p-8",
                      "transition-all cursor-pointer select-none border-2 border-dashed",
                      isDragging
                        ? "border-primary bg-primary/5"
                        : file
                          ? "border-emerald-500/30 bg-emerald-500/5 cursor-default"
                          : "border-foreground/10 hover:border-foreground/20 bg-foreground/[0.02] hover:bg-foreground/[0.04]",
                    )}
                  >
                    <input
                      ref={inputRef}
                      type="file"
                      accept=".pdf,application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleFile(f);
                      }}
                    />

                    {file ? (
                      <motion.div
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        className="flex flex-col items-center gap-4"
                      >
                        <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                          <FileText className="w-8 h-8 text-emerald-500" />
                        </div>
                        <div className="text-center">
                          <p className="text-foreground font-semibold">
                            {file.name}
                          </p>
                          <p className="text-muted-foreground text-xs mt-1">
                            {(file.size / 1024).toFixed(0)} KB
                          </p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setFile(null);
                          }}
                          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-foreground/5 hover:bg-foreground/10 flex items-center justify-center transition-colors group"
                        >
                          <X className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
                        </button>
                      </motion.div>
                    ) : (
                      <>
                        <div className="w-16 h-16 rounded-2xl bg-foreground/5 border border-foreground/10 flex items-center justify-center">
                          <Upload className="w-8 h-8 text-muted-foreground" />
                        </div>
                        <div className="text-center space-y-2">
                          <p className="text-foreground font-semibold text-lg">
                            Drop your PDF here
                          </p>
                          <p className="text-muted-foreground text-sm">
                            or click to browse · PDF only · max 10 MB
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </BlurFade>
            </motion.div>
          ) : (
            <motion.div
              key="paste"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="w-full"
            >
              <BlurFade delay={0.4} className="w-full">
                <div className="relative w-full">
                  <AnimatePresence>
                    {text.length > 0 && (
                      <motion.div
                        initial={{ y: -10, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: -10, opacity: 0 }}
                        transition={{ duration: 0.3, delay: 0.1 }}
                        className="absolute -top-6 left-4 z-10"
                      >
                        <label className="text-xs text-muted-foreground font-semibold">
                          Resume text
                        </label>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <div className="glass-textarea-wrap w-full">
                    <div className="glass-textarea relative p-4 h-[260px] flex flex-col">
                      <textarea
                        value={text}
                        onChange={(e) => {
                          setText(e.target.value);
                          setError(null);
                        }}
                        placeholder="Paste the full text content of your resume here…"
                        className="w-full flex-1 bg-transparent text-foreground placeholder:text-muted-foreground/50
                                   text-base resize-none focus:outline-none transition-all leading-relaxed relative z-0
                                   [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']"
                      />
                      <div className="w-full flex justify-end pt-2">
                        <p className="text-muted-foreground/40 text-xs font-medium pointer-events-none">
                          {text.length} chars (need ≥ 100)
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </BlurFade>
            </motion.div>
          )}
        </AnimatePresence>

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

        {/* CTA & Skip */}
        <BlurFade delay={0.5} className="w-full">
          <div className="relative flex items-center justify-end pt-2 h-12">
            {/* Skip Button */}
            <button
              type="button"
              onClick={() =>
                onParsed({ parsedResume: null, questions: [], rawText: "" })
              }
              className={cn(
                "absolute left-0 text-sm text-foreground/70 hover:text-foreground transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] whitespace-nowrap z-0",
                loading
                  ? "opacity-0 -translate-x-4 pointer-events-none"
                  : "opacity-100 translate-x-0",
              )}
            >
              Skip this step
            </button>

            {/* Main Button */}
            <GlassButton
              disabled={!canProceed || loading}
              onClick={handleSubmit}
              contentClassName="w-full h-full flex items-center justify-center"
              className={cn(
                "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] relative z-10 overflow-hidden h-11 ml-auto",
                // Explicitly define the width to stop flex-collapse cropping
                loading ? "w-full" : "w-[200px] shrink-0",
                !canProceed && !loading && "opacity-40",
              )}
            >
              {/* CSS Grid stacking keeps everything inside the natural document flow & padding box */}
              <div className="grid [grid-template-areas:'stack'] place-items-center w-full">
                {/* Idle State */}
                <div
                  className={cn(
                    "[grid-area:stack] flex items-center justify-center gap-2 transition-all duration-500 whitespace-nowrap w-full",
                    loading
                      ? "opacity-0 translate-y-4 pointer-events-none"
                      : "opacity-100 translate-y-0",
                  )}
                >
                  Analyse Resume
                  <ChevronRight className="w-4 h-4" />
                </div>

                {/* Loading State */}
                <div
                  className={cn(
                    "[grid-area:stack] flex items-center justify-center transition-all duration-500 whitespace-nowrap w-full",
                    loading
                      ? "opacity-100 translate-y-0"
                      : "opacity-0 -translate-y-4 pointer-events-none",
                  )}
                >
                  {loading && <MentorqueLoader size={42} />}
                </div>
              </div>
            </GlassButton>
          </div>
        </BlurFade>
          </>
        )}
      </div>
    </div>
  );
}
