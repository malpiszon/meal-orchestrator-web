---
project: "mo-web"
context_type: greenfield
created: 2026-09-22
updated: 2026-09-23
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "pain category"
      decision: "between data-trapped and missing-capability — MO is a weekly batch Python job (provider data from file config -> LLM via OpenRouter -> email); history only exists as ephemeral debug artifacts"
    - topic: "insight"
      decision: "MO's architecture (stateless weekly batch script) doesn't fit persistent history easily; a separate loosely-coupled app avoids reshaping MO's internals"
    - topic: "primary persona scope"
      decision: "REVISED during FR Socrates round — small trusted group (~2-4 people: the requester, their spouse, and up to two neighbor-testers), each an MO end-user known personally to the requester, not a single-user MVP; system design doesn't preclude other MO users with known emails registering later"
    - topic: "account creation flow"
      decision: "invitation-on-first-submission — when MO first sends data for an email mo-web hasn't seen, mo-web sends a 'set your password' invitation; there is no separate self-service signup path"
    - topic: "unmodified-plan approval timing"
      decision: "next week's MO upload triggers finalization of the prior (possibly unmodified) plan into history — no scheduler, fits the no-additional-infra MVP constraint"
    - topic: "history-in-automatic-selection scope"
      decision: "confirmed out of scope for MVP — mo-web will not send user decisions/scoring back to MO, and neither app will connect to the provider's panel to capture actually-selected meals"
    - topic: "plan editing, history and rating windows"
      decision: "REVISED after PRD review 2026-09-23 — date-driven, no lock/finalize transitions: upcoming plan editable/savable repeatedly until its first day; only 'user saved it' is recorded; history = every plan older than MO's newest delivery; a meal is rateable on its day or within the next 7 days (best guess). Provider change deadlines not mirrored. FR-017 overwrite of saved plans accepted until FR-018. Annotations use the latest earlier occurrence."
  frs_drafted: 18
  quality_check_status: accepted
---

## Vision & Problem Statement

Meal Orchestrator (MO) runs as a weekly batch job: it pulls the user's food-provider data from file-based config, formats it, sends it to an external AI model for a personalized meal recommendation, and emails the result. It keeps no user-facing record of past recommendations — only ephemeral debug artifacts from each run — so a meal that scored well can be recommended again even after the user is tired of it. The person who feels this is an MO end-user — for the MVP, the requester themselves, using their own MO instance — at the moment they open the weekly email and spot a meal they just had; today there is nothing to consult, so they either eat the repeat or rely on their own memory to catch it.

mo-web exists because MO's current architecture — a stateless weekly batch script — doesn't lend itself to being retrofitted with persistent choice history; building that memory as a separate, loosely-coupled application avoids reshaping MO's internals and lets mo-web's history/dashboard concerns evolve on their own schedule.

## User & Persona

Primary persona: an MO end-user who already receives MO's weekly emailed recommendation. For the MVP, this is a small, personally-known group — the requester, their spouse, and possibly up to two neighbor-testers (roughly 2-4 people), each using their own MO instance and provider data. The requester can explain expectations to each person directly, which is why the invitation-based account creation (see Access Control) is acceptable without broader self-service signup. The system does not hard-code a hard user-count limit: anyone whose email MO has already passed to mo-web can be invited, so the group can grow further without product changes.

No secondary persona for MVP — mo-web has only one type of user (no roles/admin distinction).

## Access Control

Single flat user type; no roles, no admin/member distinction.

Account creation is invitation-driven, not self-service: when MO submits data for an email mo-web has not seen before, mo-web sends that email an invitation to set a password. There is no signup form that accepts an arbitrary email — the only way in is to already be a known MO user whose data has been submitted at least once. Once a password is set, the user logs in with email + password on subsequent visits.

Unauthenticated visitors are redirected to login; the dashboard and history are gated behind authentication.

## Success Criteria

### Primary
- The end-to-end flow works: MO delivers a recommendation to mo-web, the user (after activating via invitation) sees the recommendation with history context on a dashboard, can accept it or swap meals, and saves a final plan that becomes part of history for future weeks.

### Secondary
- The user can browse their full history of past plans, not just the inline "this was in your plan N days ago" context on the current recommendation.

### Guardrails
- mo-web requires zero changes to how MO generates recommendations — only an additional delivery path alongside (not replacing) the existing email.
- If MO's delivery to mo-web fails, MO's existing email delivery still succeeds — mo-web is additive and must never become a point of failure for MO's core function. (A failed save on mo-web's side is acceptable to require manual retry, per the "no additional infrastructure" constraint.)

