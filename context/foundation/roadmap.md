---
project: mo-web
version: 1
status: draft
created: 2026-09-25
updated: 2026-09-25
prd_version: 1
main_goal: speed
top_blocker: time
milestone_id: weekly-plan-loop-with-memory
milestone_seq: 1
milestone_status: open
---

# Roadmap: mo-web

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Milestone

**M-1: Weekly plan loop with memory** — Status: open

- **Intent:** MO's weekly recommendation lands in mo-web alongside the existing email; invited users see it annotated with how recently each meal appeared in their own history, adjust it within that week's menu, and every plan becomes history automatically when the next week arrives.
- **Source materials:** `context/foundation/prd.md` (v1)
- **Done when:** every F-NN and S-NN below is `done`.
- **Scope anchors:** FR-001–FR-005, FR-007–FR-013, FR-017; US-01–US-08. Parked from this milestone: FR-006, FR-014, FR-015, FR-016, FR-018.

## Vision recap

Meal Orchestrator (MO) emails a weekly AI meal recommendation but keeps no record of past choices, so a meal the user just ate can be recommended again and nothing helps them catch it. mo-web is a separate, loosely-coupled app that receives MO's weekly delivery, keeps each user's plan history, and shows next to every recommended meal when it last appeared — without changing how MO generates recommendations and without ever becoming a point of failure for MO's email.

## North star

**S-02: User sees the upcoming plan with "was in your plan N days ago" next to repeat meals** — the north star is the smallest end-to-end flow whose success proves the product works, so it is placed as early as its prerequisites allow; here it is the PRD's Business Logic rule made visible, and with a speed-to-launch goal everything else only matters once this works.

## At a glance

| ID   | Change ID                 | Outcome (user can …)                                                                       | Prerequisites | PRD refs                                                 | Status   |
| ---- | ------------------------- | ------------------------------------------------------------------------------------------ | ------------- | -------------------------------------------------------- | -------- |
| F-01 | email-link-callback       | (foundation) links in invite and reset emails turn into a signed-in session in mo-web      | —             | FR-003, FR-005, Access Control                           | ready    |
| F-02 | supabase-idle-keepalive   | (foundation) the database stays reachable after a week or more with no activity            | —             | NFR idle availability                                    | ready    |
| S-01 | mo-weekly-delivery        | user sees the upcoming plan MO just delivered, or an explicit "no upcoming plan yet" state | —             | FR-001, FR-002, FR-007, US-01, US-05, NFR data isolation | ready    |
| S-02 | recency-annotated-plan    | user sees last week's plan become history and recency notes on repeat meals                | S-01          | FR-008, FR-011, US-01, US-06                             | proposed |
| S-03 | swap-and-save-plan        | user can swap meals within the week's menu and save the plan until its first day           | S-01          | FR-009, FR-010, US-01                                    | proposed |
| S-04 | invite-on-first-delivery  | a new MO user gets an invitation, sets a password and logs in to their own dashboard       | S-01, F-01    | FR-002, FR-003, FR-004, US-02, US-03                     | proposed |
| S-05 | password-reset            | user can reset a forgotten password from an emailed link and log in again                  | F-01          | FR-005, US-04                                            | proposed |
| S-06 | week-resubmission-replace | a re-sent week from MO replaces only that week's stored recommendation                     | S-01, S-03    | FR-017, US-07                                            | proposed |
| S-07 | plan-history-list         | user can browse all past plans as a simple chronological list                              | S-02          | FR-012                                                   | proposed |
| S-08 | rate-recent-meals         | user can rate meals from today or the previous 7 days and see their rating in annotations  | S-02          | FR-013, US-08                                            | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme             | Chain                            | Note                                                                                     |
| ------ | ----------------- | -------------------------------- | ---------------------------------------------------------------------------------------- |
| A      | Delivery → memory | `S-01` → `S-02` → `S-07`, `S-08` | Critical path to the north star; speed goal puts every other stream behind or beside it. |
| B      | Plan editing      | `S-03` → `S-06`                  | Joins Stream A at `S-01`; runs in parallel with `S-02`.                                  |
| C      | Accounts & access | `F-01` → `S-04`, `S-05`          | `S-04` joins Stream A at `S-01`; `F-01` and `S-05` can start immediately.                |
| D      | Operations        | `F-02`                           | Standalone; must land before real users rely on weekly delivery.                         |

## Baseline

What's already in place in the codebase as of `2026-09-25` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 7 + React 19 islands + Tailwind 4 + shadcn/ui (per tech-stack.md); only starter pages exist (landing page, placeholder dashboard, auth forms).
- **Backend / API:** partial — only the starter's sign-in / sign-up / sign-out routes; no endpoint MO can submit to.
- **Data:** absent — Supabase client is wired, but there are no migrations, tables or row-level security policies.
- **Auth:** partial — email/password sign-in, sign-out and middleware gating the dashboard are present; public sign-up still exists in code (disabled in production); no email-link callback, no invitation flow, no password reset.
- **Deploy / infra:** present — Cloudflare Workers deploy, CI with lint/build, smoke and deploy jobs, production secrets, Resend SMTP for auth emails. Open: the Supabase idle-pause mitigation is not decided.
- **Observability:** partial — Workers observability is enabled; no error tracking or alerting on failed MO deliveries.

