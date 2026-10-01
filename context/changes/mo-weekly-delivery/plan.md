# MO Weekly Delivery (S-01) Implementation Plan

## Overview

Give Meal Orchestrator (MO) an authenticated endpoint to deliver a user's weekly recommendation together with that week's full menu. mo-web stores each delivery per user and week, with row-level security, and the dashboard shows the upcoming plan or an explicit "no upcoming plan yet" state. Roadmap S-01, issue #4; PRD FR-001, FR-002, FR-007, US-01 (view part), US-05, NFR data isolation.

This change covers mo-web only. What MO must change (meal-ID pass-through, a delivery step, failure alerting) is specified in `context/changes/mo-weekly-delivery/mo-delivery-contract.md` and built separately in the MO repo.

## Current State Analysis

- **mo-web:** starter auth only. `src/middleware.ts:4` protects `/dashboard`. `src/lib/supabase.ts` builds a cookie-session SSR client from `SUPABASE_URL`/`SUPABASE_KEY`, both declared `optional: true` in `astro.config.mjs:24-27`. `src/pages/dashboard.astro` is a placeholder. The only migration is `supabase/migrations/20260925192719_keepalive_function.sql`. There is no service-role key, no test runner, and `scripts/smoke.mjs` only checks status/location.
- **MO (read from `/home/alan/workspaces/meal-orchestrator`):**
  - The normalized `CanonicalMenu` → `CanonicalDay` → `CanonicalMeal{type, variants[]}` → `MealVariant{name, composition, nutrition}` has **no meal IDs** (`domain/models.py:37-107`, `providers/ntfy/normalizer.py:180-199`).
  - Raw provider rows carry `configurable_product_id`. It stays stable across weeks, offers and sizes, and one dish (cfg 2654) appears under both a German and a Polish name, so names are not a usable identity.
  - The LLM scores **every** variant 1–10 with 1–2 `{icon, text}` justifications (`domain/llm_output.py:10-85`), and ties happen (`rendering/html.py:115` stars every tied variant).
  - A week is Mon–Fri with `week_start` = the nearest upcoming Monday in `Europe/Warsaw` (`orchestrator.py:96-99`, `domain/dates.py:6-14`). Users are identified by `email` (`config/models.py:73-83`). Nutrition covers protein, fat, saturated fat, carbs, sugar, fiber and salt, in grams.
- **Constraints:**
  - Workers free plan: 10 ms CPU per request (`context/foundation/infrastructure.md:63`), so ingestion is a single database call.
  - MO's POST must not hit bot protection (`infrastructure.md:76,99`).
  - Development uses local Docker Supabase. The cloud project is production only (`infrastructure.md:113`).

## Desired End State

- `POST /api/mo/deliveries` with a valid bearer token and a valid v1 payload for a known email stores the week and returns 200. A second delivery for the same (user, week_start) replaces it.
- A bad or missing token returns 401, and an invalid payload returns 400 with the issues listed.
- A delivery for an email mo-web hasn't seen creates that account first (MO is the authority on who has an account), then stores the week. No email is sent, and the account has no password until S-04 invites the user.
- A signed-in user whose newest plan has `week_start` after today (Europe/Warsaw) sees it on `/dashboard`: per day and meal slot, the recommended option (highest score; ties go to the option listed first in the menu) with its score and justifications, plus the other options with their scores.
- Any other signed-in user sees "No upcoming plan yet". A user never sees another user's plans: RLS restricts `select` to the user's own rows, and no role can write directly.
- CI runs unit tests plus smoke steps that POST a sample delivery and check the dashboard. The post-deploy smoke checks that the endpoint answers 401 without a token.

### Key Discoveries:

