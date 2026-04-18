-- Tracks whether onboarding form inputs are saved (`input_complete`) vs full journey `completed`.
-- Default: input_pending

ALTER TABLE public.onboarding_submissions
  ADD COLUMN IF NOT EXISTS input_status text NOT NULL DEFAULT 'input_pending';

ALTER TABLE public.onboarding_submissions
  DROP CONSTRAINT IF EXISTS onboarding_submissions_input_status_check;

ALTER TABLE public.onboarding_submissions
  ADD CONSTRAINT onboarding_submissions_input_status_check
  CHECK (input_status IN ('input_pending', 'input_complete', 'completed'));

COMMENT ON COLUMN public.onboarding_submissions.input_status IS
  'input_pending: wizard in progress; input_complete: form + resume data persisted; completed: user finished revamp flow';
