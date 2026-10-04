# Frame Brief: Dashboard PGRST303 "JWT issued at future"

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

Right after a session is issued, one of the dashboard's two parallel plan queries gets 401 `PGRST303 JWT issued at future`. `src/pages/dashboard.astro:39` logs `dashboard plan load failed: weekly_plans query failed: PGRST303 JWT issued at future` and the page shows "Something went wrong" until a reload. Seen twice, both on the local stack (WSL host, Supabase in Docker): once after a password reset (S-05 Phase 2 manual test), once after a plain sign-in in the local smoke on :4322 (step "dashboard shows no upcoming plan yet"; the rerun passed). Never checked in CI history or production logs.

## Initial Framing (preserved)

- **User's stated cause or approach**: a small clock skew between the app host and the Supabase containers (#55).
- **User's proposed direction**: retry the dashboard plan load once after ~1 s when PostgREST answers `PGRST303`.
- **Pre-dispatch narrowing**: where it shows up: "not sure / haven't checked" (production and CI never looked at). Which concern matters: real users seeing the error and flaky local smoke runs, "both equally".

## Dimension Map

1. **Clock skew between hosts** — the token's `iat` comes from one clock and is checked against another that lags. ← initial framing
2. **PostgREST's own "now" for JWT validation** — PostgREST compares `iat` against a cached current time that can go stale, independent of any host clock.
3. **App-side token handling** — the app mints, alters or re-times the token, or sends a different one than GoTrue issued.
4. **Production exposure** — whether hosted Supabase runs a PostgREST version with the same behaviour (decides whether this is a dev-only flake or a user-facing bug).

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| 1. Clock skew between hosts | GoTrue (issues `iat`) and PostgREST (checks it) run in the same Docker VM, so they share one kernel clock; the auth container and the WSL host read the same second. The app host's clock is not involved in either step. PostgREST also allows 30 s of skew (`allowedSkewSeconds = 30`, `src/PostgREST/Auth/Jwt.hs:71` in v14.5), far more than any WSL drift seen. GoTrue truncates `iat` to whole seconds, which makes it earlier, never later. | NONE |
| 2. PostgREST's stale time cache | Local `Server: postgrest/14.5`. v14.5 takes "now" from an `auto-update` cache (`AppState.hs`), which can hand threads a stale value, especially after idle periods (wai#1102; PostgREST#5172 reproduces it with local Supabase Auth, 1/20 vs 0/20 with direct `getCurrentTime`). Upstream CHANGELOG: v14.17 "JWT validation uses wrong current time due to a bug in auto-update (#5159)" (partial); v14.18 (2026-09-10) "Fix sporadic "PGRST303 JWT issued at future" errors (#5196)" by removing the cache. Also v14.18: "Fix wrong time appearing on logs after long idle periods (#5213)". Matches both sightings: the first request after a quiet period, intermittent, gone on reload. | STRONG |
| 3. App-side token handling | `src/middleware.ts:20` only calls `supabase.auth.getUser()`; the dashboard (`src/pages/dashboard.astro:27-35`) queries PostgREST with the same cookie session through `createClient`. Nothing in `src/` mints, refreshes or re-times a JWT (`grep getSession/setSession/getClaims`: none). | NONE |
| 4. Production exposure | **Production PostgREST is 14.5** (user checked the Supabase dashboard, 2026-10-04): the affected version. supabase/discussions/48123: fresh hosted sign-ins rejected with PGRST303 in many regions; a Supabase staff reply says hosted systems were rolled back to 14.5, with the v14.18 rollout "inconsistent". supabase/supabase#50651 (hosted, open) reports the stale value sometimes outlasting a 2 s retry. Production has no user traffic yet (MVP, per user 2026-10-04), so its logs can't show occurrences either way. | STRONG (affected version confirmed; exposure latent until the first users) |

## Narrowing Signals