- `sorted_variants_by_score` sorts by score only, and the email stars every tied variant (MO `rendering/join.py:39-46`, `rendering/html.py:115`). mo-web's tie rule (first in menu) is its own decision.
- MO already has `http.post_json`, `with_retries`/`is_transient_http_error` and an idempotency-key pattern (MO `http.py:7-15`, `retries.py:11-71`, `workflow.py:482`). The contract document builds on these.
- `supabase status -o env` exposes `SERVICE_ROLE_KEY` locally, and CI's smoke job already writes `.env`/`.dev.vars` from that output (`.github/workflows/ci.yml` smoke job).
- The worker handler (`src/worker.ts`) and middleware run for every request. The delivery route has no cookie session, so middleware can skip `getUser()` for it.

## What We're NOT Doing

- MO-side code (normalizer ID pass-through, delivery step, alerting). It is specified in `mo-delivery-contract.md` and built in the MO repo.
- Invitation emails, accepting an invite, and removing public sign-up (S-04). S-01 only creates the account. S-04 must also invite accounts that S-01 created earlier; they can be found by `app_metadata.provisioned_by = "mo-delivery"` and no confirmed email.
- Showing the in-progress week. The dashboard shows only the upcoming plan or the waiting state (decided in planning).
- Recency annotations or moving plans to history (S-02), swapping or saving (S-03), and ratings (S-08).
- A smarter tie-break between equally scored options. Parked on the roadmap as a nice-to-have outside the MVP.
- RLS isolation tests with two users. Isolation rests on the policies plus a manual check.
- Showing nutrition data. It is stored but not displayed (FR-014 is parked). Calories aren't sent by MO today.
- HMAC signatures or replay protection. A static bearer token is enough.
- Keeping saved choices on re-delivery (FR-018). There are no saved choices yet.

## Implementation Approach

1. **Database first.** A migration creates `weekly_plans` and `plan_meal_options`. RLS allows only `select` for the owner. All writes go through a `security definer` function, `ingest_weekly_plan`, that only `service_role` may execute. It resolves the user by email and replaces that week's rows in one transaction.
2. **Delivery endpoint.** It checks the bearer token and validates the v1 payload with zod. It then flattens the payload into option rows, deciding `is_recommended` in TypeScript so the rule can be unit-tested, and calls the function once through a service-role Supabase client.
3. **Dashboard.** Server-rendered Astro (no interactivity, so no React island). It reads through the user's cookie-session client, so RLS applies.
4. **Verification.** Vitest covers the pure logic; the smoke script covers the HTTP flow end to end in CI.

## Critical Implementation Details

- **Payload contract (v1).** The endpoint, the sample payload and `mo-delivery-contract.md` all depend on this shape. MO joins its menu with its assessment, so each variant carries its own score. `variant_index` is not sent: it is the variant's position in the array, which is the provider's menu order and the basis of the tie rule. `provider_meal_id` is a string (MO sends `str(configurable_product_id)`).

  ```json
  {
    "schema_version": 1,
    "run_id": "3f2c…",
    "provider": "ntfy",
    "week_start": "2026-10-05",
    "week_end": "2026-10-09",
    "user": { "email": "user@example.com" },
    "days": [
      {
        "date": "2026-10-05",
        "meals": [
          {
            "type": "breakfast",
            "variants": [
              {
                "provider_meal_id": "496",
                "name": "Kofty z miętą…",
                "composition": "…",
                "nutrition": { "protein_g": 23.8, "salt_g": 2.0 },
                "score": 8,
                "justifications": [{ "icon": "🥗", "text": "…" }]
              }
            ]
          }
        ]
      }
    ]
  }
  ```

  Validation rules:
  - `week_start` is a Monday, and `week_end` is on or after `week_start` and at most 6 days later.
  - Every `date` is unique and falls within `[week_start, week_end]`.
  - `type` is one of `breakfast | second_breakfast | lunch | tea | dinner | snack` and is unique within a day.
  - Each meal has 1–10 variants, and `provider_meal_id` is unique within a meal.
  - `name` is a non-empty string. `composition` is a string, and `""` is accepted and stored as `null`.
  - `score` is an integer from 1 to 10. There are 0–5 justifications.
  - `nutrition` is optional, with each key an optional number.
  - Unknown top-level keys are rejected, so contract drift fails loudly.
  - Emails are compared case-insensitively.
