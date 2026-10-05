---
project: mo-web
version: 1
status: draft
created: 2026-09-25
updated: 2026-10-05
prd_version: 1
main_goal: speed
top_blocker: time
milestone_id: weekly-plan-loop-with-memory
milestone_seq: 1
milestone_status: open
tracker: github-issues
gh_milestone: "M-1: Weekly plan loop with memory"
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
- **Scope anchors:** FR-001–FR-005, FR-007–FR-013, FR-017; US-01–US-08. Parked from this milestone: FR-006, FR-014, FR-015, FR-016, FR-018, FR-019.

## Vision recap

Meal Orchestrator (MO) emails a weekly AI meal recommendation but keeps no record of past choices, so a meal the user just ate can be recommended again and nothing helps them catch it. mo-web is a separate, loosely-coupled app that receives MO's weekly delivery, keeps each user's plan history, and shows next to every recommended meal when it last appeared — without changing how MO generates recommendations and without ever becoming a point of failure for MO's email.

## North star

**S-02: User sees the upcoming plan with "was in your plan N days ago" next to repeat meals** — the north star is the smallest end-to-end flow whose success proves the product works, so it is placed as early as its prerequisites allow; here it is the PRD's Business Logic rule made visible, and with a speed-to-launch goal everything else only matters once this works.

## At a glance

