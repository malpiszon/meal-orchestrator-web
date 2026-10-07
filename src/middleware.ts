import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";

const PROTECTED_ROUTES = ["/dashboard", "/history"];

// Machine-to-machine routes (MO): bearer-token auth, no cookie session. Never add them to PROTECTED_ROUTES.
const MACHINE_ROUTE_PREFIX = "/api/mo/";

export const onRequest = defineMiddleware(async (context, next) => {
  if (context.url.pathname.startsWith(MACHINE_ROUTE_PREFIX)) {
    context.locals.user = null;
    return next();
  }

  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
  }

  return next();
});
