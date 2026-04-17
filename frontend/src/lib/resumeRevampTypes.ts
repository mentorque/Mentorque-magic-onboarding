/**
 * resumeRevampTypes.ts
 * Location: artifacts/mentorque-onboarding/src/lib/resumeRevampTypes.ts
 *
 * Shared types for the resume revamp step.
 * Mirror of the backend types in resumeRevampAI.ts — kept in sync manually
 * (or generate via Orval once the OpenAPI spec is updated).
 */

export interface RevampQuestion {
  id: string;
  question: string;
  hint: string;
  /** Question input type — 'text' for free-form, 'mcq' for multiple choice */
  questionType: 'text' | 'mcq';
  /** Options for MCQ questions */
  options?: string[];
  section: 'experience' | 'skills' | 'summary' | 'general';
}

export type ChangeSection = 'experience' | 'projects' | 'summary' | 'skills';

export interface BulletChange {
  id: string;
  section: ChangeSection;
  sectionIndex?: number;
  bulletIndex?: number;
  original: string;
  revised: string;
  reason: string;
}

// The three internal sub-stages of the ResumeRevampStep
export type RevampStage = 'upload' | 'questions' | 'comparison' | 'done';

export interface ParseResult {
  parsedResume: any | null;
  questions: RevampQuestion[];
  rawText: string;
}

export interface RevampResult {
  revampedResume: any;
  changes: BulletChange[];
  compiledPdfUrl: string | null;
}
