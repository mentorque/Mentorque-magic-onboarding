/**
 * resumeRevamp.ts  (Express router)
 * Location: backend/src/routes/resumeRevamp.ts
 *
 * Mount in your main app file:
 *   import resumeRevampRouter from './routes/resumeRevamp';
 *   app.use('/api/resume-revamp', resumeRevampRouter);
 *
 * Endpoints:
 *   POST /api/resume-revamp/parse                  — upload PDF or paste text → parsed resume + questions
 *   POST /api/resume-revamp/revamp                 — parsed resume + answers  → revamped resume + diff
 *   POST /api/resume-revamp/compile-final          — final merged resume      → compiled PDF URL
 *   POST /api/resume-revamp/apply-studio-feedback  — admin mentor: AI apply PDF threads → PDF + resolve
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parsePdfToText } from '../lib/pdfParser';
import { parseResumeText } from '../lib/resumeParser';
import {
  generateQuestionsFromResume,
  revampResume,
  applyAcceptedChanges,
  type BulletChange,
} from '../lib/resumeRevampAI';
import { authenticateFirebaseOrMentorAccess } from '../middlewares/auth.js';
import { db, highlightsTable } from '@workspace/db';
import { and, eq } from 'drizzle-orm';
import {
  buildResumeSchemaOutline,
  extractActionItemsFromFeedback,
  formatFeedbackThreads,
  generateResumeFromActions,
} from '../lib/studioApplyAI.js';
import { computeStudioApplyBulletChanges } from '../lib/studioResumeDiff.js';

const router = Router();
const FALLBACK_PDF_NAME = '8e256776-bf9e-46e2-948c-6e072e22f307.pdf';

function isAiLimitError(err: unknown): boolean {
  const message = String((err as any)?.message ?? '').toLowerCase();
  return (
    message.includes('rate limit') ||
    message.includes('quota') ||
    message.includes('insufficient_quota') ||
    message.includes('too many requests') ||
    message.includes('tokens per min') ||
    message.includes('limit exceeded')
  );
}

function resolveFallbackPdfPath(): string {
  const candidates = [
    path.resolve(process.cwd(), 'backend', FALLBACK_PDF_NAME),
    path.resolve(process.cwd(), FALLBACK_PDF_NAME),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`Fallback PDF not found: ${FALLBACK_PDF_NAME}`);
  }
  return found;
}

// ─── Sanitize resume before sending to compiler ───────────────────────────────
// Fills in blank required fields that the ResumeCompiler validates strictly.
function sanitizeForCompiler(resume: any): any {
  const r = structuredClone(resume);

  const fallbackDate = (v: string | undefined, fallback: string) =>
    v && v.trim() ? v.trim() : fallback;

  if (Array.isArray(r.experience)) {
    r.experience = r.experience.map((exp: any) => ({
      ...exp,
      startDate: fallbackDate(exp.startDate, 'Jan 2020'),
      endDate:   fallbackDate(exp.endDate,   'Present'),
      company:   exp.company?.trim()  || 'Company',
      position:  exp.position?.trim() || 'Role',
    }));
  }

  if (Array.isArray(r.education)) {
    r.education = r.education.map((edu: any) => ({
      ...edu,
      startDate:   fallbackDate(edu.startDate, 'Aug 2018'),
      endDate:     fallbackDate(edu.endDate,   'May 2022'),
      institution: edu.institution?.trim() || 'University',
      degree:      edu.degree?.trim()      || 'Degree',
    }));
  }

  if (Array.isArray(r.projects)) {
    r.projects = r.projects.map((proj: any) => ({
      ...proj,
      name: proj.name?.trim() || 'Project',
    }));
  }

  return r;
}

// Multer: memory storage, 10 MB file limit
function looksLikePdf(file: { originalname?: string; mimetype?: string }): boolean {
  const name = (file.originalname || '').toLowerCase();
  if (name.endsWith('.pdf')) return true;
  const m = (file.mimetype || '').toLowerCase();
  return (
    m === 'application/pdf' ||
    m === 'application/x-pdf' ||
    m === 'binary/octet-stream' ||
    m === 'application/octet-stream'
  );
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (looksLikePdf(file)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are accepted'));
    }
  },
});

// ─── POST /extract-text ───────────────────────────────────────────────────────
// PDF or plain text only — no AI. Use for onboarding "collect text" step.
// Returns: { rawText: string }
router.post('/extract-text', upload.single('file'), async (req: Request, res: Response) => {
  try {
    let resumeText = '';

    if (req.file) {
      resumeText = await parsePdfToText(req.file.buffer);
    } else if (req.body?.text && typeof req.body.text === 'string') {
      resumeText = req.body.text.trim();
    } else {
      return res.status(400).json({
        success: false,
        message: 'Provide either a PDF file (multipart "file" field) or plain text (JSON "text" field).',
      });
    }

    if (!resumeText) {
      return res.status(422).json({
        success: false,
        message: 'Could not extract any text from the provided input.',
      });
    }

    return res.json({ success: true, rawText: resumeText });
  } catch (err: any) {
    console.error('[resume-revamp/extract-text] Error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to read resume text.' });
  }
});

// ─── POST /parse ──────────────────────────────────────────────────────────────
// Accept: multipart PDF (`file` field) OR JSON body `{ text: string }`
// Returns: { parsedResume, questions, rawText }
router.post('/parse', upload.single('file'), async (req: Request, res: Response) => {
  try {
    let resumeText = '';

    if (req.file) {
      // PDF path
      resumeText = await parsePdfToText(req.file.buffer);
    } else if (req.body?.text && typeof req.body.text === 'string') {
      // Plain-text paste path
      resumeText = req.body.text.trim();
    } else {
      return res.status(400).json({
        success: false,
        message: 'Provide either a PDF file (multipart "file" field) or plain text (JSON "text" field).',
      });
    }

    if (!resumeText) {
      return res.status(422).json({
        success: false,
        message: 'Could not extract any text from the provided input.',
      });
    }

    console.log(`[resume-revamp/parse] Extracted ${resumeText.length} chars — running AI parse...`);

    const parsedResume = await parseResumeText(resumeText);
    const generatedQuestions = await generateQuestionsFromResume(parsedResume);

    console.log(`[resume-revamp/parse] Done. ${generatedQuestions.length} questions generated.`);

    return res.json({
      success: true,
      parsedResume,
      questions: generatedQuestions,
      rawText: resumeText,
    });
  } catch (err: any) {
    console.error('[resume-revamp/parse] Error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to parse resume.' });
  }
});

// ─── POST /revamp ─────────────────────────────────────────────────────────────
// Body: { parsedResume: ResumeData, answers: Record<string, string> }
// Returns: { revampedResume, changes, compiledPdfUrl | null }
router.post('/revamp', async (req: Request, res: Response) => {
  try {
    const { parsedResume, answers } = req.body;

    if (!parsedResume || typeof parsedResume !== 'object') {
      return res.status(400).json({ success: false, message: 'parsedResume is required.' });
    }

    console.log('[resume-revamp/revamp] Starting AI revamp...');
    const { revampedResume, changes } = await revampResume(parsedResume, answers || {});
    console.log(`[resume-revamp/revamp] Done. ${changes.length} changes produced.`);

    // Sanitize the resume before sending to compiler — fill in any blank required fields
    const sanitized = sanitizeForCompiler(revampedResume);

    // Compile the revamped resume via the ResumeCompiler compile endpoint (no auth required)
    const compilerBaseUrl = (process.env.RESUME_COMPILER_URL || 'http://localhost:5001').replace(/\/$/, '');
    let compiledPdfUrl: string | null = null;

    try {
      const compileRes = await fetch(`${compilerBaseUrl}/api/resume/compile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sanitized),
      });

      if (compileRes.ok) {
        const data = (await compileRes.json()) as { id: string; url: string };
        // url from ResumeCompiler may be relative ("/api/resume/preview/xxx.pdf")
        // → make it absolute using the compiler's base URL
        compiledPdfUrl = data.url?.startsWith('http')
          ? data.url
          : `${compilerBaseUrl}${data.url}`;
        console.log(`[resume-revamp/revamp] PDF compiled: ${compiledPdfUrl}`);
      } else {
        const errBody = await compileRes.text();
        console.warn(`[resume-revamp/revamp] Compile returned ${compileRes.status}: ${errBody.slice(0, 200)}`);
      }
    } catch (compileErr: any) {
      // Non-fatal — UI will show rich-text diff regardless; PDF preview is a bonus
      console.warn('[resume-revamp/revamp] Compile step failed (non-fatal):', compileErr.message);
    }

    return res.json({
      success: true,
      revampedResume,
      changes,
      compiledPdfUrl,
    });
  } catch (err: any) {
    console.error('[resume-revamp/revamp] Error:', err);
    if (isAiLimitError(err)) {
      return res.status(200).json({
        success: true,
        aiLimitFallback: true,
        message: 'AI limit reached. Served fallback PDF.',
        revampedResume: req.body?.parsedResume ?? null,
        changes: [],
        compiledPdfUrl: '/api/resume-revamp/fallback-pdf',
      });
    }
    return res.status(500).json({ success: false, message: err.message || 'Failed to revamp resume.' });
  }
});

// ─── POST /compile-final ──────────────────────────────────────────────────────
// Body: { originalResume, revampedResume, changes, acceptedIds: string[] }
// Builds the merged resume from accepted changes and compiles it.
// Returns: { compiledPdfUrl }
router.post('/compile-final', async (req: Request, res: Response) => {
  try {
    const { originalResume, revampedResume, changes, acceptedIds } = req.body;

    if (!originalResume || !revampedResume || !Array.isArray(changes) || !Array.isArray(acceptedIds)) {
      return res.status(400).json({
        success: false,
        message: 'originalResume, revampedResume, changes[], and acceptedIds[] are all required.',
      });
    }

    // Merge accepted changes onto the original
    const acceptedSet = new Set<string>(acceptedIds);
    const finalResume = applyAcceptedChanges(
      originalResume,
      revampedResume,
      changes as BulletChange[],
      acceptedSet,
    );

    const compilerBaseUrl = (process.env.RESUME_COMPILER_URL || 'http://localhost:5001').replace(/\/$/, '');

    const compileRes = await fetch(`${compilerBaseUrl}/api/resume/compile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sanitizeForCompiler(finalResume)),
    });

    if (!compileRes.ok) {
      const errBody = await compileRes.text();
      throw new Error(`ResumeCompiler returned ${compileRes.status}: ${errBody.slice(0, 300)}`);
    }

    const data = (await compileRes.json()) as { id: string; url: string };
    const compiledPdfUrl = data.url?.startsWith('http')
      ? data.url
      : `${compilerBaseUrl}${data.url}`;

    return res.json({ success: true, compiledPdfUrl, finalResume });
  } catch (err: any) {
    console.error('[resume-revamp/compile-final] Error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to compile final resume.' });
  }
});

/**
 * Admin mentor: summarize open PDF feedback → action items → merged resume JSON → compile PDF.
 * Resolves all matching highlight rows for this document + onboarding.
 */
