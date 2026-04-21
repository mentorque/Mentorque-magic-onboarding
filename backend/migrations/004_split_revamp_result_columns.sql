-- Split onboarding_submissions.revamp_result into first-class columns.
ALTER TABLE onboarding_submissions
  ADD COLUMN IF NOT EXISTS revamped_resume jsonb,
  ADD COLUMN IF NOT EXISTS resume_changes jsonb,
  ADD COLUMN IF NOT EXISTS compiled_pdf_url text;

-- Backfill from legacy revamp_result JSON blob.
UPDATE onboarding_submissions
SET
  revamped_resume = COALESCE(revamped_resume, revamp_result->'revampedResume'),
  resume_changes = COALESCE(resume_changes, revamp_result->'changes'),
  compiled_pdf_url = COALESCE(compiled_pdf_url, NULLIF(revamp_result->>'compiledPdfUrl', ''))
WHERE revamp_result IS NOT NULL;

-- Drop old blob column once data is moved.
ALTER TABLE onboarding_submissions
  DROP COLUMN IF EXISTS revamp_result;
