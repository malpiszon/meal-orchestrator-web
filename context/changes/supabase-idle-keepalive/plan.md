# Supabase Idle Keep-Alive Implementation Plan

## Overview

Keep the free-tier production Supabase project from pausing after ~7 days of inactivity (PRD NFR "idle availability", `context/foundation/prd.md:198`) by adding a daily Cloudflare Cron Trigger to the existing mo-web Worker that calls a trivial Postgres function through Supabase RPC. Roadmap item F-02, GitHub issue #3.

## Current State Analysis

- mo-web is an Astro 7 SSR app deployed as a single Cloudflare Worker; `wrangler.jsonc` points `main` at the adapter's default entrypoint `@astrojs/cloudflare/entrypoints/server`, which exports only `{ fetch: handle }` (`node_modules/@astrojs/cloudflare/dist/entrypoints/server.js`). There is no `scheduled` handler and no `triggers` block.
- `@astrojs/cloudflare` 14.3.1 exports `./handler` → `handle(request, env, ctx)`, which is the supported way to build a custom Worker entrypoint that adds other handlers alongside Astro's `fetch`.
- The database has no application schema: no `supabase/migrations/` directory, only Supabase Auth's `auth.users`. Nothing in `public` can be queried today.
- The Worker already holds `SUPABASE_URL` / `SUPABASE_KEY` (anon key) as Workers Secrets; the app reads them via `astro:env/server` (`src/lib/supabase.ts:3`). `observability.enabled` is on in `wrangler.jsonc`.
- CI (`.github/workflows/ci.yml`) runs a `smoke` job against a local Supabase (`supabase start`, which applies `supabase/migrations/*` automatically) and the production preview, then `deploy` runs `npx wrangler deploy` on `master`.
- The repository is **public**, so a GitHub Actions `schedule` would be disabled by GitHub after 60 days without commits — exactly the idle scenario this change must survive. This is why `infrastructure.md:121`'s leading option was not chosen.

## Desired End State

- Production Supabase has a `public.keepalive()` function executable by `anon`.
- The deployed Worker runs a Cron Trigger once a day; each run calls `rpc/keepalive`, logs the outcome, and throws on failure so Cloudflare records the invocation as failed.
- The production Supabase project stays **Active** through ≥ 7 consecutive days with no user activity.
- `infrastructure.md` records the decision; the PRD carries a new nice-to-have FR-019 for operational alerting, parked in the roadmap.

Verify by: build output's generated wrangler config contains the cron; `npm run smoke` fires the scheduled handler against local Supabase successfully; after deploy, Workers logs show a successful daily run; after ≥ 7 idle days the Supabase dashboard still shows the project as Active.

### Key Discoveries:

- `@astrojs/cloudflare` exports `./handler` (`node_modules/@astrojs/cloudflare/package.json` exports map) with signature `handle(request, env, context)` (`dist/utils/handler.d.ts`).
- Default entrypoint is just `{ fetch: handle }` (`dist/entrypoints/server.js`) — a custom entrypoint re-exporting `handle` preserves current behavior exactly.
- `wrangler.jsonc:4` — `main` to replace; `wrangler.jsonc:12` — `observability.enabled: true` already gives cron logs.
- `scripts/smoke.mjs:39` — `steps` table of `[name, fn, expectation]`; new check fits this pattern.
- `.github/workflows/ci.yml` smoke job applies migrations via `supabase start`, so the new function exists in CI without extra steps.
- Supabase free projects pause after ~7 days of inactivity (`infrastructure.md:77`, risk register `infrastructure.md:101`).

## What We're NOT Doing

- No GitHub Actions scheduled workflow (disabled after 60 idle days on public repos).
- No Supabase Pro upgrade.
- No email/push alerting on failed runs — recorded as nice-to-have FR-019 in the PRD and parked in the roadmap instead.
- No tables, RLS policies or stored heartbeat data; the function returns a value and writes nothing.
- No changes to the auth flow, middleware or `astro:env` schema.
- No end-to-end check of MO's weekly delivery (S-01 does not exist yet); the idle-availability check here is "project stays Active + dashboard/auth reachable".

## Implementation Approach

A daily cron (`0 3 * * *`, 03:00 UTC) on the Worker is free, lives with the deployed app, reuses its existing secrets, and is unaffected by repository inactivity. Daily gives six missed runs of margin before the ~7-day threshold. The ping calls a `SECURITY INVOKER` SQL function via PostgREST RPC, which guarantees a real Postgres query (the activity Supabase measures) without exposing any data. Failures throw so they are visible as failed cron invocations in the Workers dashboard/logs.

## Critical Implementation Details

