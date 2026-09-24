# Repository Guidelines

Astro 7 SSR app with React 19 islands, Tailwind 4, Supabase auth, and shadcn/ui components, deployed to Cloudflare Workers.

## Hard rules

- API routes must export `const prerender = false` (app runs `output: "server"`, see `@astro.config.mjs`).
- Use the `cn()` helper from `@/lib/utils` for Tailwind class merging; never concatenate class strings manually.
- No Next.js directives (`"use client"`, etc.) in React components.
- New Supabase tables must enable RLS with granular per-operation, per-role policies.
- API route handlers use uppercase `GET`/`POST` exports and validate input with zod.
- Deploy target is Cloudflare **Workers** (`npx wrangler deploy`), never Pages (`wrangler pages …`); see `@context/foundation/infrastructure.md`.

## Commands

- Check @README.md
- Pre-commit (husky + lint-staged): `eslint --fix` on `*.{ts,tsx,astro}`, `prettier --write` on `*.{json,css,md}`.

## Architecture & conventions

- Auth: `@src/lib/supabase.ts` (SSR client, cookie sessions, `astro:env/server` for `SUPABASE_URL`/`SUPABASE_KEY`), `@src/middleware.ts` (resolves `context.locals.user`, redirects unauthenticated users off `PROTECTED_ROUTES`). API at `src/pages/api/auth/{signin,signup,signout}.ts`, pages at `src/pages/auth/*.astro`, protected example: `@src/pages/dashboard.astro`.
- Path alias `@/*` → `./src/*`.
- Astro components for static content; React only where interactivity is needed. Extract hooks to `src/components/hooks/`.
- shadcn/ui components live in `src/components/ui/` ("new-york" variant); add with `npx shadcn@latest add [name]`.
- Migrations: `supabase/migrations/YYYYMMDDHHmmss_short_description.sql`.
- Services/helpers go in `src/lib/` (or `src/lib/services/`); shared types in `src/types.ts`.

## Environment

- Check @README.md

## CI

- Check @README.md
- `@.github/workflows/ci.yml`
