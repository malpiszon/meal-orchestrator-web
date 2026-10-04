/**
 * Plain constants of the password-reset flow, kept free of zod so the React forms (sign-in,
 * forgot/set password) can import them without shipping zod to the browser. The
 * schemas built on them live in `@/lib/set-password`. Supabase enforces the same minimum
 * (`minimum_password_length` in `supabase/config.toml`).
 */
export const MIN_PASSWORD_LENGTH = 8;

/** GoTrue (bcrypt) rejects passwords longer than 72 bytes; checked here so the user gets a clear message. */
export const MAX_PASSWORD_BYTES = 72;

/** Length of a password as GoTrue counts it: UTF-8 bytes, so non-ASCII characters count more than once. */
export const passwordBytes = (password: string) => new TextEncoder().encode(password).length;

export const FORGOT_PASSWORD_PATH = "/auth/forgot-password";
export const SET_PASSWORD_PATH = "/auth/set-password";
