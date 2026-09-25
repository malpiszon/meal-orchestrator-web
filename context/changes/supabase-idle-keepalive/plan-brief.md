# Supabase Idle Keep-Alive — Plan Brief

> Full plan: `context/changes/supabase-idle-keepalive/plan.md`

## What & Why

Free-tier Supabase projects pause after ~7 days without activity, and MO's weekly delivery cadence sits right at that threshold. A paused project would make MO's delivery and the dashboard fail silently. This change keeps the production database active regardless of user activity (PRD NFR "idle availability", roadmap F-02, issue #3).

## Starting Point

mo-web is a single Cloudflare Worker using the Astro adapter's default entrypoint (fetch only, no cron). The database has no application schema or migrations yet, just Supabase Auth. The repo is public, so a GitHub Actions schedule would be switched off after 60 days without commits, which is the very idle scenario at stake.

## Desired End State

The Worker runs a daily Cron Trigger that calls a trivial `public.keepalive()` Postgres function via Supabase RPC. Failures show up as failed cron invocations in the Workers logs. The production Supabase project stays Active through ≥ 7 idle days. Operational alerting is recorded as a parked nice-to-have (FR-019).

## Key Decisions Made

| Decision            | Choice                                             | Why (1 sentence)                                                                              |
| ------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Mechanism           | Cloudflare Cron Trigger on the existing Worker     | Free, reuses the Worker's secrets, and not disabled by repo inactivity like GitHub schedules. |
| Ping target         | `public.keepalive()` SQL function via `rpc/`       | Guarantees a real Postgres query, the activity Supabase measures, and exposes no data.        |
| Frequency           | Daily, `0 3 * * *` (03:00 UTC)                     | Leaves six missed runs of margin before the ~7-day pause threshold.                           |
| Failure visibility  | Log + throw, seen in Workers logs; no email alert  | No new services for a 2–4 user app.                                                           |
| Alerting            | New nice-to-have FR-019 in the PRD, parked         | Captures the need without growing this change.                                                |
| Entrypoint          | Custom `src/worker.ts` re-exporting adapter `handle` | Adapter's supported extension point; Astro request handling is unchanged.                     |

## Scope

**In scope:**

- First migration: `public.keepalive()` (execute granted to anon/authenticated)
- `src/lib/keepalive.ts`, `src/worker.ts`, `wrangler.jsonc` `main` + `triggers.crons`
- Smoke step that fires the scheduled handler in CI
- README, `infrastructure.md`, PRD FR-019, roadmap parked anchor
- Production migration push, deploy, ≥ 7-day idle verification

**Out of scope:**

- GitHub Actions cron, Supabase Pro upgrade
- Email/push alerting (FR-019, parked)
- Tables, RLS, stored heartbeat data
- End-to-end MO delivery check (S-01 not built yet)

## Architecture / Approach

Cloudflare fires `scheduled()` daily → `src/worker.ts` calls `pingSupabase(env.SUPABASE_URL, env.SUPABASE_KEY)` → supabase-js `.rpc("keepalive")` → PostgREST runs `select now()`. `fetch` stays wired to the adapter's `handle`, so all existing routes behave as before.

## Phases at a Glance

| Phase                                        | What it delivers                                                 | Key risk                                                              |
| -------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1. Keep-alive function and scheduled handler | Migration, helper, custom entrypoint, cron config, CI smoke step | Preview may not expose `/cdn-cgi/handler/scheduled` (fallback defined) |
| 2. Production rollout and docs               | Migration in prod, deployed cron, docs/PRD/roadmap updates, 7-day check | Deploying the Worker before the migration → failing first runs       |

**Prerequisites:** Supabase CLI access to the production project (`supabase link`); local Supabase via Docker for Phase 1.
**Estimated effort:** ~1–2 sessions across 2 phases, plus a ≥ 7-day passive wait for final verification.

## Open Risks & Assumptions

- Assumes a PostgREST RPC query counts as "activity" for Supabase's pause detection; the ≥ 7-day idle check confirms it.
- Cloudflare cron runs are best-effort; daily frequency absorbs occasional misses.
- Failures are only visible if someone looks at the Workers logs until FR-019 is built.

## Success Criteria (Summary)

- The production Supabase project stays Active after ≥ 7 days with no user activity.
- Workers logs show a successful `keepalive ok` run every day.
- Existing auth flow and CI deploy continue to work unchanged.