## Functional Requirements

### Ingestion & Accounts
- FR-001: MO can submit a user's weekly recommendation and associated data to mo-web as a structured, machine-readable submission. Priority: must-have
  > Socrates: Counter-argument considered: "the submission format may be too thin — MO's current per-module payload might not carry everything mo-web needs (e.g. a provider-side meal ID)." Resolution: kept; submission-format completeness is already tracked as an Open Question and must be confirmed before/during implementation planning.
- FR-002: mo-web persists each submitted recommendation as data tied to the correct user account, matched by email. Priority: must-have
  > Socrates: No counter-argument; stands as written.
- FR-003: A user whose email is new to mo-web receives an invitation to set a password upon their first submitted recommendation. Priority: must-have
  > Socrates: Counter-argument considered: "this reads as an unsolicited email to someone who never signed up." Resolution: kept; mo-web's actual user base is a small, personally-known group (requester, spouse, up to two neighbor-testers) whom the requester can inform directly before they're invited — this isn't cold outreach to strangers.
- FR-004: User can log in with email + password. Priority: must-have
  > Socrates: Counter-argument considered: "no password-recovery path is defined, and password-only auth is weak for personal dietary data." Resolution: split — added FR-005 (password reset) as must-have, and FR-006 (MFA) as nice-to-have rather than blocking MVP on it.
- FR-005: User can reset a forgotten password via an emailed reset link. Priority: must-have
  > Socrates: Created as a resolution to FR-004's challenge — not independently challenged.
- FR-006: User can enable multi-factor login (mechanism TBD downstream). Priority: nice-to-have
  > Socrates: Created as a resolution to FR-004's challenge — not independently challenged.

### Plan lifecycle (terminology)

A plan moves through three states, clarified during the FR Socrates round and revised after PRD review (2026-09-23) so that every state follows from dates and MO's deliveries alone — no user action and no time-triggered processing is needed: **upcoming** (MO's newest recommendation; it arrives Tue/Wed before its week starts and stays editable until the plan's first day) → **in-progress** (the plan whose days include today; the user is eating through it and it can no longer be changed) → **history** (every plan older than MO's newest delivery, whether or not the user saved it). A plan can already be in history while its later days are still being eaten (e.g. week N after week N+1 arrives on Wednesday) — that is fine, because rating is governed by each meal's own date, not by the plan's state: a meal can be rated on its day or within the following 7 days (7 is a best-guess starting value, to be tuned with use), so e.g. Monday's meals can be rated on Monday even before the next plan arrives, while Friday's meals cannot be rated on Wednesday. Macro/nutritional summaries can apply to the in-progress plan, past history entries, or the upcoming plan (recalculated live as the upcoming plan is edited).

### Weekly Plan
- FR-007: User can view the upcoming week's recommended plan on a dashboard. Priority: must-have
  > Socrates: Counter-argument considered: "if MO's delivery hasn't arrived yet, the dashboard has nothing to show — no defined empty state." Resolution: kept; dashboard shows an explicit "no upcoming plan yet" waiting state rather than blank/stale content. (This challenge surfaced the upcoming/in-progress/history terminology split — see "Plan lifecycle" above.)
- FR-008: mo-web shows contextual history annotations on the upcoming plan (e.g. "this meal was in your plan 6 days ago"). Priority: must-have
  > Socrates: Counter-argument considered: "what counts as 'recent' isn't defined — an arbitrary cutoff could mislead the user." Resolution: kept; annotations always show exact recency (e.g. "6 days ago", "11 weeks ago") rather than a hidden cutoff.
  > Update (2026-09-23): the annotation uses the most recent earlier occurrence of the meal anywhere in the user's history. Cleaning up history is out of MVP scope.
- FR-009: User can swap a recommended meal in the upcoming plan for another meal available in that week's menu, until the plan's first day. Priority: must-have
  > Socrates: No counter-argument; stands as written. Context surfaced: MO always validates its output before delivering it, so mo-web receives a complete menu or nothing. "Full menu" = the user's subscribed meal-count (2 for breakfast+lunch, up to 5 for the full suite) × per-meal variants (currently 3, since MO supports one provider) — well-defined by MO's payload, not ambiguous.
- FR-010: User can save the upcoming plan (as-is or with swaps) as many times as they like until the plan's first day; mo-web records whether the user saved the plan. Priority: must-have
  > Socrates: Counter-argument considered: "overlaps with FR-011 (auto-finalize) — unclear what explicit saving adds." Resolution: kept both, clarified division of labor — FR-010 is user-initiated lock-in (happens whenever the user chooses to save, before or during that week); FR-011 is the automatic fallback that moves a plan into history once the next MO upload arrives, regardless of whether FR-010 happened.
  > Update (2026-09-23): saving no longer "locks" the plan. What stops changes is the plan's first day arriving; saving only records that the user confirmed the plan. The provider's own meal-change deadlines are per-provider and are not mirrored (see Non-Goals).