- **"Upcoming" boundary.** "Today" is the calendar date in `Europe/Warsaw`, not UTC. A plan is upcoming only while `week_start > today`, so on the plan's first day (Monday) it stops being upcoming and the dashboard shows the waiting state. This matches the PRD's editable-until-first-day rule. Among qualifying plans the latest `week_start` wins.
- **Account provisioning order.** The endpoint calls `ingest_weekly_plan`. On `unknown_user` it creates the account with `auth.admin.createUser({ email, email_confirm: false, app_metadata: { provisioned_by: "mo-delivery" } })` and calls the function once more. The account must stay unconfirmed and without a password, because GoTrue's invite refuses already-confirmed users and S-04 relies on inviting these accounts. If `createUser` fails because the email already exists (two deliveries racing), go straight to the retry. A failure after the account was created leaves the account in place and returns 500; MO's retry then stores the week, because provisioning is idempotent.
- **Middleware.** `/api/mo/` must never be added to `PROTECTED_ROUTES` (MO has no cookie session). The middleware should skip the `getUser()` round-trip for it.

## Phase 1: Schema & ingestion function

### Overview

Tables, RLS and the one write path, applied to local Supabase.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_weekly_plans.sql`

**Intent**: Store one plan per user and week, with every menu option normalized, so S-02's recency lookups and S-03's swaps are indexed SQL rather than jsonb unnesting. Keep the raw payload for re-deriving data later.

**Contract**:
- **`public.weekly_plans`:**
  - `id uuid pk default gen_random_uuid()`
  - `user_id uuid not null references auth.users on delete cascade`
  - `provider text not null`
  - `week_start date not null`
  - `week_end date not null`
  - `mo_run_id text`
  - `raw_payload jsonb not null`
  - `received_at timestamptz not null default now()`
  - `unique (user_id, week_start)`
- **`public.plan_meal_options`:**
  - `id uuid pk`
  - `plan_id uuid not null references weekly_plans on delete cascade`
  - `user_id uuid not null`, denormalized for RLS and S-02 indexes
  - `meal_date date not null`
  - `meal_type text not null`
  - `variant_index smallint not null`
  - `provider_meal_id text not null`
  - `name text not null`
  - `composition text`
  - `nutrition jsonb`
  - `score smallint not null check (score between 1 and 10)`
  - `justifications jsonb not null default '[]'`
  - `is_recommended boolean not null`
  - `unique (plan_id, meal_date, meal_type, variant_index)`
  - Index on `(user_id, provider_meal_id, meal_date)` for S-02.
- **RLS and grants:**
  - RLS is enabled on both tables.
  - Per-operation, per-role policies: `select` for `authenticated` using `user_id = (select auth.uid())`.
  - No `insert`/`update`/`delete` policies for `anon` or `authenticated`, and no `anon` policy at all.
  - Revoke table write privileges from `anon`/`authenticated`.

#### 2. Ingestion function

**File**: same migration.

**Intent**: One atomic, low-CPU write path that bypasses RLS only through a narrowly granted function.

**Contract**:
- Signature: `public.ingest_weekly_plan(p_email text, p_provider text, p_week_start date, p_week_end date, p_run_id text, p_raw jsonb, p_options jsonb) returns uuid`.
- Declared `language plpgsql security definer set search_path = ''`.
- Resolves `auth.users` by `lower(email) = lower(p_email)`. If there is no match it raises a distinct error, `raise exception using errcode = 'P0002', message = 'unknown_user'`, which tells the endpoint to create the account and call again (see Account provisioning order).
- Upserts `weekly_plans` on `(user_id, week_start)`, refreshing every column and `received_at`.
- Deletes that plan's `plan_meal_options` and inserts the rows from `p_options`, a jsonb array of `{meal_date, meal_type, variant_index, provider_meal_id, name, composition, nutrition, score, justifications, is_recommended}`, using `jsonb_to_recordset`.
- Returns the plan id.
- `revoke execute … from public, anon, authenticated`, then `grant execute … to service_role`.

### Success Criteria:

#### Automated Verification:

- Migration applies on a fresh local stack: `npx supabase db reset`
- The function is not executable by `anon`: calling `rpc('ingest_weekly_plan')` with the anon key returns a permission error (checked from the smoke script in Phase 4, or ad hoc via `psql` now)
- Lint and type check pass: `npm run lint && npx astro check`

#### Manual Verification:

- In local Studio, both tables show RLS enabled with only the `select` policy for `authenticated`
- A `psql` call to `ingest_weekly_plan` for an existing local user inserts one plan with its options. A second call for the same week replaces the options instead of duplicating them. An unknown email raises `unknown_user`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Delivery endpoint & MO contract

### Overview

The authenticated, validated HTTP entry point, the sample payload, the MO requirements document and the unit-test tooling.

### Changes Required:

#### 1. Environment

**Files**: `astro.config.mjs`, `.env.example`, `README.md`

**Intent**: Declare the two new server secrets and document local and production setup.

**Contract**:
- Add `SUPABASE_SERVICE_ROLE_KEY` and `MO_INGEST_TOKEN` to `env.schema` with `context: "server"`, `access: "secret"`, `optional: true`, following the existing pattern.
- The endpoint returns 503 `{"error":"not_configured"}` when either secret is missing, so a deploy without them fails visibly.
- `.env.example` gets both keys. The README explains that the local value is `SERVICE_ROLE_KEY` from `npx supabase status -o env`, that production uses `npx wrangler secret put`, and describes the delivery endpoint.

#### 2. Payload schema and mapping

**File**: `src/lib/mo-delivery.ts`

**Intent**: The single definition of payload v1, plus the pure function that flattens it into option rows and marks the recommended option per slot. It has no `astro:env` import, so Vitest can load it.

**Contract**:
- `moDeliverySchema` is a zod schema enforcing the rules in Critical Implementation Details.
- `type MoDelivery = z.infer<…>`.
- `toOptionRows(delivery): OptionRow[]` sets `variant_index` to the array position. `is_recommended` is true for exactly one variant per (date, meal type): the highest score, with ties going to the lowest `variant_index`.
- Shared row types go in `src/types.ts`.

#### 3. Service-role client

**File**: `src/lib/supabase.ts`

**Intent**: A cookie-less admin client for machine-to-machine writes, kept out of any user-facing code path.

**Contract**: `createServiceClient(): SupabaseClient | null`. It uses `createClient` from `@supabase/supabase-js` with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` and `auth: { persistSession: false, autoRefreshToken: false }` (same options as `src/lib/keepalive.ts`). It returns `null` when unconfigured.