- **Env access in `scheduled`**: read `SUPABASE_URL` / `SUPABASE_KEY` from the `env` argument passed to `scheduled(controller, env, ctx)`, not from `astro:env/server` — the keep-alive must not depend on Astro's request pipeline being initialized. Wrap the ping in `ctx.waitUntil(...)` and also await/propagate its rejection so the invocation is marked failed.
- **Local trigger endpoint**: the Cloudflare Vite plugin (used by `astro dev` / `astro preview`) exposes `/cdn-cgi/handler/scheduled` to fire the `scheduled` handler. If the preview server does not expose it, drop the smoke step (Phase 1 change #5) and rely on manual verification 1.6 using `npx wrangler dev --test-scheduled` + `curl "http://localhost:8787/__scheduled?cron=0+3+*+*+*"` instead.
- **Rollout order**: the migration must be applied to production Supabase **before** the Worker with the cron is deployed; otherwise the first runs fail with a 404 from PostgREST.

## Phase 1: Keep-alive function and scheduled handler

### Overview

Add the Postgres function, the ping helper and a custom Worker entrypoint with a daily cron, and prove it locally and in CI.

### Changes Required:

#### 1. Keep-alive migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_keepalive_function.sql`

**Intent**: Create the repo's first migration, adding a side-effect-free function the cron can call so each ping executes a real query.

**Contract**: `public.keepalive() returns timestamptz` — `language sql`, `stable`, `security invoker`, `set search_path = ''`, body `select now()`. `revoke execute ... from public`; `grant execute ... to anon, authenticated`. Header comment states purpose (F-02, prevents free-tier pause). No tables, so the RLS hard rule does not apply.

#### 2. Ping helper

**File**: `src/lib/keepalive.ts`

**Intent**: Encapsulate the RPC call so the Worker entrypoint stays thin and the call is reusable.

**Contract**: `export async function pingSupabase(url: string, key: string): Promise<void>` — creates a stateless `@supabase/supabase-js` client (`auth.persistSession: false`, `autoRefreshToken: false`), calls `.rpc("keepalive")`, throws an `Error` including the Supabase error message on failure; throws if `url`/`key` are missing.

#### 3. Custom Worker entrypoint

**File**: `src/worker.ts`

**Intent**: Keep Astro's request handling unchanged while adding the cron handler.

**Contract**: default export `{ fetch: handle, scheduled }` where `handle` is imported from `@astrojs/cloudflare/handler`. `scheduled(controller, env, ctx)` calls `pingSupabase(env.SUPABASE_URL, env.SUPABASE_KEY)` via `ctx.waitUntil`, logs `keepalive ok` / `keepalive failed: <message>` with `controller.cron`, and rethrows on failure. Declare a minimal local env type for the two secrets if no generated `Env` type covers them.

#### 4. Wrangler config

**File**: `wrangler.jsonc`

**Intent**: Point the Worker at the new entrypoint and register the daily trigger.

**Contract**: `"main": "./src/worker.ts"`; `"triggers": { "crons": ["0 3 * * *"] }`. Everything else unchanged.

#### 5. Smoke step

**File**: `scripts/smoke.mjs`

**Intent**: Make CI prove the scheduled handler runs end-to-end against local Supabase with the migration applied.

**Contract**: new entry in `steps`: `"keepalive cron succeeds"` → `request("/cdn-cgi/handler/scheduled")`, expect `{ status: 200 }` (see Critical Implementation Details for the fallback).

#### 6. README

**File**: `README.md`

**Intent**: Document the keep-alive and correct the now-stale "No database tables or migrations are required" statement.

**Contract**: Supabase Configuration section notes the `keepalive` migration and that production needs `npx supabase db push`; Deployment section mentions the daily Cron Trigger and how to fire it locally.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Build passes: `npm run build`
- Generated Worker config in `dist/` contains `triggers.crons` `["0 3 * * *"]` and the custom entrypoint
- Smoke test passes against local Supabase + `npm run preview`, including "keepalive cron succeeds": `BASE_URL=http://localhost:4321 npm run smoke`

#### Manual Verification:

- Firing the scheduled handler locally logs `keepalive ok`; with `SUPABASE_URL` pointed at an unreachable host it logs `keepalive failed: …` and the invocation reports failure
- Existing auth flow still works in `npm run dev` (sign in, dashboard, sign out)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Production rollout and docs

### Overview

Apply the migration to production, ship the Worker, confirm the cron fires, update foundation docs, and verify the idle-availability NFR over ≥ 7 days.

### Changes Required:

#### 1. Infrastructure decision record

**File**: `context/foundation/infrastructure.md`

**Intent**: Close the open pause-handling item and update the risk register with the chosen mitigation.

**Contract**: checklist item at line ~121 marked done with date, stating: daily Cloudflare Cron Trigger → `rpc/keepalive`; GitHub Actions cron rejected (public repo, 60-day disable). Risk-register row at line ~101 mitigation updated accordingly.

#### 2. PRD — alerting requirement

**File**: `context/foundation/prd.md`

**Intent**: Capture the user's request for operational alerting as a future nice-to-have without building it now.

**Contract**: new FR-019 under a new `### Operations` subsection in Functional Requirements: "Operator is notified when a scheduled operational job (e.g. the database keep-alive) or MO's delivery fails. Priority: nice-to-have", with a short note that it originated in F-02 planning (2026-09-25).

#### 3. Roadmap — park FR-019

**File**: `context/foundation/roadmap.md`

**Intent**: Keep the roadmap consistent with the PRD; parked items get no GitHub issue.

**Contract**: add FR-019 to the Milestone "Parked from this milestone" scope anchor; bump frontmatter `updated:`.

#### 4. Production migration and deploy

**File**: none (operational)

**Intent**: Get the function into production before the cron starts, then deploy via the normal merge-to-`master` CI path.

**Contract**: `npx supabase link --project-ref <ref>` + `npx supabase db push` (human-approved), then merge the PR with `Closes #3`; CI `deploy` job runs `npx wrangler deploy`.

### Success Criteria:

#### Automated Verification:

- CI `ci`, `smoke` and `deploy` jobs pass on the merge to `master`
- `npx wrangler deployments list` shows the new version as active

#### Manual Verification:

- `public.keepalive` exists in production (Supabase dashboard → Database → Functions) before the Worker deploy
- Workers dashboard shows the cron trigger `0 3 * * *` and the first scheduled run succeeded with `keepalive ok` in logs
- After ≥ 7 consecutive days without user activity, the Supabase project is still Active and `/auth/signin` plus a sign-in attempt respond normally (issue #3 Definition of done)
- `infrastructure.md`, `prd.md` (FR-019) and `roadmap.md` updates read correctly

**Implementation Note**: The ≥ 7-day idle check completes after merge; record its result as a comment on issue #3 and tick the issue's "Verified" checkbox.

---

## Testing Strategy

### Unit Tests:

- None — the repo has no unit test runner; the helper is a single RPC call covered by the smoke step.

### Integration Tests:

- `scripts/smoke.mjs` "keepalive cron succeeds" fires the real scheduled handler against local Supabase with the migration applied (CI `smoke` job).

### Manual Testing Steps:

1. `npx supabase start`, `npm run build && npm run preview`, then `curl -i http://localhost:4321/cdn-cgi/handler/scheduled` → 200, preview log shows `keepalive ok`.
2. Temporarily set `SUPABASE_URL` in `.dev.vars` to an unreachable host, rebuild, fire again → non-2xx and `keepalive failed: …`.
3. After production deploy, check Workers → mo-web → Triggers/Logs for the first 03:00 UTC run.
4. Leave production idle ≥ 7 days; confirm Supabase project status is Active.

## Performance Considerations

One trivial `select now()` per day; negligible for both Workers and Supabase free-tier quotas.

## Migration Notes

First migration in the repo. It is additive and idempotent in intent (create function + grants); rollback is `drop function public.keepalive();` after removing the cron. Keeping the function while rolling back the Worker is harmless.

## References

- Roadmap item: `context/foundation/roadmap.md` § F-02
- Issue: https://github.com/malpiszon/meal-orchestrator-web/issues/3
- PRD NFR: `context/foundation/prd.md:198`
- Pause risk: `context/foundation/infrastructure.md:77`, `:101`, `:121`
- Adapter handler: `node_modules/@astrojs/cloudflare/dist/utils/handler.d.ts`
- Smoke steps pattern: `scripts/smoke.mjs:39`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Keep-alive function and scheduled handler

#### Automated

- [ ] 1.1 Lint passes: `npm run lint`
- [ ] 1.2 Type check passes: `npx astro check`
- [ ] 1.3 Build passes: `npm run build`
- [ ] 1.4 Generated Worker config in `dist/` contains `triggers.crons` `["0 3 * * *"]` and the custom entrypoint
- [ ] 1.5 Smoke test passes against local Supabase + `npm run preview`, including "keepalive cron succeeds"

#### Manual

- [ ] 1.6 Firing the scheduled handler locally logs `keepalive ok`; with an unreachable `SUPABASE_URL` it logs `keepalive failed: …` and the invocation reports failure
- [ ] 1.7 Existing auth flow still works in `npm run dev` (sign in, dashboard, sign out)

### Phase 2: Production rollout and docs

#### Automated

- [ ] 2.1 CI `ci`, `smoke` and `deploy` jobs pass on the merge to `master`
- [ ] 2.2 `npx wrangler deployments list` shows the new version as active

#### Manual

- [ ] 2.3 `public.keepalive` exists in production before the Worker deploy
- [ ] 2.4 Workers dashboard shows the cron trigger `0 3 * * *` and the first scheduled run succeeded with `keepalive ok` in logs
- [ ] 2.5 After ≥ 7 consecutive days without user activity, the Supabase project is still Active and auth endpoints respond normally
- [ ] 2.6 `infrastructure.md`, `prd.md` (FR-019) and `roadmap.md` updates read correctly