### History
- FR-011: A plan (saved or not) becomes part of history once MO delivers a newer week's recommendation; no user action is needed. Priority: must-have
  > Update (2026-09-23): "finalized" means only that the plan is now in history. Whether the user saved it stays recorded (FR-010), and its meals can still be rated within the rating window (FR-013).
- FR-012: User can browse their full history of past plans. Priority: nice-to-have
  > Socrates: Counter-argument considered: "overlaps with the Secondary success criterion — risk of over-building a full browsing UI." Resolution: kept as nice-to-have, explicitly scoped down for MVP purposes to a simple chronological list — no filtering/search required to satisfy this FR.
- FR-013: User can assign custom ratings to meals from their plans on the meal's own day or within the following 7 days (best-guess starting value, to be tuned), independent of the provider's aggregate ratings. Priority: nice-to-have
  > Socrates: Counter-argument considered: "no consumer for the rating since mo-web → MO integration is out of scope." Resolution: kept — surfaced a real payoff even without MO integration: FR-008's history annotation can be enriched with the user's own past rating (e.g. "last time you ate this meal was 2 weeks ago, scored 6/10"), not just recency. This is a valuable enhancement to FR-008 once FR-013 exists, though not required for FR-008's MVP form.
- FR-014: User can view a macro/nutritional summary (e.g. salt) for the in-progress week, a past history entry, or the upcoming plan — recalculated live as the upcoming plan is edited. Priority: nice-to-have
  > Socrates: Counter-argument considered: "blocked by data availability — depends on whether MO's payload includes macro data at all." Resolution: kept as nice-to-have; tied to the existing Open Question on payload completeness (see Open Questions).
- FR-015: User can compare nutritional summaries across weeks (including the upcoming plan). Priority: nice-to-have
  > Socrates: Same data-availability dependency as FR-014. Resolution: kept as nice-to-have, tied to the same Open Question.
- FR-016: mo-web can import prior choices from Meal Orchestrator's historical logs to populate history predating mo-web. Priority: nice-to-have
  > Socrates: Counter-argument considered: "MO's debug artifacts aren't a stable data source — parsing them to populate history could be brittle." Resolution: kept as nice-to-have, but flagged as higher-risk/exploratory — feasibility depends on investigating the actual log format, and this may need reprioritizing once that's known.

### Duplicate submissions (edge case surfaced at cross-check)
- FR-017: When MO submits data for a week it already sent (meals identical, but LLM-generated scoring/comments may differ), the latest submission overwrites the previously stored recommendation for that week. Priority: must-have
  > Update (2026-09-23): confirmed. Until FR-018 is built, this also overwrites a plan the user has already saved or swapped for that week. FR-018 adds the rules for when overwriting is not allowed.
- FR-018: If the user has already saved/swapped their plan for that week (FR-010) before a later re-submission arrives, the re-submission does not overwrite the user's saved choices. Priority: nice-to-have

## Business Logic

mo-web helps the user decide which meals to swap in their upcoming plan by surfacing how recently (and, once ratings exist, how well) each recommended meal has appeared in their own history.

The rule consumes two user-facing inputs: the meals in the upcoming plan MO just recommended, and the user's own history of past plans (plus, once implemented, their own ratings of previously-eaten meals). Its output is, per meal in the upcoming plan, a recency fact ("last appeared N days/weeks ago" or no annotation if it hasn't recurred) and, when a rating exists, the user's own score for that meal. The user encounters this inline on the dashboard next to each meal in the upcoming plan — the annotation described in FR-008, enriched by FR-013's ratings once that's built — so the decision to swap or keep a meal is informed by the user's own history rather than made blind.

Two date rules limit what the user can do. A plan can be changed only before its first day. A meal can be rated only on its own day or within the following 7 days (a best-guess value, to be tuned). No explicit approval step exists: a plan becomes history when a newer one arrives, whether or not the user saved it.

## Non-Functional Requirements

- A user's data (plans, history, ratings) is visible only to that user — never to other mo-web users, even within the same small trusted group.
- History and plan data is retained indefinitely; there is no automatic deletion or expiry window.
- The dashboard is usable on mobile browsers, since users are expected to check their plan from a phone.

## User Stories

### US-01: User reviews and saves the upcoming week's plan

