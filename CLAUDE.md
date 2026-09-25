# Repository Guidelines

Astro 7 SSR app with React 19 islands, Tailwind 4, Supabase auth, and shadcn/ui components, deployed to Cloudflare Workers.

## Hard rules

- API routes must export `const prerender = false` (app runs `output: "server"`, see `@astro.config.mjs`).
- Use the `cn()` helper from `@/lib/utils` for Tailwind class merging; never concatenate class strings manually.
- No Next.js directives (`"use client"`, etc.) in React components.
- New Supabase tables must enable RLS with granular per-operation, per-role policies.
- API route handlers use uppercase `GET`/`POST` exports and validate input with zod.
- Deploy target is Cloudflare **Workers** (`npx wrangler deploy`), never Pages (`wrangler pages …`); see `@context/foundation/infrastructure.md`.

## Issue tracking (GitHub)

- Every roadmap item (F-NN / S-NN) in `@context/foundation/roadmap.md` has a GitHub issue titled `[<ID>] …` in the milestone matching the roadmap's (`M-1: Weekly plan loop with memory`); numbers are in the roadmap's Backlog Handoff table. Roadmap = scope source of truth; issues = execution status.
- Prerequisites live only in GitHub's native "Blocked by" relationship (`gh api repos/{owner}/{repo}/issues/<n>/dependencies/blocked_by`, POST with `-F issue_id=<blocker's .id, not number>`), never in the issue body.
- Next workable items: `gh api "repos/{owner}/{repo}/issues?milestone=<milestone number>&state=open" --jq '.[]|select(.issue_dependencies_summary.blocked_by==0)|"#\(.number) \(.title)"'` (the `-is:blocked` search qualifier does not work).
- Starting an item: `gh issue edit <n> --add-assignee @me`, branch `<change-id>`, comment on the issue linking `context/changes/<change-id>/` once `/10x-plan` has run.
- While working: tick the issue's "Open unknowns" / "Definition of done" checkboxes as they are settled; record each unknown's resolution as an issue comment.
- PRs implementing an item contain `Closes #<n>`; after merge set the item's roadmap status to `done` (via `/10x-roadmap`).
- Any roadmap change (new/split/removed item, changed prerequisites, new milestone) is mirrored to GitHub in the same session: issue create/edit/close, labels (`foundation`/`slice`, `stream:*`, `north-star`, `nice-to-have`) and "Blocked by" links. Closing a roadmap milestone closes the GitHub milestone.
- Parked items get no issues until pulled into a milestone.

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
