import { useCallback, useEffect, useState } from "react";
import type { RouteComponentProps } from "wouter";
import { Eye, EyeOff, Sparkles, FileText, CheckCircle, RefreshCw, ExternalLink, Copy, Check, Loader2, Trash2, Calendar, User, ShieldCheck, Link2, Search, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { withApiBase } from "@/lib/apiBaseUrl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";

function ProgressBadge({
  progress,
  hasAiQuestions,
  hasQuestionnaireAnswers,
  hasRevampResult,
}: {
  progress: string;
  hasAiQuestions: boolean;
  hasQuestionnaireAnswers: boolean;
  hasRevampResult: boolean;
}) {
  const getVariant = (): "default" | "secondary" | "destructive" | "outline" => {
    switch (progress) {
      case "Input pending":
        return "destructive";
      case "Questionnaire generated":
      case "Form complete":
        return "secondary";
      case "Questionnaire answered":
        return "default";
      case "Revamp ready":
        return "default";
      default:
        return "outline";
    }
  };

  const getStyle = () => {
    switch (progress) {
      case "Input pending":
        return "bg-red-500/15 text-red-400 border-red-500/20";
      case "Questionnaire generated":
      case "Form complete":
        return "bg-amber-500/15 text-amber-400 border-amber-500/20";
      case "Questionnaire answered":
        return "bg-blue-500/15 text-blue-400 border-blue-500/20";
      case "Revamp ready":
        return "bg-emerald-500/15 text-emerald-400 border-emerald-500/20";
      default:
        return "bg-white/5 text-muted-foreground border-white/10";
    }
  };

  const Icon = progress === "Revamp ready" && hasRevampResult ? RefreshCw : 
                (progress === "Input pending" ? FileText : CheckCircle);

  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider",
        getStyle()
      )}
    >
      <Icon className={cn("h-3 w-3", progress === "Revamp ready" && hasRevampResult && "animate-spin-slow")} />
      {progress}
    </Badge>
  );
}

function HeaderInfo({ label, tooltip }: { label: string; tooltip: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      <Tooltip>
        <TooltipTrigger asChild>
          <Info className="h-3.5 w-3.5 cursor-help text-slate-600 transition-colors hover:text-slate-400" />
        </TooltipTrigger>
        <TooltipContent className="max-w-[200px] border-slate-700 bg-slate-900 text-[11px] text-slate-300 shadow-xl">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </span>
  );
}