- **Production runs PostgREST 14.5** (user, Supabase dashboard): the version with the stale time cache. It has **no user traffic yet** (MVP), so the exposure is latent: the first real users will meet it at exactly the trigger moment, the first dashboard load right after a fresh sign-in, password reset or (S-04) invitation, often after the project sat idle.
- **The local stack runs 14.5 because it mirrors production**: `supabase link` (used for `db push` to production) wrote `supabase/.temp/rest-version` = `v14.5` and `gotrue-version` = `v2.197.0` (gitignored), and the CLI starts those images locally. CI never links, so it gets the CLI's default images.
- **CI history is clean**: all 73 completed `smoke` jobs (2026-09-24 → 2026-10-04) end "All smoke steps passed", with no `FAIL` line, no `PGRST303`, and no retried runs. CI ran `postgrest:v16.2` (35 runs, pre-fix) then `v16.4` (38 runs, fixed). Zero failures even on v16.2 fits the idle-staleness mechanism: a fresh stack with back-to-back requests never sits idle. (The Worker's own logs aren't in CI output, since `astro preview` daemonizes; only step failures are visible.)

- Shared Docker kernel clock plus PostgREST's 30 s allowance rules out host clock skew; the cause must sit inside PostgREST.
- The upstream fix (v14.18) and the reproduction on local Supabase Auth (PostgREST#5172) match this project's local versions (PostgREST 14.5, GoTrue 2.197.0) and its intermittent, reload-fixes-it symptom.
- The production answer is still open: the user hasn't checked production logs, and hosted projects are reported as both affected and pinned to 14.5.

## Cross-System Convention

Upstream fixed it at the source (removed the time cache in PostgREST v14.18 / v16.3). Hosted Supabase users without control over the version apply a narrow client-side retry: only on 401 with `PGRST303` "JWT issued at future", with backoff, since a single fixed short retry can hit a still-stale worker thread (#50651). Locally, a newer PostgREST image removes the cause for development and the smoke. The initial direction (one retry after ~1 s) is in that family but sized for clock skew, not for a cache that can stay stale longer.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: PostgREST v14.5's stale time cache can reject freshly issued Supabase sessions with `PGRST303 JWT issued at future`, locally for sure and probably on hosted production, and the dashboard turns that one transient error into "Something went wrong".

There is no clock to fix: the cause is a known, upstream-fixed PostgREST bug in the version both stacks likely run. Two separate levers follow: the PostgREST version the local stack (and CI) runs, which removes the cause for development and smoke, and the dashboard's tolerance of this one transient error, which is the only lever for production while Supabase controls the hosted version. Only the second protects real users; only the first stops local smoke flakes for sure.

## Confidence

**HIGH** — shared clock rules out skew; upstream changelog, code and a matching reproduction explain the mechanism; production and the local stack both run the affected 14.5 (local because it mirrors production via `supabase link`); CI's clean history on fresh v16.x stacks fits. Production logs can't add evidence: there is no traffic yet.

## What Changes for /10x-plan

The plan is about PostgREST's stale time cache, not clock skew: decide whether the local stack should keep mirroring production's PostgREST (it is 14.5 only because `supabase link` pinned it; CI already runs v16.x), and how the dashboard (and any other server-side PostgREST reads after sign-in) should tolerate `PGRST303` "JWT issued at future" in production. A single fixed 1 s retry may be too short, per hosted reports. The issue title and #55's "Likely cause" line should be corrected.

## References

- Source files: `src/pages/dashboard.astro:27-39`, `src/middleware.ts:20`, `src/lib/services/plans.ts`, `wrangler.jsonc:15`, `supabase/config.toml:158`
- Local stack: `public.ecr.aws/supabase/postgrest:v14.5`, `gotrue:v2.197.0`, Supabase CLI 2.119.0
- Upstream: PostgREST CHANGELOG v14.17 (#5159), v14.18 (#5196, #5213); https://github.com/PostgREST/postgrest/issues/5172; https://github.com/PostgREST/postgrest/issues/5196; https://github.com/yesodweb/wai/issues/1102
- Supabase: https://github.com/orgs/supabase/discussions/48123; https://github.com/supabase/supabase/issues/50651
- Prior sightings: `context/archive/2026-10-04-password-reset/follow-ups/review-fixes.md`, `.../reviews/impl-review-phase-3.md` (F5); issue #55
