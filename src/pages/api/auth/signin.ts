import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { signInErrorCode } from "@/lib/signin-errors";

export const prerender = false;

const signInSchema = z.object({
  email: z.string().trim().min(1),
  password: z.string().min(1),
});

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData().catch(() => null);
  const parsed = signInSchema.safeParse({
    email: form?.get("email") ?? undefined,
    password: form?.get("password") ?? undefined,
  });
  if (!parsed.success) {
    return context.redirect("/auth/signin?error=invalid_credentials");
  }
  const { email, password } = parsed.data;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect("/auth/signin?error=not_configured");
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // The raw Supabase message stays in the Worker logs; the URL only carries a fixed code.
    console.error(`auth signin: signInWithPassword failed: ${error.code ?? error.status} ${error.message}`);
    return context.redirect(`/auth/signin?error=${signInErrorCode(error)}`);
  }

  return context.redirect("/dashboard");
};
