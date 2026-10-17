# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-10-17

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the
   team is worried about X, and the failure would surface somewhere in
   <area>" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/migrations/`, `supabase/tests/`, `scripts/` (80 commits in the 30 days to 2026-10-10).

Expected values in every test come from an independent source — the PRD, `docs/api.md`, `docs/mo-delivery-contract.md`, or this plan's §2 — never from the implementation under test.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                                                                                                                      | Impact | Likelihood | Source (evidence — not anchor)                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A migration ships plan logic, a grant or a policy that behaves differently than intended, and the hosted database runs it (migrations are applied before the matching code merges)                                           | High   | High       | interview Q3; hot-spot dirs `supabase/migrations/` (13 commits/30d), `supabase/tests/` (15/30d); archive: S-02, S-06, S-11, S-12, S-13 all changed SQL plan logic; README deploy order |
| 2   | MO's weekly delivery gets a 2xx but the week is stored wrong — wrong account, missing slots or options, wrong dates, or a partial write — and nobody notices, because MO alerts only on non-2xx and mo-web has no monitoring | High   | Medium     | interview Q1; PRD FR-001, FR-002, Guardrails; hot-spot dir `src/pages/api/` (30/30d)                                                                                                   |
| 3   | Abuse: a signed-in user reads or changes another user's plan, choices or ratings, through the app's API or by calling the database API directly with their own session                                                       | High   | Medium     | PRD NFR data isolation, US-03; README (RLS, plan logic in SQL functions); hot-spot dir `src/pages/api/` (30/30d)                                                                       |
| 4   | The critical journey breaks in a real browser while the HTTP smoke stays green: swap, save or rate doesn't work, or the dashboard shows "Something went wrong"                                                               | High   | Medium     | interview Q4; hot-spot dirs `src/components/plan/` (25/30d), `src/pages/` (16/30d); archive: dashboard-pgrst303-retry                                                                  |
| 5   | Date rules go wrong at their boundaries: a plan can still be changed on its first day, the rating window is off by a day, or "This week"/"Next week" picks the wrong plan                                                    | Medium | Medium     | PRD Business Logic, US-01, US-05, US-08; archive: next-week-nearest-upcoming (a past selection bug); hot-spot dir `src/lib/` (60/30d)                                                  |
| 6   | A re-sent week breaks state: saved choices lost, other weeks or history changed, or the wrong week shown as "Next week"                                                                                                      | High   | Low        | PRD US-07, FR-017, FR-018; archive: week-resubmission-replace; roadmap Parked "stale Keep as recommended"; re-sends are rare on prod (user, 2026-10-10)                                |
| 7   | An invitation or reset link stops signing the user in, or is wrongly reported as expired                                                                                                                                     | Medium | Low        | `docs/deployment.md` Known risks (link check reads Supabase internals); PRD US-02, US-04; 2–4 users, so a workaround (operator sends a new link) exists                                |