#### 4. Delivery route

**File**: `src/pages/api/mo/deliveries.ts`

**Intent**: Accept MO's weekly delivery.

**Contract**:
- `export const prerender = false`, `export const POST: APIRoute`.
- Order of checks:
  1. Configuration (503).
  2. `Authorization: Bearer <token>`, compared in constant time against `MO_INGEST_TOKEN`, using a Workers-safe constant-time compare, e.g. a SHA-256 of both values then XOR. Failure returns 401 `{"error":"unauthorized"}`.
  3. JSON parse and `moDeliverySchema.safeParse`. Failure returns 400 `{"error":"invalid_payload","issues":[…]}`.
  4. `rpc('ingest_weekly_plan', …)` with `toOptionRows` output. On `unknown_user`, create the account and call again (see Account provisioning order). Any other database or Admin API error is logged with `console.error` and returns 500 `{"error":"storage_failed"}`.
  5. Success returns 200 `{"plan_id","week_start","account_created"}`, where `account_created` is true only when this request created the account.
- All responses are JSON. The body is never logged (it contains the email).

#### 5. Middleware

**File**: `src/middleware.ts`

**Intent**: Skip the Supabase `getUser()` round-trip for `/api/mo/` requests. They carry no session, and skipping saves CPU and latency.

**Contract**: `context.locals.user = null` and `next()` for paths starting with `/api/mo/`. `PROTECTED_ROUTES` is unchanged.