## Foundations

### F-01: Email-link callback

- **Outcome:** (foundation) links in Supabase auth emails (invitation, password reset) land on a callback that exchanges the link's code for a signed-in session and forwards the user to the right next page.
- **Change ID:** email-link-callback
- **PRD refs:** FR-003, FR-005, Access Control
- **Unlocks:** S-04 (invitation acceptance), S-05 (password reset); verification path: a real invitation re-test, as required by the infrastructure risk register.
- **Prerequisites:** —
- **Parallel with:** F-02, S-01, S-02, S-03, S-06, S-07, S-08
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Shared by two slices and verifiable on its own; without it both invitation and reset links dead-end on the landing page. Redirect allowlist mistakes break links silently — verify against production.
- **Status:** ready

### F-02: Supabase idle keep-alive

- **Outcome:** (foundation) the production database stays active through weeks with no user activity, so MO's weekly delivery and the dashboard keep working.
- **Change ID:** supabase-idle-keepalive
- **PRD refs:** NFR idle availability (added 2026-09-24)
- **Unlocks:** verification path for S-01 — a weekly delivery after ≥ 7 idle days must still be accepted.
- **Prerequisites:** —
- **Parallel with:** F-01, S-01, S-02, S-03, S-04, S-05, S-06, S-07, S-08
- **Blockers:** —
- **Unknowns:**
  - Scheduled keep-alive ping vs paid database plan (leading option in infrastructure.md: scheduled ping every few days; scheduled CI jobs stop after 60 days without commits in public repos). — Owner: user. Block: no.
- **Risk:** MO's weekly cadence sits right at the ~7-day pause threshold; a paused database would make MO's delivery fail silently from the user's point of view.
- **Status:** ready

## Slices

### S-01: MO's weekly delivery reaches the dashboard

- **Outcome:** user can open the dashboard and see the upcoming plan MO just delivered for their email — or an explicit "no upcoming plan yet" state when nothing has arrived.
- **Change ID:** mo-weekly-delivery
- **PRD refs:** FR-001, FR-002, FR-007, US-01, US-05, NFR data isolation
- **Prerequisites:** —
- **Parallel with:** F-01, F-02, S-05
- **Blockers:** —
- **Unknowns:**
  - PRD Open Question 1: does MO's payload carry everything needed (e.g. a provider-side meal ID stable across weeks)? Settle on a real MO payload sample during planning. — Owner: user. Block: no.
  - How MO authenticates its delivery and how a non-2xx response reaches MO's operator for manual retry (MO's email must still succeed). — Owner: user. Block: no.
  - First account for the requester: created manually until S-04 lands; deliveries for unknown emails are rejected until then. — Owner: user. Block: no.
- **Risk:** First slice to introduce data and per-user isolation; the submission shape chosen here constrains meal matching in S-02, so a wrong meal identity is the costliest mistake in the roadmap.
- **Status:** ready

### S-02: Recency-annotated upcoming plan (north star)

