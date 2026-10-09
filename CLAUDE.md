# Repository Guidelines

Astro 7 SSR app with React 19 islands, Tailwind 4, Supabase auth, and shadcn/ui components, deployed to Cloudflare Workers.

## Hard rules

- API routes must export `const prerender = false` (app runs `output: "server"`, see `@astro.config.mjs`) and validate input with zod.
- Use the `cn()` helper from `@/lib/utils` for Tailwind class merging; never concatenate class strings manually.
- No Next.js directives (`"use client"`, etc.) in React components.
- New Supabase tables must enable RLS with granular per-operation, per-role policies.
- Deploy target is Cloudflare **Workers** (`npx wrangler deploy`), never Pages (`wrangler pages …`); see `@context/foundation/infrastructure.md`.
- Style with design tokens (`bg-background`, `text-muted-foreground`, `bg-primary`, …, defined in `src/styles/global.css`) and shadcn component variants; never hard-code palette colours (`white/*`, `blue-500`, hex) and never pass colour classes to a shadcn component via `className` (tailwind-merge makes them override the variant). Layout classes (`w-full`, spacing) are fine.
- Never use shadcn `asChild` from `.astro` files (Astro wraps slot children, so Radix `Slot` drops the classes); apply `buttonVariants({ variant })` to the element instead.

## Issue tracking (GitHub)

- Every roadmap item (F-NN / S-NN) in `@context/foundation/roadmap.md` has a GitHub issue titled `[<ID>] …` in the milestone named by the roadmap's `gh_milestone` frontmatter; numbers are in the roadmap's Backlog Handoff table. Roadmap = scope source of truth; issues = execution status.
- Prerequisites live only in GitHub's native "Blocked by" relationship (`gh api repos/{owner}/{repo}/issues/<n>/dependencies/blocked_by`, POST with `-F issue_id=<blocker's .id, not number>`), never in the issue body.
- Next workable items: `gh api "repos/{owner}/{repo}/issues?milestone=<milestone number>&state=open" --jq '.[]|select(.issue_dependencies_summary.blocked_by==0)|"#\(.number) \(.title)"'` (the `-is:blocked` search qualifier does not work).
- Starting an item (the agent does this, never hands it to the user): on `/10x-new`, run `gh issue edit <n> --add-assignee @me` and switch to a new branch `<change-id>`; after `/10x-plan`, comment on the issue linking `context/changes/<change-id>/`. Then report what was done.
- Phases as sub-issues: once `/10x-plan` has written `plan.md`, create one native sub-issue of the item's issue per plan phase (`POST …/issues/<n>/sub_issues` with `-F sub_issue_id=<sub-issue's .id>`). Title it `[<ID>] Phase <N>: <phase name>`, give it the parent's milestone and `stream:*` label (not `foundation`/`slice`), and put the phase summary and success criteria in the body. Chain the phases with "Blocked by" (phase N+1 blocked by N), and list the sub-issue numbers in the plan's References. The plan's `## Progress` stays the canonical checklist. Work phase by phase: reference the phase's sub-issue in its commits, and close it (`gh issue close <n>`) when all of that phase's Progress rows are ticked. The parent still closes via `Closes #<n>` in the PR.
- While working: tick the issue's "Open unknowns" / "Definition of done" checkboxes as they are settled; record each unknown's resolution as an issue comment.
- PRs implementing an item contain `Closes #<n>`; after merge set the item's roadmap status to `done` (via `/10x-roadmap`).
- Any roadmap change (new/split/removed item, changed prerequisites, new milestone) is mirrored to GitHub in the same session: issue create/edit/close, labels (`foundation`/`slice`, `stream:*`, `north-star`, `nice-to-have`) and "Blocked by" links. Closing a roadmap milestone closes the GitHub milestone.
- Parked items get no issues until pulled into a milestone.

## Commands

- Check @README.md (scripts, local setup, env vars); tests and smoke env vars: `docs/testing.md`.

## Architecture & conventions

- Auth: `@src/lib/supabase.ts` (SSR client, cookie sessions, `astro:env/server` for `SUPABASE_URL`/`SUPABASE_KEY`), `@src/middleware.ts` (resolves `context.locals.user`, redirects unauthenticated users off `PROTECTED_ROUTES`). API at `src/pages/api/auth/{signin,signout,forgot-password,set-password,confirm}.ts`, pages at `src/pages/auth/*.astro`; no sign-up (accounts come from MO deliveries plus an invitation).
- Path alias `@/*` → `./src/*`.
- A component is React (`.tsx`, mounted with a `client:*` directive) only if it holds state or handles events; everything else is `.astro` (e.g. `MealSlot.astro` renders a meal, the `MealRating.tsx` island inside it handles the taps). Extract hooks to `src/components/hooks/`.
- shadcn/ui components live in `src/components/ui/` ("new-york" variant); add with `npx shadcn@latest add [name]`.
- Light/dark mode follows the OS via an inline script in `Layout.astro` that toggles `.dark` on `<html>`.
- Migrations: `supabase/migrations/YYYYMMDDHHmmss_short_description.sql`.
- Services/helpers go in `src/lib/` (or `src/lib/services/`); shared types in `src/types.ts`.

## Docs

- Behaviour and routes: `docs/api.md`; MO payload and responses: `docs/mo-delivery-contract.md` (keep in sync with `moDeliverySchema`); secrets, deploy order, Supabase dashboard settings: `docs/deployment.md`; local walkthrough: `docs/dev-walkthrough.md`. Read the relevant one before changing that area.
- A change that alters a route, a user-visible rule, a secret or a deploy step updates the matching `docs/` file in the same PR. Docs describe the current state; rollout history belongs in the change's `context/` folder.

## CI

- `docs/testing.md#ci`, `@.github/workflows/ci.yml`
