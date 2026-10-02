# MO Weekly Delivery (S-01) — Plan Brief

> Full plan: `context/changes/mo-weekly-delivery/plan.md`
> MO requirements (drafted now; reconciled in Phase 2): `context/changes/mo-weekly-delivery/mo-delivery-contract.md`

## What & Why

Meal Orchestrator (MO) emails a weekly recommendation but remembers nothing. This slice gives MO an authenticated endpoint to deliver each user's week (the recommendation plus the full menu) into mo-web. mo-web stores it per user with row-level isolation, and the dashboard shows the upcoming plan or an explicit "no upcoming plan yet". Everything else in the roadmap (recency, swaps, history) builds on the data shape chosen here.

## Starting Point

mo-web has starter auth, a placeholder dashboard, no tables and no test runner. MO's normalized menu has no meal IDs. The raw provider data carries a `configurable_product_id` that is stable across weeks, while meal names are not (one dish appears under both a German and a Polish name). MO scores every option 1–10, and ties happen.

## Desired End State

MO can call `POST /api/mo/deliveries` with a bearer token. A valid delivery for a known email is stored; re-sending the same week replaces it. A signed-in user sees the upcoming week: for each day and meal, the recommended option with its score and reasons, and the other options expandable. They see only their own data.

## Key Decisions Made

| Decision                     | Choice                                                                               | Why (1 sentence)                                                                                 | Source           |
| ---------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ---------------- |
| Meal identity                | `(provider, configurable_product_id)` sent as `provider_meal_id`                     | Stable across weeks, offers and sizes; names are proven unreliable.                               | Plan             |
| Recommended option per slot  | Highest score; ties go to the option listed first in the menu                        | Deterministic, with no MO change; a smarter tie-break is parked as a nice-to-have outside the MVP. | Plan             |
| MO authentication            | Static bearer token (`MO_INGEST_TOKEN`), compared in constant time                   | Simplest fit for 2–4 users over HTTPS, and easy to rotate.                                        | Plan             |
| MO-side work                 | Not built here; specified in `mo-delivery-contract.md`                               | Keeps the change to one repo; MO builds the ID pass-through and a best-effort step separately.    | Plan             |
| Re-sent week                 | Replace that (user, week) atomically                                                 | This is FR-017, and no saved plans exist yet to protect.                                          | Plan             |
| Dashboard scope              | Upcoming plan or waiting state only; in-progress week not shown                      | Matches the roadmap outcome and US-05, with minimal UI.                                            | Plan             |
| Storage                      | `weekly_plans` (with raw jsonb) + normalized `plan_meal_options`                     | S-02's recency lookups become cheap indexed SQL under the 10 ms CPU limit.                        | Plan             |
| Write path                   | A `security definer` function that only `service_role` can execute; RLS is select-only | One atomic call, and no user role can write.                                                    | Plan             |
| "Upcoming"                   | Latest plan with `week_start` after today in Europe/Warsaw                           | Matches the PRD rule that a plan stops being editable on its first day.                           | Plan             |
| Unknown email                | S-01 creates the account (unconfirmed, no password, no email) and stores the week    | MO decides who has an account, so no week is lost; S-04 sends the invitation.                      | Plan             |
| Testing                      | Vitest (schema, tie rule, date boundary) + smoke steps in CI                         | Unit tests for edge dates, plus real end-to-end checks in the existing CI smoke job.              | Plan             |

## Scope

**In scope:** migration with RLS and the ingestion function; creating the account on first delivery; a dev walkthrough for signing in as that account; delivery endpoint with zod validation; the service-role client; the middleware skip; a sample payload; the MO requirements document; Vitest; the dashboard's upcoming and waiting states; smoke and CI updates; production setup (migration, secrets).

**Out of scope:** MO-repo code; invitation emails, accepting invites and removing sign-up (S-04); the in-progress week view; recency and history (S-02); swap and save (S-03); ratings; showing nutrition; a smarter tie-break (parked); two-user RLS tests; HMAC signatures.

## Architecture / Approach

MO → `POST /api/mo/deliveries` (bearer check → zod v1 schema → flatten into option rows, with `is_recommended` decided in TypeScript) → one call to `ingest_weekly_plan` through the service-role client. That function finds the user by email and upserts the plan and its options in a single transaction. The dashboard (server-rendered Astro) reads through the user's cookie client, so RLS applies, and picks the newest plan with `week_start` after today in Warsaw.

## Phases at a Glance

| Phase                           | What it delivers                                                   | Key risk                                                  |
| ------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------- |
| 1. Schema & ingestion function  | Tables, select-only RLS, and the one write path                    | Grants that are too wide let users write, or anon call the function |
| 2. Delivery endpoint & contract | Authenticated, validated endpoint; sample payload; MO spec; Vitest | Contract drift from what MO can actually produce          |
| 3. Dashboard                    | Upcoming plan view and waiting state                               | Warsaw/UTC day boundary showing the wrong plan            |
| 4. Smoke, CI & prod setup       | End-to-end CI coverage; production ready for MO                    | Missing Worker secrets or unpushed migration in production |

**Prerequisites:** local Docker Supabase; production Supabase link rights and Wrangler access (for Phase 4).
**Estimated effort:** ~3–4 sessions across 4 phases.

## Open Risks & Assumptions

- MO's first real delivery depends on a separate MO change. Until then, only the sample payload proves the flow.
- The sample payload's IDs and scores are partly illustrative. The contract assumes MO can send `configurable_product_id` for every variant.
- Replacing a re-sent week will overwrite saved choices once S-03 exists. S-06/FR-018 must revisit this.
- Before S-04, no production account has a password, because every account is created by a delivery and invitations need F-01. Dashboard verification therefore happens on the dev stack, where a one-off Admin API call sets a password on a delivery-created account.
- S-04 depends on Supabase being able to invite a user who already exists but is unconfirmed. This is checked on local Supabase in Phase 2.

## Success Criteria (Summary)

- A recorded MO payload is accepted, creates the account and shows on the dashboard in the dev environment. Production accepts deliveries (the post-deploy probe returns 401 without a token).
- A user with no delivery sees "No upcoming plan yet", never an older plan.
- Users see only their own plans. Bad tokens and invalid payloads are rejected with clear status codes, and a new email becomes an account without losing its week.