- **Outcome:** user can see last week's plan become history automatically when the next week arrives, and see "was in your plan N days/weeks ago" next to each meal in the upcoming plan that appeared before.
- **Change ID:** recency-annotated-plan
- **PRD refs:** FR-008, FR-011, US-01, US-06
- **Prerequisites:** S-01
- **Parallel with:** F-02, S-03, S-04, S-05, S-06
- **Blockers:** —
- **Unknowns:**
  - What counts as "the same meal" across weeks if the payload has no stable meal ID (depends on S-01's resolution of PRD Open Question 1). — Owner: user. Block: no.
- **Risk:** Proves the product; the annotation must stay cheap per request (Workers free-plan CPU limit per infrastructure.md) and use the most recent earlier occurrence anywhere in history.
- **Status:** proposed

### S-03: Swap and save the upcoming plan

- **Outcome:** user can swap any meal for another option from that week's menu and save the plan as often as they like until its first day, after which it can no longer be changed.
- **Change ID:** swap-and-save-plan
- **PRD refs:** FR-009, FR-010, US-01
- **Prerequisites:** S-01
- **Parallel with:** F-02, S-02, S-04, S-05, S-07, S-08
- **Blockers:** —
- **Unknowns:**
  - Which time zone defines "the plan's first day" for the edit cut-off. — Owner: user. Block: no.
- **Risk:** Date rule is the only lock; getting the cut-off wrong either blocks legitimate edits or lets in-progress plans change.
- **Status:** proposed

### S-04: Invitation on first delivery

- **Outcome:** a user whose email MO sends for the first time gets an account and an invitation email, sets a password, logs in, and sees only their own plan; the public sign-up path is gone.
- **Change ID:** invite-on-first-delivery
- **PRD refs:** FR-002, FR-003, FR-004, US-02, US-03
- **Prerequisites:** S-01, F-01
- **Parallel with:** F-02, S-02, S-03, S-05, S-06, S-07, S-08
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Sequenced after the north star because the first users can be created manually; auth email rate limit (30/hour) is ample for 2–4 users but must be re-tested with a real invite.
- **Status:** proposed

### S-05: Password reset

- **Outcome:** user can request a reset link by email, set a new password, and log in with it.
- **Change ID:** password-reset
- **PRD refs:** FR-005, US-04
- **Prerequisites:** F-01
- **Parallel with:** F-02, S-01, S-02, S-03, S-04, S-06, S-07, S-08
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Small and independent; a good parallel track while the delivery stream is in flight.
- **Status:** proposed

### S-06: Re-sent week replaces the stored recommendation

- **Outcome:** when MO delivers a week it already sent, the latest delivery replaces that week's stored recommendation (including a saved plan, until FR-018 is built) and leaves other weeks and history untouched.
- **Change ID:** week-resubmission-replace
- **PRD refs:** FR-017, US-07
- **Prerequisites:** S-01, S-03
- **Parallel with:** F-02, S-02, S-04, S-05, S-07, S-08
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Follows S-03 so the overwrite behaviour over saved/swapped plans is tested against real saved state rather than assumed.
- **Status:** proposed

### S-07: Browse plan history

- **Outcome:** user can browse their full history of past plans as a simple chronological list.
- **Change ID:** plan-history-list
- **PRD refs:** FR-012
- **Prerequisites:** S-02
- **Parallel with:** F-02, S-03, S-04, S-05, S-06, S-08
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Nice-to-have (secondary success criterion); scoped to a plain list with no filtering or search.
- **Status:** proposed

### S-08: Rate recently eaten meals

- **Outcome:** user can rate meals dated today or in the previous 7 days, and their own rating appears alongside the recency note on later plans.
- **Change ID:** rate-recent-meals
- **PRD refs:** FR-013, US-08
- **Prerequisites:** S-02
- **Parallel with:** F-02, S-03, S-04, S-05, S-06, S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Nice-to-have, last in line under the speed goal; the rating window is governed by each meal's date, not the plan's state, which is easy to get wrong.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                 | Suggested issue title                                        | Ready for `/10x-plan` | Notes                                   |
| ---------- | ------------------------- | ------------------------------------------------------------ | --------------------- | --------------------------------------- |
| F-01       | email-link-callback       | Exchange email-link codes for sessions                       | yes                   | Run `/10x-plan email-link-callback`     |
| F-02       | supabase-idle-keepalive   | Keep the production database awake between weekly deliveries | yes                   | Run `/10x-plan supabase-idle-keepalive` |
| S-01       | mo-weekly-delivery        | Accept MO's weekly delivery and show it on the dashboard     | yes                   | Run `/10x-plan mo-weekly-delivery`      |
| S-02       | recency-annotated-plan    | Annotate upcoming meals with recency from history            | no                    | Needs S-01                              |
| S-03       | swap-and-save-plan        | Swap meals within the week's menu and save the plan          | no                    | Needs S-01                              |
| S-04       | invite-on-first-delivery  | Invite new MO users on their first delivery                  | no                    | Needs S-01, F-01                        |
| S-05       | password-reset            | Password reset by email                                      | no                    | Needs F-01                              |
| S-06       | week-resubmission-replace | Replace a re-sent week's recommendation                      | no                    | Needs S-01, S-03                        |
| S-07       | plan-history-list         | Chronological list of past plans                             | no                    | Needs S-02; nice-to-have                |
| S-08       | rate-recent-meals         | Rate meals from the last 7 days                              | no                    | Needs S-02; nice-to-have                |

## Open Roadmap Questions

1. **Does MO's current per-module data payload contain everything mo-web needs (e.g. a provider-side meal ID), or does MO need a small payload extension?** — Owner: user. Block: none (settled while planning S-01; shapes S-02 and S-03).
2. **Does MO's payload include macro/nutritional data (e.g. salt) at all?** — Owner: user. Block: parked FR-014, FR-015.
3. **What format are MO's historical debug-artifact logs in, and are they parseable as a stable source?** — Owner: user. Block: parked FR-016.
4. **Where is the sending side built — the extra delivery step in MO's own repository, alongside (not replacing) the email?** — Owner: user. Block: none (S-01 is verifiable with a recorded payload; real end-to-end needs MO's side).

## Parked

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
- **FR-018 keep saved choices on re-submission** — Why parked: nice-to-have; speed goal. S-06 overwrites saved plans until this is picked up.

## Milestone History

## Done
