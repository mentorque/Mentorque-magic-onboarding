import { useEffect, useState, type ReactNode } from "react";
import { useAuthStore } from "@/store/useAuthStore";
import { GradientBackground } from "@/components/GradientBackground";
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

/** Matches `OnboardingFlow` main pane: `bg-card` + `GradientBackground` behind content. */
function RevampSpaceShell({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background text-foreground flex h-screen w-screen flex-col overflow-hidden">
      <div className="relative flex min-h-0 w-full flex-1 items-stretch justify-start overflow-hidden bg-card">
        <div className="absolute inset-0 z-0">
          <GradientBackground />
        </div>
        <div className="relative z-10 flex min-h-0 w-full flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}

export function RevampSpacePage() {
  const firebaseToken = useAuthStore((s) => s.token);
  const [phase, setPhase] = useState<"loading" | "auth" | "denied" | "ready">("loading");
  const [parsedResume, setParsedResume] = useState<unknown>(null);
  const [revampResult, setRevampResult] = useState<RevampResult | null>(null);
  const [annotation, setAnnotation] = useState<RevampSpaceAnnotation | null>(null);
  const [accessToken, setAccessToken] = useState("");

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const mentorToken =
        typeof window !== "undefined" ? localStorage.getItem(LS_ACCESS_TOKEN)?.trim() : "";
      const token = mentorToken || firebaseToken?.trim() || "";
      if (!cancelled) setAccessToken(token);

      if (!token) {
        if (!cancelled) setAccessToken("");
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
      <RevampSpaceShell>
        <div className="flex flex-1 flex-col items-center justify-center px-6">
          <p className="text-sm font-medium text-muted-foreground">Loading…</p>
        </div>
      </RevampSpaceShell>
    );
  }

  if (phase === "auth") {
    return (
      <RevampSpaceShell>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-sm text-muted-foreground">
            Sign in or open a valid access link to continue.
          </p>
          <button
            type="button"
            className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-medium text-foreground hover:bg-primary/15"
            onClick={() => {
              window.location.href = "/";
            }}
          >
            Go to home
          </button>
        </div>
      </RevampSpaceShell>
    );
  }

  if (phase === "denied" || !revampResult || parsedResume == null) {
    return (
      <RevampSpaceShell>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-sm font-medium text-foreground">Revamp space unavailable</p>
          <p className="max-w-md text-xs text-muted-foreground">
            For owners: your revamped resume must be revealed and your profile complete. For reviewers:
            use the link from the admin panel.
          </p>
          <button
            type="button"
            className="mt-2 text-sm text-primary hover:underline"
            onClick={() => {
              window.location.href = "/";
            }}
          >
            Back to home
          </button>
        </div>
      </RevampSpaceShell>
    );
  }

  return (
    <RevampSpaceShell>
      <div className="relative mx-auto flex h-full min-h-0 w-full max-w-[1600px] flex-1 flex-col overflow-hidden px-6 pb-2 pt-4">
        <ComparisonView
          originalResume={parsedResume}
          revampedResume={revampResult.revampedResume}
          changes={revampResult.changes}
          compiledPdfUrl={revampResult.compiledPdfUrl}
          apiBaseUrl={API_BASE_URL}
          annotation={pdfAnnotation}
          authToken={accessToken}
        />
      </div>
    </RevampSpaceShell>
  );
}
