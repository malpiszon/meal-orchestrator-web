# Dashboard PGRST303 Retry — Plan Brief

> Full plan: `context/changes/dashboard-pgrst303-retry/plan.md`
> Frame brief: `context/changes/dashboard-pgrst303-retry/frame.md`

## What & Why

> PostgREST v14.5's stale time cache can reject freshly issued Supabase sessions with `PGRST303 JWT issued at future`, locally for sure and probably on hosted production, and the dashboard turns that one transient error into "Something went wrong".

Production runs PostgREST 14.5 (re-checked 2026-10-04), and Supabase controls that version, so the app has to tolerate the error itself before the first real users sign in.

## Starting Point

The dashboard's two parallel plan reads and the recency read, plus the choose/confirm saves, all go through `src/lib/services/plans.ts` and fail on the first PostgREST error. The Supabase client's built-in retry covers only 503/520 and network errors on GET, never a 401. The local stack runs 14.5 because `supabase link` pins it to production's version; CI runs the fixed v16.x.

## Desired End State

A PGRST303 "JWT issued at future" on the first dashboard load after sign-in costs at most ~2 s instead of an error card. Each retry leaves a warning in the Worker logs. The README explains the local 14.5 pin, and issue #55 names the real cause.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Root cause | PostgREST 14.5 stale time cache, not clock skew | Shared Docker clock + 30 s allowance rule out skew; upstream fixed it in v14.18 | Frame |
| Retry schedule | 2 retries, 500 ms then 1500 ms (≤ 2 s added) | Clears the usual one-request staleness fast and still covers values stale for over 1 s; a single 1 s retry can hit a still-stale thread | Plan |
| Retry trigger | Only `code === "PGRST303"` with "issued at future" in the message | PGRST303 also covers other JWT claim failures that must fail fast | Plan |
| Scope | All five plan calls (3 reads + choose/confirm writes) | One helper, one policy; safe for writes because PGRST303 is rejected before SQL runs | Plan |
| Local stack | Keep mirroring production (14.5), document it | Local keeps reproducing production's bug; re-link confirmed prod is still 14.5 | Plan |
| Observability | `console.warn` per retry, code/message only | Only signal for whether this reaches production users | Plan |

## Scope

**In scope:**
- `src/lib/postgrest-retry.ts` helper + `src/lib/postgrest-retry.test.ts`
- Wiring all calls in `src/lib/services/plans.ts` through it
- README note on the local PostgREST version pin
- Correcting issue #55 (title, cause, DoD)

**Out of scope:**
- Changing local or CI PostgREST versions
- Retrying other errors, MO delivery or keep-alive RPCs
- Changing the dashboard error card or `plan-save.ts`
- Retrying longer than ~2 s

## Architecture / Approach

`withPgrst303Retry(label, run)` takes a factory that builds a fresh PostgREST request per attempt (builders execute when awaited, so one can't be awaited twice). It returns the first result that isn't the stale-clock error, or the last result after two retries. The services keep their throw-on-error code unchanged, so `dashboard.astro` and `plan-save.ts` need no changes.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Retry wrapper in the plan services | Helper, tests, all five calls wrapped | Re-awaiting a builder instead of rebuilding it would not resend the request |
| 2. Docs, issue and local verification | README note, corrected #55, smoke + manual check on :4322 | The bug is intermittent, so the manual check may not trigger a retry |

**Prerequisites:** Local Supabase running (linked, PostgREST 14.5); preview on :4322.
**Estimated effort:** ~1 session across 2 small phases.

## Open Risks & Assumptions

- Staleness can outlast 2 s (supabase#50651); then the error card still shows. The warnings will tell us if that happens.
- Supabase may roll hosted projects to v14.18+ at any time; the retry then becomes a no-op and can stay.

## Success Criteria (Summary)

- Signing in right after an idle period lands on a working dashboard, not "Couldn't load your plan".
- Other errors fail exactly as before; successful loads add no latency.
- Retries show up as warnings in the Worker logs.