Not a test: mo-web has no monitoring of its own (FR-019, parked). Risk #2 covers the testable part, a 2xx with a bad save. Noticing failures in production belongs to observability.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                                                                                                                              | Must challenge                                                                       | Context `/10x-research` must ground                                                                                          | Likely cheapest layer                       | Anti-pattern to avoid                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------- |
| #1   | Each PRD plan rule (recency from saved plans only, cut-off, rating window, rating order, re-send replace) still holds after the migrations are applied on top of existing data, and the previous app version still works against the new schema during the deploy window | "pgTAP green on a fresh local database means the hosted migration is safe"           | Which migrations rewrite functions, grants or policies; deploy-order window; what seed or fixture data looks like production | pgTAP + a migration replay over seeded data | Asserting a function's output against a copy of its own SQL               |
| #2   | Each field of a contract-valid payload reads back intact through the owning user's view; any failure part-way through the write answers non-2xx and leaves nothing half-written                                                                                          | "2xx means the week is stored"                                                       | Ingest entry point, whether the write is atomic, error translation to HTTP codes, `docs/mo-delivery-contract.md`             | pgTAP + unit (schema)                       | Expected values taken from the code instead of from the delivery contract |
| #3   | A second user gets nothing back and changes nothing on every read and write path, both through the app routes and directly against the database API with their own session                                                                                               | "RLS is enabled, so it's safe" (functions that run with the owner's rights skip RLS) | Every table, function and grant reachable with the anon or authenticated key; how the app derives the user                   | pgTAP + smoke                               | Checking only the pages, not direct database calls                        |
| #4   | One real-browser run: delivery, invitation, set password, dashboard, swap, save, rate, sign in again, choices still there                                                                                                                                                | "The HTTP smoke implies the interactive parts work"                                  | Preview on the Workers runtime, Mailpit, fixtures, how to reset the stack between runs                                       | e2e (one journey)                           | Re-checking in e2e every rule pgTAP already covers                        |
| #5   | The day before, the first day and the day after a plan starts; days 7 and 8 of the rating window; two future weeks delivered                                                                                                                                             | "Server time equals the user's date" (Workers run in UTC)                            | Where "today" comes from in each rule; the time-zone rule the PRD implies                                                    | unit + pgTAP                                | Tests that depend on the real current date                                |
| #6   | After a re-send: saved choices are kept where the meal is still offered, other weeks are unchanged, the plan stays saved, "Next week" stays the nearest week                                                                                                             | "The identical re-send case covers the changed one"                                  | Replace rules, how the saved flag survives, real dev re-sends as fixtures                                                    | pgTAP                                       | Testing only a re-send identical to the first delivery                    |
| #7   | A valid link leads to a session; a used or expired link is refused before the password form                                                                                                                                                                              | "The local Supabase version behaves like hosted"                                     | Existing pgTAP and smoke coverage of links; what a Supabase upgrade could change                                             | existing pgTAP + smoke; Phase 4 journey     | Duplicating checks the smoke already makes                                |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                     | Goal (one line)                                                                                          | Risks covered | Test types                    | Status   | Change folder                                       |
| --- | ------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------- | ----------------------------- | -------- | --------------------------------------------------- |
| 1   | Migration and date-rule safety | Prove the PRD plan rules hold after migrations run on existing data and at their date boundaries         | #1, #5        | pgTAP, unit, migration replay | complete | testing-migration-date-rules                        |
| 2   | Delivery and re-send integrity | Prove a 2xx means MO's week is stored exactly, and a re-send changes only what it should                 | #2, #6        | pgTAP, unit, smoke extensions | complete | testing-delivery-resend-integrity                   |
| 3   | Data isolation sweep           | Prove a second user can't read or change anything that isn't theirs, through the app or the database API | #3            | pgTAP, smoke                  | complete | testing-data-isolation                              |
| 4   | Critical journey e2e           | One real-browser journey on the Workers runtime, wired as a CI gate                                      | #4, #7        | e2e (Playwright)              | complete | testing-critical-journey-e2e                        |
| 5   | Agent-loop feedback            | Post-edit hook runs the matching pgTAP or unit tests when an agent edits migrations or `src/lib/`        | #1, #5        | post-edit hook                | complete | — (built with `/10x-configure-hook`; #123, PR #129) |

Order rationale: #1 is the only High × High risk and covers the SQL the delivery logic runs on; delivery integrity follows (interview Q1); isolation is the abuse lens; e2e is the most expensive layer and only covers what cheaper layers can't reach; the hook comes last because it runs the tests the earlier phases add.

## 4. Stack

| Layer                      | Tool                                    | Version           | Notes                                                                                                                         |
| -------------------------- | --------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| unit                       | Vitest                                  | ^5.0.3            | `src/**/*.test.ts`; 21 files in `src/lib/` and `src/lib/services/`                                                            |
| database                   | pgTAP via Supabase CLI                  | supabase ^2.120.0 | `supabase/tests/*.test.sql`; 12 files; runs against local Supabase                                                            |
| HTTP smoke                 | `scripts/smoke.mjs` (Node, no deps)     | n/a               | Drives flows over HTTP against a preview on the Workers runtime; also post-deploy probe                                       |
| e2e (browser)              | Playwright Test (Chromium)              | 1.64.0            | `tests/e2e/`; the critical journey and a seed, against a preview on the Workers runtime; CI `e2e` job; checked: 2026-10-11    |
| (AI-native) post-edit hook | Claude Code hooks — checked: 2026-10-10 | n/a               | When NOT to use: UI, styling or docs edits, and any edit where the matching test needs the full stack and takes over a minute |

