declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
  }
}

interface ImportMetaEnv {
  // Inlined into the browser bundle by the production deploy build only.
  readonly PUBLIC_SENTRY_DSN?: string;
}
