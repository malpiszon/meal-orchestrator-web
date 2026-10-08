// @ts-check
import { defineConfig, envField } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

// https://astro.build/config
export default defineConfig({
  site: "https://mo-web.malpiszon.workers.dev",
  output: "server",
  // Auth uses Supabase cookies, not Astro sessions; disabling stops the Cloudflare adapter from requiring a SESSION KV binding.
  session: false,
  // Default, pinned on purpose: the cookie-session JSON routes (`readJsonRequest`: /api/plans/*, /api/ratings)
  // parse JSON whatever the Content-Type, so this origin check is what stops cross-site text/plain form posts (CSRF).
  security: { checkOrigin: true },
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
    // Dev server only: lets MO running in Docker deliver to http://host.docker.internal:4321.
    server: {
      allowedHosts: ["host.docker.internal"],
    },
  },
  adapter: cloudflare(),
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_SERVICE_ROLE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      MO_INGEST_TOKEN: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
