# Swap and save the upcoming plan — Plan Brief

> Full plan: `context/changes/swap-and-save-plan/plan.md`

## What & Why

S-03 (issue #7, FR-009, FR-010, US-01) lets the user act on the recency notes: swap any meal of the upcoming week for another option from that week's menu, or confirm MO's plan as it is, until the plan's first day. The user's choice then becomes what "planned" means in history, so later recency notes reflect what they actually picked, not what MO suggested.

## Starting Point

mo-web stores each delivered week with every option and a recommended option per slot (`is_recommended`, derived by mo-web from MO's scores), shows the upcoming week read-only with the alternatives collapsed, and computes recency notes from those recommended options (`get_plan_recency`). Users have no write access at all; the only writer is MO's service-role ingest.

## Desired End State

"Next week" lists every option of every slot. Every top-scored option carries a star, as in MO's email, and the user's choice is selected. Tapping another option saves it immediately, and the week's recency notes refresh. A status line shows "Not saved yet" (with "Keep as recommended") or "Saved Fri 9 Oct, 18:42", followed by "Editable until Sun 11 Oct". From Monday 00:00 Warsaw, the plan is "This week" with the chosen meals, and saves are rejected.

## Key Decisions Made

| Decision            | Choice                                                                  | Why (1 sentence)                                                                                        |
| ------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Data model          | `is_chosen` on `plan_meal_options` + `weekly_plans.saved_at`            | Recency and display read one boolean with a partial index, and re-delivery resets choices for free.     |
| Interaction         | Each tap saves at once; "Keep as recommended" only while never saved    | Nothing can be lost by forgetting a Save button.                                                        |
| Option visibility   | "Next week" always shows all options (no collapsed list)                | The user must see every option before choosing.                                                         |
| Top-score badge     | Star (no text) on every option with the slot's top score; ties get several | Mirrors MO's email, so a tie is shown instead of hidden behind one pick.                               |
| Cut-off             | Editable while `week_start > today` in Europe/Warsaw, enforced in Postgres | Same rule that already defines "upcoming", so the editable plan is always the "Next week" tab.       |
| Write path          | Two `security definer` functions (`choose_plan_option`, `confirm_plan`) | Ownership and cut-off checks can't be bypassed by a stale page or a crafted request.                    |
| Save-state display  | Persistent status line with saved time and "Editable until"             | After a reload, the user still knows whether they saved and until when they can change it.             |
| Recency predicate   | `h.is_chosen` replaces `h.is_recommended` (S-02 handoff)                | History records the user's choices; the backfill keeps today's notes unchanged.                         |

## Scope

**In scope:**

- A migration with the column, save time, functions, ingest reset, recency switch and partial index.
- pgTAP tests for choices, the cut-off and recency.
- Zod-validated `POST /api/plans/choose` and `/api/plans/confirm`.
- Choice-aware grouping and Warsaw date labels.
- A React island for "Next week", with "This week" showing the chosen meals.
- Smoke steps and README updates.

**Out of scope:**

- Draft/unsaved editing and "reset all".
- Editing "This week" or the past.
- Keeping choices on re-delivery (FR-018).
- Tie-break rules, per-user time zones, provider deadlines and ratings.

## Architecture / Approach

The island calls a JSON API route, which uses the user's cookie client. The route calls a `security definer` RPC, which checks the owner (`auth.uid()`) and the Warsaw cut-off, updates `is_chosen`/`saved_at` under a plan-row lock, and returns `saved_at`. The route then re-reads `get_plan_recency` (security invoker, RLS-bound) and returns `{ saved_at, recency }`, which the island applies in place. Errors map to 400/401/404/409/500/503, and 409 `plan_locked` disables the editor.

## Phases at a Glance

| Phase                                          | What it delivers                                                    | Key risk                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1. Database: choices, cut-off and recency      | Schema, guarded write functions, ingest reset, recency on choice, pgTAP | The cut-off boundary or one-chosen-per-slot invariant is wrong in SQL |
| 2. Server: services and API                    | Typed services, two API routes, choice-aware grouping, date labels  | Error mapping from Postgres codes to HTTP statuses                     |
| 3. Dashboard: swap UI                          | "Next week" editor island, status line, smoke + README              | Out-of-order saves or a cramped layout at phone width                  |

**Prerequisites:** S-01 and S-02 are done (merged); the local Supabase stack is running. The production migration push happens before the merge.
**Estimated effort:** ~3 sessions, one per phase.

## Open Risks & Assumptions

- The star and the initial choice are separate. MO sends scores only, and mo-web derives `is_recommended` at ingest: exactly one per slot, with ties going to the first listed (`toOptionRows`). That flag seeds `is_chosen`, so on a tied slot several options are starred but only the first listed starts selected.
- A user who swaps on Sunday evening from another time zone may hit the Warsaw-midnight cut-off earlier or later than their own midnight. This is accepted.
- A re-sent week silently drops the user's swaps (by design until FR-018). S-06 owns the test and the user-facing wording.

## Success Criteria (Summary)

- The user can swap and re-swap meals in the upcoming week from a phone, and every choice survives a reload.
- From the plan's first day (Warsaw), the plan can't be changed, and the server enforces it.
- Recency notes on later weeks count the meals the user chose.