- **Given** a logged-in user whose upcoming week's recommendation has been received from MO
- **When** they open the dashboard
- **Then** they see the recommended plan with history annotations (e.g. "this meal was in your plan 6 days ago"), can swap any meal for another available in that week's menu, and save the final plan

#### Acceptance Criteria
- Each annotation reflects the most recent earlier occurrence of the meal anywhere in the user's history; meals with no earlier occurrence show no annotation.
- Swapping a meal only offers choices available in the current menu (not arbitrary meals).
- Saving records the plan (as accepted or modified) as the reference for future weeks.
- The user can swap and save as many times as they like until the plan's first day; after that the plan can no longer be changed.

### US-02: Known MO user is invited on first delivery

- **Given** MO delivers a weekly recommendation for an email mo-web has not seen before
- **When** mo-web accepts the submission
- **Then** the recommendation is stored under an account for that email, and that email receives an invitation to set a password

#### Acceptance Criteria
- The recommendation is tied to the account matching the submitted email (FR-002).
- There is no signup path that accepts an arbitrary email — the invitation is the only way to get an account.
- A later submission for an email mo-web already knows is stored under the existing account; it does not create a second account.

### US-03: Invited user logs in

- **Given** an invited user who has set their password via the invitation
- **When** they log in with email and password
- **Then** they reach their dashboard

#### Acceptance Criteria
- An unauthenticated visitor who opens the dashboard or history is redirected to login.
- A logged-in user sees only their own plans, history, and ratings — never another user's.

### US-04: User resets a forgotten password

- **Given** a user who has set a password but forgotten it
- **When** they request a password reset
- **Then** they receive an emailed reset link that lets them set a new password

#### Acceptance Criteria
- After resetting, the user can log in with the new password.

### US-05: User opens the dashboard before the week's recommendation arrives

- **Given** a logged-in user for whom MO has not yet delivered the upcoming week's recommendation
- **When** they open the dashboard
- **Then** they see an explicit "no upcoming plan yet" waiting state

#### Acceptance Criteria
- The dashboard does not show blank content, and does not present an older plan as the upcoming one.

### US-06: A plan becomes history when the next week arrives

- **Given** a user with a week's plan that is either saved (as-is or with swaps) or left unmodified
- **When** MO delivers the following week's recommendation
- **Then** that plan becomes part of history

#### Acceptance Criteria
- An unmodified plan enters history exactly as MO recommended it.
- A saved plan enters history with the user's swaps, and whether the user saved it stays recorded.
- No user action is needed.
- Plans in history feed the history annotations on later upcoming plans (FR-008).

### US-07: MO re-sends a week it already delivered

- **Given** mo-web has already stored a user's recommendation for a given week
- **When** MO delivers a recommendation for the same week again
- **Then** the latest delivery replaces the stored recommendation for that week

#### Acceptance Criteria
- Only that week's recommendation is replaced; other weeks and history are unaffected.
- (nice-to-have, FR-018) If the user has already saved their plan for that week, their saved choices are kept.

### US-08: User rates recently eaten meals (nice-to-have, FR-013)

- **Given** a logged-in user with meals in their plans dated today or within the previous 7 days
- **When** they rate one of those meals
- **Then** their own rating is stored for that meal, independent of the provider's aggregate rating

