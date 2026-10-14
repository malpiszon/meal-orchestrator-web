---
project: mo-web
version: 1
status: draft
created: 2026-10-10
updated: 2026-10-14
prd_version: —
main_goal: quality
top_blocker: time
milestone_id: regression-safety-net
milestone_seq: 2
milestone_status: open
tracker: github-issues
gh_milestone: "M-2: Regression safety net"
---

# Roadmap: mo-web

> Derived from `context/foundation/test-plan.md` §3 (2026-10-10) + the user's descriptions of nice-to-have mutation-testing and Sentry items + the observability audit of 2026-10-12 + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Milestone

**M-2: Regression safety net** — Status: open

- **Intent:** a change that breaks a plan rule, MO's delivery, another user's data or the main journey fails a test before it reaches production, and a system fault that slips through (database, Auth or email outage, a broken render) reaches Sentry instead of looking like a user error or success. The test plan's risks #1–#7 are covered by the cheapest test that gives a real signal, and the audit's critical findings and proven coverage gaps are closed; more scope goes into a later milestone.
- **Source materials:** `context/foundation/test-plan.md` §3 Phased Rollout (risks in §2), plus the user's descriptions for MS-06 (2026-10-10) and MS-07 (2026-10-11), plus `context/audits/observability/2026-10-12_mo-delivery-week-edit-auth-ratings-history.md` §5–§6 for MS-08 to MS-11 (added 2026-10-12).
- **Done when:** S-01 to S-05 and S-08 to S-11 are `done`, and S-06 and S-07 (nice-to-have) are each either `done` or moved to `## Parked` with their issue closed as not planned.
- **Scope anchors:**
  - MS-01: Test-plan Phase 1, migration and date-rule safety (risks #1, #5).
  - MS-02: Test-plan Phase 2, delivery and re-send integrity (risks #2, #6).
  - MS-03: Test-plan Phase 3, data isolation sweep (risk #3).
  - MS-04: Test-plan Phase 4, critical-journey e2e (risks #4, #7).
  - MS-05: Test-plan Phase 5, agent-loop feedback (risks #1, #5).
  - MS-06: Mutation testing, probably with Stryker — nice-to-have (user, 2026-10-10: "cover only risks listed there + nice to have for mutation tests").
  - MS-07: Sentry error monitoring — nice-to-have (user, 2026-10-11: "I'd like to add Sentry to this project").
  - MS-08: Observability audit (2026-10-12), handled-error reporting: a shared helper reports system faults the app handles, and the "not reported" policy is rewritten (X3, X5, D2, W3, W6, R2, A6). Policy (user, 2026-10-12): report system faults only, grouped by step and error code; user errors stay in the logs.
  - MS-09: Observability audit, auth faults visible (X1, X4, A1–A4); holds two of the three critical findings.
  - MS-10: Observability audit, MO invitation failure surfaced (D1, the third critical finding, plus D3, D4, D6).
  - MS-11: Observability audit, streamed render errors captured (X2, proven by probe P10).

## Vision recap

Meal Orchestrator (MO) emails a weekly meal recommendation; mo-web receives that week, keeps each user's plan history, shows when each meal last appeared, and lets the user swap, save and rate meals. M-1 shipped that loop. M-2 adds no user-facing features: it makes the existing rules hard to break, because migrations reach the hosted database before their code merges, and it makes the failures that still happen visible. Sentry (S-07) sees only thrown errors; the 2026-10-12 audit showed that outages the app handles look like user errors or success.

## North star

**S-01: a migration that breaks a plan rule or a date boundary fails a test before it reaches production** — the north star is the smallest item whose success proves the milestone works, so it goes first. Here it covers the test plan's only risk rated high on both impact and likelihood, and it lays down the pinned "today", the RPC contract and the migration replay that later items reuse.

## At a glance

| ID   | Change ID                         | Outcome (user can …)                                                                                     | Prerequisites | PRD refs | Status |
| ---- | --------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------- | -------- | ------ |
| S-01 | testing-migration-date-rules      | a migration that breaks a plan rule, grant or date boundary fails a test before production               | —             | MS-01    | done   |
| S-02 | testing-delivery-resend-integrity | a 2xx from MO's delivery provably means the week is stored exactly; a re-send changes only its week      | S-01          | MS-02    | ready  |
| S-03 | testing-data-isolation            | a second user provably can't read or change another user's data, via the app or the database API         | S-01          | MS-03    | ready  |
| S-04 | testing-critical-journey-e2e      | one real-browser journey from delivery to rating runs as a CI gate                                       | —             | MS-04    | done   |
| S-05 | testing-agent-post-edit-hook      | an agent editing a migration or `src/lib/` gets the matching tests run before it hands back              | S-01          | MS-05    | done   |
| S-06 | testing-mutation-stryker          | a developer can see which code changes the unit tests fail to catch (nice-to-have)                       | S-01          | MS-06    | ready  |
| S-07 | add-sentry                        | an unhandled error in the Worker or a React island reaches Sentry instead of going silent (nice-to-have) | —             | MS-07    | done   |
| S-08 | report-handled-errors             | a database, PostgREST or Auth fault the app handles reaches Sentry as one grouped issue, not a log line  | S-07          | MS-08    | done   |
| S-09 | auth-fault-visibility             | an Auth outage or missing secret is reported, not shown as sign-outs or expired links                    | S-08          | MS-09    | ready  |
| S-10 | mo-invitation-failure-visible     | a failed invitation is reported and visible to MO, not answered with a plain success                     | S-08          | MS-10    | ready  |
| S-11 | streamed-render-errors            | an error while a page streams is reported instead of leaving a silent truncated page                     | S-07          | MS-11    | ready  |

## Baseline

What's already in place in the codebase as of `2026-10-10` (auto-researched + user-confirmed). The app itself is complete for M-1 (see Milestone History); this inventory covers the test layers M-2 works on.

- **Unit tests:** present — Vitest, 11 files in `src/lib/`; S-01 adds week-selection cases and an in-memory database fake.
- **Database tests:** present — pgTAP, 6 files; S-01 adds the RPC contract, the Warsaw "today" helper and the date-boundary tests.
- **HTTP smoke:** present — `scripts/smoke.mjs`, run in CI's smoke job and after deploy.
- **Migration replay:** present — `npm run test:replay`, run in CI since S-01 (PR #127).
- **Browser e2e:** present — Playwright (Chromium) in `tests/e2e/`, run by CI's `e2e` job, a required check that `deploy` waits for (S-04, PR #134).
- **Agent post-edit hook:** present — Claude Code hooks in `.claude/settings.json`: related unit and pgTAP tests after each edit, lint, types and tests at the end of each turn (S-05, PR #129).
- **Observability:** partial — Workers observability is on; Sentry reports unhandled errors from the Worker and the browser and monitors the keep-alive (S-07, PR #140), and database, PostgREST and set-password Auth faults the app handles, grouped by step and error code (S-08, PR #153); other Auth faults, invitation failures and errors after streaming starts are not reported yet (`context/audits/observability/2026-10-12_mo-delivery-week-edit-auth-ratings-history.md`, S-09 to S-11); no alerting (FR-019, parked).

## Foundations

None. Each item sets up the tooling it needs (S-01 the replay harness, S-04 Playwright, S-06 Stryker, S-07 Sentry), so no shared enabler has to land first.

## Slices

### S-01: Migration and date-rule safety (north star)

- **Outcome:** a migration that changes a plan rule, a grant or a date boundary fails a test (locally and in CI) before it reaches the hosted database, and the previous Worker keeps working against the new schema during the deploy window.
- **Change ID:** testing-migration-date-rules
- **Issue:** [#116](https://github.com/malpiszon/meal-orchestrator-web/issues/116)
- **PRD refs:** MS-01
- **Prerequisites:** —
- **Parallel with:** S-04
- **Blockers:** —
- **Unknowns:**
  - Does `supabase test db` run tests from a directory outside `supabase/tests/`? (Phase 3 spike) — Owner: research. Block: no.
  - Does `supabase db reset --version` keep CI's service exclusions? (Phase 3 spike) — Owner: research. Block: no.
- **Risk:** The only High × High risk in the test plan; first because S-02, S-03, S-05 and S-06 reuse its pinned "today", contract test and replay harness.
- **Status:** done

### S-02: Delivery and re-send integrity

- **Outcome:** a 2xx from MO's delivery provably means the week is stored exactly as the contract describes, and a re-sent week changes only what it should; a contract-valid payload stored wrong, or a partial write behind a 2xx, fails a test.
- **Change ID:** testing-delivery-resend-integrity
- **Issue:** [#120](https://github.com/malpiszon/meal-orchestrator-web/issues/120)
- **PRD refs:** MS-02
- **Prerequisites:** S-01
- **Parallel with:** S-03, S-04, S-05, S-06, S-07, S-08, S-09, S-10, S-11
- **Blockers:** —
- **Unknowns:**
  - Is the delivery write atomic, so a failure part-way through answers non-2xx and leaves nothing half-written? — Owner: research. Block: no.
  - Can real dev re-sends serve as fixtures for the changed-week cases? — Owner: user. Block: no.
- **Risk:** MO alerts only on non-2xx and mo-web has no monitoring, so a 2xx with a bad save goes unnoticed; next in line because the delivery is where every week's data enters.
- **Status:** ready

### S-03: Data isolation sweep

- **Outcome:** a second user can't read or change another user's plans, choices or ratings, through the app's routes or by calling the database API directly with their own session; a new table, function or grant that leaks fails a test.
- **Change ID:** testing-data-isolation
- **Issue:** [#121](https://github.com/malpiszon/meal-orchestrator-web/issues/121)
- **PRD refs:** MS-03
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-04, S-05, S-06, S-07, S-08, S-09, S-10, S-11
- **Blockers:** —
- **Unknowns:**
  - Which tables, functions and grants are reachable with the public keys, and which functions run with the owner's rights (skipping row-level security)? — Owner: research. Block: no.
- **Risk:** Challenges "row-level security is on, so it's safe"; follows S-01 because it walks the function list S-01's contract test pins.
- **Status:** ready

### S-04: Critical-journey e2e

- **Outcome:** one real-browser journey on the Workers runtime (delivery → invitation → set password → dashboard → swap → save → rate → sign in again → choices still there) runs as a required CI gate on every PR.
- **Change ID:** testing-critical-journey-e2e
- **Issue:** [#122](https://github.com/malpiszon/meal-orchestrator-web/issues/122)
- **PRD refs:** MS-04
- **Prerequisites:** —
- **Parallel with:** S-01, S-02, S-03, S-05, S-06, S-07
- **Blockers:** —
- **Unknowns:**
  - Does Playwright run against the Workers preview in CI next to local Supabase and Mailpit, and how is the stack reset between runs? — Owner: research. Block: no. Resolved on #122: a separate `e2e` job with its own local Supabase and Mailpit; no reset, since each run uses a new journey user and a self-provisioning setup user.
- **Risk:** The most expensive layer and new tooling; technically independent, but kept after S-02 and S-03 in the test plan's order so it only covers what cheaper layers can't reach.
- **Status:** done

### S-05: Agent post-edit test hook

- **Outcome:** when an agent edits `src/lib/` or a pgTAP test, a post-edit hook runs the matching unit or pgTAP tests; when it adds a migration, the end-of-turn hook applies it and runs pgTAP before the agent hands back. Either way the failure reaches the agent in the same loop.
- **Change ID:** testing-agent-post-edit-hook
- **Issue:** [#123](https://github.com/malpiszon/meal-orchestrator-web/issues/123)
- **PRD refs:** MS-05
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-03, S-04, S-06, S-07
- **Blockers:** —
- **Unknowns:**
  - How does an edited file map to its tests, and can the hook stay under a minute? — Owner: research. Block: no. Resolved on #123: `vitest related` and the edited pgTAP file per edit (~3 s); migrations at end of turn, since a migration can't be tested before it is applied.
- **Risk:** Runs the tests the earlier items add, so it comes late; local only, never a CI substitute.
- **Status:** done

### S-06: Mutation testing for unit tests (nice-to-have)

- **Outcome:** a developer can run mutation testing over `src/lib/` and see which code changes the unit tests fail to catch, so weak tests are found by a tool instead of by hand.
- **Change ID:** testing-mutation-stryker
- **Issue:** [#124](https://github.com/malpiszon/meal-orchestrator-web/issues/124)
- **PRD refs:** MS-06
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-03, S-04, S-05, S-07, S-08, S-09, S-10, S-11
- **Blockers:** —
- **Unknowns:**
  - Does Stryker work with this repo's Vitest and TypeScript versions, and is a run fast enough for CI or only for local use? — Owner: research. Block: no.
- **Risk:** Nice-to-have and first to park if M-2 drags on (top blocker: time); last so it scores the suite the earlier items build. TypeScript only — SQL keeps the manual mutation checks S-01 uses.
- **Status:** ready

### S-07: Error monitoring with Sentry (nice-to-have)

- **Outcome:** an unhandled error in the Worker (pages, API routes, MO delivery, keep-alive) or in a React island reaches Sentry with enough context to find its cause, so a failure that slips past the tests is noticed instead of going silent.
- **Change ID:** add-sentry
- **Issue:** [#136](https://github.com/malpiszon/meal-orchestrator-web/issues/136)
- **PRD refs:** MS-07
- **Prerequisites:** —
- **Parallel with:** S-02, S-03, S-06
- **Blockers:** —
- **Unknowns:**
  - Which Sentry setup works for the app on the Workers runtime, including the scheduled keep-alive, and does it fit the Worker size limit? — Owner: research. Block: no. Resolved on #136: `@sentry/cloudflare` wraps the Worker entry, `@sentry/astro` runs browser-only, and the Worker stays far under the size limit.
  - What may be sent to Sentry: user emails, meal data, request bodies? — Owner: user. Block: no. Resolved on #136: none of them; no user, IP, cookies, bodies or query strings, and emails are masked.
- **Risk:** Nice-to-have; M-2 can close with it parked. It notices failures in production, where the other items stop them before; alert rules for failed deliveries and keep-alive runs (FR-019) stay parked.
- **Status:** done

### S-08: Handled-error reporting

- **Outcome:** a database, PostgREST or Auth fault that the app handles with a friendly page, an error code or a fallback reaches Sentry as one issue per step and error code, with the original error kept as its cause; user errors stay in the logs, and `docs/deployment.md` describes the new policy.
- **Change ID:** report-handled-errors
- **Issue:** [#143](https://github.com/malpiszon/meal-orchestrator-web/issues/143)
- **PRD refs:** MS-08
- **Prerequisites:** S-07
- **Parallel with:** S-02, S-03, S-06, S-11
- **Blockers:** —
- **Unknowns:**
  - Which error fields can be sent without user data (PostgREST `details` can echo row values), and does grouping keep an outage inside the free plan's 5,000 events a month? — Owner: research. Block: no. Resolved on #143: only the code, an email-masked hint and the message; non-`Error` inputs are wrapped so `details` is never sent; one issue per step and code, and Sentry's Dedupe drops repeats within an isolate.
- **Risk:** The core of the audit; first because S-09 and S-10 route their system faults through its helper and policy. Too broad a capture rule floods the event budget, so it reports system faults only (decided 2026-10-12).
- **Status:** done

### S-09: Auth faults visible

- **Outcome:** an Auth outage, a failed link check or a missing secret is reported to Sentry and shown to the user as "try again" where that applies, instead of looking like everyone signing out, every invitation expiring or a wrong password; anonymous visits and wrong passwords stay quiet.
- **Change ID:** auth-fault-visibility
- **Issue:** [#144](https://github.com/malpiszon/meal-orchestrator-web/issues/144)
- **PRD refs:** MS-09
- **Prerequisites:** S-08
- **Parallel with:** S-02, S-03, S-06, S-10, S-11
- **Blockers:** —
- **Unknowns:**
  - Which Auth error codes mean the link really expired or was used, and which are system faults? — Owner: research. Block: no.
- **Risk:** Two of the three critical findings (X1, A1). It must not reveal which accounts exist, and must not report the normal signed-out case, or it becomes noise.
- **Status:** ready

### S-10: MO invitation failure surfaced

- **Outcome:** when the invitation email can't be sent or the account can't be created, the delivery reports it to Sentry and tells MO in its response, and a missing or wrong secret answers a distinct "not configured" error instead of a retryable storage failure.
- **Change ID:** mo-invitation-failure-visible
- **Issue:** [#145](https://github.com/malpiszon/meal-orchestrator-web/issues/145)
- **PRD refs:** MS-10
- **Prerequisites:** S-08
- **Parallel with:** S-02, S-03, S-06, S-09, S-11
- **Blockers:** —
- **Unknowns:**
  - Does MO accept a new response field (`invitation_sent`) and a new error code without a change on its side, and should it alert on them? — Owner: user. Block: no.
- **Risk:** The third critical finding (D1): today a user can get an account with no invitation and nobody knows. It changes the delivery contract, so `docs/mo-delivery-contract.md` changes with it; re-inviting or retrying stays parked. Touches the delivery route that S-02 tests, so sequence the two branches if they overlap.
- **Status:** ready

### S-11: Streamed render errors captured

- **Outcome:** an error thrown by a component after the page has started streaming reaches Sentry and the Worker logs, instead of leaving the user a truncated page with status 200 and no trace.
- **Change ID:** streamed-render-errors
- **Issue:** [#146](https://github.com/malpiszon/meal-orchestrator-web/issues/146)
- **PRD refs:** MS-11
- **Prerequisites:** S-07
- **Parallel with:** S-02, S-03, S-06, S-08, S-09, S-10
- **Blockers:** —
- **Unknowns:**
  - Can the middleware catch errors in the streamed body without breaking streaming, or should streaming be turned off in the adapter? — Owner: research. Block: no.
- **Risk:** A proven gap (probe P10) that every page render shares; independent of the helper, so it can run any time. Fixes the claim at `docs/deployment.md` § Error monitoring that page errors are reported.
- **Status:** ready

## Backlog Handoff

| Roadmap ID | Issue                                                                 | Change ID                         | Suggested issue title                             | Ready for `/10x-plan` | Notes                                             |
| ---------- | --------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------- | --------------------- | ------------------------------------------------- |
| S-01       | [#116](https://github.com/malpiszon/meal-orchestrator-web/issues/116) | testing-migration-date-rules      | Test-plan Phase 1: migration and date-rule safety | done                  | Merged 2026-10-10 (PR #127)                       |
| S-02       | [#120](https://github.com/malpiszon/meal-orchestrator-web/issues/120) | testing-delivery-resend-integrity | Test-plan Phase 2: delivery and re-send integrity | yes                   | Run `/10x-plan testing-delivery-resend-integrity` |
| S-03       | [#121](https://github.com/malpiszon/meal-orchestrator-web/issues/121) | testing-data-isolation            | Test-plan Phase 3: data isolation sweep           | yes                   | Test-plan order: after S-02                       |
| S-04       | [#122](https://github.com/malpiszon/meal-orchestrator-web/issues/122) | testing-critical-journey-e2e      | Test-plan Phase 4: critical-journey e2e           | done                  | Merged 2026-10-11 (PR #134)                       |
| S-05       | [#123](https://github.com/malpiszon/meal-orchestrator-web/issues/123) | testing-agent-post-edit-hook      | Test-plan Phase 5: agent post-edit test hook      | done                  | Merged 2026-10-10 (PR #129)                       |
| S-06       | [#124](https://github.com/malpiszon/meal-orchestrator-web/issues/124) | testing-mutation-stryker          | Mutation testing for unit tests (Stryker)         | yes                   | Nice-to-have; last, first to park                 |
| S-07       | [#136](https://github.com/malpiszon/meal-orchestrator-web/issues/136) | add-sentry                        | Error monitoring with Sentry                      | done                  | Merged 2026-10-12 (PR #140)                       |
| S-08       | [#143](https://github.com/malpiszon/meal-orchestrator-web/issues/143) | report-handled-errors             | Report handled system faults to Sentry            | done                  | Merged 2026-10-14 (PR #153)                       |
| S-09       | [#144](https://github.com/malpiszon/meal-orchestrator-web/issues/144) | auth-fault-visibility             | Make Auth faults visible                          | yes                   | Run `/10x-plan auth-fault-visibility`             |
| S-10       | [#145](https://github.com/malpiszon/meal-orchestrator-web/issues/145) | mo-invitation-failure-visible     | Surface MO invitation failures                    | yes                   | Changes the MO contract; overlaps S-02's route    |
| S-11       | [#146](https://github.com/malpiszon/meal-orchestrator-web/issues/146) | streamed-render-errors            | Capture errors in streamed pages                  | yes                   | Independent; any time                             |

## Open Roadmap Questions

1. **Does MO's payload include macro/nutritional data (e.g. salt) at all?** — Owner: user. Block: parked FR-014, FR-015 (PRD Open Question 2).
2. **What format are MO's historical debug-artifact logs in, and are they parseable as a stable source?** — Owner: user. Block: parked FR-016 (PRD Open Question 3).

## Parked

- **Operator alerts on failed jobs or deliveries (FR-019)** — Why parked: nice-to-have; the test plan treats noticing failures in production as observability, not testing (§2). S-07 adds error capture only; alert rules stay here (decided 2026-10-11). A candidate for a later milestone.
- **Remaining observability-audit findings** — Why parked: outside M-2's critical scope (decided 2026-10-12). From `context/audits/observability/2026-10-12_mo-delivery-week-edit-auth-ratings-history.md` §6 steps 5–7: browser save and rating reporting with an island error boundary (W5, R6, X8), logging the expected 404/409/400/401 outcomes and invariants (W2, W4, W9, W10, R1, R3, R4, R5, D7, A5, A8), and the low-severity polish (X6, X7, X9, D5, D8, D9, D10, A7, A9, A10, R7, R8, W7, W8). A candidate for a later milestone; re-run `/10x-observability-audit` first.
- **Visual or snapshot tests of shadcn components** — Why parked: test-plan §7; generated components, and the look changes in the parked UI review.
- **Load and performance tests** — Why parked: test-plan §7; 2–4 users and one delivery a week.
- **More keep-alive tests** — Why parked: test-plan §7; the smoke already checks the Cron Trigger's success and failure modes.
- **No AI/LLM use in mo-web** — Why parked: PRD §Non-Goals.
- **No integration with the food provider's panel** — Why parked: PRD §Non-Goals.
- **No intermediary delivery layer or automatic retry between MO and mo-web** — Why parked: PRD §Non-Goals; failed deliveries are retried manually.
- **No roles or admin features** — Why parked: PRD §Non-Goals.
- **No mo-web → MO integration** — Why parked: PRD §Non-Goals; future work.
- **No detection of whether a meal was actually eaten** — Why parked: PRD §Non-Goals.
- **No mirroring of providers' meal-change deadlines** — Why parked: PRD §Non-Goals.
- **No custom domain** — Why parked: PRD §Non-Goals; would require moving the `malpiszon.net` DNS zone.
- **FR-006 multi-factor login** — Why parked: nice-to-have; speed goal.
- **FR-014 / FR-015 nutritional summaries and comparison** — Why parked: nice-to-have; blocked by Open Roadmap Question 2.
- **FR-016 import of MO's historical logs** — Why parked: nice-to-have, exploratory; blocked by Open Roadmap Question 3.
- **Smarter tie-break between equally scored options** — Why parked: nice-to-have, outside the MVP (decided while planning S-01, 2026-09-30). S-01 recommends the highest-scored option and breaks ties by menu order (first listed wins); a later slice may resolve ties better (e.g. prefer the option not recently eaten, or let MO send an explicit pick).
- **Invite email failure handling** — Why parked: nice-to-have, outside the MVP (decided while planning S-04, 2026-10-04). If the invitation email can't be sent (rate limit, SMTP down), the delivery still returns 200, the failure is only logged, and the account stays unconfirmed with no invitation; the user can use "Forgot password?". S-10 makes the failure visible (Sentry and MO's response); retrying or re-inviting stays parked here. Revisit (retry, re-invite on a later delivery, or a visible state) if the user base grows beyond 2–4 people.
- **Styled invitation and password-reset emails** — Why parked: nice-to-have, outside M-1 (decided 2026-10-06). The templates in `supabase/templates/` are unstyled (a heading, one sentence and a link). When picked up, reuse the styling of MO's own emails rather than designing new styling. Traces to FR-003, FR-005. Email programs can't use the app's Tailwind classes or design tokens, so the styles must be inline. Production templates are pasted by hand into the Supabase dashboard (see `docs/deployment.md#email-settings-and-templates`).
- **General mo-web UI review (logo, visual identity)** — Why parked: nice-to-have, outside M-1 (decided 2026-10-06). An app-wide pass that adds a logo and a consistent look across pages. Its scope differs from S-09, which only replaces the page at `/` with a sign-in page. When picked up, run it through `/10x-ui` one view at a time. It could also give the styled emails above a shared look.
- **Stale "Keep as recommended" after a re-delivery** — Why parked: nice-to-have, outside the MVP (decided 2026-10-06, from the S-06 review). On a "Next week" page opened before MO re-sends that week, "Keep as recommended" still saves: the plan id survives a re-send, so `confirm_plan` accepts it. What gets saved is MO's latest recommendation, while the open page still shows the old dishes next to "Saved …" until a reload. S-06 then keeps those dishes on later re-sends. It needs a never-saved plan, an open page and a re-send together. A swap on such a page already shows "This plan was updated. Reload to see the latest version." Proposed fix: the page sends the plan's `received_at` (or `mo_run_id`) with confirm, and `confirm_plan` answers `not_found` on a mismatch, so the same reload message shows. That needs a migration (signature change) plus changes to the route, dashboard props, hook, pgTAP and smoke. Traces to FR-010, FR-018.

## Milestone History

- **M-1: Weekly plan loop with memory** (`weekly-plan-loop-with-memory`) — closed 2026-10-09. MO's weekly plan lands in mo-web for invited users, who see recency notes, swap and save the upcoming week, rate recent meals (which also order the options) and browse past weeks; all 13 slices and their foundations done.

## Done

(`/10x-archive` appends M-2 entries here. M-1's entries are in this file's git history and in `context/archive/`.)

- **S-01: a migration that changes a plan rule, a grant or a date boundary fails a test (locally and in CI) before it reaches the hosted database, and the previous Worker keeps working against the new schema during the deploy window.** — Archived 2026-10-10 → `context/archive/2026-10-10-testing-migration-date-rules/`. Lesson: —.
- **S-05: when an agent edits `src/lib/` or a pgTAP test, the matching tests run after the edit; a new migration is applied and tested before the agent hands back.** — Merged 2026-10-10 (PR #129); no change folder to archive (built with `/10x-configure-hook`, decisions on #123). Lesson: —.
- **S-04: one real-browser journey on the Workers runtime (delivery → invitation → set password → dashboard → swap → save → rate → sign in again → choices still there) runs as a required CI gate on every PR.** — Archived 2026-10-12 → `context/archive/2026-10-11-testing-critical-journey-e2e/`. Lesson: —.
- **S-08: a database, PostgREST or Auth fault that the app handles with a friendly page, an error code or a fallback reaches Sentry as one issue per step and error code, with the original error kept as its cause; user errors stay in the logs, and `docs/deployment.md` describes the new policy.** — Archived 2026-10-14 → `context/archive/2026-10-13-report-handled-errors/`. Lesson: —.
