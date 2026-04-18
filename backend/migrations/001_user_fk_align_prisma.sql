-- Align foreign keys with Prisma "User" (not Drizzle's lowercase `users` table).
-- Run once against your Postgres (Neon, etc.) as a superuser or table owner.
--
-- Before running: every non-null user_id in these tables must exist in "User"(id),
-- or the ADD CONSTRAINT step will fail (fix or delete orphan rows first).

-- 1) Drop FK constraints that reference public.users
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      c.conname::text AS conname,
      n.nspname AS schema_name,
      rel.relname AS table_name
    FROM pg_constraint c
    JOIN pg_class rel ON c.conrelid = rel.oid
    JOIN pg_namespace n ON rel.relnamespace = n.oid
    JOIN pg_class ref ON c.confrelid = ref.oid
    WHERE c.contype = 'f'
      AND n.nspname = 'public'
      AND ref.relname = 'users'
      AND rel.relname IN (
        'onboarding_submissions',
        'resume_reviewers',
        'review_comments'
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I DROP CONSTRAINT %I',
      r.schema_name,
      r.table_name,
      r.conname
    );
    RAISE NOTICE 'Dropped FK % on %.%', r.conname, r.schema_name, r.table_name;
  END LOOP;
END $$;

-- 2) Point user / userId columns at Prisma "User"(id)
-- ResumeSettings is the Prisma table (PascalCase); userId references "User"(id) via Prisma migration.
-- If your DB already has ResumeSettings_userId_fkey, the DROP/ADD below is optional (safe if names match).

ALTER TABLE public."ResumeSettings"
  DROP CONSTRAINT IF EXISTS "ResumeSettings_userId_fkey";

ALTER TABLE public."ResumeSettings"
  ADD CONSTRAINT "ResumeSettings_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES public."User"(id) ON DELETE CASCADE;

ALTER TABLE public.onboarding_submissions
  DROP CONSTRAINT IF EXISTS onboarding_submissions_user_id_user_fkey;

ALTER TABLE public.onboarding_submissions
  ADD CONSTRAINT onboarding_submissions_user_id_user_fkey
  FOREIGN KEY (user_id) REFERENCES public."User"(id) ON DELETE CASCADE;

ALTER TABLE public.resume_reviewers
  DROP CONSTRAINT IF EXISTS resume_reviewers_user_id_user_fkey;

ALTER TABLE public.resume_reviewers
  ADD CONSTRAINT resume_reviewers_user_id_user_fkey
  FOREIGN KEY (user_id) REFERENCES public."User"(id) ON DELETE SET NULL;

ALTER TABLE public.review_comments
  DROP CONSTRAINT IF EXISTS review_comments_user_id_user_fkey;

ALTER TABLE public.review_comments
  ADD CONSTRAINT review_comments_user_id_user_fkey
  FOREIGN KEY (user_id) REFERENCES public."User"(id) ON DELETE SET NULL;
