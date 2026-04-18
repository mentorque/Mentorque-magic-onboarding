import { useCallback, useEffect, useState } from "react";
import type { RouteComponentProps } from "wouter";
import { Eye, EyeOff, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { withApiBase } from "@/lib/apiBaseUrl";

type Row = {
  onboardingId: string;
  userId: string;
  userName: string;
  revealResume: boolean;
  inputStatus: string;
};

type ReviewerRole = "user" | "admin" | "mentor";

export function AdminOnboardingPanel(props: RouteComponentProps<{ token: string }>) {
  const adminToken = props.params.token;
  const [items, setItems] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nameByOnboarding, setNameByOnboarding] = useState<Record<string, string>>({});
  const [roleByOnboarding, setRoleByOnboarding] = useState<Record<string, ReviewerRole>>({});
  const [generated, setGenerated] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [revealTogglingId, setRevealTogglingId] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    const res = await fetch(withApiBase(`/api/onboarding/admin/${adminToken}/list`));
    const data = await res.json();
    if (!data?.success) throw new Error(data?.message ?? "Failed to load list.");
    setItems(data.items ?? []);
  }, [adminToken]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadList();
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Load failed.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadList]);

  const toggleReveal = async (onboardingId: string, next: boolean) => {
    setRevealTogglingId(onboardingId);
    setError(null);
    try {
      const res = await fetch(
        withApiBase(
          `/api/onboarding/admin/${adminToken}/submissions/${encodeURIComponent(onboardingId)}/reveal`,
        ),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revealResume: next }),
        },
      );
      const data = await res.json();
      if (!data?.success) throw new Error(data?.message ?? "Could not update reveal.");
      setItems((prev) =>
        prev.map((row) =>
          row.onboardingId === onboardingId ? { ...row, revealResume: next } : row,
        ),
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Reveal update failed.");
    } finally {
      setRevealTogglingId(null);
    }
  };

  const generateWildcard = async (onboardingId: string) => {
    const name = nameByOnboarding[onboardingId]?.trim();
    const role = roleByOnboarding[onboardingId] ?? "mentor";
    if (!name) {
      setError("Enter a display name for this wildcard.");
      return;
    }
    setSavingId(onboardingId);
    setError(null);
    try {
      const res = await fetch(
        withApiBase(`/api/onboarding/admin/${adminToken}/mentor-links`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ onboardingId, name, role }),
        },
      );
      const data = await res.json();
      if (!data?.success) throw new Error(data?.message ?? "Failed to create link.");
      const path = data.wildcardLink as string;
      const fullUrl = `${window.location.origin}${path}`;
      setGenerated((s) => ({ ...s, [onboardingId]: fullUrl }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <div className="relative min-h-[100dvh] w-full bg-background flex items-center justify-center overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(ellipse 80% 50% at 50% -20%, hsl(var(--primary) / 0.15), transparent 50%), radial-gradient(ellipse 60% 40% at 100% 50%, hsl(220 60% 25% / 0.12), transparent 45%)",
          }}
        />
        <p className="relative text-sm font-medium text-muted-foreground">Loading submissions…</p>
      </div>
    );
  }

  return (
    <div className="relative min-h-[100dvh] w-full bg-background text-foreground overflow-x-hidden overflow-y-auto">
      {/* Match onboarding ambient layers */}
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 90% 55% at 50% -15%, hsl(var(--primary) / 0.12), transparent 55%), radial-gradient(ellipse 70% 45% at 110% 20%, hsl(220 55% 28% / 0.1), transparent 50%), radial-gradient(ellipse 50% 40% at -10% 80%, hsl(200 45% 22% / 0.08), transparent 45%)",
        }}
      />
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[linear-gradient(180deg,hsl(var(--background))_0%,hsl(var(--background))_40%,hsl(222_47%_6%/0.97)_100%)]" />

      <div className="relative mx-auto w-full max-w-[min(100rem,calc(100vw-1.5rem))] px-3 py-10 sm:px-6 sm:py-14 lg:px-12">
        <header className="mb-10 flex flex-col items-center gap-3 text-center sm:mb-12">
          <div className="flex items-center gap-2 rounded-full border border-blue-400/25 bg-blue-950/30 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-sky-300/90 backdrop-blur-sm">
            <Sparkles className="h-3.5 w-3.5" />
            Admin
          </div>
          <h1 className="font-serif text-4xl font-light tracking-tight text-foreground sm:text-5xl">
            Onboarding
          </h1>
          <p className="max-w-xl text-sm font-medium text-muted-foreground">
            Submissions, reveal controls, and mentor wildcard links — same look as the main flow.
          </p>
        </header>

        {error && (
          <div className="mb-6 rounded-2xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-center text-sm text-red-200 backdrop-blur-sm">
            {error}
          </div>
        )}

        <div className="overflow-hidden rounded-[2rem] border border-blue-400/20 bg-blue-950/20 shadow-[0_8px_30px_rgba(0,0,0,0.35)] backdrop-blur-xl">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-black/20 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="max-w-[9rem] px-4 py-4 pl-6">Onboarding ID</th>
                  <th className="min-w-[10rem] px-4 py-4">User</th>
                  <th className="whitespace-nowrap px-4 py-4">Reveal</th>
                  <th className="whitespace-nowrap px-4 py-4">Input</th>
                  <th className="min-w-[14rem] px-4 py-4">Wildcard label</th>
                  <th className="min-w-[7rem] px-4 py-4">Role</th>
                  <th className="min-w-[12rem] px-4 py-4 pr-6">Wildcard</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-16 text-center text-muted-foreground">
                      No onboarding submissions yet.
                    </td>
                  </tr>
                ) : (
                  items.map((it) => (
                    <tr
                      key={it.onboardingId}
                      className="border-b border-white/5 transition-colors last:border-0 hover:bg-white/[0.03]"
                    >
                      <td className="max-w-[9rem] px-4 py-4 pl-6 font-mono text-xs text-foreground/90">
                        <span
                          className="block truncate"
                          title={it.onboardingId}
                        >
                          {it.onboardingId}
                        </span>
                      </td>
                      <td className="px-4 py-4 font-medium text-foreground">{it.userName}</td>
                      <td className="px-4 py-4">
                        <button
                          type="button"
                          disabled={revealTogglingId === it.onboardingId}
                          onClick={() => void toggleReveal(it.onboardingId, !it.revealResume)}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors",
                            it.revealResume
                              ? "border-amber-500/35 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20"
                              : "border-sky-500/40 bg-sky-500/15 text-sky-100 hover:bg-sky-500/25",
                            revealTogglingId === it.onboardingId && "opacity-50",
                          )}
                        >
                          {it.revealResume ? (
                            <>
                              <EyeOff className="h-3.5 w-3.5" /> Hide
                            </>
                          ) : (
                            <>
                              <Eye className="h-3.5 w-3.5" /> Reveal
                            </>
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {it.inputStatus}
                      </td>
                      <td className="px-4 py-3">
                        <input
                          className="w-full min-w-[12rem] rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none ring-0 transition-colors focus:border-blue-400/40 focus:bg-black/40"
                          placeholder="e.g. Mentor Jane"
                          value={nameByOnboarding[it.onboardingId] ?? ""}
                          onChange={(e) =>
                            setNameByOnboarding((s) => ({
                              ...s,
                              [it.onboardingId]: e.target.value,
                            }))
                          }
                        />
                      </td>
                      <td className="px-4 py-3">
                        <select
                          className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2 text-sm text-foreground outline-none focus:border-blue-400/40"
                          value={roleByOnboarding[it.onboardingId] ?? "mentor"}
                          onChange={(e) =>
                            setRoleByOnboarding((s) => ({
                              ...s,
                              [it.onboardingId]: e.target.value as ReviewerRole,
                            }))
                          }
                        >
                          <option value="mentor">mentor</option>
                          <option value="user">user</option>
                          <option value="admin">admin</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 pr-6">
                        <button
                          type="button"
                          disabled={savingId === it.onboardingId}
                          onClick={() => void generateWildcard(it.onboardingId)}
                          className="rounded-full border border-sky-500/40 bg-sky-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-sky-50 transition-colors hover:bg-sky-500/35 disabled:opacity-50"
                        >
                          {savingId === it.onboardingId ? "…" : "Generate link"}
                        </button>
                        {generated[it.onboardingId] && (
                          <p className="mt-2 max-w-xs break-all text-xs text-emerald-300/90">
                            {generated[it.onboardingId]}
                          </p>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
