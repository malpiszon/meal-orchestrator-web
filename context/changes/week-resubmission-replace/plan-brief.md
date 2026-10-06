# Re-sent week replaces the stored recommendation (S-06) — Plan Brief

> Full plan: `context/changes/week-resubmission-replace/plan.md`

## What & Why

When MO delivers a week it already sent, the latest delivery must replace that week's stored recommendation and leave other weeks and history untouched (FR-017, US-07). If the user already saved or swapped that week, their choices must survive (FR-018, un-parked into S-06 on 2026-10-06, because this change rewrites the same function anyway).

S-03 built a replace-and-reset that ignores these cases. As a result, a re-send of a started week, an identical retry, or any re-send after the user saved can cost them their choices. A page left open across a re-delivery also leaves the user stuck.

## Starting Point

`ingest_weekly_plan` upserts the week on `(user_id, week_start)`, re-creates its option rows with choices back on MO's recommendation and clears `saved_at`. It does this for any week, started or not, saved or not, and even for an identical retry. No test proves that the other weeks stay untouched. On a stale page a tap returns 404 and says "please try again", which can never work.

## Desired End State

| Delivery for (user, week_start)                   | Result                                                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| First delivery of any week                        | Stored, as today                                                                                    |
| Same JSON value as the stored one (checked first) | 200, same `plan_id`; choices, save and `received_at` untouched                                      |
| Changed, week's Monday ≤ today (Europe/Warsaw)    | 409 `week_started`, nothing stored; MO doesn't retry (verified in MO's code)                        |
| Changed, upcoming, never saved                    | Replaced; choices follow MO's new picks; "Not saved yet" (as today)                                 |
| Changed, upcoming, saved or swapped               | New scores and comments; each slot keeps the user's dish if still offered, else MO's pick; stays "Saved <time>" |

On a 404, a stale page shows "This plan was updated. Reload to see the latest version." pgTAP and smoke prove a re-send changes no other week, no other user and no history.

## Key Decisions Made

| Decision                          | Choice                                                     | Why (1 sentence)                                                                                         | Source |
| --------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------ |
| FR-018 timing                     | Folded into S-06 (un-parked)                               | This change already rewrites `ingest_weekly_plan` and its re-send tests; later it would mean another rewrite. | Plan   |
| What "saved" means                | `saved_at` is not null                                     | Both swapping and "Keep as recommended" set it, which matches FR-018's "saved/swapped".                  | Plan   |
| Carrying a choice over            | Same `provider_meal_id` in the same slot, else MO's pick; plan stays saved | FR-017 says re-sent meals are identical, so the dish is almost always still there.         | Plan   |
| Re-send of a started week         | Refuse with 409 `week_started`, only if already stored     | The same Warsaw cut-off as swaps keeps history fixed; first deliveries of the current week still work.   | Plan   |
| Identical retry                   | No-op when `raw_payload` equals the body (jsonb), checked first | MO's HTTP retries resend the same bytes, so a retry can never touch the user's plan.                | Plan   |
| Stale-page 404                    | "Plan updated, reload" message                             | It's a one-branch change, and the generic "try again" never works there.                                 | Plan   |
| Where the rules live              | Inside `ingest_weekly_plan`                                | The reset and the swap cut-off already live in Postgres functions; the route stays a thin mapper.        | Plan   |

## Scope

**In scope:**
- New migration redefining `ingest_weekly_plan` (no-op, `week_started`, saved-plan carry-over) and a new pgTAP file
- `plan_choices.test.sql`: a distinct `p_raw`, and a swapped plan now keeps `saved_at`
- The 409 mapping in the delivery route, the 404 message in `usePlanChoices`
- Smoke: three new steps, "re-delivery resets the swap" flipped to "keeps the swap"; README and MO contract updates

**Out of scope:**
- Letting MO correct a started week, refusing first deliveries of started weeks
- Stable option ids across re-sends, telling the user that a vanished dish fell back to MO's pick
- Auto-refreshing an open dashboard, changes on MO's side

## Architecture / Approach

Inside one transaction, ingest locks the existing plan row for the user and week, then decides:
1. If the stored payload equals the new one, it returns the id.
2. Otherwise, if the week has started, it raises `55000 week_started`.
3. Otherwise it upserts the plan. If the plan was saved, it notes each slot's chosen `provider_meal_id` before re-creating the options, picks those dishes again where they're offered, and keeps `saved_at`. If not, choices follow `is_recommended` and `saved_at` stays null.

The route turns `week_started` into a 409. Everything else is tests, one UI message and docs.

## Phases at a Glance

| Phase                                | What it delivers                                                    | Key risk                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1. Database: re-send rules and pgTAP | No-op, refusal and carry-over in ingest; isolation and recency proven | The saved choices must be captured before the delete, and exactly one option per slot chosen (unique index) |
| 2. Endpoint, page and docs           | 409 response, reload message, smoke steps, README + contract        | MO's operator must learn the new 409 (no retry); the smoke reset step flips meaning           |

**Prerequisites:** S-01 and S-03 done (they are). Local Supabase running. The migration goes to production with `npx supabase db push` after CI is green and before merging.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- MO never needs to correct a week once it has started. If it does, a later change adds an override.
- If a re-send drops a dish the user had chosen, that slot silently falls back to MO's pick while the plan still reads "Saved". FR-017 says this shouldn't happen.
- A Worker deployed before the migration push would map `week_started` to 500. The usual push-before-merge timing avoids this.

## Success Criteria (Summary)

- A user who saved or swapped next week keeps their meals when MO re-sends it, and an identical retry never touches their plan.
- A week the user has started eating can't be rewritten, so recency notes stay true.
- A user whose open page went stale is told to reload instead of retrying forever.