router.post(
  '/apply-studio-feedback',
  authenticateFirebaseOrMentorAccess,
  async (req: Request, res: Response) => {
    if (req.authMode !== 'mentor' || !req.mentorAccess) {
      return res.status(403).json({
        success: false,
        message: 'Mentor access token required.',
      });
    }
    const role = String(req.mentorAccess.payload.role ?? '').toLowerCase();
    if (role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin reviewer role required.',
      });
    }

    const { documentUrl, currentRevampedResume, onboardingId: bodyOnboardingId } =
      req.body ?? {};
    const tokenOid = req.mentorAccess.payload.onboardingId;
    if (
      typeof bodyOnboardingId === 'string' &&
      bodyOnboardingId.trim() &&
      bodyOnboardingId.trim() !== tokenOid
    ) {
      return res.status(403).json({
        success: false,
        message: 'onboardingId does not match access token.',
      });
    }

    if (!documentUrl || typeof documentUrl !== 'string' || !documentUrl.trim()) {
      return res.status(400).json({
        success: false,
        message: 'documentUrl is required.',
      });
    }
    if (!currentRevampedResume || typeof currentRevampedResume !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'currentRevampedResume object is required.',
      });
    }

    try {
      const rows = await db
        .select()
        .from(highlightsTable)
        .where(
          and(
            eq(highlightsTable.documentUrl, documentUrl.trim()),
            eq(highlightsTable.onboardingId, tokenOid),
            eq(highlightsTable.isResolved, false),
          ),
        );

      if (rows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No open feedback threads to apply for this document.',
        });
      }

      const digest = formatFeedbackThreads(
        rows.map((r) => ({
          id: r.id,
          content: r.content as { text?: string },
          comments: r.comments as unknown[],
        })),
      );
      const schemaOutline = buildResumeSchemaOutline(currentRevampedResume);
      const actionItems = await extractActionItemsFromFeedback(digest, schemaOutline);

      if (actionItems.length === 0) {
        return res.status(400).json({
          success: false,
          message:
            'Could not map feedback to resume fields. Try more specific notes.',
        });
      }

      const mergedResume = await generateResumeFromActions(
        currentRevampedResume,
        actionItems,
      );
      const sanitized = sanitizeForCompiler(mergedResume);

      const compilerBaseUrl = (process.env.RESUME_COMPILER_URL || 'http://localhost:5001').replace(
        /\/$/,
        '',
      );
      const compileRes = await fetch(`${compilerBaseUrl}/api/resume/compile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sanitized),
      });

      if (!compileRes.ok) {
        const errBody = await compileRes.text();
        throw new Error(
          `ResumeCompiler returned ${compileRes.status}: ${errBody.slice(0, 300)}`,
        );
      }

      const data = (await compileRes.json()) as { id: string; url: string };
      const compiledPdfUrl = data.url?.startsWith('http')
        ? data.url
        : `${compilerBaseUrl}${data.url}`;

      await db
        .update(highlightsTable)
        .set({ isResolved: true, updatedAt: new Date() })
        .where(
          and(
            eq(highlightsTable.documentUrl, documentUrl.trim()),
            eq(highlightsTable.onboardingId, tokenOid),
            eq(highlightsTable.isResolved, false),
          ),
        );

      const changes = computeStudioApplyBulletChanges(
        currentRevampedResume,
        mergedResume,
      );

      const revampResult = {
        revampedResume: mergedResume,
        changes,
        compiledPdfUrl,
      };

      return res.json({
        success: true,
        revampResult,
        actionItems,
      });
    } catch (err: any) {
      console.error('[resume-revamp/apply-studio-feedback]', err);
      return res.status(500).json({
        success: false,
        message: err.message || 'Failed to apply studio feedback.',
      });
    }
  },
);

// ─── GET /proxy-pdf ───────────────────────────────────────────────────────────
// Proxies a PDF from an external URL through this server to avoid CORS issues.
// Usage: /api/resume-revamp/proxy-pdf?url=https://...
router.get('/proxy-pdf', async (req: Request, res: Response) => {
  const { url } = req.query;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ success: false, message: 'url query param required.' });
  }

  try {
    const upstream = await fetch(url);
    if (!upstream.ok) {
      return res.status(upstream.status).json({ success: false, message: `Upstream returned ${upstream.status}` });
    }
    const buffer = await upstream.arrayBuffer();
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline',
      'Content-Length': String(buffer.byteLength),
      'Cache-Control': 'no-store',
    });
    return res.send(Buffer.from(buffer));
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET /fallback-pdf ────────────────────────────────────────────────────────
// Returns a hardcoded local PDF when AI limits are exceeded.
router.get('/fallback-pdf', (_req: Request, res: Response) => {
  try {
    const fallbackPath = resolveFallbackPdfPath();
    const file = readFileSync(fallbackPath);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline',
      'Content-Length': String(file.byteLength),
      'Cache-Control': 'no-store',
    });
    return res.send(file);
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
