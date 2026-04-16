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
  ArrowRight,
  Info
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
            <span className="text-xs font-bold uppercase tracking-widest text-white/20">Rendering...</span>
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
        <div className="flex items-center gap-8 px-6 py-2.5 rounded-2xl bg-white/[0.05] border border-white/10 backdrop-blur-md shadow-xl">
          <button
            onClick={() => changePage(-1)}
            disabled={pageNumber <= 1}
            className={cn(
              "p-2.5 rounded-xl transition-all duration-300",
              pageNumber <= 1 
                ? "text-white/5 cursor-not-allowed" 
                : "text-white/40 hover:text-white hover:bg-white/10 active:scale-90"
            )}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          
          <div className="flex flex-col items-center min-w-[100px]">
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-white/70">
              Page {pageNumber} of {numPages}
            </span>
          </div>

          <button
            onClick={() => changePage(1)}
            disabled={pageNumber >= numPages}
            className={cn(
              "p-2.5 rounded-xl transition-all duration-300",
              pageNumber >= numPages 
                ? "text-white/5 cursor-not-allowed" 
                : "text-white/40 hover:text-white hover:bg-white/10 active:scale-90"
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
    <div className="w-full text-[13px] leading-relaxed text-white/60 font-mono space-y-2">
      {name && (
        <div className="text-center pb-6 mb-8 border-b border-white/10">
          <p className="text-white/90 font-bold text-2xl tracking-tight">{name}</p>
          {contact && <p className="text-white/40 text-xs mt-2">{contact}</p>}
        </div>
      )}
      {r.professionalSummary && (
        <div className="mb-8">
          <p className="text-xs font-bold uppercase tracking-widest text-white/40 mb-3">Summary</p>
          <p className="text-white/70 leading-relaxed">{r.professionalSummary}</p>
        </div>
      )}
      {r.experience?.map((exp: any, i: number) => (
        <div key={i} className="mb-8">
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-xs font-bold uppercase tracking-widest text-white/50">
              {exp.position} · {exp.company}
            </p>
            <p className="text-[11px] text-white/30">{exp.startDate} – {exp.endDate || 'Present'}</p>
          </div>
          {exp.highlights?.map((h: string, hi: number) => (
            <p key={hi} className="pl-5 border-l-2 border-white/10 text-white/50 mb-2 text-sm leading-relaxed">{h}</p>
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
  headerClassName,
  rightElement,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  headerClassName?: string;
  rightElement?: React.ReactNode;
}) {
  return (
    <motion.div
      layout
      transition={{
        layout: { type: "spring", stiffness: 300, damping: 30 },
        opacity: { duration: 0.2 }
      }}
      className={cn(
        "relative rounded-[2rem] border border-white/10 bg-white/[0.03] backdrop-blur-xl p-5 flex flex-col gap-4 overflow-hidden shadow-2xl transition-all duration-500 hover:bg-white/[0.05] hover:border-white/20 group/card",
        className
      )}
    >
      <div className={cn("flex items-center justify-between shrink-0", headerClassName)}>
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-white/5 text-white/40 group-hover/card:text-primary transition-colors">
            {icon}
          </div>
          <h4 className="text-[10px] font-black uppercase tracking-[0.25em] text-white/30 group-hover/card:text-white/60 transition-colors">{title}</h4>
        </div>
        {rightElement}
      </div>
      <div className="flex-1 relative">
        {children}
      </div>
    </motion.div>
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

  return (
    <BentoCard 
      title="Strategic Enhancements" 
      icon={<Sparkles className="w-4 h-4" />}
      className="md:col-span-3 min-h-[220px]"
    >
      <div className="h-full flex flex-col gap-5">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={idx}
            custom={dir}
            variants={{
              enter: (d: number) => ({ x: d > 0 ? 10 : -10, opacity: 0, filter: 'blur(10px)' }),
              center: { x: 0, opacity: 1, filter: 'blur(0px)' },
              exit: (d: number) => ({ x: d < 0 ? 10 : -10, opacity: 0, filter: 'blur(10px)' }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: 'spring', stiffness: 400, damping: 40 }}
            className="flex-1 flex flex-col justify-center gap-6"
          >
            <div className="relative pl-6">
              <div className="absolute left-0 top-1 bottom-1 w-[2px] bg-white/10 rounded-full" />
              <p className="text-[11px] font-bold uppercase tracking-widest text-white/20 mb-1.5">Original</p>
              <p className="text-sm text-white/40 line-through decoration-white/20 leading-relaxed font-light">
                {visible?.original}
              </p>
            </div>
            <div className="relative pl-6">
              <div className="absolute left-0 top-1 bottom-1 w-[2px] bg-emerald-500/40 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.3)]" />
              <p className="text-[11px] font-bold uppercase tracking-widest text-emerald-500/40 mb-1.5">Optimized</p>
              <p className="text-base text-white/90 leading-relaxed font-medium">
                {visible?.revised}
              </p>
            </div>
          </motion.div>
        </AnimatePresence>

        <div className="mt-auto flex items-center justify-between border-t border-white/5 pt-4">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono font-bold text-white/40">{String(idx + 1).padStart(2, '0')}</span>
            <div className="w-8 h-px bg-white/10" />
            <span className="text-[10px] font-mono text-white/10">{String(changes.length).padStart(2, '0')}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => go(-1)}
              className="p-2.5 rounded-xl border border-white/10 bg-white/5 text-white/50 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all active:scale-90"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => go(1)}
              className="p-2.5 rounded-xl border border-white/10 bg-white/5 text-white/50 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all active:scale-90"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </BentoCard>
  );
}

// ─── Card 2: Impact Analysis ─────────────────────────────────────────────────────

function ImpactCard({ changes }: { changes: BulletChange[] }) {
  const insights = useMemo(() => {
    const revisedTexts = changes.map(c => c.revised);
    const items: string[] = [];
    if (revisedTexts.some(t => /\d/.test(t))) items.push('Quantifiable');
    if (revisedTexts.some(t => /led|engineered|drove/i.test(t))) items.push('Action-First');
    if (revisedTexts.some(t => /scalable|performance/i.test(t))) items.push('Architecture');
    if (!items.length) items.push('Professional');
    return items.slice(0, 3);
  }, [changes]);

  return (
    <BentoCard 
      title="Value Delta" 
      icon={<TrendingUp className="w-4 h-4" />}
      className="md:col-span-3"
    >
      <div className="h-full flex flex-row items-center justify-between py-1 gap-12">
        <div className="flex-1 space-y-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-white/20 mb-2">Key Insights</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {insights.map((item, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] transition-colors">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500/40" />
                <span className="text-xs font-medium text-white/60">{item}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 px-8 border-l border-white/5">
          <span className="text-[10px] font-black uppercase tracking-widest text-white/20">Metric Score</span>
          <div className="flex items-baseline gap-2">
            <span className="text-5xl font-mono font-bold text-emerald-400">+28</span>
            <span className="text-sm font-mono font-bold text-emerald-400/40">%</span>
          </div>
        </div>
      </div>
    </BentoCard>
  );
}

// ─── Card 3: Company Fit ─────────────────────────────────────────────────────────

// Random success stories tied to companies
const SUCCESS_STORIES: Record<string, { message: string; role: string }> = {
  Google: {
    message: 'One of our similar revamps got selection for SDE-2 role at Google',
    role: '→ L4 SWE, Mountain View',
  },
  Meta: {
    message: 'One of our similar revamps got selection for SDE-2 role at Meta',
    role: '→ E5, Menlo Park',
  },
  Stripe: {
    message: 'One of our similar revamps got selection for SDE-2 role at Stripe',
    role: '→ L3 Engineer, Remote',
  },
  Amazon: {
    message: 'One of our similar revamps got selection for SDE-2 role at Amazon',
    role: '→ L6 SDE, Seattle',
  },
  Shopify: {
    message: 'One of our similar revamps got selection for SDE-2 role at Shopify',
    role: '→ Senior Developer, Remote',
  },
  Netflix: {
    message: 'One of our similar revamps got selection for SDE-2 role at Netflix',
    role: '→ Senior Engineer, Los Gatos',
  },
  Microsoft: {
    message: 'One of our similar revamps got selection for SDE-2 role at Microsoft',
    role: '→ L62 SDE, Redmond',
  },
  Apple: {
    message: 'One of our similar revamps got selection for SDE-2 role at Apple',
    role: '→ ICT V, Cupertino',
  },
};

function CompanyFitCard() {
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const story = selectedCompany ? SUCCESS_STORIES[selectedCompany] : null;

  return (
    <BentoCard
      title="Target Alignment"
      icon={<Building2 className="w-4 h-4" />}
      className="md:col-span-3 h-[210px]"
      rightElement={
        <AnimatePresence mode="wait">
          {selectedCompany ? (
            <motion.button
              key="back-btn"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              onClick={() => setSelectedCompany(null)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-white/40 hover:text-white hover:bg-white/10 transition-all"
            >
              <ChevronLeft className="w-3 h-3" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Back</span>
            </motion.button>
          ) : (
            <motion.div
              key="badge"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex items-center gap-2 px-3 py-1 rounded-full bg-primary/20 border border-primary/30 shadow-[0_0_15px_rgba(var(--primary),0.2)]"
            >
              <Sparkles className="w-3 h-3 text-primary" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-primary">Tier-1 Optimized</span>
            </motion.div>
          )}
        </AnimatePresence>
      }
    >
      <div className="relative h-full flex flex-col justify-center">
        <AnimatePresence mode="wait">
          {!selectedCompany ? (
            <motion.div
              key="grid"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex flex-col gap-4"
            >
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-4">
                {COMPANIES.map((c) => (
                  <button
                    key={c.name}
                    onClick={() => setSelectedCompany(c.name)}
                    className="group/logo relative flex flex-col items-center gap-2"
                  >
                    <div className="w-12 h-12 flex items-center justify-center rounded-2xl bg-white/[0.03] border border-white/10 text-white/20 group-hover/logo:bg-white/[0.1] group-hover/logo:border-primary/40 group-hover/logo:scale-110 transition-all duration-500">
                      <c.icon className="w-6 h-6 transition-colors" />
                      <style dangerouslySetInnerHTML={{ __html: `
                        .group\\/logo:hover svg { color: ${c.color} !important; filter: drop-shadow(0 0 10px ${c.color}44); }
                      `}} />
                    </div>
                    <span className="text-[9px] font-bold text-white/30 group-hover/logo:text-white/70 transition-colors uppercase tracking-widest">{c.name}</span>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 text-white/40">
                <Info className="w-3.5 h-3.5" />
                <p className="text-[10px] font-medium italic">Click a logo to see success story</p>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="selected"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center"
            >
              {/* Col 1: Logo */}
              <div className="md:col-span-2 flex flex-col items-center gap-2">
                {(() => {
                  const c = COMPANIES.find(co => co.name === selectedCompany);
                  if (!c) return null;
                  return (
                    <motion.div 
                      layoutId={`logo-${selectedCompany}`}
                      className="flex flex-col items-center gap-2"
                    >
                      <div className="w-14 h-14 flex items-center justify-center rounded-2xl bg-white/5 border border-primary/20 shadow-[0_0_20px_rgba(var(--primary),0.1)]" style={{ color: c.color }}>
                        <c.icon className="w-7 h-7" />
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-white/60">{selectedCompany}</span>
                    </motion.div>
                  );
                })()}
              </div>

              {/* Col 2: Message */}
              <div className="md:col-span-7 border-l border-white/5 pl-6">
                {story && (
                  <motion.div
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 }}
                    className="space-y-2"
                  >
                    <p className="text-white/80 text-sm leading-relaxed font-medium">{story.message}</p>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-px bg-primary/40" />
                      <p className="text-primary/90 text-[10px] font-black uppercase tracking-widest">{story.role}</p>
                    </div>
                  </motion.div>
                )}
              </div>

              {/* Col 3: Button */}
              <div className="md:col-span-3 flex justify-end pr-2">
                <motion.a
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.2 }}
                  href="/sample-resume.pdf"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group/preview flex flex-col items-center gap-2 text-white/40 hover:text-primary transition-all duration-300"
                >
                  <div className="w-12 h-12 flex items-center justify-center rounded-full bg-primary/10 border border-primary/20 group-hover/preview:bg-primary/20 group-hover/preview:border-primary/40 group-hover/preview:scale-110 transition-all duration-500 shadow-[0_0_20px_rgba(var(--primary),0.05)] relative overflow-hidden">
                    <FileText className="w-5 h-5 transition-all duration-500 group-hover/preview:opacity-0 group-hover/preview:scale-50 group-hover/preview:rotate-12" />
                    <ArrowUpRight className="w-5 h-5 absolute opacity-0 scale-50 -rotate-12 group-hover/preview:opacity-100 group-hover/preview:scale-100 group-hover/preview:rotate-0 transition-all duration-500" />
                  </div>
                  <span className="text-[9px] font-black uppercase tracking-[0.2em]">Sample</span>
                </motion.a>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </BentoCard>
  );
}

// ─── Card 4: Metrics ─────────────────────────────────────────────────────────────

function MetricItem({ m }: { m: any }) {
  return (
    <div className="group/metric relative flex flex-col justify-between p-4 rounded-3xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.05] hover:border-white/15 transition-all duration-500 shadow-xl overflow-hidden min-h-[120px]">
      <div className={cn("absolute -top-10 -right-10 w-20 h-20 blur-[40px] opacity-10 transition-opacity group-hover/metric:opacity-20", m.color.replace('text-', 'bg-'))} />
      <div className="flex items-center justify-between mb-4">
        <div className={cn("w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 border border-white/10", m.color)}>
          {m.icon}
        </div>
        <div className="text-right">
          <span className={cn("text-xs font-black tracking-tighter", m.color)}>
            +{Math.max(0, (typeof m.value === 'number' ? m.value : 100) - (typeof m.prev === 'number' ? m.prev : 0))}%
          </span>
        </div>
      </div>
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/20 mb-1 leading-none">{m.label}</p>
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-mono font-bold text-white leading-none">{m.value}</span>
          <span className="text-sm font-mono font-bold text-white/20 leading-none">{m.suffix}</span>
        </div>
      </div>
    </div>
  );
}

function MetricsCard({ revampedResume, originalResume }: { revampedResume: any; originalResume?: any }) {
  const getStats = (res: any) => {
    const allHighlights: string[] = [];
    res?.experience?.forEach((e: any) => e.highlights?.forEach((h: string) => allHighlights.push(h)));
    res?.projects?.forEach((p: any) => p.highlights?.forEach((h: string) => allHighlights.push(h)));
    const total = allHighlights.length;
    const withNumbers = allHighlights.filter(h => /\d/.test(h)).length;
    const actionVerbs = ['led', 'engineered', 'delivered', 'drove', 'spearheaded', 'optimized', 'architected', 'scaled', 'transformed', 'accelerated', 'generated', 'launched'];
    const withVerbs = allHighlights.filter(h => actionVerbs.some(v => h.toLowerCase().startsWith(v))).length;
    return { 
      density: total > 0 ? Math.round((withNumbers / total) * 100) : 0, 
      strength: total > 0 ? Math.round((withVerbs / total) * 100) : 0 
    };
  };

  const curr = getStats(revampedResume);
  const orig = getStats(originalResume);

  const items = [
    { label: 'Density', value: curr.density, prev: orig.density, suffix: '%', icon: <TrendingUp className="w-5 h-5" />, color: 'text-emerald-400' },
    { label: 'Strength', value: curr.strength, prev: orig.strength, suffix: '%', icon: <Sparkles className="w-5 h-5" />, color: 'text-amber-400' },
    { label: 'Match', value: 94, prev: 62, suffix: '%', icon: <BarChart3 className="w-5 h-5" />, color: 'text-blue-400' },
    { label: 'Reading', value: 'A+', prev: 'B-', suffix: '', icon: <FileText className="w-5 h-5" />, color: 'text-purple-400' },
  ];

  return (
    <BentoCard 
      title="Performance" 
      icon={<BarChart3 className="w-4 h-4" />}
      className="md:col-span-3"
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {items.map(m => <MetricItem key={m.label} m={m} />)}
      </div>
    </BentoCard>
  );
}

// ─── Report Panel ────────────────────────────────────────────────────────────────

// ─── Report Panel (Section Specific Only) ──────────────────────────────────────────

function SectionAnalysis({
  changes,
}: {
  changes: BulletChange[];
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
        <div className="flex items-center gap-5">
          <div className="w-12 h-12 rounded-2xl bg-white/[0.03] border border-white/10 flex items-center justify-center text-2xl shadow-2xl">
            {meta.icon}
          </div>
          <div className="flex flex-col gap-0.5">
            <h3 className="text-lg font-bold uppercase tracking-[0.2em] text-white">{meta.label}</h3>
            <p className="text-[10px] text-white/30 font-black uppercase tracking-widest">Section Analysis</p>
          </div>
        </div>
        
        <div className="flex items-center gap-6">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.02] border border-white/5">
            {sectionsWithChanges.map((_, i) => (
              <div
                key={i}
                className={cn(
                  "h-1 rounded-full transition-all duration-500",
                  i === sectionIdx ? "bg-primary w-6 shadow-[0_0_8px_rgba(var(--primary),0.5)]" : "bg-white/10 w-1.5"
                )}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => go(-1)}
              disabled={sectionsWithChanges.length <= 1}
              className="p-3 rounded-2xl border border-white/10 text-white/30 hover:text-white hover:bg-white/10 transition-all active:scale-90"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => go(1)}
              disabled={sectionsWithChanges.length <= 1}
              className="p-3 rounded-2xl border border-white/10 text-white/30 hover:text-white hover:bg-white/10 transition-all active:scale-90"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Bento Layout (Section Specific) */}
      <div className="pb-8">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.div
            key={currentSection}
            custom={dir}
            variants={{
              enter: (d: number) => ({ y: 20, opacity: 0, filter: 'blur(20px)' }),
              center: { y: 0, opacity: 1, filter: 'blur(0px)' },
              exit: (d: number) => ({ y: -20, opacity: 0, filter: 'blur(20px)' }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-6"
          >
            {/* Primary Analysis (2 cols) */}
            <KeyChangesCard changes={sectionChanges} />

            {/* Impact (1 col) */}
            <ImpactCard changes={sectionChanges} />
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 flex-1 min-h-0 p-6">
        {/* LEFT — PDF preview (Direct on background) */}
        <div className="flex flex-col items-center justify-start overflow-y-auto custom-scrollbar p-4">
          <PdfPanel pdfUrl={compiledPdfUrl} revampedResume={revampedResume} />
        </div>

        {/* RIGHT — Info + Report + Actions (Single Continuous Scroll) */}
        <div className="overflow-y-auto flex flex-col gap-12 pr-6 custom-scrollbar h-full">
          {/* Header */}
          <div className="flex items-end justify-between px-2 shrink-0 pt-2">
            <div className="space-y-2">
              <div className="flex items-center gap-4">
                <div className="px-3 py-1 rounded-lg bg-primary/20 border border-primary/30 shadow-[0_0_15px_rgba(var(--primary),0.2)]">
                  <span className="text-xs font-bold uppercase tracking-widest text-primary">Revamp V1.0</span>
                </div>
                <h2 className="text-3xl font-bold tracking-tight text-white">Resume Analysis</h2>
              </div>
              <p className="text-white/40 text-sm font-medium">Strategic enhancements and competitive benchmarking</p>
            </div>
            
            {compiledPdfUrl && (
              <a
                href={compiledPdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-2.5 px-4 py-2 rounded-xl bg-white/[0.05] border border-white/10 hover:bg-white/[0.1] hover:border-white/20 transition-all active:scale-95 shadow-lg"
              >
                <FileText className="w-4 h-4 text-white/60 group-hover:text-white transition-colors" />
                <span className="text-xs font-bold uppercase tracking-widest text-white/60 group-hover:text-white transition-colors">Export PDF</span>
              </a>
            )}
          </div>

          {/* Global Analysis Modules */}
          <div className="grid grid-cols-1 gap-6 shrink-0">
            <MetricsCard revampedResume={revampedResume} originalResume={originalResume} />
            <CompanyFitCard />
          </div>

          <div className="h-px bg-white/10 w-full shrink-0" />

          {/* Section-specific Analysis */}
          <div className="shrink-0">
            <SectionAnalysis changes={changes} />
          </div>

          {/* Proceed button — bottom of scroll */}
          <button
            disabled
            className="relative w-full flex items-center justify-center gap-4 px-8 py-5
                       rounded-2xl text-sm font-bold uppercase tracking-[0.3em]
                       bg-white/5 text-white/20 border border-white/5 cursor-not-allowed shadow-inner mb-8"
          >
            Finalize Resume
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
