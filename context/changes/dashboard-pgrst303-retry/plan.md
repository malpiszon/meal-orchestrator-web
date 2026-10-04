# Dashboard PGRST303 Retry Implementation Plan

## Overview

PostgREST v14.5 (the version both production and the local stack run) can reject a freshly issued Supabase session with 401 `PGRST303` "JWT issued at future" because of a stale time cache (fixed upstream in v14.18). The dashboard turns that one transient error into "Couldn't load your plan". This plan adds a narrow retry to every plan call in `src/lib/services/plans.ts`, retrying up to twice (after 500 ms, then 1500 ms) on that error only, documents the local stack's version pin, and corrects issue #55.

## Current State Analysis

- The dashboard runs `getCurrentPlan` and `getUpcomingPlan` in parallel (`src/pages/dashboard.astro:33-36`); any throw sets `loadFailed` and logs `dashboard plan load failed: …` (`:37-40`). `getPlanRecency` runs after (`:44-50`) and degrades to no notes on failure.
- The plan writes `choose_plan_option` / `confirm_plan` go through `savePlan` (`src/lib/services/plans.ts:111-130`) from `handlePlanSave` (`src/lib/plan-save.ts:73-80`); a PGRST303 there classifies as `failed` → 500 `save_failed`.
- All services turn `error.code` + `error.message` into a thrown message (`plans.ts:29-31`, `:56-58`, `:77-79`, `:118-123`).
- The Supabase client's built-in retry (`@supabase/postgrest-js` 2.117.2, `fetchWithRetry`) only retries 503/520 and network errors on GET/HEAD/OPTIONS. A 401 is never retried, and `.rpc()` calls are POST. So nothing retries PGRST303 today.
- Cause (frame, HIGH confidence): PostgREST 14.5's `auto-update` time cache can hand a stale "now" after idle periods; upstream fixed it in v14.18 (#5196). Not clock skew: GoTrue and PostgREST share one clock, with a 30 s allowance.
- Versions (re-checked 2026-10-04 with `supabase link`): production PostgREST **v14.5**, GoTrue v2.197.0. `supabase start` uses the gitignored `supabase/.temp/rest-version`, so the local stack mirrors production. CI never links and runs the CLI default v16.x (fixed); its 73 smoke runs are clean.

## Desired End State

On the first dashboard load after sign-in, password reset or (later) an invitation, a PGRST303 "JWT issued at future" from PostgREST costs at most ~2 s of extra latency instead of an error card. Each retry logs a warning in the Worker logs, so production occurrences become visible once there are users. Other errors behave exactly as today. The README explains why the local stack runs PostgREST 14.5 and how to re-check it, and issue #55 describes the real cause.

Verify: unit tests for the retry helper pass, the smoke passes against the local 14.5 stack, and a manual sign-in after an idle period renders the dashboard.

### Key Discoveries:

- PostgREST builders are thenables that execute when awaited (`postgrest-js` `then`, `dist/index.mjs:391`). A retry must call a factory that builds a **new** request per attempt, not await the same builder again.
- PGRST303 is raised in PostgREST's JWT check, before any SQL runs, so retrying the `choose_plan_option` / `confirm_plan` POSTs cannot double-apply a write.
- Error logs carry code + message only, never user data (`dashboard.astro:38`, `plan-save.ts:21-24`). The retry warning follows that rule.
- Unit tests live next to their module as `src/lib/**/*.test.ts` (`vitest.config.ts` include), run under `TZ=Pacific/Honolulu`.

## What We're NOT Doing

