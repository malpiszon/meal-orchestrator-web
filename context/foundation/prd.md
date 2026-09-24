---
project: "mo-web"
version: 1
status: draft
created: 2026-09-23
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
---

## Vision & Problem Statement

Meal Orchestrator (MO) runs as a weekly batch job: it pulls the user's food-provider data from file-based config, formats it, sends it to an external AI model for a personalized meal recommendation, and emails the result. It keeps no user-facing record of past recommendations — only ephemeral debug artifacts from each run — so a meal that scored well can be recommended again even after the user is tired of it. The person who feels this is an MO end-user — for the MVP, the requester themselves, using their own MO instance — at the moment they open the weekly email and spot a meal they just had; today there is nothing to consult, so they either eat the repeat or rely on their own memory to catch it.

mo-web exists because MO's current architecture — a stateless weekly batch script — doesn't lend itself to being retrofitted with persistent choice history; building that memory as a separate, loosely-coupled application avoids reshaping MO's internals and lets mo-web's history/dashboard concerns evolve on their own schedule.

## User & Persona

Primary persona: an MO end-user who already receives MO's weekly emailed recommendation. For the MVP, this is a small, personally-known group — the requester, their spouse, and possibly up to two neighbor-testers (roughly 2-4 people), each using their own MO instance and provider data. The requester can explain expectations to each person directly, which is why the invitation-based account creation (see Access Control) is acceptable without broader self-service signup. The system does not hard-code a hard user-count limit: anyone whose email MO has already passed to mo-web can be invited, so the group can grow further without product changes.

No secondary persona for MVP — mo-web has only one type of user (no roles/admin distinction).

## Success Criteria

### Primary

- The end-to-end flow works: MO delivers a recommendation to mo-web, the user (after activating via invitation) sees the recommendation with history context on a dashboard, can swap meals and save the plan (as recommended or with swaps) as many times as they like until the plan's first day, and the plan becomes part of history, feeding the annotations on future weeks, once MO delivers the next week's recommendation.

### Secondary

- The user can browse their full history of past plans, not just the inline "this was in your plan N days ago" context on the current recommendation.

### Guardrails

- mo-web requires zero changes to how MO generates recommendations — only an additional delivery path alongside (not replacing) the existing email.
- If MO's delivery to mo-web fails, MO's existing email delivery still succeeds — mo-web is additive and must never become a point of failure for MO's core function. (A failed save on mo-web's side is acceptable to require manual retry, per the "no additional infrastructure" constraint.)

## User Stories

### US-01: User reviews and saves the upcoming week's plan

- **Given** a logged-in user whose upcoming week's recommendation has been received from MO
- **When** they open the dashboard
- **Then** they see the recommended plan with history annotations (e.g. "this meal was in your plan 6 days ago"), can swap any meal for another available in that week's menu, and save the plan

#### Acceptance Criteria

- Each annotation reflects the most recent earlier occurrence of the meal anywhere in the user's history; meals with no earlier occurrence show no annotation.
- Swapping a meal only offers choices available in the current menu (not arbitrary meals).
- Saving keeps the user's current choices (as recommended or with swaps) and records that the user saved the plan; it does not lock the plan.
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
  > Socrates: Counter-argument considered: "overlaps with FR-011 (plan moves to history) — unclear what explicit saving adds." Resolution (revised 2026-09-23): kept both, with separate jobs. FR-010 lets the user keep their swaps and records that they confirmed the plan, which is useful to know later. Saving locks nothing: the user can change and re-save the plan until its first day, and only the date stops changes. FR-011 moves a plan into history when the next MO delivery arrives, whether or not the user saved it. No scheduled processing and no separate "finalized" state exist. The provider's own meal-change deadlines are per-provider and are not mirrored (see Non-Goals).

### History

- FR-011: A plan (saved or not) becomes part of history once MO delivers a newer week's recommendation; no user action is needed. Priority: must-have
  > Update (2026-09-23): being in history is not a separate "finalized" state; it follows from a newer delivery existing. Whether the user saved it stays recorded (FR-010), and its meals can still be rated within the rating window (FR-013).
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

## Non-Functional Requirements

- A user's data (plans, history, ratings) is visible only to that user — never to other mo-web users, even within the same small trusted group.
- History and plan data is retained indefinitely; there is no automatic deletion or expiry window.
- The dashboard is usable on mobile browsers, since users are expected to check their plan from a phone.
- mo-web accepts MO's weekly submission and serves the dashboard even after a week or more with no user activity; hosting must not become unavailable due to idleness.
  > Added 2026-09-24 after the first deploy: the free Supabase project pauses after ~7 days idle, and MO's weekly cadence sits right at that threshold. How to prevent it (keep-alive job, paid plan) is decided in `infrastructure.md`.

## Business Logic

mo-web helps the user decide which meals to swap in their upcoming plan by surfacing how recently (and, once ratings exist, how well) each recommended meal has appeared in their own history.

The rule consumes two user-facing inputs: the meals in the upcoming plan MO just recommended, and the user's own history of past plans (plus, once implemented, their own ratings of previously-eaten meals). Its output is, per meal in the upcoming plan, a recency fact ("last appeared N days/weeks ago" or no annotation if it hasn't recurred) and, when a rating exists, the user's own score for that meal. The user encounters this inline on the dashboard next to each meal in the upcoming plan — the annotation described in FR-008, enriched by FR-013's ratings once that's built — so the decision to swap or keep a meal is informed by the user's own history rather than made blind.

Two date rules limit what the user can do. A plan can be changed only before its first day. A meal can be rated only on its own day or within the following 7 days (a best-guess value, to be tuned). No explicit approval step exists: a plan becomes history when a newer one arrives, whether or not the user saved it.

## Access Control

Single flat user type; no roles, no admin/member distinction.

Account creation is invitation-driven, not self-service: when MO submits data for an email mo-web has not seen before, mo-web sends that email an invitation to set a password. There is no signup form that accepts an arbitrary email — the only way in is to already be a known MO user whose data has been submitted at least once. Once a password is set, the user logs in with email + password on subsequent visits.

Unauthenticated visitors are redirected to login; the dashboard and history are gated behind authentication.

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