Test-base profile: `meaningful` — Vitest configured, 21 unit files, 12 pgTAP files, an HTTP smoke and one Playwright journey; pages, API routes and components have no tests of their own beyond the smoke and the journey.

**Stack grounding tools (current session):**

- Docs: none (no Context7 or framework docs MCP) — versions taken from `package.json`; checked: 2026-10-10
- Search: no search MCP (no Exa); built-in web search only, not used; checked: 2026-10-10
- Runtime/browser: none (no Playwright MCP) — not used; Phase 4 research should verify Playwright on the Workers preview; checked: 2026-10-10
- Provider/platform: `gh` CLI (not an MCP) for issues and CI status; no Supabase or Cloudflare MCP; checked: 2026-10-10

## 5. Quality Gates

| Gate                                                 | Where                    | Required?                          | Catches                                            |
| ---------------------------------------------------- | ------------------------ | ---------------------------------- | -------------------------------------------------- |
| lint + typecheck (`npm run lint`, `npx astro check`) | local + CI (`ci` job)    | required                           | syntactic / type drift                             |
| unit (`npm test`)                                    | local + CI (`ci` job)    | required                           | logic regressions in `src/lib/`                    |
| database (`supabase test db`)                        | local + CI (`smoke` job) | required; widened by §3 Phases 1–3 | plan-rule, migration and isolation regressions     |
| HTTP smoke (`npm run smoke`)                         | local + CI (`smoke` job) | required                           | broken flows over HTTP, error and edge cases       |
| e2e on the critical journey (`npx playwright test`)  | local + CI (`e2e` job)   | required                           | broken interactive journey in a real browser       |
| post-deploy probe                                    | CI (`deploy` job)        | required                           | missing Worker secrets, bot protection blocking MO |
| post-edit hook                                       | local (agent loop)       | recommended after §3 Phase 5       | regressions at edit time; not a CI substitute      |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase <N>."

### 6.1 Adding a test for a plan rule or migration

- **Date rule (SQL)**: compute "today" with `private.warsaw_today()`, never inline. `supabase/tests/warsaw_today.test.sql` fails when a function in `public` or `private` derives a date any other way (`at time zone`, `current_date`, `now()::date`, …); plain `now()` for timestamps is fine.
- **Boundary test**: add cases to `supabase/tests/date_boundaries.test.sql`, or copy its header into a new file. It pins today to 2026-03-30 by replacing `private.warsaw_today()` at the top of its `begin … rollback`, as `postgres` before any `set local role` (see `docs/testing.md`, "Pinning today"), and builds fixtures from that date (`pg_temp.d(n)`). Cover T+1, T and T-1 of the rule, and both ends of a window (T-7, T-8), with expected values from the PRD or `docs/api.md`.
- **New or changed RPC**: add its rows to `supabase/tests/rpc_contract.test.sql`, taken from the TS call site: argument names and types, return type, EXECUTE for the calling role and none for `anon` unless the client is anon, and any column the TS reads. A migration that renames, retypes or revokes something the deployed Worker uses then fails before it reaches production.
- **Migration over existing rows**: `npm run test:replay` (CI runs it) seeds at the previous version, applies the newest migration and runs `supabase/replay/checks.test.sql` plus the full suite. `supabase/replay/seed.sql` may create rows only through RPCs the contract test pins (`ingest_weekly_plan`, `choose_plan_option`, `confirm_plan`, `rate_meal`), so it stays valid at the previous version; a migration that needs new kinds of existing rows extends the seed that way and adds a snapshot table and a check.
- **Read-side week selection (TS)**: test `src/lib/services/plans.ts` with fixed `today` strings against rows through `fakeSupabase` (`src/test/fake-supabase.ts`), not by asserting query arguments. The fake throws on any builder method it doesn't implement; add the method there, with its PostgREST semantics, when a service starts using it.
- **Reference tests**: `supabase/tests/date_boundaries.test.sql`, `supabase/tests/rpc_contract.test.sql`, `src/lib/services/plans.test.ts`.

### 6.2 Adding a test for the MO delivery endpoint

Expected values come from `docs/mo-delivery-contract.md` and `docs/api.md` Re-delivery, never from `src/lib/mo-delivery.ts` or the SQL. Change the contract first, then the tests.

