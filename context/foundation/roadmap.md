---
project: mo-web
version: 1
status: draft
created: 2026-10-10
updated: 2026-10-10
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

> Derived from `context/foundation/test-plan.md` §3 (2026-10-10) + the user's description of a nice-to-have mutation-testing item + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Milestone

**M-2: Regression safety net** — Status: open

- **Intent:** a change that breaks a plan rule, MO's delivery, another user's data or the main journey fails a test before it reaches production. The test plan's risks #1–#7 are covered by the cheapest test that gives a real signal; more scope goes into a later milestone.
- **Source materials:** `context/foundation/test-plan.md` §3 Phased Rollout (risks in §2), plus the user's description for MS-06 (2026-10-10).
- **Done when:** every S-NN below is `done`.
- **Scope anchors:**
  - MS-01: Test-plan Phase 1, migration and date-rule safety (risks #1, #5).
  - MS-02: Test-plan Phase 2, delivery and re-send integrity (risks #2, #6).
  - MS-03: Test-plan Phase 3, data isolation sweep (risk #3).
  - MS-04: Test-plan Phase 4, critical-journey e2e (risks #4, #7).
  - MS-05: Test-plan Phase 5, agent-loop feedback (risks #1, #5).
  - MS-06: Mutation testing, probably with Stryker — nice-to-have (user, 2026-10-10: "cover only risks listed there + nice to have for mutation tests").

## Vision recap

Meal Orchestrator (MO) emails a weekly meal recommendation; mo-web receives that week, keeps each user's plan history, shows when each meal last appeared, and lets the user swap, save and rate meals. M-1 shipped that loop. M-2 adds no user-facing features: it makes the existing rules hard to break, because migrations reach the hosted database before their code merges and mo-web has no monitoring that would notice a silent failure.

## North star

**S-01: a migration that breaks a plan rule or a date boundary fails a test before it reaches production** — the north star is the smallest item whose success proves the milestone works, so it goes first. Here it covers the test plan's only risk rated high on both impact and likelihood, and it lays down the pinned "today", the RPC contract and the migration replay that later items reuse.

## At a glance

| ID   | Change ID                         | Outcome (user can …)                                                                                | Prerequisites | PRD refs | Status      |
| ---- | --------------------------------- | --------------------------------------------------------------------------------------------------- | ------------- | -------- | ----------- |
| S-01 | testing-migration-date-rules      | a migration that breaks a plan rule, grant or date boundary fails a test before production          | —             | MS-01    | in-progress |
| S-02 | testing-delivery-resend-integrity | a 2xx from MO's delivery provably means the week is stored exactly; a re-send changes only its week | S-01          | MS-02    | proposed    |
| S-03 | testing-data-isolation            | a second user provably can't read or change another user's data, via the app or the database API    | S-01          | MS-03    | proposed    |
| S-04 | testing-critical-journey-e2e      | one real-browser journey from delivery to rating runs as a CI gate                                  | —             | MS-04    | ready       |
| S-05 | testing-agent-post-edit-hook      | an agent editing a migration or `src/lib/` gets the matching tests run after the edit               | S-01          | MS-05    | proposed    |
| S-06 | testing-mutation-stryker          | a developer can see which code changes the unit tests fail to catch (nice-to-have)                  | S-01          | MS-06    | proposed    |

## Baseline

What's already in place in the codebase as of `2026-10-10` (auto-researched + user-confirmed). The app itself is complete for M-1 (see Milestone History); this inventory covers the test layers M-2 works on.

- **Unit tests:** present — Vitest, 11 files in `src/lib/`; S-01 adds week-selection cases and an in-memory database fake.
- **Database tests:** present — pgTAP, 6 files; S-01 adds the RPC contract, the Warsaw "today" helper and the date-boundary tests.
- **HTTP smoke:** present — `scripts/smoke.mjs`, run in CI's smoke job and after deploy.
- **Migration replay:** partial — being added to CI by S-01 Phase 3.
- **Browser e2e:** absent — no Playwright in the project or CI.
- **Agent post-edit hook:** absent — `.claude/settings.json` holds permissions only.
- **Observability:** partial — Workers observability is on; no alerting (FR-019, parked).

## Foundations

None. Each item sets up the tooling it needs (S-01 the replay harness, S-04 Playwright, S-06 Stryker), so no shared enabler has to land first.

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
- **Status:** in-progress

### S-02: Delivery and re-send integrity

- **Outcome:** a 2xx from MO's delivery provably means the week is stored exactly as the contract describes, and a re-sent week changes only what it should; a contract-valid payload stored wrong, or a partial write behind a 2xx, fails a test.
- **Change ID:** testing-delivery-resend-integrity
- **Issue:** [#120](https://github.com/malpiszon/meal-orchestrator-web/issues/120)
- **PRD refs:** MS-02
- **Prerequisites:** S-01
- **Parallel with:** S-03, S-04, S-05, S-06
- **Blockers:** —
- **Unknowns:**
  - Is the delivery write atomic, so a failure part-way through answers non-2xx and leaves nothing half-written? — Owner: research. Block: no.
  - Can real dev re-sends serve as fixtures for the changed-week cases? — Owner: user. Block: no.
- **Risk:** MO alerts only on non-2xx and mo-web has no monitoring, so a 2xx with a bad save goes unnoticed; next in line because the delivery is where every week's data enters.
- **Status:** proposed

### S-03: Data isolation sweep

- **Outcome:** a second user can't read or change another user's plans, choices or ratings, through the app's routes or by calling the database API directly with their own session; a new table, function or grant that leaks fails a test.
- **Change ID:** testing-data-isolation
- **Issue:** [#121](https://github.com/malpiszon/meal-orchestrator-web/issues/121)
- **PRD refs:** MS-03
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-04, S-05, S-06
- **Blockers:** —
- **Unknowns:**
  - Which tables, functions and grants are reachable with the public keys, and which functions run with the owner's rights (skipping row-level security)? — Owner: research. Block: no.
- **Risk:** Challenges "row-level security is on, so it's safe"; follows S-01 because it walks the function list S-01's contract test pins.
- **Status:** proposed

### S-04: Critical-journey e2e

- **Outcome:** one real-browser journey on the Workers runtime (delivery → invitation → set password → dashboard → swap → save → rate → sign in again → choices still there) runs as a required CI gate on every PR.
- **Change ID:** testing-critical-journey-e2e
- **Issue:** [#122](https://github.com/malpiszon/meal-orchestrator-web/issues/122)
- **PRD refs:** MS-04
- **Prerequisites:** —
- **Parallel with:** S-01, S-02, S-03, S-05, S-06
- **Blockers:** —
- **Unknowns:**
  - Does Playwright run against the Workers preview in CI next to local Supabase and Mailpit, and how is the stack reset between runs? — Owner: research. Block: no.
- **Risk:** The most expensive layer and new tooling; technically independent, but kept after S-02 and S-03 in the test plan's order so it only covers what cheaper layers can't reach.
- **Status:** ready

### S-05: Agent post-edit test hook

- **Outcome:** when an agent edits a migration or `src/lib/`, a post-edit hook runs the matching pgTAP or unit tests and reports a failure in the same loop.
- **Change ID:** testing-agent-post-edit-hook
- **Issue:** [#123](https://github.com/malpiszon/meal-orchestrator-web/issues/123)
- **PRD refs:** MS-05
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-03, S-04, S-06
- **Blockers:** —
- **Unknowns:**
  - How does an edited file map to its tests, and can the hook stay under a minute? — Owner: research. Block: no.
- **Risk:** Runs the tests the earlier items add, so it comes late; local only, never a CI substitute.
- **Status:** proposed

### S-06: Mutation testing for unit tests (nice-to-have)

- **Outcome:** a developer can run mutation testing over `src/lib/` and see which code changes the unit tests fail to catch, so weak tests are found by a tool instead of by hand.
- **Change ID:** testing-mutation-stryker
- **Issue:** [#124](https://github.com/malpiszon/meal-orchestrator-web/issues/124)
- **PRD refs:** MS-06
- **Prerequisites:** S-01
- **Parallel with:** S-02, S-03, S-04, S-05
- **Blockers:** —
- **Unknowns:**
  - Does Stryker work with this repo's Vitest and TypeScript versions, and is a run fast enough for CI or only for local use? — Owner: research. Block: no.
- **Risk:** Nice-to-have and first to park if M-2 drags on (top blocker: time); last so it scores the suite the earlier items build. TypeScript only — SQL keeps the manual mutation checks S-01 uses.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Issue                                                                 | Change ID                         | Suggested issue title                             | Ready for `/10x-plan` | Notes                                               |
| ---------- | --------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------- | --------------------- | --------------------------------------------------- |
| S-01       | [#116](https://github.com/malpiszon/meal-orchestrator-web/issues/116) | testing-migration-date-rules      | Test-plan Phase 1: migration and date-rule safety | in progress           | Phase sub-issues #117 (closed), #118 (closed), #119 |
| S-02       | [#120](https://github.com/malpiszon/meal-orchestrator-web/issues/120) | testing-delivery-resend-integrity | Test-plan Phase 2: delivery and re-send integrity | no                    | After S-01                                          |
| S-03       | [#121](https://github.com/malpiszon/meal-orchestrator-web/issues/121) | testing-data-isolation            | Test-plan Phase 3: data isolation sweep           | no                    | After S-01                                          |
| S-04       | [#122](https://github.com/malpiszon/meal-orchestrator-web/issues/122) | testing-critical-journey-e2e      | Test-plan Phase 4: critical-journey e2e           | yes                   | Test-plan order puts it after S-02 and S-03         |
| S-05       | [#123](https://github.com/malpiszon/meal-orchestrator-web/issues/123) | testing-agent-post-edit-hook      | Test-plan Phase 5: agent post-edit test hook      | no                    | After S-01                                          |
| S-06       | [#124](https://github.com/malpiszon/meal-orchestrator-web/issues/124) | testing-mutation-stryker          | Mutation testing for unit tests (Stryker)         | no                    | Nice-to-have; after S-01                            |

## Open Roadmap Questions

1. **Does MO's payload include macro/nutritional data (e.g. salt) at all?** — Owner: user. Block: parked FR-014, FR-015 (PRD Open Question 2).
2. **What format are MO's historical debug-artifact logs in, and are they parseable as a stable source?** — Owner: user. Block: parked FR-016 (PRD Open Question 3).

## Parked

- **Operator alerts on failed jobs or deliveries (FR-019)** — Why parked: nice-to-have; the test plan treats noticing failures in production as observability, not testing (§2). A candidate for a later milestone.
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
- **Invite email failure handling** — Why parked: nice-to-have, outside the MVP (decided while planning S-04, 2026-10-04). If the invitation email can't be sent (rate limit, SMTP down), the delivery still returns 200, the failure is only logged, and the account stays unconfirmed with no invitation; the user can use "Forgot password?". Revisit (retry, re-invite on a later delivery, or a visible state) if the user base grows beyond 2–4 people.
- **Styled invitation and password-reset emails** — Why parked: nice-to-have, outside M-1 (decided 2026-10-06). The templates in `supabase/templates/` are unstyled (a heading, one sentence and a link). When picked up, reuse the styling of MO's own emails rather than designing new styling. Traces to FR-003, FR-005. Email programs can't use the app's Tailwind classes or design tokens, so the styles must be inline. Production templates are pasted by hand into the Supabase dashboard (see `docs/deployment.md#email-settings-and-templates`).
- **General mo-web UI review (logo, visual identity)** — Why parked: nice-to-have, outside M-1 (decided 2026-10-06). An app-wide pass that adds a logo and a consistent look across pages. Its scope differs from S-09, which only replaces the page at `/` with a sign-in page. When picked up, run it through `/10x-ui` one view at a time. It could also give the styled emails above a shared look.
- **Stale "Keep as recommended" after a re-delivery** — Why parked: nice-to-have, outside the MVP (decided 2026-10-06, from the S-06 review). On a "Next week" page opened before MO re-sends that week, "Keep as recommended" still saves: the plan id survives a re-send, so `confirm_plan` accepts it. What gets saved is MO's latest recommendation, while the open page still shows the old dishes next to "Saved …" until a reload. S-06 then keeps those dishes on later re-sends. It needs a never-saved plan, an open page and a re-send together. A swap on such a page already shows "This plan was updated. Reload to see the latest version." Proposed fix: the page sends the plan's `received_at` (or `mo_run_id`) with confirm, and `confirm_plan` answers `not_found` on a mismatch, so the same reload message shows. That needs a migration (signature change) plus changes to the route, dashboard props, hook, pgTAP and smoke. Traces to FR-010, FR-018.

## Milestone History

- **M-1: Weekly plan loop with memory** (`weekly-plan-loop-with-memory`) — closed 2026-10-09. MO's weekly plan lands in mo-web for invited users, who see recency notes, swap and save the upcoming week, rate recent meals (which also order the options) and browse past weeks; all 13 slices and their foundations done.

## Done

(`/10x-archive` appends M-2 entries here. M-1's entries are in this file's git history and in `context/archive/`.)
