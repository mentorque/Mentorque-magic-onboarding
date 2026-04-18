import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/useAuthStore";
import { API_BASE_URL, withApiBase } from "@/lib/apiBaseUrl";
import { ComparisonView } from "@/components/resume/ComparisonView";
import type { RevampResult } from "@/lib/resumeRevampTypes";
import type { AnnotationAttribution } from "@/components/resume/PdfAnnotator";

const LS_ACCESS_TOKEN = "onboardingAccessToken";
const LS_ACCESS_PAYLOAD = "onboardingAccessPayload";

type RevampSpaceAnnotation = {
  displayName: string;
  role: string;
  onboardingId: string;
  reviewerId: string | null;
};

export function RevampSpacePage() {
  const firebaseToken = useAuthStore((s) => s.token);
  const [phase, setPhase] = useState<"loading" | "auth" | "denied" | "ready">("loading");
  const [parsedResume, setParsedResume] = useState<unknown>(null);
  const [revampResult, setRevampResult] = useState<RevampResult | null>(null);
  const [annotation, setAnnotation] = useState<RevampSpaceAnnotation | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const mentorToken =
        typeof window !== "undefined" ? localStorage.getItem(LS_ACCESS_TOKEN)?.trim() : "";
      const token = mentorToken || firebaseToken?.trim() || "";

      if (!token) {
        setPhase("auth");
        return;
      }

      setPhase("loading");
      try {
        const res = await fetch(withApiBase("/api/onboarding/revamp-space-data"), {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 401) {
          if (!cancelled) setPhase("auth");
          return;
        }
        if (res.status === 403) {
          if (!cancelled) setPhase("denied");
          return;
        }
        const data = (await res.json()) as {
          success?: boolean;
          submission?: {
            parsedResume?: unknown;
            revampResult?: RevampResult | null;
          } | null;
          annotation?: RevampSpaceAnnotation;
        };
        const sub = data.submission;
        if (
          !data.success ||
          !sub ||
          sub.parsedResume == null ||
          sub.revampResult == null
        ) {
          if (!cancelled) setPhase("denied");
          return;
        }
        if (cancelled) return;
        setParsedResume(sub.parsedResume);
        setRevampResult(sub.revampResult);
        if (data.annotation) {
          setAnnotation(data.annotation);
        } else if (typeof window !== "undefined") {
          try {
            const raw = localStorage.getItem(LS_ACCESS_PAYLOAD);
            if (raw) {
              const p = JSON.parse(raw) as {
                onboardingId?: string;
                reviewerId?: string;
                role?: string;
                name?: string;
              };
              if (p.onboardingId && p.reviewerId && p.name) {
                setAnnotation({
                  displayName: p.name,
                  role: p.role ?? "mentor",
                  onboardingId: p.onboardingId,
                  reviewerId: p.reviewerId,
                });
              }
            }
          } catch {
            /* ignore */
          }
        }
        setPhase("ready");
      } catch {
        if (!cancelled) setPhase("denied");
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [firebaseToken]);

  const pdfAnnotation: AnnotationAttribution | null = annotation
    ? {
        displayName: annotation.displayName,
        role: annotation.role,
        onboardingId: annotation.onboardingId,
        reviewerId: annotation.reviewerId,
      }
    : null;

  if (phase === "loading") {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950 text-zinc-200">
        <p className="text-sm text-zinc-400">Loading…</p>
      </div>
    );
  }

  if (phase === "auth") {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-zinc-950 px-6 text-center text-zinc-200">
        <p className="text-sm text-zinc-400">Sign in or open a valid access link to continue.</p>
        <button
          type="button"
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
          onClick={() => {
            window.location.href = "/";
          }}
        >
          Go to home
        </button>
      </div>
    );
  }

  if (phase === "denied" || !revampResult || parsedResume == null) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-2 bg-zinc-950 px-6 text-center text-zinc-200">
        <p className="text-sm font-medium text-zinc-300">Revamp space unavailable</p>
        <p className="max-w-md text-xs text-zinc-500">
          For owners: your revamped resume must be revealed and your profile complete. For reviewers:
          use the link from the admin panel.
        </p>
        <button
          type="button"
          className="mt-2 text-xs text-sky-400 hover:underline"
          onClick={() => {
            window.location.href = "/";
          }}
        >
          Back to home
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-background">
      <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col">
        <ComparisonView
          originalResume={parsedResume}
          revampedResume={revampResult.revampedResume}
          changes={revampResult.changes}
          compiledPdfUrl={revampResult.compiledPdfUrl}
          apiBaseUrl={API_BASE_URL}
          annotation={pdfAnnotation}
        />
      </div>
    </div>
  );
}
