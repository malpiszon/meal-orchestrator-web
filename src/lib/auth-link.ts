import { z } from "zod";
import { SET_PASSWORD_LINK_TYPES, setPasswordUrl, tokenHashSchema } from "@/lib/set-password";

/**
 * Link types `/api/auth/confirm` accepts: invitations, plus every type the set-password page
 * takes (built from the same list, so the two can't drift). Other OTP types (sign-up, magic
 * link, email change) are not accepted. S-04 moves `"invite"` into `SET_PASSWORD_LINK_TYPES`.
 */
export const AUTH_LINK_TYPES = ["invite", ...SET_PASSWORD_LINK_TYPES] as const;

/**
 * Query of an invitation or password-reset email link: `/api/auth/confirm?token_hash=…&type=…`.
 * New reset emails link straight to the set-password page; this route still receives older ones.
 */
export const authLinkQuerySchema = z.object({
  token_hash: tokenHashSchema,
  type: z.enum(AUTH_LINK_TYPES),
});

export type AuthLinkQuery = z.infer<typeof authLinkQuerySchema>;

/** What `/api/auth/confirm` does with a valid link: verify it here first, or only redirect. */
export interface AuthLinkRoute {
  verify: boolean;
  location: string;
}

/**
 * Per-type handling of an email link. `recovery` is forwarded, unverified, to the set-password
 * page, which uses the token only when the new password is posted. `invite` is still verified on
 * the GET and lands on the dashboard; S-04 moves it to the set-password page too.
 */
export function authLinkRoute(query: AuthLinkQuery): AuthLinkRoute {
  switch (query.type) {
    case "invite":
      return { verify: true, location: "/dashboard" };
    case "recovery":
      return { verify: false, location: setPasswordUrl({ link: { token_hash: query.token_hash, type: query.type } }) };
  }
}
