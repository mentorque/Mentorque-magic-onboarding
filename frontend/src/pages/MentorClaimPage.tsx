import { useEffect, useState } from "react";
import type { RouteComponentProps } from "wouter";
import { withApiBase } from "@/lib/apiBaseUrl";

const LS_ACCESS_TOKEN = "onboardingAccessToken";
const LS_ACCESS_PAYLOAD = "onboardingAccessPayload";

export function MentorClaimPage(props: RouteComponentProps<{ inviteToken: string }>) {
  const inviteToken = props.params.inviteToken;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(withApiBase("/api/onboarding/mentor/claim"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inviteToken }),
        });
        const data = await res.json();
        if (!data?.success) throw new Error(data?.message ?? "Claim failed.");
        if (cancelled) return;
        localStorage.setItem(LS_ACCESS_TOKEN, data.token);
        localStorage.setItem(LS_ACCESS_PAYLOAD, JSON.stringify(data.payload));
        window.location.href = "/revamp-space";
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Something went wrong.");
      }
    })();
    return () => { cancelled = true; };
  }, [inviteToken]);

  if (error) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-red-500/30 bg-zinc-900/60 p-8 text-center space-y-3">
          <p className="text-sm text-red-400">{error}</p>
          <p className="text-xs text-zinc-500">This link may be invalid or expired.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 text-center space-y-3">
        <p className="text-sm text-zinc-400">Opening…</p>
      </div>
    </div>
  );
}