| ID   | Change ID                 | Outcome (user can …)                                                                       | Prerequisites | PRD refs                                                 | Status |
| ---- | ------------------------- | ------------------------------------------------------------------------------------------ | ------------- | -------------------------------------------------------- | ------ |
| F-01 | email-link-callback       | (foundation) links in invite and reset emails turn into a signed-in session in mo-web      | —             | FR-003, FR-005, Access Control                           | done   |
| F-02 | supabase-idle-keepalive   | (foundation) the database stays reachable after a week or more with no activity            | —             | NFR idle availability                                    | done   |
| S-01 | mo-weekly-delivery        | user sees the upcoming plan MO just delivered, or an explicit "no upcoming plan yet" state | —             | FR-001, FR-002, FR-007, US-01, US-05, NFR data isolation | done   |
| S-02 | recency-annotated-plan    | user sees last week's plan become history and recency notes on repeat meals                | S-01          | FR-008, FR-011, US-01, US-06                             | done   |
| S-03 | swap-and-save-plan        | user can swap meals within the week's menu and save the plan until its first day           | S-01          | FR-009, FR-010, US-01                                    | done   |
| S-04 | invite-on-first-delivery  | a new MO user gets an invitation, sets a password and logs in to their own dashboard       | S-01, F-01    | FR-002, FR-003, FR-004, US-02, US-03                     | done   |
| S-05 | password-reset            | user can reset a forgotten password from an emailed link and log in again                  | F-01          | FR-005, US-04                                            | done   |
| S-06 | week-resubmission-replace | a re-sent week from MO replaces only that week's stored recommendation                     | S-01, S-03    | FR-017, US-07                                            | ready  |
| S-07 | plan-history-list         | user can browse all past plans as a simple chronological list                              | S-02          | FR-012                                                   | ready  |
| S-08 | rate-recent-meals         | user can rate meals from today or the previous 7 days and see their rating in annotations  | S-02          | FR-013, US-08                                            | ready  |
| S-09 | landing-page              | user lands on a styled sign-in page at `/` and can log in or start a password reset        | S-05          | FR-004, FR-005, US-03, US-04                             | ready  |
| S-10 | expired-link-notice       | user opening an expired or used invite/reset link is told at once and offered a new one    | S-04, S-05    | FR-003, FR-005, US-02, US-04                             | ready  |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme             | Chain                                    | Note                                                                                     |
| ------ | ----------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| A      | Delivery → memory | `S-01` → `S-02` → `S-07`, `S-08`         | Critical path to the north star; speed goal puts every other stream behind or beside it. |
| B      | Plan editing      | `S-03` → `S-06`                          | Joins Stream A at `S-01`; runs in parallel with `S-02`.                                  |
| C      | Accounts & access | `F-01` → `S-04`, `S-05` → `S-09`, `S-10` | `S-04` joins Stream A at `S-01`; `F-01` and `S-05` can start immediately.                |
| D      | Operations        | `F-02`                                   | Standalone; must land before real users rely on weekly delivery.                         |

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
- **Issue:** [#2](https://github.com/malpiszon/meal-orchestrator-web/issues/2)
- **PRD refs:** FR-003, FR-005, Access Control
- **Unlocks:** S-04 (invitation acceptance), S-05 (password reset); verification path: a real invitation re-test, as required by the infrastructure risk register.
- **Prerequisites:** —
- **Parallel with:** F-02, S-01, S-02, S-03, S-06, S-07, S-08
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Shared by two slices and verifiable on its own; without it both invitation and reset links dead-end on the landing page. Redirect allowlist mistakes break links silently — verify against production.
- **Handoff to S-04/S-05:** `/api/auth/confirm` verifies `invite` and `recovery` links (`token_hash` + `type`) and forwards both to `/dashboard`, via the constant `AUTH_LINK_DESTINATION` in `src/lib/auth-link.ts`; each slice switches its type's destination to its own set-password page. The route uses up the single-use token on the GET the link opens, so mail scanners that prefetch links (Microsoft Defender Safe Links, corporate gateways) can consume it before the user clicks, and any page can make a victim open the attacker's own link and sign them in as the attacker (login CSRF). Each slice's set-password page should take `token_hash` + `type` on GET and call `verifyOtp` only on the form POST.
- **Status:** done

### F-02: Supabase idle keep-alive

- **Outcome:** (foundation) the production database stays active through weeks with no user activity, so MO's weekly delivery and the dashboard keep working.
- **Change ID:** supabase-idle-keepalive
- **Issue:** [#3](https://github.com/malpiszon/meal-orchestrator-web/issues/3)
- **PRD refs:** NFR idle availability (added 2026-09-24)
- **Unlocks:** verification path for S-01 — a weekly delivery after ≥ 7 idle days must still be accepted.
- **Prerequisites:** —
- **Parallel with:** F-01, S-01, S-02, S-03, S-04, S-05, S-06, S-07, S-08, S-09
- **Blockers:** —
- **Unknowns:**
  - Scheduled keep-alive ping vs paid database plan (leading option in infrastructure.md: scheduled ping every few days; scheduled CI jobs stop after 60 days without commits in public repos). — Owner: user. Block: no.
- **Risk:** MO's weekly cadence sits right at the ~7-day pause threshold; a paused database would make MO's delivery fail silently from the user's point of view.
- **Status:** done

## Slices

### S-01: MO's weekly delivery reaches the dashboard

- **Outcome:** user can open the dashboard and see the upcoming plan MO just delivered for their email — or an explicit "no upcoming plan yet" state when nothing has arrived.
- **Change ID:** mo-weekly-delivery
- **Issue:** [#4](https://github.com/malpiszon/meal-orchestrator-web/issues/4)
- **PRD refs:** FR-001, FR-002, FR-007, US-01, US-05, NFR data isolation
- **Prerequisites:** —
- **Parallel with:** F-01, F-02, S-05, S-09
- **Blockers:** —
- **Unknowns:**
  - PRD Open Question 1: does MO's payload carry everything needed (e.g. a provider-side meal ID stable across weeks)? Settle on a real MO payload sample during planning. — Owner: user. Block: no.
  - How MO authenticates its delivery and how a non-2xx response reaches MO's operator for manual retry (MO's email must still succeed). — Owner: user. Block: no.
  - Accounts: resolved 2026-09-30. MO is the authority, so a delivery for an email mo-web hasn't seen creates that account (unconfirmed, no password, no email sent) and stores the week. No accounts are created manually; before S-04 the dashboard is verified on the dev stack, where a password is set with an Admin API call. Invitation emails are S-04. — Owner: user. Block: no.
- **Risk:** First slice to introduce data and per-user isolation; the submission shape chosen here constrains meal matching in S-02, so a wrong meal identity is the costliest mistake in the roadmap.
- **Status:** done

### S-02: Recency-annotated upcoming plan (north star)

- **Outcome:** user can see last week's plan become history automatically when the next week arrives, and see "was in your plan N days/weeks ago" next to each meal in the upcoming plan that appeared before.
- **Change ID:** recency-annotated-plan
- **Issue:** [#6](https://github.com/malpiszon/meal-orchestrator-web/issues/6)
- **PRD refs:** FR-008, FR-011, US-01, US-06
- **Prerequisites:** S-01
- **Parallel with:** F-02, S-03, S-04, S-05, S-06, S-09
- **Blockers:** —
- **Unknowns:**
  - What counts as "the same meal" across weeks if the payload has no stable meal ID (depends on S-01's resolution of PRD Open Question 1). — Owner: user. Block: no.
  - How the dashboard shows the in-progress week. S-01 shows only the upcoming plan, so from a plan's first day (Monday) until MO's next delivery the dashboard shows "No upcoming plan yet"; this slice is expected to close that gap (decided 2026-09-30 while planning S-01). — Owner: user. Block: no.
- **Risk:** Proves the product; the annotation must stay cheap per request (Workers free-plan CPU limit per infrastructure.md) and use the most recent earlier occurrence anywhere in history.
- **Status:** done

### S-03: Swap and save the upcoming plan

- **Outcome:** user can swap any meal for another option from that week's menu and save the plan as often as they like until its first day, after which it can no longer be changed.
- **Change ID:** swap-and-save-plan
- **Issue:** [#7](https://github.com/malpiszon/meal-orchestrator-web/issues/7)
- **PRD refs:** FR-009, FR-010, US-01
- **Prerequisites:** S-01
- **Parallel with:** F-02, S-02, S-04, S-05, S-07, S-08, S-09
- **Blockers:** —
- **Unknowns:**
  - Which time zone defines "the plan's first day" for the edit cut-off. Resolved 2026-10-03: Europe/Warsaw for everyone; a plan is editable while its first day is after today there, enforced in Postgres. — Owner: user. Block: no.
- **Risk:** Date rule is the only lock; getting the cut-off wrong either blocks legitimate edits or lets in-progress plans change.
- **Handoff from S-02:** `get_plan_recency` (`supabase/migrations/20261002190000_plan_recency.sql`) treats "planned" as `is_recommended`. S-03 must switch that predicate to the user's saved choice and update `supabase/tests/get_plan_recency.test.sql`. While there, consider a partial index or `LATERAL … order by meal_date desc limit 1`, since the lookup currently reads offered-only history rows too. Done in S-03: the predicate is `is_chosen`, served by a partial index on chosen rows only.
- **Status:** done

### S-04: Invitation on first delivery

- **Outcome:** a user whose account was created by MO's first delivery for their email (S-01) gets an invitation email, sets a password, logs in, and sees only their own plan. This includes accounts S-01 created before this slice shipped. The public sign-up path is gone.
- **Change ID:** invite-on-first-delivery
- **Issue:** [#8](https://github.com/malpiszon/meal-orchestrator-web/issues/8)
- **PRD refs:** FR-002, FR-003, FR-004, US-02, US-03
- **Prerequisites:** S-01, F-01
- **Parallel with:** F-02, S-02, S-03, S-05, S-06, S-07, S-08, S-09
- **Blockers:** —
- **Unknowns:**
  - Supabase must be able to invite an existing, unconfirmed account (the ones S-01 creates). Checked on local Supabase during S-01 Phase 2 (plan row 2.6). — Owner: agent. Block: no.
- **Risk:** Sequenced after the north star because S-01 already creates accounts on first delivery, so no week is lost while invitations wait; auth email rate limit (30/hour) is ample for 2–4 users but must be re-tested with a real invite.
- **Handoff from S-05:** the set-password page (`/auth/set-password`, `POST /api/auth/set-password`) is built to be shared. (1) Add `"invite"` to `SET_PASSWORD_LINK_TYPES` (`src/lib/set-password.ts`, which `setPasswordLinkSchema` and `authLinkQuerySchema` are built from) and to the page's `WORDING` map (`src/pages/auth/set-password.astro`), and point `supabase/templates/invite.html` at `{{ .SiteURL }}/auth/set-password?token_hash={{ .TokenHash }}&type=invite`. (2) Then remove the GET `verifyOtp` from `/api/auth/confirm`: forward `invite` like `recovery` in `authLinkRoute` (`src/lib/auth-link.ts`), so no GET uses a token; as with S-05's reset template, paste the production **Invite user** template only after the deploy. (3) A rejected invite password is retried through the same `mo-password-retry` cookie gate (set only when saving fails right after `verifyOtp`, holds that user's id, 10 minutes); a signed-in session alone can't set a password, so keep that gate. (4) Invite only accounts that are still unconfirmed: a delivery-created account may already have claimed itself through "Forgot or never set a password?". (5) Once invitations exist, the sign-in link "Forgot or never set a password?" can become "Forgot password?". (6) Known issue: right after a reset (an invite will behave the same), the redirect to `/dashboard` once got PostgREST `PGRST303 JWT issued at future` on one of the dashboard's two plan queries ("Something went wrong"; a reload fixed it; not reproduced in 15 scripted runs). Candidate follow-up: retry the dashboard plan load once on `PGRST303`.
- **Status:** done

### S-05: Password reset

- **Outcome:** user can request a reset link by email, set a new password, and log in with it.
- **Change ID:** password-reset
- **Issue:** [#5](https://github.com/malpiszon/meal-orchestrator-web/issues/5)
- **PRD refs:** FR-005, US-04
- **Prerequisites:** F-01
- **Parallel with:** F-02, S-01, S-02, S-03, S-04, S-06, S-07, S-08
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Small and independent; a good parallel track while the delivery stream is in flight.
- **Status:** done

### S-06: Re-sent week replaces the stored recommendation

- **Outcome:** when MO delivers a week it already sent, the latest delivery replaces that week's stored recommendation (including a saved plan, until FR-018 is built) and leaves other weeks and history untouched.
- **Change ID:** week-resubmission-replace
- **Issue:** [#9](https://github.com/malpiszon/meal-orchestrator-web/issues/9)
- **PRD refs:** FR-017, US-07
- **Prerequisites:** S-01, S-03
- **Parallel with:** F-02, S-02, S-04, S-05, S-07, S-08, S-09, S-10
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Follows S-03 so the overwrite behaviour over saved/swapped plans is tested against real saved state rather than assumed.
- **Handoff from S-03:** re-delivery already resets the week: `ingest_weekly_plan` re-creates the option rows with the user's choice back on MO's recommendation and sets `saved_at` to null (`supabase/migrations/20261003120000_plan_choices.sql`; pgTAP in `supabase/tests/plan_choices.test.sql`, smoke step "re-delivery resets the swap"). S-06 should confirm the remaining FR-017 / US-07 behaviour (other weeks and history untouched) rather than rebuild the reset.
- **Status:** ready

### S-07: Browse plan history

- **Outcome:** user can browse their full history of past plans as a simple chronological list.
- **Change ID:** plan-history-list
- **Issue:** [#10](https://github.com/malpiszon/meal-orchestrator-web/issues/10)
- **PRD refs:** FR-012
- **Prerequisites:** S-02
- **Parallel with:** F-02, S-03, S-04, S-05, S-06, S-08, S-09, S-10
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Nice-to-have (secondary success criterion); scoped to a plain list with no filtering or search.
- **Status:** ready

### S-08: Rate recently eaten meals

- **Outcome:** user can rate meals dated today or in the previous 7 days, and their own rating appears alongside the recency note on later plans.
- **Change ID:** rate-recent-meals
- **Issue:** [#11](https://github.com/malpiszon/meal-orchestrator-web/issues/11)
- **PRD refs:** FR-013, US-08
- **Prerequisites:** S-02
- **Parallel with:** F-02, S-03, S-04, S-05, S-06, S-07, S-09, S-10
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Nice-to-have, last in line under the speed goal; the rating window is governed by each meal's date, not the plan's state, which is easy to get wrong.
- **Status:** ready

### S-09: Landing page

- **Outcome:** user opening `/` lands on a sign-in page that looks finished and matches the rest of the app, logs in from there, or follows "forgot password" into the reset flow; the starter's "10x Astro Starter" page is gone.
- **Change ID:** landing-page
- **Issue:** [#18](https://github.com/malpiszon/meal-orchestrator-web/issues/18)
- **PRD refs:** FR-004, FR-005, US-03, US-04
- **Prerequisites:** S-05
- **Parallel with:** F-02, S-01, S-02, S-03, S-04, S-06, S-07, S-08, S-10
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Not a marketing page: no pitch or ad copy, just a pleasant entry point. Build it through the Core Skills Chain (`/10x-new` → `/10x-research` → `/10x-plan` → `/10x-implement`), then polish with `/10x-ui`. Must not link to `/auth/signup`, which S-04 removed. The login and reset paths from `/` need a test, not only a manual check.
- **Status:** ready

### S-10: Expired link notice on open

- **Outcome:** user who opens an invitation or password-reset link that has expired or was already used sees "this link is invalid or has expired" straight away, before typing a password, with a way to get a new link; a valid link still shows the password form.
- **Change ID:** expired-link-notice
- **Issue:** [#67](https://github.com/malpiszon/meal-orchestrator-web/issues/67)
- **PRD refs:** FR-003, FR-005, US-02, US-04
- **Prerequisites:** S-04, S-05
- **Parallel with:** F-02, S-06, S-07, S-08, S-09
- **Blockers:** —
- **Unknowns:**
  - How to tell whether a link is still valid without using up its single-use token (Supabase Auth has no such call; candidate: a database function reading Supabase's own token records and the configured link lifetime, which couples the app to Supabase internals). Confirm on local Supabase while planning. — Owner: agent. Block: no.
- **Risk:** Requirement change added 2026-10-05, not a bug: S-05/S-04 deliberately use the token only on the form post (mail-scanner prefetch, login CSRF), so expiry surfaced only after submitting. That rule must hold — the check on open must never use the token or sign anyone in — and the post-time error stays as the fallback for a link that expires while the form is open.
- **Status:** ready

## Backlog Handoff

| Roadmap ID | Issue                                                               | Change ID                 | Suggested issue title                                        | Ready for `/10x-plan` | Notes                                     |
| ---------- | ------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------ | --------------------- | ----------------------------------------- |
| F-01       | [#2](https://github.com/malpiszon/meal-orchestrator-web/issues/2)   | email-link-callback       | Exchange email-link codes for sessions                       | done                  | Archived 2026-10-03                       |
| F-02       | [#3](https://github.com/malpiszon/meal-orchestrator-web/issues/3)   | supabase-idle-keepalive   | Keep the production database awake between weekly deliveries | done                  | Archived 2026-09-29                       |
| S-01       | [#4](https://github.com/malpiszon/meal-orchestrator-web/issues/4)   | mo-weekly-delivery        | Accept MO's weekly delivery and show it on the dashboard     | done                  | Archived 2026-10-02                       |
| S-02       | [#6](https://github.com/malpiszon/meal-orchestrator-web/issues/6)   | recency-annotated-plan    | Annotate upcoming meals with recency from history            | done                  | Archived 2026-10-03                       |
| S-03       | [#7](https://github.com/malpiszon/meal-orchestrator-web/issues/7)   | swap-and-save-plan        | Swap meals within the week's menu and save the plan          | done                  | Archived 2026-10-03                       |
| S-04       | [#8](https://github.com/malpiszon/meal-orchestrator-web/issues/8)   | invite-on-first-delivery  | Invite new MO users on their first delivery                  | done                  | Archived 2026-10-04                       |
| S-05       | [#5](https://github.com/malpiszon/meal-orchestrator-web/issues/5)   | password-reset            | Password reset by email                                      | done                  | Archived 2026-10-04                       |
| S-06       | [#9](https://github.com/malpiszon/meal-orchestrator-web/issues/9)   | week-resubmission-replace | Replace a re-sent week's recommendation                      | yes                   | Run `/10x-plan week-resubmission-replace` |
| S-07       | [#10](https://github.com/malpiszon/meal-orchestrator-web/issues/10) | plan-history-list         | Chronological list of past plans                             | yes                   | Nice-to-have                              |
| S-08       | [#11](https://github.com/malpiszon/meal-orchestrator-web/issues/11) | rate-recent-meals         | Rate meals from the last 7 days                              | yes                   | Nice-to-have                              |
| S-09       | [#18](https://github.com/malpiszon/meal-orchestrator-web/issues/18) | landing-page              | Sign-in landing page with login and password reset           | yes                   | Run `/10x-plan landing-page`              |
| S-10       | [#67](https://github.com/malpiszon/meal-orchestrator-web/issues/67) | expired-link-notice       | Show an expired invite/reset link as soon as it's opened     | yes                   | Run `/10x-plan expired-link-notice`       |

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
- **Smarter tie-break between equally scored options** — Why parked: nice-to-have, outside the MVP (decided while planning S-01, 2026-09-30). S-01 recommends the highest-scored option and breaks ties by menu order (first listed wins); a later slice may resolve ties better (e.g. prefer the option not recently eaten, or let MO send an explicit pick).
- **Invite email failure handling** — Why parked: nice-to-have, outside the MVP (decided while planning S-04, 2026-10-04). If the invitation email can't be sent (rate limit, SMTP down), the delivery still returns 200, the failure is only logged, and the account stays unconfirmed with no invitation; the user can use "Forgot password?". Revisit (retry, re-invite on a later delivery, or a visible state) if the user base grows beyond 2–4 people.

## Milestone History

## Done

- **F-02: (foundation) the production database stays active through weeks with no user activity, so MO's weekly delivery and the dashboard keep working.** — Archived 2026-09-29 → `context/archive/2026-09-25-supabase-idle-keepalive/`. Lesson: —.
- **S-01: user can open the dashboard and see the upcoming plan MO just delivered for their email — or an explicit "no upcoming plan yet" state when nothing has arrived.** — Archived 2026-10-02 → `context/archive/2026-09-30-mo-weekly-delivery/`. Lesson: —.
- **S-02: user can see last week's plan become history automatically when the next week arrives, and see "was in your plan N days/weeks ago" next to each meal in the upcoming plan that appeared before.** — Archived 2026-10-03 → `context/archive/2026-10-02-recency-annotated-plan/`. Lesson: —.
- **F-01: (foundation) links in Supabase auth emails (invitation, password reset) land on a callback that exchanges the link's code for a signed-in session and forwards the user to the right next page.** — Archived 2026-10-03 → `context/archive/2026-10-03-email-link-callback/`. Lesson: —.
- **S-03: user can swap any meal for another option from that week's menu and save the plan as often as they like until its first day, after which it can no longer be changed.** — Archived 2026-10-03 → `context/archive/2026-10-03-swap-and-save-plan/`. Lesson: —.
- **S-05: user can request a reset link by email, set a new password, and log in with it.** — Archived 2026-10-04 → `context/archive/2026-10-04-password-reset/`. Lesson: —.
- **S-04: a user whose account was created by MO's first delivery for their email (S-01) gets an invitation email, sets a password, logs in, and sees only their own plan. This includes accounts S-01 created before this slice shipped. The public sign-up path is gone.** — Archived 2026-10-04 → `context/archive/2026-10-04-invite-on-first-delivery/`. Lesson: —.
