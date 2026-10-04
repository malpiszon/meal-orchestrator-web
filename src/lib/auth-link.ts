import { z } from "zod";
import { SET_PASSWORD_LINK_TYPES, setPasswordUrl, tokenHashSchema } from "@/lib/set-password";

/**
 * Query of an older invitation or password-reset email link: `/api/auth/confirm?token_hash=…&type=…`.
 * New emails link straight to the set-password page; this route still receives links sent before
 * that. Accepts the set-password page's link types only (built from the same list, so the two can't
 * drift); other OTP types (sign-up, magic link, email change) are rejected.
 */
export const authLinkQuerySchema = z.object({
  token_hash: tokenHashSchema,
  type: z.enum(SET_PASSWORD_LINK_TYPES),
});

export type AuthLinkQuery = z.infer<typeof authLinkQuerySchema>;

/**
 * Where `/api/auth/confirm` sends a valid link: the set-password page, with the token unverified
 * (it is used only when the new password is posted, so mail scanners can't burn it).
 */
export function authLinkRoute(query: AuthLinkQuery): string {
  return setPasswordUrl({ link: { token_hash: query.token_hash, type: query.type } });
}
