alter table onboarding_submissions
add column if not exists action_items jsonb;