- Not changing the local or CI PostgREST version. The local stack keeps mirroring production (14.5) on purpose, so it reproduces production's behaviour; CI keeps the CLI default.
- Not retrying any other error (other 401s such as PGRST301 expired JWT, `not_found`, `plan_locked`, network errors already covered by postgrest-js).
- Not touching the MO delivery (`ingest_weekly_plan`, service-role key, not a fresh user JWT) or keep-alive RPCs.
- Not adding a client-side retry or reload button to the error card; the copy stays as is.
- Not retrying longer than ~2 s total; if staleness outlasts that (supabase#50651), the page still shows the error.
- Not touching the middleware's `getUser()` (GoTrue, not PostgREST).

## Implementation Approach

A small generic helper wraps "build and run one PostgREST request" and retries it on exactly one error signature, with a fixed delay schedule. Each service function passes a factory to it, so all five plan calls share one policy. Keeping it in the services keeps `dashboard.astro` and `plan-save.ts` unchanged. Their existing error handling still applies after retries run out.

## Critical Implementation Details

- **Timing & lifecycle**: the helper must call the factory once per attempt (see Key Discoveries). The two dashboard reads run in parallel and retry independently; that is fine, since the worst case is still ~2 s of wall time, and Workers' `setTimeout` waits don't use CPU time.
- **Debug & observability**: one `console.warn` per retry, naming the call (e.g. `weekly_plans query`), the attempt (`1/2`) and the delay. That is the only production signal for whether 14.5's staleness reaches users.

## Phase 1: Retry wrapper in the plan services

### Overview

Add the PGRST303 retry helper with tests and route every call in `src/lib/services/plans.ts` through it.

### Changes Required:

#### 1. Retry helper

**File**: `src/lib/postgrest-retry.ts` (new)

**Intent**: Run a PostgREST request and, when its result's error is PostgREST's stale-clock rejection, wait and run a fresh request again, up to two retries. Any other result (success or other error) is returned immediately; after the last retry, the last result is returned unchanged, so callers keep their existing error handling.

**Contract**:
- Exported delay schedule `PGRST303_RETRY_DELAYS_MS = [500, 1500]` (2 retries, ≤ 2 s added).
- Exported predicate `isJwtIssuedAtFuture(error)`: true only when `error.code === "PGRST303"` and the message contains "issued at future" (case-insensitive). PGRST303 also covers other JWT claim failures, which must not retry.
- `withPgrst303Retry<R extends { error: { code?: string; message: string } | null }>(label: string, run: () => PromiseLike<R>): Promise<R>`. `run` builds a new request on each call.
- Before each retry: `console.warn("<label>: PGRST303 JWT issued at future, retry <n>/2 in <ms> ms")`. Code and message only, no user data.

#### 2. Route the plan services through it

**File**: `src/lib/services/plans.ts`

**Intent**: Wrap all five calls (`getUpcomingPlan`, `getCurrentPlan`, `getPlanRecency`, and `savePlan` for `choose_plan_option` / `confirm_plan`) in `withPgrst303Retry`, with labels matching their existing error-message prefixes (`weekly_plans query`, `get_plan_recency`, `<fn>`). Each still throws as today when the final result has an error.

**Contract**: Public signatures and thrown messages unchanged. Update the JSDoc of the read functions and `savePlan` to say they retry PGRST303 "JWT issued at future" (with a pointer to the helper).

#### 3. Tests

**File**: `src/lib/postgrest-retry.test.ts` (new)

**Intent**: Prove the policy with fake timers and a stub `run` that returns scripted results.

**Contract**: Cases:
- success on the first try → 1 call, no wait, no warning;
- PGRST303 "JWT issued at future" then success → 2 calls, returned after 500 ms, 1 warning `… retry 1/2 in 500 ms`;
- PGRST303 twice then success → 3 calls, after 500 + 1500 ms;
- PGRST303 three times → 3 calls, the third (error) result returned;
- PGRST303 with a different message (e.g. "JWT expired" style claim error), PGRST301, and P0002 `not_found` → 1 call, returned at once;
- `run` is invoked once per attempt (fresh request).

Plus one test through a service: `getUpcomingPlan` with a stub client whose builder chain yields PGRST303 then data returns the data; this pins the wiring.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Build passes: `npm run build`

#### Manual Verification:

- Code review: `dashboard.astro` and `plan-save.ts` unchanged; all five service calls go through `withPgrst303Retry` with a factory

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Docs, issue and local verification

### Overview

Document why the local stack runs PostgREST 14.5 and what the app does about it, correct issue #55, and verify end to end against the local 14.5 stack.

### Changes Required:

#### 1. README

**File**: `README.md`

**Intent**: In "First-time setup (local…)" (near the `npx supabase start` paragraph), add a short note: after `supabase link`, `supabase start` runs the linked project's service versions (`supabase/.temp/rest-version`, gitignored, refreshed by every `supabase link`). Production and local currently run PostgREST v14.5, whose stale time cache can reject a fresh session once with `PGRST303 JWT issued at future`. The plan services retry that error twice (0.5 s, 1.5 s) and log `… PGRST303 JWT issued at future, retry n/2 …`. CI doesn't link and runs the CLI default (fixed) version. In "Swapping and saving the upcoming plan", no route contract changes, so no edit there.

**Contract**: One new paragraph under the local setup section; no other section changes.

#### 2. Issue #55

**Intent**: Make the issue describe the real cause and the agreed fix.

**Contract**: `gh issue edit 55`:
- title → `Dashboard: retry plan loads on PGRST303 (JWT issued at future)`;
- replace the "Likely cause" line with: PostgREST v14.5's stale time cache (upstream fix v14.18, #5196), not clock skew; production runs 14.5 (checked 2026-10-04); see `context/changes/dashboard-pgrst303-retry/frame.md`;
- first Definition-of-done box → `The plan services retry PGRST303 "JWT issued at future" up to twice (0.5 s, 1.5 s) and the dashboard renders normally`.

Tick the DoD boxes as they are met.

### Success Criteria:

#### Automated Verification:

- Prettier passes on the README: `npx prettier --check README.md`
- Smoke passes against the local 14.5 stack: `npm run build && npm run preview -- --port 4322`, then `BASE_URL=http://localhost:4322 MO_INGEST_TOKEN=<token> SUPABASE_URL=… SUPABASE_KEY=… SUPABASE_SERVICE_ROLE_KEY=… npm run smoke`
- Issue #55 shows the new title, cause and DoD text: `gh issue view 55`

#### Manual Verification:

- After leaving the local stack idle for a few minutes, signing in on :4322 lands on a dashboard showing the plan or "No upcoming plan yet", not "Couldn't load your plan"; any retry shows as a `PGRST303 … retry` warning in the preview logs
- README note reads correctly next to the local setup steps

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Unit Tests:

- Retry policy in `src/lib/postgrest-retry.test.ts` (schedule, predicate precision, fresh request per attempt, returns last result, warning text).
- One service-level wiring test for `getUpcomingPlan`.

### Integration Tests:

- Existing smoke (`npm run smoke`) on :4322 against the local 14.5 stack; CI's smoke on v16.x keeps proving no regression on the happy path.

### Manual Testing Steps:

1. Start the preview on :4322 against the local stack (PostgREST 14.5).
2. Leave it idle a few minutes, then sign in.
3. Confirm the dashboard renders; check the preview output for a retry warning (it may or may not occur, since the bug is intermittent).

## Performance Considerations

Only the failing case pays: up to 2 s extra per affected request. Successful calls are unchanged (no wait, no extra request).

## Migration Notes

None: no schema, route or secret changes. The PR needs no pre-merge production step.

## References

- Frame brief: `context/changes/dashboard-pgrst303-retry/frame.md`
- Code: `src/pages/dashboard.astro:30-51`, `src/lib/services/plans.ts:14-130`, `src/lib/plan-save.ts:73-80`
- postgrest-js retry scope: `node_modules/@supabase/postgrest-js/dist/index.mjs:61-230`
- Upstream: PostgREST CHANGELOG v14.18 (#5196); https://github.com/supabase/supabase/issues/50651
- Issue: #55; phase sub-issues: Phase 1 #58, Phase 2 #59

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Retry wrapper in the plan services

#### Automated

- [x] 1.1 Unit tests pass: `npm test` — 32b9e02
- [x] 1.2 Lint passes: `npm run lint` — 32b9e02
- [x] 1.3 Type check passes: `npx astro check` — 32b9e02
- [x] 1.4 Build passes: `npm run build` — 32b9e02

#### Manual

- [x] 1.5 Code review: `dashboard.astro` and `plan-save.ts` unchanged; all five service calls go through `withPgrst303Retry` with a factory — 32b9e02

### Phase 2: Docs, issue and local verification

#### Automated

- [x] 2.1 Prettier passes on the README: `npx prettier --check README.md`
- [x] 2.2 Smoke passes against the local 14.5 stack
- [x] 2.3 Issue #55 shows the new title, cause and DoD text: `gh issue view 55`

#### Manual

- [x] 2.4 After an idle period, signing in on :4322 renders the dashboard, not "Couldn't load your plan"
- [x] 2.5 README note reads correctly next to the local setup steps