#### 6. Sample payload

**File**: `scripts/fixtures/mo-delivery.sample.json`

**Intent**: A realistic v1 payload for smoke, unit tests and manual production verification.

**Contract**:
- Built from MO's `tests/fixtures/ntfy/canonical_offer6_week_2026-06-29.json` (5 days, breakfast and lunch, 3 variants each).
- `provider_meal_id` values are the matching `configurable_product_id`s from the raw fixtures where available, otherwise plausible numeric strings.
- Scores and justifications are illustrative, and at least one slot has a two-way tie for the top score.
- The email is a placeholder. Smoke and manual runs rewrite the email and dates.

#### 7. MO requirements document

**File**: `context/changes/mo-weekly-delivery/mo-delivery-contract.md`

**Intent**: Everything the MO repo must implement, as a standalone spec. **Drafted during planning.** In this phase, reconcile it with the final `moDeliverySchema` and response codes, so that any divergence is fixed in whichever document is wrong.

**Contract**: Sections covering:
- Endpoints and auth: a dev endpoint (the local mo-web dev server) and a prod endpoint (`https://mo-web.malpiszon.workers.dev/api/mo/deliveries`), each with its own token, sent as `Authorization: Bearer <token>`.
- Payload v1 and its validation rules.
- Response codes and whether MO should retry each:
  - 5xx, 429 and network errors: retry through `with_retries`/`is_transient_http_error`.
  - 400 and 401: don't retry; alert.
- Idempotency: re-sending a week replaces it, so a manual retry is safe.
- MO changes:
  - Carry `configurable_product_id` through `MealVariant` as `provider_meal_id`.
  - Add a new `delivery/mo_web.py` client behind a Protocol, injected like the email client and built only when the config has a `delivery.mo_web` section: `url` for the environment's endpoint (dev or prod, one config file per MO deployment) and `token_env`, the name of the env var holding that environment's token.
  - Add a best-effort delivery step after email in both `execute_from_menu` and `execute_from_llm_result`. A failure never affects email or the run status, is logged, and posts to the ops Discord webhook via `notify_safely`.
  - Skip the step in dry-run.
- Manual retry procedure.

#### 8. Unit tests

**Files**: `package.json`, `vitest.config.ts`, `src/lib/mo-delivery.test.ts`

**Intent**: Set up Vitest and cover the contract logic.

**Contract**:
- Add `vitest` as a dev dependency, with a `test` script (`vitest run`) and the `@` alias resolved in the config.
- Tests:
  - The sample payload passes, and so does a variant with `composition: ""`, which maps to `null`.
  - Rejections: non-Monday `week_start`, a date outside the week, a duplicate meal type, score 0 or 11, an unknown top-level key, a missing `provider_meal_id`.
  - `toOptionRows`: exactly one recommended option per slot, a tie resolved to the lowest index, and `variant_index` equal to array order.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Lint and type check pass: `npm run lint && npx astro check`
- Build succeeds: `npm run build`

#### Manual Verification:

- Against `npm run dev` with local Supabase and a signed-up local user, curl the sample for that user's email. Without a token you get 401, with a malformed body 400, and for the known email 200. Rows appear in Studio, and a repeated POST keeps a single plan
- A POST for a new email returns 200 with `account_created: true`, and the Studio shows the user unconfirmed with `provisioned_by: "mo-delivery"`. A second POST for it returns `account_created: false`, and no email arrives in Mailpit
- Supabase check for S-04: `auth.admin.inviteUserByEmail` for that provisioned account succeeds, and the invitation arrives in Mailpit. Record the result on issue #8
- `mo-delivery-contract.md` reads as a complete spec for the MO repo, with no need to read this plan

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Dashboard

### Overview

Show the upcoming plan or the waiting state.

### Changes Required:

#### 1. Plan-state logic