type Row = {
  onboardingId: string;
  userId: string;
  userName: string;
  revealResume: boolean;
  progress: string;
  hasAiQuestions: boolean;
  hasQuestionnaireAnswers: boolean;
  hasRevampResult: boolean;
  updatedAt: string;
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
  const [searchQuery, setSearchQuery] = useState("");

  const filteredItems = searchQuery
    ? items.filter(
        (item) =>
          item.userName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.onboardingId.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : items;
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

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

  const deleteSubmission = async (onboardingId: string) => {
    if (!confirm("Are you sure you want to delete this onboarding submission? This action cannot be undone.")) {
      return;
    }
    setDeletingId(onboardingId);
    setError(null);
    try {
      const res = await fetch(
        withApiBase(`/api/onboarding/admin/${adminToken}/submissions/${encodeURIComponent(onboardingId)}`),
        { method: "DELETE" },
      );
      const data = await res.json();
      if (!data?.success) throw new Error(data?.message ?? "Failed to delete submission.");
      setItems((prev) => prev.filter((row) => row.onboardingId !== onboardingId));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setDeletingId(null);
    }
  };

  const copyToClipboard = (onboardingId: string, url: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(onboardingId);
      setTimeout(() => setCopiedId(null), 2000);
    });
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
    <div className="min-h-[100dvh] w-full bg-[#0a0a0b] text-slate-200">
      <div className="mx-auto w-full max-w-[min(120rem,calc(100vw-2rem))] px-4 py-8 sm:px-6">
        <header className="mb-8 flex flex-col items-start justify-between gap-4 border-b border-white/10 pb-6 md:flex-row md:items-center">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-sky-400" />
              <span className="text-xs font-bold uppercase tracking-widest text-sky-400">Admin Dashboard</span>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-white">
              Onboarding Submissions
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <Input
                placeholder="Search by name or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 w-64 border-white/10 bg-black/40 pl-10 text-sm text-white placeholder:text-slate-600 focus:border-sky-500/50"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => void loadList()}
              disabled={loading}
              className="h-10 gap-2 border-white/20 bg-white/5 text-white hover:bg-white/10"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </header>

        {error && (
          <div className="mb-6 flex items-center gap-3 rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <span className="font-bold">Error:</span>
            {error}
          </div>
        )}

        <div className="rounded-xl border border-white/10 bg-[#111114] shadow-2xl">
          <div className="overflow-x-auto">
            <TooltipProvider delayDuration={200}>
              <Table>
                <TableHeader className="bg-white/[0.03]">
                  <TableRow className="border-white/10 hover:bg-transparent">
                    <TableHead className="h-12 whitespace-nowrap px-4 text-xs font-bold uppercase tracking-wider text-slate-400">
                      <HeaderInfo label="ID / Date" tooltip="Unique submission ID and last update timestamp" />
                    </TableHead>
                    <TableHead className="h-12 whitespace-nowrap px-4 text-xs font-bold uppercase tracking-wider text-slate-400">
                      <HeaderInfo label="User" tooltip="Name from Google OAuth login" />
                    </TableHead>
                    <TableHead className="h-12 whitespace-nowrap px-4 text-xs font-bold uppercase tracking-wider text-slate-400">
                      <HeaderInfo label="Status" tooltip="Form completion stage" />
                    </TableHead>
                    <TableHead className="h-12 whitespace-nowrap px-4 text-xs font-bold uppercase tracking-wider text-slate-400 text-center">
                      <HeaderInfo label="Resume" tooltip="Toggle to show/hide AI revamp from user" />
                    </TableHead>
                    <TableHead className="h-12 px-4 text-xs font-bold uppercase tracking-wider text-slate-400">
                      <HeaderInfo label="Mentor Link Configuration" tooltip="Create invite links for mentors/admin to review" />
                    </TableHead>
                    <TableHead className="h-12 px-4 text-right text-xs font-bold uppercase tracking-wider text-slate-400">
                      <HeaderInfo label="Actions" tooltip="Manage individual submissions" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
              <TableBody>
                {filteredItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-48 text-center text-slate-500">
                      {searchQuery ? "No matching submissions found." : "No submissions found."}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredItems.map((it) => (
                    <TableRow key={it.onboardingId} className="border-white/5 transition-colors hover:bg-white/[0.02]">
                      <TableCell className="px-4 py-4">
                        <div className="flex flex-col gap-1">
                          <span className="font-mono text-xs font-medium text-slate-300" title={it.onboardingId}>
                            {it.onboardingId.slice(0, 12)}...
                          </span>
                          <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
                            <Calendar className="h-3 w-3" />
                            {it.updatedAt ? new Date(it.updatedAt).toLocaleString("en-US", {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                              second: "2-digit",
                              hour12: true,
                            }) : 'No date'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-slate-800 text-slate-400 border border-slate-700">
                            <User className="h-4 w-4" />
                          </div>
                          <span className="font-medium text-white">{it.userName}</span>
                        </div>
                      </TableCell>
                      <TableCell className="px-4 py-4">
                        <ProgressBadge
                          progress={it.progress}
                          hasAiQuestions={it.hasAiQuestions}
                          hasQuestionnaireAnswers={it.hasQuestionnaireAnswers}
                          hasRevampResult={it.hasRevampResult}
                        />
                      </TableCell>
                      <TableCell className="px-4 py-4 text-center">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={revealTogglingId === it.onboardingId}
                          onClick={() => void toggleReveal(it.onboardingId, !it.revealResume)}
                          className={cn(
                            "h-8 gap-2 border px-3 text-xs font-semibold transition-all",
                            it.revealResume
                              ? "border-amber-500/30 bg-amber-500/5 text-amber-300 hover:bg-amber-500/20"
                              : "border-sky-500/30 bg-sky-500/5 text-sky-300 hover:bg-sky-500/20",
                            revealTogglingId === it.onboardingId && "opacity-50"
                          )}
                        >
                          {it.revealResume ? (
                            <>
                              <EyeOff className="h-3.5 w-3.5" />
                              Hide
                            </>
                          ) : (
                            <>
                              <Eye className="h-3.5 w-3.5" />
                              Reveal
                            </>
                          )}
                        </Button>
                      </TableCell>
                      <TableCell className="px-4 py-4">
                        <div className="flex flex-col gap-3">
                          <div className="flex items-center gap-2">
                            <Input
                              placeholder="Label (e.g. Mentor Name)"
                              value={nameByOnboarding[it.onboardingId] ?? ""}
                              onChange={(e) => setNameByOnboarding(s => ({ ...s, [it.onboardingId]: e.target.value }))}
                              className="h-9 border-white/10 bg-black/40 text-sm text-white placeholder:text-slate-600 focus:border-sky-500/50"
                            />
                            <Select
                              value={roleByOnboarding[it.onboardingId] ?? "mentor"}
                              onValueChange={(val) => setRoleByOnboarding(s => ({ ...s, [it.onboardingId]: val as ReviewerRole }))}
                            >
                              <SelectTrigger className="h-9 w-[110px] border-white/10 bg-black/40 text-xs font-medium">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="border-white/10 bg-[#1a1a1e] text-slate-200">
                                <SelectItem value="mentor">Mentor</SelectItem>
                                <SelectItem value="user">User</SelectItem>
                                <SelectItem value="admin">Admin</SelectItem>
                              </SelectContent>
                            </Select>
                            <Button
                              size="sm"
                              disabled={savingId === it.onboardingId}
                              onClick={() => void generateWildcard(it.onboardingId)}
                              className="h-9 bg-sky-600 px-4 text-xs font-bold text-white hover:bg-sky-500"
                            >
                              {savingId === it.onboardingId ? <Loader2 className="h-4 w-4 animate-spin" /> : "Generate"}
                            </Button>
                          </div>
                          
                          {generated[it.onboardingId] && (
                            <div className="flex items-center gap-2 rounded border border-emerald-500/30 bg-emerald-500/5 p-2">
                              <span className="flex-1 font-mono text-xs text-emerald-400 overflow-hidden text-ellipsis">
                                {generated[it.onboardingId]}
                              </span>
                              <div className="flex gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-emerald-400 hover:bg-emerald-500/20"
                                  onClick={() => copyToClipboard(it.onboardingId, generated[it.onboardingId])}
                                  title="Copy Link"
                                >
                                  {copiedId === it.onboardingId ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  asChild
                                  className="h-7 w-7 text-emerald-400 hover:bg-emerald-500/20"
                                  title="Open Link"
                                >
                                  <a href={generated[it.onboardingId]} target="_blank" rel="noopener noreferrer">
                                    <ExternalLink className="h-4 w-4" />
                                  </a>
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="px-4 py-4 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={deletingId === it.onboardingId}
                          onClick={() => void deleteSubmission(it.onboardingId)}
                          className="h-9 w-9 text-slate-500 hover:bg-red-500/10 hover:text-red-400"
                          title="Delete submission"
                        >
                          {deletingId === it.onboardingId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TooltipProvider>
        </div>
      </div>
    </div>
  </div>
);
}