- **New or changed contract field**: add it, with its edge values, to `scripts/fixtures/mo-delivery.edge-cases.json`; map it in `expectedOptions` (or the plan `expected` object) in `scripts/smoke.mjs`, written from the contract text; keep "accepts the edge-case payload" in `src/lib/mo-delivery.test.ts` green. A new column the Worker reads also goes into `rpc_contract.test.sql` (§6.1). The round trip runs only with `SUPABASE_KEY` set.
- **New or changed response status**: an `it` in `src/lib/services/mo-deliveries.test.ts` with the scripted RPC answer, asserting status and body from the contract's Responses table, whether it was reported, and that a pre-storage check never calls the RPC.
- **New or changed re-send rule**: a case in `supabase/tests/week_resubmission.test.sql` on its own week, snapshotting `pg_temp.state(<plan>)` before the re-send and comparing after, so other weeks and users stay untouched.
- **New write step in `ingest_weekly_plan`**: each case in `supabase/tests/delivery_atomicity.test.sql` must still fail after every write; if one now fails earlier or a new table is written, add a case or extend its snapshots.
- **Reference tests**: `src/lib/services/mo-deliveries.test.ts`, `supabase/tests/delivery_atomicity.test.sql`, `supabase/tests/week_resubmission.test.sql`, the `round trip: …` steps in `scripts/smoke.mjs`.

### 6.3 Adding an isolation test for a new table, function or route

