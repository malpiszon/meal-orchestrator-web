import { z } from "zod";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-rules";

/**
 * Server-side rules shared by the password-reset request and the set-a-new-password page and
 * route, so the minimum length and accepted link types can't drift. Client components import the
 * plain constants from `@/lib/password-rules` instead, which keeps zod out of their bundles.
 */
export { FORGOT_PASSWORD_PATH, MIN_PASSWORD_LENGTH, SET_PASSWORD_PATH } from "@/lib/password-rules";

/** Body of the reset request form (`POST /api/auth/forgot-password`). */
export const resetRequestSchema = z.object({
  email: z.string().trim().pipe(z.email()),
});

/** Link types the set-password page accepts. S-04 adds `"invite"`. */
const setPasswordLinkType = z.enum(["recovery"]);

/** Query of an emailed set-password link: `/auth/set-password?token_hash=…&type=recovery`. */
export const setPasswordLinkSchema = z.object({
  token_hash: z.string().min(1),
  type: setPasswordLinkType,
});

export type SetPasswordLink = z.infer<typeof setPasswordLinkSchema>;

/**
 * Body of the set-password form (`POST /api/auth/set-password`). The token fields are present
 * when the form comes from an emailed link, and absent when a signed-in user retries after a
 * rejected password.
 */
export const setPasswordFormSchema = z
  .object({
    password: z.string().min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`),
    token_hash: z.string().min(1).optional(),
    type: setPasswordLinkType.optional(),
  })
  .refine((form) => (form.token_hash === undefined) === (form.type === undefined), {
    message: "token_hash and type must be given together",
    path: ["token_hash"],
  });

export type SetPasswordForm = z.infer<typeof setPasswordFormSchema>;

const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";
const RATE_LIMIT_MESSAGE = "Too many requests. Please try again later.";

const MESSAGES_BY_CODE: Record<string, string> = {
  weak_password: `This password is too weak. Use at least ${MIN_PASSWORD_LENGTH} characters and avoid common passwords.`,
  same_password: "Your new password must be different from your current one.",
  over_email_send_rate_limit: RATE_LIMIT_MESSAGE,
};

/** The parts of a GoTrue (`AuthError`) error used to pick a message. */
interface AuthErrorLike {
  code?: string | null;
  status?: number | null;
}

/**
 * Friendly text for a Supabase Auth error. Raw error messages are for the logs only and are
 * never shown to the user; unknown errors get a generic message.
 */
export function passwordErrorMessage(error: AuthErrorLike | null | undefined): string {
  const byCode = error?.code ? MESSAGES_BY_CODE[error.code] : undefined;
  if (byCode) return byCode;
  if (error?.status === 429) return RATE_LIMIT_MESSAGE;
  return GENERIC_ERROR_MESSAGE;
}
