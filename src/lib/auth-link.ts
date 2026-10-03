import { z } from "zod";

/**
 * Query of an invitation or password-reset email link, as built by the templates in
 * `supabase/templates/`: `/api/auth/confirm?token_hash=…&type=invite|recovery`.
 * Other OTP types (sign-up, magic link, email change) are not accepted.
 */
export const authLinkQuerySchema = z.object({
  token_hash: z.string().min(1),
  type: z.enum(["invite", "recovery"]),
});

export type AuthLinkQuery = z.infer<typeof authLinkQuerySchema>;

/** Where a verified email link sends the user. S-04/S-05 change this to their own pages. */
export const AUTH_LINK_DESTINATION = "/dashboard";