#### Acceptance Criteria
- Meals dated after today cannot be rated yet (e.g. Friday's meals on Wednesday).
- Meals dated more than 7 days ago can no longer be rated.
- Rating works regardless of whether the meal's plan is in progress or already in history (e.g. Monday's meals can be rated on Monday before the next plan arrives, and last week's meals after it arrives).

## Non-Goals

- No AI/LLM use in mo-web — generating and re-ranking recommendations remains MO's responsibility; mo-web only surfaces history/recency/rating context for the user's own swap decision.
- No integration with the food provider's panel — neither mo-web nor MO will connect to it to detect actually-selected or eaten meals.
- No additional infrastructure between MO and mo-web for the MVP (no intermediary delivery layer) — a failed delivery from MO to mo-web is handled by manual retry, not automatic retry.
- No roles or admin features — every mo-web user is the same flat type; no team/shared-workspace concept.
- No mo-web → Meal Orchestrator integration — mo-web will not send user decisions or ratings back to MO; using history directly in MO's automatic selection is explicitly future work, not MVP scope.
- No detection of whether a planned meal was actually eaten, or eaten on a different day — history tracks the user's planned choices, not consumption.
- No mirroring of each provider's own meal-change deadlines — mo-web only stops changes once a plan's first day arrives. Providers have their own, differing rules, and the user still applies their swaps within those rules.

## Open Questions

1. **Does MO's current per-module data payload contain everything mo-web needs (e.g. a provider-side meal ID), or does MO need a small payload extension?** — Owner: user. Blocks a precise FR-001 submission format and affects FR-009 (menu-swap data) and FR-008 / FR-011 (matching the same meal across weeks). Probably yes for the core case, but unconfirmed for edge details.
2. **Does MO's payload include macro/nutritional data (e.g. salt) at all?** — Owner: user. Blocks FR-014 and FR-015 (nice-to-have) — if the data isn't available from MO, these FRs cannot be built as scoped.
3. **What format are MO's historical debug-artifact logs in, and are they parseable as a stable source?** — Owner: user. Blocks FR-016 (nice-to-have, exploratory) — feasibility and effort are unknown until investigated.

## Quality cross-check

All soft-gate elements present at closing check: Access Control, Business Logic (one-sentence rule), project artifacts, timeline-cost acknowledgment (3-week MVP), Non-Goals. No gaps recorded.

## Seed Notes (verbatim)

# Local name

**meal-orchestrator-web**, hereinafter: **mo-web**

# Problem

Meal Orchestrator takes user preferences into account, but does not remember choices from previous weeks. As a result, a meal that is rated highly by MO may be recommended repeatedly, even though the user may already be tired of it.

mo-web adds a history of user choices and allows it to be taken into account when selecting the current plan.

# Features

1. **Weekly plan**
   1.1. The user sees the plan generated by Meal Orchestrator.
   1.2. mo-web shows context resulting from history, e.g. "this meal was in your plan 6 days ago".
   1.3. The user can choose other meals available in the current menu.
   1.4. The user saves the final plan, which becomes a reference for subsequent weeks.

2. **History**
   2.1. A plan that was not modified by the user is also added to the history.
   2.2. History describes the user's choices/plans, not the meals actually eaten.

# Nice to have

1. Custom meal ratings — more useful than the provider's aggregate ratings.
2. Summary of macros and other values (e.g. salt) for the week.
3. Comparison of the above values between weeks.
4. Access to historical choices.
5. Import of previous choices based on Meal Orchestrator logs.
6. In the future, use of history directly in automatic selection/recommendation.

# Technical requirements

1. Maximum separation from Meal Orchestrator.
   1.1. No shared database.
   1.2. Meal Orchestrator passes data to the mo-web API in JSON format.
2. The MVP requires minimal changes on the Meal Orchestrator side — passing results to mo-web in addition to the existing email delivery.
   2.1. The existing module mechanism should make this possible.
3. Only one type of user.
4. No additional infrastructure between the applications in the MVP — a failed save and a potential manual retry are acceptable.

# Idea flow

1. Meal Orchestrator generates a personalized recommendation.
2. Meal Orchestrator passes the user's data and recommendation to the mo-web API.
3. mo-web saves the data and history.
4. The user registers — if their email is known in mo-web, they can create an account.
   4.1. If the email is not known, they cannot create an account.
   4.2. Alternatively: upon the first data submission, the user receives an invitation to set a password.
5. The user sees a dashboard with the current recommendation and history.
6. The user accepts the recommendation or chooses other meals.
7. The final plan is saved and becomes part of the history.

# Out of scope

1. Clicking in the provider's panel.
2. Use of AI in mo-web.
3. Detecting that the user did not eat a meal or ate it on a different day.
4. mo-web → Meal Orchestrator integration.
5. Additional infrastructure between Meal Orchestrator and mo-web (e.g. a queue).

# Open questions

1. Does the data that meal-orchestrator currently has when passing data to modules contain everything mo-web needs?
   1.1. Probably yes, but additional data may be useful, e.g. the meal ID on the provider's side.
2. When is the user's plan considered "approved"? Scheduler (significant overhead for the MVP) or the moment when meal-orchestrator uploads the recommendation for the following week?

## Forward: tech-stack

- MO → mo-web delivery: MO calls an HTTP API exposed by mo-web and sends JSON (seed notes, Technical requirements 1.2). No shared database between the apps (1.1). Integration hooks into MO's existing module mechanism (2.1).
- No message queue or other intermediary infrastructure between MO and mo-web in the MVP; a failed call is retried manually (Technical requirements 4).
- Context on MO (existing system, not a mo-web choice): weekly batch Python job; recommendation generated by an LLM reached via OpenRouter; history exists only as ephemeral debug artifacts (relevant to FR-016 log import).

## Forward: technical-roadmap

_(populated if implementation/testing/deployment content surfaces)_
