/** Mirrors `onboarding_submissions.input_status` (see migration 002). */
export const ONBOARDING_INPUT_STATUS = {
  INPUT_PENDING: "input_pending",
  INPUT_COMPLETE: "input_complete",
  COMPLETED: "completed",
} as const;

export type OnboardingInputStatus =
  (typeof ONBOARDING_INPUT_STATUS)[keyof typeof ONBOARDING_INPUT_STATUS];

export function isInputSavedInDb(status: string | null | undefined): boolean {
  return (
    status === ONBOARDING_INPUT_STATUS.INPUT_COMPLETE ||
    status === ONBOARDING_INPUT_STATUS.COMPLETED
  );
}
