import { captureException } from "@sentry/cloudflare";
import { defineMiddleware } from "astro:middleware";
import { captureStreamErrors } from "@/lib/report-stream-errors";
import { readSessionUser } from "@/lib/services/auth-session";
import { createClient } from "@/lib/supabase";

const PROTECTED_ROUTES = ["/dashboard", "/history"];

// Machine-to-machine routes (MO): bearer-token auth, no cookie session. Never add them to PROTECTED_ROUTES.
const MACHINE_ROUTE_PREFIX = "/api/mo/";

export const onRequest = defineMiddleware(async (context, next) => {
  // Astro turns a thrown page or route error into its own 500, so the Worker's Sentry wrapper never sees it.
  // The catch covers errors before the body streams (frontmatter, endpoints); `captureStreamErrors`
  // covers errors while it streams (components, island SSR), which happen after `next()` returns.
  try {
    if (context.url.pathname.startsWith(MACHINE_ROUTE_PREFIX)) {
      context.locals.user = null;
      // JSON with nothing to render: no stream to watch, and wrapping would drop its Content-Length.
      return await next();
    }

    const supabase = createClient(context.request.headers, context.cookies);

    // A session that couldn't be checked (an Auth outage, reported, or a rate limit) still reads as
    // signed out, but the redirect says so instead of looking like a sign-out.
    let sessionUnchecked = false;
    if (supabase) {
      const { user, failure } = await readSessionUser(supabase, "auth.session");
      context.locals.user = user;
      sessionUnchecked = failure !== null;
    } else {
      context.locals.user = null;
    }

    if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
      if (!context.locals.user) {
        return context.redirect(sessionUnchecked ? "/auth/signin?error=session_unavailable" : "/auth/signin");
      }
    }

    // Every other body is wrapped, JSON routes included (they go out chunked, which is harmless).
    // A rewrite (`Astro.rewrite`, `context.rewrite`) runs this middleware again, so the body would be
    // wrapped twice and one stream error logged twice; the app has none today.
    return captureStreamErrors(await next());
  } catch (error) {
    // Unhandled, like the Worker's own captures: Astro only turns it into a 500 page.
    captureException(error, { mechanism: { handled: false, type: "auto.middleware.astro" } });
    throw error;
  }
});
