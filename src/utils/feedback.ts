/** Rules of the feedback channel. The same limits are enforced by public.submit_feedback (migration 044). */
export const FEEDBACK_CATEGORIES = ['bug', 'suggestion', 'safety', 'other'] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_MIN_LENGTH = 10;
export const FEEDBACK_MAX_LENGTH = 1000;

/** Thrown by feedbackService when the optional screenshot can't be uploaded. */
export const FEEDBACK_UPLOAD_FAILED = 'FEEDBACK_UPLOAD_FAILED';

export type FeedbackProblem = 'category' | 'tooShort' | 'tooLong';

export function isFeedbackCategory(value: unknown): value is FeedbackCategory {
  return typeof value === 'string' && (FEEDBACK_CATEGORIES as readonly string[]).includes(value);
}

/** Collapses runs of blank lines and trims the ends; the server stores the trimmed text. */
export function cleanFeedbackText(text: string) {
  return text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Problems with a report before it is sent (empty list = valid). */
export function feedbackProblems(category: string | null, description: string): FeedbackProblem[] {
  const problems: FeedbackProblem[] = [];
  if (!isFeedbackCategory(category)) problems.push('category');
  const length = cleanFeedbackText(description).length;
  if (length < FEEDBACK_MIN_LENGTH) problems.push('tooShort');
  if (length > FEEDBACK_MAX_LENGTH) problems.push('tooLong');
  return problems;
}

/** Maps the server's error codes to i18n keys under `feedback.errors`. */
export function feedbackErrorKey(rawMessage: string): 'rateLimit' | 'invalid' | 'auth' | 'upload' | null {
  if (/FEEDBACK_RATE_LIMIT/.test(rawMessage)) return 'rateLimit';
  if (/FEEDBACK_(UPLOAD_FAILED|SCREENSHOT_INVALID)/.test(rawMessage)) return 'upload';
  if (/FEEDBACK_(CATEGORY_INVALID|TOO_SHORT|TOO_LONG)/.test(rawMessage)) return 'invalid';
  if (/AUTH_REQUIRED/.test(rawMessage)) return 'auth';
  return null;
}