Expected values come from PRD US-03 (a user sees and changes only their own plans) and `docs/api.md` (someone else's plan, option or rating answers `not_found`, like one that does not exist), never from the policies or functions under test.

- **New table, function or grant**: `supabase/tests/exposed_surface.test.sql` fails on anything new that `anon` or `authenticated` can reach, since Supabase's default privileges grant them everything new in `public`. In the same migration PR, revoke what they must not have and add the rest to the allowlist. A newly exposed schema (`[api] schemas`) joins the file's schema lists; a migration that revokes the pinned `MAINTAIN` default removes it from the allowlist.
- **Its second-user case**: each allowlist row gets a case in `supabase/tests/second_user_isolation.test.sql`, where a second user and anon act on the first user's rows and change nothing. A security definer function must check `auth.uid()` itself. A row that needs no case gets a line in the file's header saying why.
- **New write path for child rows**: set the row's `user_id` from its plan's owner, and build the sweep's fixtures through that path so its `user_id` invariant checks the rows it writes.
- **New route taking an id**: a `second user: …` step in `scripts/smoke.mjs` sending the smoke user's real id. If the route reaches a new table or RPC, add the matching direct `/rest/v1` call as the second user too, since the app's own `user_id` filters hide whether RLS holds.
- **Reference tests**: `supabase/tests/exposed_surface.test.sql`, `supabase/tests/second_user_isolation.test.sql`, the `second user: …` steps in `scripts/smoke.mjs`.

### 6.4 Adding to the critical-journey e2e

- **Step or spec**: a new interactive step of the same user's journey (a new control on the dashboard, a new page the user reaches after signing in) is a `test.step` in `tests/e2e/critical-journey.spec.ts`, placed where the user would do it. A separate journey with its own starting state (another entry point, another kind of user) is a new spec in `tests/e2e/`. A read-only check of the signed-in dashboard can use the `setup` session, as `seed.spec.ts` does.
- **Reuse `tests/e2e/support/`**: `deliverWeek` with `thisMonday`/`nextMonday` for weeks relative to the Warsaw today, `ensureUserWithPassword` for a user that signs in directly, `readInvitationLink` for the real invitation email, `signIn`/`setPassword` for the forms (they wait for hydration). Never hard-code a date or rely on a hand-made user.
- **New users per run**: a spec that changes state creates its own user with a unique email (`e2e-<name>-${randomUUID()}@example.com`), so runs, retries and re-runs need no reset. Don't change the `setup` user's state from a spec; other specs load its session.
- **Selectors**: by role, label or accessible name (`getByRole`, `getByLabel`), as a user finds the control; a `data-*` or value attribute only to pin one element among identical ones. An island clicked before it hydrates loses the click: retry with `expect(…).toPass()` or wait for hydration as `support/auth.ts` does.
- **What not to check**: never re-check in the browser a rule pgTAP or the smoke covers (cut-off, rating-window edges, re-send rules, expired or used links, isolation). Assert only what needs a browser: hydration, optimistic UI, the cookie session.
- **Reference tests**: `tests/e2e/critical-journey.spec.ts`, `tests/e2e/auth.setup.ts`.

### 6.5 Per-rollout-phase notes

- **Phase 1** (`testing-migration-date-rules`): the SQL "today" had to become a function (`private.warsaw_today()`) before any test could pin it; the older pgTAP files still use the real Warsaw today and were left as they are. The replay runs only in CI or with `MIGRATION_REPLAY_WIPES_LOCAL_DB=1`, as it resets the local stack shared with `npm run dev` and other worktrees, and it can start no further back than `20261008180000`, the oldest version with every RPC the seed calls.
- **Phase 2** (`testing-delivery-resend-integrity`, #120): the route imported `astro:env/server`, so its body moved unchanged into `handleMoDelivery` (`src/lib/services/mo-deliveries.ts`) with the token and client injected; the route is now a one-line call. The tests needed a right oracle first: the contract said a never-saved re-send follows MO's new recommendations and the PRD (US-07, FR-017) that the latest delivery always replaces the stored week; both now describe the shipped behaviour (the rating-adjusted suggested pick, a changed re-send of a started week refused with 409, kept choices). The fixtures are hand-built from the contract, not real dev re-sends. Provisioning and invitation partial states (unknown user, `createUser` fallback) were left to S-10 (#145), which changes that branch; the unit tests never stub `unknown_user`. The round trip runs in smoke, not in the post-deploy probe, so it never writes to production.
- **Phase 3** (`testing-data-isolation`, #121): no leak found; the risk was Supabase's default privileges, which grant `anon` and `authenticated` everything on a new table, function or sequence in `public`, so every migration revokes by hand and nothing failed on one that forgot. The allowlist now does. Reading grants with `has_table_privilege` rather than `role_table_grants` surfaced `MAINTAIN` on all three tables, another default; it is pinned as allowed, with no migration, and noted on #121 as a candidate revoke. The allowlist also pins `graphql_public.graphql()`, Supabase's stub while pg_graphql isn't installed; a manual check on prod (2026-10-17) found pg_graphql off and no table in a realtime publication. The app's reads filter by `user_id` on top of RLS, so only the direct `/rest/v1` calls show RLS holds on its own. The choose route's `planId` is still not checked against the option; it only re-reads recency, which RLS scopes, and the smoke checks that. Like the round trip, the second user exists only on the local and CI stacks; the post-deploy probe is unchanged.
- **Phase 4** (`testing-critical-journey-e2e`, #122): the swap and the rating need different weeks (swap only before a week starts, rating only within 7 days of a meal), so the journey delivers this week and next week relative to the Warsaw today and runs on any date. Local and CI auth email isn't rate limited (`email_sent` needs custom SMTP), so the journey always reads the real invitation from Mailpit. The invitation links to `site_url` (port 4321); the helper re-hosts it on `baseURL`, and CI previews on 4321. In CI the `e2e` job takes about 2 min 15 s and runs beside `smoke` (about 3 min 10 s), so it adds no wall-clock time per PR (first measured 2026-10-11).
- **Phase 5** (agent hooks, #123): type-checked ESLint takes ~45 s per file and `astro check` ~50 s on this checkout, so neither runs per edit; the end-of-turn hook runs them side by side. Per edit, only Vitest (`related`, for `src/lib/` and `src/test/`) and an edited pgTAP file run. A migration can't be tested before it is applied, so the end-of-turn hook applies new ones (`npx supabase migration up --local`, additive, once the agent stops editing for the turn) and then runs pgTAP; an edited, already-applied migration needs a `db reset`, which the hook only reports, as it wipes the local database.

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **Visual or snapshot tests of shadcn components** — generated components, and the look will change in the parked UI review. Re-evaluate after that review lands. (Source: interview Q5.)
- **Load and performance tests** — 2–4 users and one delivery a week. Re-evaluate if the user base grows beyond a personally-known group. (Source: interview Q5.)
- **More keep-alive tests** — the smoke already checks the Cron Trigger's success and failure modes. Re-evaluate if the keep-alive mechanism changes. (Source: interview Q5.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-10-10
- Stack versions last verified: 2026-10-11
- AI-native tool references last verified: 2026-10-10

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
