import { z } from "zod";
import { MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH, passwordBytes, SET_PASSWORD_PATH } from "@/lib/password-rules";

/**
 * Server-side rules shared by the password-reset request and the set-a-new-password page and
 * route, so the minimum length and accepted link types can't drift. Client components import the
 * plain constants from `@/lib/password-rules` instead, which keeps zod out of their bundles.
 */
export { FORGOT_PASSWORD_PATH, MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH, SET_PASSWORD_PATH } from "@/lib/password-rules";

/** Body of the reset request form (`POST /api/auth/forgot-password`). */
export const resetRequestSchema = z.object({
  email: z.string().trim().pipe(z.email()),
});

/** The `token_hash` of an emailed link. Shared with `authLinkQuerySchema` (`@/lib/auth-link`). */
export const tokenHashSchema = z.string().min(1);

/**
 * Link types the set-password page accepts. S-04 adds `"invite"`; `@/lib/auth-link` builds its
 * accepted types from this list, so the two can't drift.
 */
export const SET_PASSWORD_LINK_TYPES = ["recovery"] as const;

const setPasswordLinkType = z.enum(SET_PASSWORD_LINK_TYPES);

export type SetPasswordLinkType = z.infer<typeof setPasswordLinkType>;

/** Query of an emailed set-password link: `/auth/set-password?token_hash=…&type=recovery`. */
export const setPasswordLinkSchema = z.object({
  token_hash: tokenHashSchema,
  type: setPasswordLinkType,
});

export type SetPasswordLink = z.infer<typeof setPasswordLinkSchema>;

/**
 * URL of the set-password page, optionally carrying an emailed link's token (so it stays usable)
 * and an error to show.
 */
export function setPasswordUrl({ link, error }: { link?: SetPasswordLink; error?: string } = {}): string {
  const params = new URLSearchParams();
  if (link) {
    params.set("token_hash", link.token_hash);
    params.set("type", link.type);
  }
  if (error) params.set("error", error);
  const query = params.toString();
  return query ? `${SET_PASSWORD_PATH}?${query}` : SET_PASSWORD_PATH;
}

/**
 * Body of the set-password form (`POST /api/auth/set-password`). The token fields are present
 * when the form comes from an emailed link, and absent when a signed-in user retries after a
 * rejected password.
 */
export const setPasswordFormSchema = z
  .object({
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
      .refine((password) => passwordBytes(password) <= MAX_PASSWORD_BYTES, {
        message: `Password must be at most ${MAX_PASSWORD_BYTES} characters`,
      }),
    token_hash: tokenHashSchema.optional(),
    type: setPasswordLinkType.optional(),
  })
  .refine((form) => (form.token_hash === undefined) === (form.type === undefined), {
    message: "token_hash and type must be given together",
    path: ["token_hash"],
  });

export type SetPasswordForm = z.infer<typeof setPasswordFormSchema>;

/**
 * Lets a user retry a rejected password without the emailed token, which the first attempt
 * already used. Set only when saving fails right after the token was verified; holds that user's
 * id and expires quickly, so a signed-in session alone can never change the password.
 */
export const PASSWORD_RETRY_COOKIE = "mo-password-retry";
export const PASSWORD_RETRY_MAX_AGE_SECONDS = 10 * 60;

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