**File**: `src/lib/plans.ts` (plus `src/lib/plans.test.ts`)

**Intent**: Pure date and grouping helpers, unit-tested around the Warsaw day boundary.

**Contract**:
- `todayInWarsaw(now: Date): string` returns `YYYY-MM-DD`, using `Intl.DateTimeFormat` with `timeZone: "Europe/Warsaw"`.
- `groupPlanOptions(rows)` produces days in date order. Within each day, meal slots follow MO's slot order (`breakfast, second_breakfast, lunch, tea, dinner, snack`). Each slot holds `recommended` and `others`, with `others` sorted by score descending, then index.
- Tests:
  - `2026-10-04T22:30:00Z` is `2026-10-05` in Warsaw.
  - `2026-10-04T21:30:00Z` is still `2026-10-04` in winter time; pick dates around the late-October DST switch.
  - Grouping and ordering.

#### 2. Plan query

**File**: `src/lib/services/plans.ts`

**Intent**: Fetch the upcoming plan for the signed-in user through the RLS-bound client.

**Contract**: `getUpcomingPlan(supabase, today)` runs one `select` of `weekly_plans` with its `plan_meal_options(*)`, where `week_start > today`, ordered by `week_start desc`, `limit 1`. It returns `null` when there is none. There is no explicit `user_id` filter beyond RLS, though adding `eq('user_id', user.id)` as defence in depth is fine.

#### 3. Dashboard page

**File**: `src/pages/dashboard.astro` (plus a small Astro component under `src/components/plan/` if the markup gets long)

**Intent**: A mobile-first view of the upcoming week, replacing the placeholder card and keeping sign-out.

**Contract**:
- **Upcoming plan:** a heading with the week range, then per day (weekday and date) per slot:
  - a human meal-type label, e.g. "Second breakfast";
  - the recommended option's name, `score/10` and its justifications (icon plus text);
  - a `<details>` "Other options" element listing each other option's name and score.
- **No plan:** a card titled "No upcoming plan yet", explaining that MO's recommendation usually arrives Tuesday/Wednesday before the week starts. No older plan is shown.
- **Styling:** design tokens and shadcn `Card`/`Badge`/`buttonVariants` only, following the CLAUDE.md hard rules. No `asChild` in `.astro`.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Lint, type check and build pass: `npm run lint && npx astro check && npm run build`

#### Manual Verification:

- After POSTing the sample (with a future Monday) for the local user, `/dashboard` shows 5 days × 2 slots. The tied slot recommends the first-listed option, and other options expand
- A second local user with no delivery sees "No upcoming plan yet", and does not see the first user's plan
- A delivery whose `week_start` is today or earlier is not shown as upcoming (waiting state)
- The page is readable on a phone-width viewport and in dark mode

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Smoke, CI & production setup

### Overview

End-to-end automation in CI and the one-time production setup.

### Changes Required:

#### 1. Smoke script

**File**: `scripts/smoke.mjs`

**Intent**: Prove the delivery flow over HTTP against the built app.

**Contract**:
- `request()` also returns the response body text and accepts JSON bodies and extra headers.
- The script loads the sample fixture and rewrites `user.email` to the smoke user, `week_start` to the Monday at least 7 days ahead, and the day dates to match.
- Reads `MO_INGEST_TOKEN` from the environment and fails fast if it is unset in normal mode.
- New steps after "signin accepts correct password":
  1. The dashboard shows "No upcoming plan yet".
  2. A delivery without a token returns 401.
  3. A delivery for a new email returns 200 with `account_created: true`.
  4. A delivery for the smoke user returns 200.
  5. The dashboard shows the first recommended meal name.
  6. A re-delivery with a changed name returns 200.
  7. The dashboard shows the new name and not the old one.
- Keep the `KEEPALIVE_EXPECT_FAILURE` mode unchanged.

#### 2. CI

**File**: `.github/workflows/ci.yml`

**Intent**: Run unit tests and give smoke the new secrets.

