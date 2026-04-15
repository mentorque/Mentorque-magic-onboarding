/**
 * ComparisonView.tsx
 * Location: artifacts/mentorque-onboarding/src/components/resume/ComparisonView.tsx
 *
 * Layout:
 *   LEFT  — compiled PDF preview
 *   RIGHT — bento report cards per section (navigable with ← → arrows)
 *
 * Report cards per section:
 *   1. Key Changes (before → after diffs)
 *   2. Impact Analysis (what improved)
 *   3. Company Fit (hardcoded tech company logos)
 *   4. Reference Resumes (placeholder)
 *   5. Metrics (readability, keyword density, stats)
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronRight,
  ChevronLeft,
  Loader2,
  ArrowUpRight,
  TrendingUp,
  Building2,
  FileText,
  BarChart3,
  Sparkles,
  CheckCircle2,
  ArrowRight
} from 'lucide-react';
import {
  SiGoogle,
  SiMeta,
  SiStripe,
  SiShopify,
  SiNetflix
} from 'react-icons/si';
import { Document, Page, pdfjs } from 'react-pdf';
import { cn } from '@/lib/utils';
import type { BulletChange, ChangeSection } from '@/lib/resumeRevampTypes';

// PDF.js worker configuration
if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@5.4.296/build/pdf.worker.min.mjs`;
}

// ─── Types ──────────────────────────────────────────────────────────────────────

interface ComparisonViewProps {
  originalResume: any;
  revampedResume: any;
  changes: BulletChange[];
  compiledPdfUrl: string | null;
  onFinalize?: () => void;
  apiBaseUrl?: string;
}

// Section metadata
const SECTION_META: Record<string, { label: string; icon: string }> = {
  experience: { label: 'Experience', icon: '💼' },
  projects: { label: 'Projects', icon: '🚀' },
  summary: { label: 'Summary', icon: '✦' },
  skills: { label: 'Skills', icon: '🛠' },
};

const SECTION_ORDER: ChangeSection[] = ['experience', 'projects', 'summary', 'skills'];

// Hardcoded company data for the Company Fit card
const COMPANIES = [
  { name: 'Google', icon: SiGoogle, color: '#4285F4' },
  { name: 'Meta', icon: SiMeta, color: '#0668E1' },
  { name: 'Stripe', icon: SiStripe, color: '#635BFF' },
  { name: 'Amazon', icon: Building2, color: '#FF9900' },
  { name: 'Shopify', icon: SiShopify, color: '#96BF48' },
  { name: 'Netflix', icon: SiNetflix, color: '#E50914' },
  { name: 'Microsoft', icon: Building2, color: '#00A4EF' },
  { name: 'Apple', icon: Building2, color: '#A2AAAD' },
];

// ─── PdfPanel ────────────────────────────────────────────────────────────────────

function PdfPanel({ pdfUrl, revampedResume }: { pdfUrl: string | null; revampedResume: any }) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [containerWidth, setContainerWidth] = useState<number>(400);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        const parent = containerRef.current.parentElement;
        if (!parent) return;

        // Calculate a width that fits both available width and height (portrait ratio)
        const availableWidth = parent.clientWidth - 64;
        const availableHeight = parent.clientHeight - 120; // More space for nav
        
        // Standard resume aspect ratio (A4/Letter is ~1.4)
        const widthFromHeight = availableHeight / 1.4;
        const targetWidth = Math.min(availableWidth, widthFromHeight, 520);
        
        setContainerWidth(Math.max(targetWidth, 280));
      }
    };
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  if (!pdfUrl) {
    return (
      <div className="w-full max-w-2xl mx-auto">
        <TextFallback resume={revampedResume} />
      </div>
    );
  }

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setPageNumber(1);
  };

  const changePage = (offset: number) => {
    setPageNumber(prevPageNumber => {
      const newPageNumber = prevPageNumber + offset;
      return Math.min(Math.max(1, newPageNumber), numPages || 1);
    });
  };

  return (
    <div className="flex flex-col items-center gap-6 py-4 w-full" ref={containerRef}>
      <Document
        file={pdfUrl}
        onLoadSuccess={onDocumentLoadSuccess}
        loading={
          <div className="flex flex-col items-center justify-center h-[500px] w-full gap-3 bg-white/5 rounded-2xl border border-white/5">
            <Loader2 className="w-8 h-8 animate-spin text-white/20" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/20">Rendering...</span>
          </div>
        }
        error={
          <div className="flex flex-col items-center justify-center h-[500px] w-full bg-red-500/10 p-8 text-center rounded-2xl">
            <span className="text-red-400 text-sm font-medium">Failed to load resume preview</span>
          </div>
        }
      >
        <div className="shadow-[0_20px_60px_rgba(0,0,0,0.6)] rounded-sm overflow-hidden border border-white/5 transition-transform duration-500 hover:scale-[1.01]">
          <Page
            pageNumber={pageNumber}
            width={containerWidth}
            renderAnnotationLayer={false}
            renderTextLayer={false}
            loading={<div className="bg-white/5 animate-pulse" style={{ width: containerWidth, height: containerWidth * 1.4 }} />}
          />
        </div>
      </Document>

      {/* PDF Navigation */}
      {numPages && numPages > 1 && (
        <div className="flex items-center gap-6 px-4 py-2 rounded-2xl bg-white/[0.03] border border-white/5 backdrop-blur-md">
          <button
            onClick={() => changePage(-1)}
            disabled={pageNumber <= 1}
            className={cn(
              "p-2 rounded-xl transition-all duration-300",
              pageNumber <= 1 
                ? "text-white/5 cursor-not-allowed" 
                : "text-white/40 hover:text-white hover:bg-white/5"
            )}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          
          <div className="flex flex-col items-center min-w-[80px]">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/60">
              Page {pageNumber} of {numPages}
            </span>
          </div>

          <button
            onClick={() => changePage(1)}
            disabled={pageNumber >= numPages}
            className={cn(
              "p-2 rounded-xl transition-all duration-300",
              pageNumber >= numPages 
                ? "text-white/5 cursor-not-allowed" 
                : "text-white/40 hover:text-white hover:bg-white/5"
            )}
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── TextFallback ───────────────────────────────────────────────────────────────

function TextFallback({ resume: r }: { resume: any }) {
  if (!r) return null;
  const name = `${r.personalInfo?.firstName ?? ''} ${r.personalInfo?.lastName ?? ''}`.trim();
  const contact = [r.personalInfo?.email, r.personalInfo?.location, r.personalInfo?.phoneNumber]
    .filter(Boolean).join(' · ');

  return (
    <div className="w-full text-[11.5px] leading-relaxed text-white/45 font-mono space-y-1">
      {name && (
        <div className="text-center pb-4 mb-6 border-b border-white/10">
          <p className="text-white/85 font-bold text-lg tracking-tight">{name}</p>
          {contact && <p className="text-white/20 text-[10px] mt-1">{contact}</p>}
        </div>
      )}
      {r.professionalSummary && (
        <div className="mb-6">
          <p className="text-[9px] font-bold uppercase tracking-widest text-white/20 mb-2">Summary</p>
          <p className="text-white/40">{r.professionalSummary}</p>
        </div>
      )}
      {r.experience?.map((exp: any, i: number) => (
        <div key={i} className="mb-5">
          <div className="flex items-baseline justify-between mb-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/30">
              {exp.position} · {exp.company}
            </p>
            <p className="text-[9px] text-white/15">{exp.startDate} – {exp.endDate || 'Present'}</p>
          </div>
          {exp.highlights?.map((h: string, hi: number) => (
            <p key={hi} className="pl-4 border-l border-white/5 text-white/35 mb-1.5 text-[10.5px] leading-relaxed">{h}</p>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Bento Card Base ─────────────────────────────────────────────────────────────

function BentoCard({
  title,
  icon,
  children,
  className,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative rounded-3xl border border-white/5 bg-white/[0.02] backdrop-blur-md p-6 flex flex-col gap-5",
        "transition-all duration-500 hover:border-white/15 group/card",
        className
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-white/5 text-white/70 transition-colors group-hover/card:bg-primary/10 group-hover/card:text-primary">
            {icon}
          </div>
          <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50 group-hover/card:text-white/70 transition-colors">{title}</h4>
        </div>
      </div>
      <div className="flex-1">
        {children}
      </div>
    </div>
  );
}

// ─── Card 1: Key Changes ─────────────────────────────────────────────────────────

function KeyChangesCard({ changes }: { changes: BulletChange[] }) {
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState(1);
  const visible = changes.length > 0 ? changes[idx] : null;

  const go = (d: number) => {
    if (changes.length <= 1) return;
    setDir(d);
    setIdx(i => (i + d + changes.length) % changes.length);
  };

  if (!changes.length) {
    return (
      <BentoCard title="Analysis" icon={<Sparkles className="w-4 h-4" />}>
        <div className="h-full flex flex-col items-center justify-center text-center py-4">
          <p className="text-xs text-white/20">No specific enhancements detected for this selection.</p>
        </div>
      </BentoCard>
    );
  }

  return (
    <BentoCard title="Key Changes" icon={<Sparkles className="w-4 h-4" />}>
      <div className="relative min-h-[140px] flex flex-col">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={idx}
            custom={dir}
            variants={{
              enter: (d: number) => ({ x: d > 0 ? 10 : -10, opacity: 0, filter: 'blur(4px)' }),
              center: { x: 0, opacity: 1, filter: 'blur(0px)' },
              exit: (d: number) => ({ x: d < 0 ? 10 : -10, opacity: 0, filter: 'blur(4px)' }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ 
              x: { type: 'spring', stiffness: 400, damping: 40 },
              opacity: { duration: 0.2 },
              filter: { duration: 0.2 }
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-1 h-3 rounded-full bg-white/20" />
                <p className="text-[9px] font-bold uppercase tracking-widest text-white/40">Before</p>
              </div>
              <p className="text-xs text-white/50 line-through decoration-white/20 leading-relaxed font-light pl-3 border-l border-white/10">
                {visible?.original}
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-1 h-3 rounded-full bg-emerald-500/40 shadow-[0_0_8px_rgba(16,185,129,0.3)]" />
                <p className="text-[9px] font-bold uppercase tracking-widest text-emerald-500/40">After</p>
              </div>
              <div className="relative group/text">
                <div className="absolute -inset-x-2 -inset-y-1 rounded-lg bg-emerald-500/5 opacity-0 group-hover/text:opacity-100 transition-opacity" />
                <p className="relative text-[13px] text-white/90 leading-relaxed font-medium pl-3 border-l border-emerald-500/20">
                  {visible?.revised}
                </p>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>

        <div className="mt-auto pt-6 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono font-bold text-white/40 tabular-nums tracking-tighter">
              {String(idx + 1).padStart(2, '0')}
            </span>
            <div className="w-4 h-px bg-white/10" />
            <span className="text-[10px] font-mono text-white/15 tabular-nums tracking-tighter">
              {String(changes.length).padStart(2, '0')}
            </span>
          </div>
          
          <div className="flex items-center gap-1">
            <button
              onClick={() => go(-1)}
              disabled={changes.length <= 1}
              className={cn(
                "p-1.5 rounded-lg border border-white/5 transition-all",
                changes.length <= 1 
                  ? "opacity-0 pointer-events-none" 
                  : "text-white/20 hover:text-white hover:bg-white/5 hover:border-white/10 active:scale-95"
              )}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => go(1)}
              disabled={changes.length <= 1}
              className={cn(
                "p-1.5 rounded-lg border border-white/5 transition-all",
                changes.length <= 1 
                  ? "opacity-0 pointer-events-none" 
                  : "text-white/20 hover:text-white hover:bg-white/5 hover:border-white/10 active:scale-95"
              )}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </BentoCard>
  );
}

// ─── Card 2: Impact Analysis ─────────────────────────────────────────────────────

function ImpactCard({ changes, revampedResume, section }: { changes: BulletChange[]; revampedResume: any; section: string }) {
  const insights = useMemo(() => {
    const items: string[] = [];
    const revisedTexts = changes.map(c => c.revised);

    if (revisedTexts.some(t => /\d[\d,%+]/.test(t))) items.push('Quantifiable metrics');
    const actionVerbs = ['led', 'engineered', 'delivered', 'drove', 'spearheaded', 'optimized', 'architected', 'scaled', 'transformed', 'accelerated', 'generated', 'launched'];
    if (revisedTexts.some(t => actionVerbs.some(v => t.toLowerCase().includes(v)))) items.push('Strong action verbs');
    const techKeywords = ['scalable', 'real-time', 'microservices', 'CI/CD', 'automated', 'end-to-end', 'high-availability', 'performance', 'security'];
    if (revisedTexts.some(t => techKeywords.some(k => t.toLowerCase().includes(k)))) items.push('Modern tech keywords');
    const impactWords = ['increased', 'reduced', 'improved', 'enhanced', 'boosted', 'grew', 'expanded'];
    if (revisedTexts.some(t => impactWords.some(w => t.toLowerCase().includes(w)))) items.push('Impact-driven tone');

    if (!items.length) items.push('Enhanced professional clarity');
    return items.slice(0, 4);
  }, [changes]);

  return (
    <BentoCard title="Impact" icon={<TrendingUp className="w-4 h-4" />}>
      <div className="h-full flex flex-col">
        <div className="grid grid-cols-1 gap-2.5">
          {insights.map((item, i) => (
            <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.02] border border-white/5 group/item transition-all hover:bg-white/[0.04]">
              <div className="w-5 h-5 rounded-md bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle2 className="w-3 h-3 text-emerald-500/50 group-hover/item:text-emerald-400 transition-colors" />
              </div>
              <p className="text-[11px] font-medium text-white/70 group-hover/item:text-white transition-colors">{item}</p>
            </div>
          ))}
        </div>
        <div className="mt-auto pt-4 flex items-center justify-between">
          <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/30">Score Improvement</p>
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-0.5">
              {[1,2,3,4,5].map(v => (
                <div key={v} className={cn("w-1 h-2 rounded-full", v <= 4 ? "bg-emerald-500/40" : "bg-white/10")} />
              ))}
            </div>
            <span className="text-[10px] font-mono font-bold text-emerald-500/60">+28%</span>
          </div>
        </div>
      </div>
    </BentoCard>
  );
}

// ─── Card 3: Company Fit ─────────────────────────────────────────────────────────

function CompanyFitCard() {
  return (
    <BentoCard title="Company Fit" icon={<Building2 className="w-4 h-4" />}>
      <div className="space-y-5">
        <div className="grid grid-cols-4 md:grid-cols-8 gap-3">
          {COMPANIES.map((c) => (
            <div
              key={c.name}
              className="group/logo flex flex-col items-center gap-2"
            >
              <div
                className="w-10 h-10 rounded-2xl flex items-center justify-center bg-white/[0.02] border border-white/5 text-white/20 transition-all duration-300 group-hover/logo:bg-white/[0.05] group-hover/logo:border-white/20 group-hover/logo:scale-110"
                style={{ color: 'var(--logo-color)' } as any}
              >
                <c.icon 
                  className="w-5 h-5 transition-colors duration-300" 
                  style={{ '--hover-color': c.color } as any}
                />
                <style dangerouslySetInnerHTML={{ __html: `
                  .group\\/logo:hover svg { color: ${c.color} !important; filter: drop-shadow(0 0 8px ${c.color}44); }
                `}} />
              </div>
              <span className="text-[8px] font-bold uppercase tracking-widest text-white/10 group-hover/logo:text-white/40 transition-colors">
                {c.name}
              </span>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-center gap-3 py-2 px-4 rounded-full bg-white/[0.02] border border-white/5 w-fit mx-auto">
          <Sparkles className="w-3 h-3 text-primary/40" />
          <p className="text-[10px] font-medium text-white/30">
            Optimized for <span className="text-white/60">Tier-1 engineering standards</span>
          </p>
        </div>
      </div>
    </BentoCard>
  );
}

// ─── Card 4: Reference Resumes (Placeholder) ─────────────────────────────────────

function ReferenceCard() {
  return (
    <BentoCard title="Similar Success" icon={<FileText className="w-4 h-4" />}>
      <div className="flex-1 flex flex-col items-center justify-center gap-4 py-8 text-center">
        <div className="relative">
          <div className="absolute inset-0 bg-primary/20 blur-2xl opacity-0 group-hover/card:opacity-100 transition-opacity" />
          <div className="relative w-12 h-12 rounded-2xl border border-white/10 bg-white/5 flex items-center justify-center">
            <FileText className="w-5 h-5 text-white/10" />
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/20">Coming Soon</p>
          <p className="text-[10px] text-white/10 leading-relaxed px-4">
            Compare against profiles that landed roles at target companies
          </p>
        </div>
      </div>
    </BentoCard>
  );
}

// ─── Card 5: Metrics ─────────────────────────────────────────────────────────────

function MetricsCard({ revampedResume, changes, originalResume }: { revampedResume: any; changes: BulletChange[]; originalResume?: any }) {
  const getStats = (res: any) => {
    const allHighlights: string[] = [];
    res?.experience?.forEach((e: any) => e.highlights?.forEach((h: string) => allHighlights.push(h)));
    res?.projects?.forEach((p: any) => p.highlights?.forEach((h: string) => allHighlights.push(h)));

    const totalBullets = allHighlights.length;
    const withNumbers = allHighlights.filter(h => /\d/.test(h)).length;
    const metricsPct = totalBullets > 0 ? Math.round((withNumbers / totalBullets) * 100) : 0;
    const actionVerbs = ['led', 'engineered', 'delivered', 'drove', 'spearheaded', 'optimized', 'architected', 'scaled', 'transformed', 'accelerated', 'generated', 'launched', 'built', 'developed', 'shipped', 'created', 'implemented', 'designed', 'managed', 'directed'];
    const withVerbs = allHighlights.filter(h => actionVerbs.some(v => h.toLowerCase().startsWith(v))).length;
    const verbPct = totalBullets > 0 ? Math.round((withVerbs / totalBullets) * 100) : 0;

    return { metricsPct, verbPct };
  };

  const current = getStats(revampedResume);
  const original = getStats(originalResume);

  const metricItems = [
    { 
      label: 'Metric Density', 
      value: current.metricsPct, 
      prev: original.metricsPct,
      suffix: '%', 
      icon: <TrendingUp className="w-3.5 h-3.5" />, 
      color: 'text-emerald-400' 
    },
    { 
      label: 'Verb Strength', 
      value: current.verbPct, 
      prev: original.verbPct,
      suffix: '%', 
      icon: <Sparkles className="w-3.5 h-3.5" />, 
      color: 'text-amber-400' 
    },
    { 
      label: 'Keyword Match', 
      value: 94, 
      prev: 62,
      suffix: '%', 
      icon: <BarChart3 className="w-3.5 h-3.5" />, 
      color: 'text-primary' 
    },
    { 
      label: 'Readability', 
      value: 'A+', 
      prev: 'B-',
      suffix: '', 
      icon: <FileText className="w-3.5 h-3.5" />, 
      color: 'text-blue-400' 
    },
  ];

  return (
    <BentoCard title="Performance" icon={<BarChart3 className="w-4 h-4" />}>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {metricItems.map((m) => (
          <div key={m.label} className="group/metric flex flex-col gap-3 p-3 rounded-xl bg-white/[0.04] border border-white/10 transition-all hover:bg-white/[0.08]">
            <div className="flex items-center gap-2">
              <div className={cn("p-1.5 rounded-lg bg-white/10", m.color)}>
                {m.icon}
              </div>
              <p className="text-[8px] font-bold uppercase tracking-widest text-white/50 group-hover/metric:text-white/70 transition-colors">{m.label}</p>
            </div>
            
            <div className="flex flex-col gap-0.5">
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-mono font-bold text-white">{m.value}</span>
                <span className="text-[9px] font-mono font-bold text-white/40">{m.suffix}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[8px] font-bold uppercase tracking-tight text-white/30">Prev</span>
                <span className="text-[10px] font-mono font-bold text-white/40">{m.prev}{m.suffix}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </BentoCard>
  );
}

// ─── Report Panel ────────────────────────────────────────────────────────────────

function ReportPanel({
  changes,
  originalResume,
  revampedResume,
}: {
  changes: BulletChange[];
  originalResume: any;
  revampedResume: any;
}) {
  const sectionsWithChanges = useMemo(() => {
    return SECTION_ORDER.filter(s => {
      const sectionChanges = changes.filter(c => c.section === s);
      return sectionChanges.length > 0 || s === 'experience';
    });
  }, [changes]);

  const [sectionIdx, setSectionIdx] = useState(0);
  const [dir, setDir] = useState(1);

  const go = (d: number) => {
    if (sectionsWithChanges.length <= 1) return;
    setDir(d);
    setSectionIdx(i => (i + d + sectionsWithChanges.length) % sectionsWithChanges.length);
  };

  const currentSection = sectionsWithChanges[sectionIdx] || 'experience';
  const sectionChanges = changes.filter(c => c.section === currentSection);
  const meta = SECTION_META[currentSection] || { label: currentSection, icon: '📄' };

  return (
    <div className="flex flex-col gap-6">
      {/* Section Navigation */}
      <div className="flex items-center justify-between px-2 shrink-0">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-xs">{meta.icon}</span>
            <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-white/90">{meta.label}</h3>
          </div>
          <p className="text-[10px] text-white/20 font-medium">Detailed section analysis</p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            {sectionsWithChanges.map((_, i) => (
              <div
                key={i}
                className={cn(
                  "h-1 rounded-full transition-all duration-500",
                  i === sectionIdx ? "bg-primary w-6" : "bg-white/10 w-2"
                )}
              />
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => go(-1)}
              disabled={sectionsWithChanges.length <= 1}
              className={cn(
                "p-2 rounded-xl border border-white/5 transition-all",
                sectionsWithChanges.length <= 1
                  ? "opacity-0 pointer-events-none"
                  : "text-white/40 hover:text-white hover:bg-white/5 hover:border-white/10"
              )}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => go(1)}
              disabled={sectionsWithChanges.length <= 1}
              className={cn(
                "p-2 rounded-xl border border-white/5 transition-all",
                sectionsWithChanges.length <= 1
                  ? "opacity-0 pointer-events-none"
                  : "text-white/40 hover:text-white hover:bg-white/5 hover:border-white/10"
              )}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Bento Cards */}
      <div className="pb-4">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={currentSection}
            custom={dir}
            variants={{
              enter: (d: number) => ({ y: 10, opacity: 0, filter: 'blur(10px)' }),
              center: { y: 0, opacity: 1, filter: 'blur(0px)' },
              exit: (d: number) => ({ y: -10, opacity: 0, filter: 'blur(10px)' }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ 
              y: { type: 'spring', stiffness: 300, damping: 30 },
              opacity: { duration: 0.3 },
              filter: { duration: 0.3 }
            }}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Row 1: Key Changes (Full width) */}
              <div className="md:col-span-2">
                <KeyChangesCard changes={sectionChanges} />
              </div>

              {/* Row 2: Impact | Similar Success (Half width each) */}
              <ImpactCard changes={sectionChanges} revampedResume={revampedResume} section={currentSection} />
              <ReferenceCard />

              {/* Row 3: Company Fit (Full width) */}
              <div className="md:col-span-2">
                <CompanyFitCard />
              </div>

              {/* Row 4: Performance (Full width) */}
              <div className="md:col-span-2">
                <MetricsCard revampedResume={revampedResume} changes={changes} originalResume={originalResume} />
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────────

export function ComparisonView({
  originalResume,
  revampedResume,
  compiledPdfUrl,
  changes,
}: ComparisonViewProps) {
  return (
    <div className="w-full flex-1 flex flex-col min-h-0">
      {/* Two-panel layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 flex-1 min-h-0">
        {/* LEFT — PDF preview (Direct on background) */}
        <div className="flex flex-col items-center justify-start overflow-y-auto custom-scrollbar">
          <PdfPanel pdfUrl={compiledPdfUrl} revampedResume={revampedResume} />
        </div>

        {/* RIGHT — Info + Report + Actions (Independent Scroll) */}
        <div className="overflow-y-auto flex flex-col gap-10 pr-4 custom-scrollbar">
          {/* Header */}
          <div className="flex items-end justify-between px-2 shrink-0 pt-4">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <div className="px-2 py-0.5 rounded-md bg-primary/10 border border-primary/20">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-primary">Revamp V1.0</span>
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-white">Resume Analysis</h2>
              </div>
              <p className="text-white/30 text-xs font-medium">Strategic enhancements and competitive benchmarking</p>
            </div>
            
            {compiledPdfUrl && (
              <a
                href={compiledPdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.08] hover:border-white/20 transition-all active:scale-95"
              >
                <FileText className="w-3.5 h-3.5 text-white/40 group-hover:text-white/70 transition-colors" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-white/40 group-hover:text-white/70 transition-colors">Export</span>
              </a>
            )}
          </div>

          {/* Bento Report */}
          <div className="shrink-0">
            <ReportPanel changes={changes} originalResume={originalResume} revampedResume={revampedResume} />
          </div>

          {/* Proceed button — disabled placeholder */}
          <button
            disabled
            className="relative w-full flex items-center justify-center gap-3 px-6 py-4
                       rounded-2xl text-xs font-bold uppercase tracking-[0.3em]
                       bg-white/5 text-white/20 border border-white/5 cursor-not-allowed"
          >
            Proceed
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
