import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { signInErrorCode } from "@/lib/signin-errors";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const password = form.get("password") as string;

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