**Contract**:
- **ci job:** add `npm test` after lint.
- **smoke job:**
  - Also extract `SERVICE_ROLE_KEY` from `supabase status -o env`.
  - Write `SUPABASE_SERVICE_ROLE_KEY` and a fixed test `MO_INGEST_TOKEN` into `.env`/`.dev.vars`.
  - Pass `MO_INGEST_TOKEN` to `npm run smoke`.
- **Post-deploy smoke:** `POST $PROD_URL/api/mo/deliveries` without a token must return `401`. A 503 means the Worker secrets are missing; a 403 or challenge means bot protection is blocking MO.

#### 3. Dev walkthrough: sign in as an account a delivery created

**File**: `README.md` (local development section)

**Intent**: Let the developer see the dashboard exactly as a real user will, on the local dev stack only. The account is created by a delivery, as in production, and then given a password with one Admin API call. That call stands in for the S-04 invitation, which doesn't exist yet.

**Contract**: documented steps against `npm run dev` and local Supabase:
1. POST the sample payload with your email and a future week. The response shows `account_created: true`.
2. Set a password with `curl -X PUT http://127.0.0.1:54321/auth/v1/admin/users/<id>`, using the local `SERVICE_ROLE_KEY` as both `apikey` and `Authorization: Bearer`, and the body `{"password": "…", "email_confirm": true}`. The `<id>` comes from Studio or `GET /auth/v1/admin/users`.
3. Sign in at `/auth/signin` and check the dashboard.

The README states that this is for local development only. Production accounts get their password through the S-04 invitation, and there is no manual account or test delivery in production.

#### 4. Production setup (one-time, human-approved)

**Intent**: Give production the schema and secrets that the new Worker code needs. Nothing account- or user-specific happens in production.

**Contract**: steps recorded in the README Deployment section.

**Timing:** all four phases ship in **one** implementation PR (`Closes #4`), because every merge to `master` deploys to production. Run both steps below **after that PR's CI is green and before merging it**, so the deploy lands on a database and Worker that are already prepared. Don't merge phases to `master` one at a time: for example, the Phase 3 dashboard would query tables that don't exist in production yet.

1. `npx supabase db push` to the linked production project, **before** the Worker code that calls the function is deployed.
2. `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY` and `npx wrangler secret put MO_INGEST_TOKEN`. Generate the token with `openssl rand -hex 32` and store it for MO as `MO_WEB_TOKEN`.

### Success Criteria:

#### Automated Verification:

- Local smoke passes against the preview: `npm run build && npm run preview` then `BASE_URL=http://localhost:4321 MO_INGEST_TOKEN=<local> npm run smoke`
- CI `ci`, `smoke` and `deploy` jobs are green on the PR and on `master`, including the post-deploy 401 probe

#### Manual Verification:

- Dev walkthrough: a delivery for your email creates the account, the admin call sets a password, and after signing in the dashboard shows the delivered plan. Before any delivery, a freshly signed-up dev user sees "No upcoming plan yet"
- The production migration has been pushed and both Worker secrets set (the post-deploy probe returns 401, not 503)
- The MO token has been handed over for the MO-side change, and the contract document is linked from issue #4

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `mo-delivery.test.ts`: covers every schema validation rule, plus the tie-break, the one-recommended-per-slot invariant and index order in `toOptionRows`.
- `plans.test.ts`: covers the Warsaw day boundary (including DST) and grouping/order.

### Integration Tests:

- Smoke (CI, local Supabase, production preview build): auth errors, account creation for a new email, store, dashboard render, replacement on re-delivery, and the waiting state before any delivery.

### Manual Testing Steps:

1. Sign up two local users. Deliver the sample for user A only.
2. As A: the dashboard shows the plan, the tied slot recommends the first-listed option, and "Other options" expands.
3. As B: the dashboard shows "No upcoming plan yet".
4. Deliver for A with `week_start` equal to today's Monday. A's dashboard falls back to the waiting state (if no later plan exists).
5. In a phone-width viewport and dark mode, the dashboard is readable.

