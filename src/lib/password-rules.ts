/**
 * Plain constants of the password-reset flow, kept free of zod so the React forms (sign-in,
 * sign-up, forgot/set password) can import them without shipping zod to the browser. The
 * schemas built on them live in `@/lib/set-password`. Supabase enforces the same minimum
 * (`minimum_password_length` in `supabase/config.toml`).
 */
export const MIN_PASSWORD_LENGTH = 8;

export const FORGOT_PASSWORD_PATH = "/auth/forgot-password";
export const SET_PASSWORD_PATH = "/auth/set-password";