## Performance Considerations

Ingestion is one RPC (about 30–90 option rows) with no per-row round-trips, and the dashboard is one `select` with an embedded relation. Both keep Worker CPU well under the free plan's 10 ms. The `(user_id, provider_meal_id, meal_date)` index is there for S-02's recency lookup.

## Migration Notes

The tables are new, so there is no data to migrate. Push the migration to production **before** deploying the Worker code that calls the function (Phase 4 production setup, step 1), which means before merging the single implementation PR. Rollback: `wrangler rollback` for the Worker. The tables can stay, since nothing else depends on them.

## References

- Roadmap item: `context/foundation/roadmap.md` § S-01; issue #4. Phase sub-issues: #24 (Phase 1), #25 (Phase 2), #26 (Phase 3), #27 (Phase 4)
- PRD: `context/foundation/prd.md` (FR-001, FR-002, FR-007, FR-017, US-01, US-05, Plan lifecycle)
- Infrastructure constraints: `context/foundation/infrastructure.md:63,76,84,99,113`
- MO data model: `meal-orchestrator/src/meal_orchestrator/domain/models.py:37-107`, `domain/llm_output.py:10-123`, `providers/ntfy/normalizer.py:78-199`, `workflow.py:258-356,459-524`, `orchestrator.py:93-99`
- Existing patterns: `src/lib/keepalive.ts` (non-cookie client), `supabase/migrations/20260925192719_keepalive_function.sql` (grants, `search_path = ''`), `scripts/smoke.mjs`
- MO requirements: `context/changes/mo-weekly-delivery/mo-delivery-contract.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema & ingestion function

#### Automated

- [x] 1.1 Migration applies on a fresh local stack: `npx supabase db reset`
- [x] 1.2 The function is not executable by `anon`
- [x] 1.3 Lint and type check pass: `npm run lint && npx astro check`

#### Manual

- [x] 1.4 In local Studio, both tables show RLS enabled with only the `select` policy for `authenticated`
- [x] 1.5 `ingest_weekly_plan` inserts, replaces on repeat, and raises `unknown_user` for an unknown email

### Phase 2: Delivery endpoint & MO contract

#### Automated

- [ ] 2.1 Unit tests pass: `npm test`
- [ ] 2.2 Lint and type check pass: `npm run lint && npx astro check`
- [ ] 2.3 Build succeeds: `npm run build`

#### Manual

- [ ] 2.4 Local curl returns 401/400/200 as specified, and a repeated POST keeps a single plan
- [ ] 2.5 A POST for a new email creates an unconfirmed `mo-delivery` account and sends no email, and a repeat returns `account_created: false`
- [ ] 2.6 `inviteUserByEmail` succeeds for a provisioned account (result recorded on #8)
- [ ] 2.7 `mo-delivery-contract.md` reads as a complete spec for the MO repo

### Phase 3: Dashboard

#### Automated

- [ ] 3.1 Unit tests pass: `npm test`
- [ ] 3.2 Lint, type check and build pass: `npm run lint && npx astro check && npm run build`

#### Manual

- [ ] 3.3 The dashboard shows 5 days × 2 slots, the tied slot recommends the first-listed option, and other options expand
- [ ] 3.4 A second user with no delivery sees "No upcoming plan yet" and not the first user's plan
- [ ] 3.5 A delivery with `week_start` today or earlier is not shown as upcoming
- [ ] 3.6 Readable on a phone-width viewport and in dark mode

### Phase 4: Smoke, CI & production setup

#### Automated

- [ ] 4.1 Local smoke passes against the preview
- [ ] 4.2 CI `ci`, `smoke` and `deploy` jobs are green, including the post-deploy 401 probe

#### Manual

- [ ] 4.3 Dev walkthrough: a delivery creates your account, the admin call sets a password, and the dashboard shows the plan
- [ ] 4.4 The production migration has been pushed and both Worker secrets set
- [ ] 4.5 The MO token has been handed over and the contract document is linked from issue #4
