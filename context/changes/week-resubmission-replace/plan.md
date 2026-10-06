# Re-sent week replaces the stored recommendation (S-06) Implementation Plan

## Overview

When MO delivers a week it already sent, the latest delivery replaces that week's stored recommendation, and nothing else changes (FR-017, US-07). If the user has already saved or swapped that week, their choices survive (FR-018, pulled into M-1 with S-06 on 2026-10-06).

S-03 built the replace-and-reset. S-06 turns it into these rules:
- A byte-identical retry changes nothing.
- A week that has already started can't be re-sent.
- A changed re-send of a saved upcoming week keeps the user's dish in every meal slot that still offers it.
- A page left open across a re-delivery tells the user to reload.

It also adds tests proving that a re-send touches only its own week.

## Current State Analysis

- `ingest_weekly_plan` (`supabase/migrations/20261003120000_plan_choices.sql:37`) upserts `weekly_plans` on `(user_id, week_start)`, sets `saved_at = null`, deletes that plan's `plan_meal_options` and inserts the new ones with `is_chosen = is_recommended`.
  - Every write is scoped to one `plan_id`, so other weeks and other users are already untouched. No test asserts it, though.
  - The reset ignores whether the user saved: a saved or swapped plan loses its choices and goes back to "Not saved yet". FR-017's 2026-09-23 note accepted this "until FR-018 is built".
- `plan_choices.test.sql:195-229` covers the reset after a swap. It asserts `saved_at` is null after the re-delivery. Its fixture rows and its re-delivery both use `raw_payload = '{}'`.
- The smoke test (`scripts/smoke.mjs:523-549`) re-delivers the upcoming week after a swap, with a renamed meal: only the `name` changes, the `provider_meal_id` stays. It then asserts "re-delivery resets the swap". It never checks that "This week" survives, never sends an identical retry and never re-sends the current week. The smoke user is fresh on every run (`scripts/smoke.mjs:12`).
- Gaps in the current behaviour:
  - Started weeks: ingest overwrites a week whose Monday is today or earlier, which wipes the user's swaps for a week they are already eating. Those swaps are the history that recency notes count (`get_plan_recency`, `is_chosen`).
  - Identical retries: the MO contract promises "repeating a request is always safe" (`context/archive/2026-09-30-mo-weekly-delivery/mo-delivery-contract.md:128`). In fact an identical retry after the user saved resets their choices and their save.
  - Stale pages: once a re-delivery has replaced the option rows, `choose_plan_option` raises `not_found`. The API answers 404, and `usePlanChoices` (`src/components/hooks/usePlanChoices.ts:76-81`) shows "Couldn't save your plan. Please try again.", but trying again can never work.

## Desired End State

| Delivery for (user, week_start)                                    | Result                                                                                                                                                                                                                             |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First delivery of any week (started or not)                        | Stored, as today                                                                                                                                                                                                                   |
| Same JSON value as the stored `raw_payload` (checked first)        | 200 with the existing `plan_id`; options, choices, `saved_at` and `received_at` stay unchanged                                                                                                                                     |
| Different body, week's Monday ≤ today in Europe/Warsaw             | 409 `{"error":"week_started"}`, nothing stored; MO doesn't retry                                                                                                                                                                   |
| Different body, upcoming week, never saved (`saved_at` is null)    | Replaces the week; choices follow MO's new recommendation; stays "Not saved yet" (as today)                                                                                                                                       |
| Different body, upcoming week, saved (`saved_at` is not null)      | Replaces options, scores and comments. In each meal slot the user keeps the dish (same `provider_meal_id`) they had chosen if the new delivery still offers it there, otherwise MO's new recommendation. `saved_at` is unchanged, so it stays "Saved <time>" |

"Saved" means `saved_at` is not null. Both a swap (`choose_plan_option`) and "Keep as recommended" (`confirm_plan`) set it, so FR-018's "saved/swapped" is exactly that predicate. A slot that is new in the re-send gets MO's recommendation.

A swap UI that gets 404 shows "This plan was updated. Reload to see the latest version." pgTAP and smoke prove that a re-send changes no other week, no other user and no history. README and the MO contract describe the 409, the precise idempotency rule and the kept choices.

Verify with `npx supabase test db`, `npm test`, `npm run lint`, `npx astro check` and `npm run smoke` against a preview on :4322.

### Key Discoveries:

- `ingest_weekly_plan` is redefined in full by each migration that changes it (`20261003120000_plan_choices.sql:35` says "body unchanged from … except …"). Follow the same pattern, including the revoke/grant lines.
- The cut-off expression already used by `choose_plan_option`/`confirm_plan` is `week_start <= (now() at time zone 'Europe/Warsaw')::date`, raising errcode `55000`. Reuse it with message `week_started`.
- The route passes the parsed body as `p_raw` (`src/pages/api/mo/deliveries.ts:98`). It is stored as `jsonb`, so equality ignores whitespace and key order: a body with the same content in a different layout also counts as identical.
- FR-017 states that a re-sent week has the same meals and only the scores and comments differ. So carrying a choice over by `provider_meal_id` within its slot `(meal_date, meal_type)` almost always finds the dish. The fallback to MO's recommendation is the rare case.
- The partial unique index `plan_meal_options_one_chosen_per_slot` requires exactly one chosen option per slot. A carried-over choice must replace the recommended one in its slot, never be added beside it.
- The provisioning path (unknown user) can never hit a re-send, because a new account has no plans.
- MO side, verified in `malpiszon/meal-orchestrator` at `a1842b1`:
  - `MoWebHttpClient.send` (`delivery/mo_web.py:96`) retries only when `is_transient_http_error` (`retries.py:11-17`) holds: HTTP 429/500/502/503/504, `URLError` or a timeout. A 409 is raised at once and never retried.
  - `workflow.py:571-591` then logs the failure ("best effort") and posts the ops Discord alert "mo-web delivery failed … HTTP 409 / error: week_started" (`ops_notifications.py:121-180`).
  - The retries resend the same encoded `body`, so a retry after a timeout whose first attempt was actually stored is identical and hits the no-op.
  - Every new run carries a new `run_id`, so a re-run is never identical.

## What We're NOT Doing

- Letting MO correct a week once it has started (no override flag).
- Refusing a *first* delivery of a started week. The smoke test and the README walkthrough rely on delivering the current week.
- Keeping option ids stable across a changed re-send (updating rows in place). Option rows are still re-created, so an open page goes stale and gets the reload message.
- Telling the user that a saved choice fell back to MO's pick because the dish disappeared. It's rare given FR-017, and it's silent.
- Keeping a never-saved plan's choices. With `saved_at` null they are MO's old recommendations, so they follow the new ones.
- Auto-reloading or live-updating an open dashboard after a re-delivery.
- Changing the MO side. The contract's MO-facing sections only gain the 409 row and the corrected re-send notes.

## Implementation Approach

Put all the rules in `ingest_weekly_plan`, where the existing reset and the swap cut-off already live, so the route stays a thin mapper. Lock the existing plan row before deciding (`for update`), so a concurrent `choose_plan_option` and a re-send serialize as they do today. For a saved plan, remember each slot's chosen `provider_meal_id` before the old option rows are deleted, then pick the chosen option per slot while inserting the new rows. Then cover the UI message, smoke and docs in a second phase.

## Critical Implementation Details

- **Order of checks inside ingest:** identical first, then started, then replace (with carry-over when saved). An identical retry of a started week therefore answers 200 rather than 409. That matches "repeating a request is always safe".
- **Capture before delete:** the saved plan's chosen `(meal_date, meal_type, provider_meal_id)` triples must be read before `delete from plan_meal_options`, for example into a local array or a CTE in the same statement. If a slot offers the same `provider_meal_id` more than once, the lowest `variant_index` wins, so exactly one option per slot is chosen.
- **Existing tests that flip:**
  - `plan_choices.test.sql` re-delivers a *swapped* (so saved) plan and asserts `saved_at` is null afterwards. Under FR-018 `saved_at` is kept. Its `p_raw = '{}'` also equals the fixture's `raw_payload`, which would make it a no-op.
  - The smoke step "re-delivery resets the swap" asserts the opposite of FR-018.

  Both are adjusted in this plan, not deleted.

## Phase 1: Database: re-send rules and pgTAP

### Overview

Redefine `ingest_weekly_plan` with the identical-payload no-op, the started-week refusal and the saved-plan carry-over. Prove all three rules, plus the isolation of every other week, user and history row, in pgTAP.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20261006120000_week_resubmission_rules.sql`

**Intent**: Replace `ingest_weekly_plan` with a body that first looks up (and locks) the caller's existing plan for `p_week_start`, then:
- If its `raw_payload` equals `p_raw`, return its id without writing anything.
- Otherwise, if that plan exists and its week has started in Europe/Warsaw, raise.
- Otherwise upsert the plan and re-create its options. If the existing plan was saved, each slot's chosen option is the one with the previously chosen `provider_meal_id`, when present, and `saved_at` is kept. In every other case the choices follow `is_recommended` and `saved_at` becomes null, as today.

The header comment states the rules, as earlier migrations do, and notes that FR-018 is now covered.

**Contract**:
- Same signature, `security definer`, `search_path = ''` and grants (execute revoked from `public, anon, authenticated`, granted to `service_role`).
- New error: errcode `55000`, message `week_started`, raised only when all of these hold:
  - a plan already exists for `(user, p_week_start)`;
  - `p_week_start <= (now() at time zone 'Europe/Warsaw')::date`;
  - `raw_payload is distinct from p_raw`.
- A no-op returns the existing `plan_id` and leaves `weekly_plans` (including `received_at`, `saved_at`, `mo_run_id`) and `plan_meal_options` untouched.
- A changed re-send of a saved plan:
  - keeps `saved_at`;
  - in every slot, sets `is_chosen` on exactly one option: the previously chosen `provider_meal_id` if offered (lowest `variant_index` on duplicates), else the recommended one.

#### 2. Existing choices test under the new rules

**File**: `supabase/tests/plan_choices.test.sql`

**Intent**: The re-delivery after a swap still has to test what it says. Give it a distinct `p_raw`, so it is a changed re-send, and rewrite its `saved_at` assertion to FR-018: a swapped plan keeps its `saved_at`. The choice assertion stays as it is (Z, Y chosen, X not): in that case the swapped-to Y is also the new recommendation, so the result is the same either way. Update the file's header comment, which mentions "ingest's reset of choices on re-delivery".

**Contract**: The test count (`plan(29)`) stays the same. The assertion `'re-delivery resets saved_at to null'` becomes `'re-delivery keeps saved_at of a saved plan'`.

#### 3. pgTAP: re-send rules and isolation

**File**: `supabase/tests/week_resubmission.test.sql`

**Intent**: Pin S-06's behaviour with dates relative to today in Europe/Warsaw, so the test never ages. Fixtures follow `plan_choices.test.sql`:
- User A has a past week, a week starting today, and two upcoming weeks (one never saved, one that gets swapped).
- User B has a week with the same `week_start` as one of A's upcoming weeks.

Snapshot every other plan's `weekly_plans` and `plan_meal_options` rows into a temp table before each re-send, and compare afterwards with `results_eq`.

**Contract**: The assertions cover:
- **Never saved:** a changed re-send of A's never-saved upcoming week returns the same `plan_id`, replaces its options, makes the choices follow the new `is_recommended` and keeps `saved_at` null.
- **Saved, dish still offered:** A swaps a slot to a non-recommended dish. A changed re-send (new scores, and a different recommended option in that slot) keeps the swapped `provider_meal_id` chosen. Untouched slots keep their previously chosen dish even where MO's recommendation moved. `saved_at` is unchanged.
- **Saved, dish gone:** a changed re-send that drops the swapped dish from its slot chooses MO's new recommendation in that slot. The other slots keep their choices and `saved_at` is unchanged.
- **Saved by confirm:** after `confirm_plan` without any swap, a changed re-send that moves the recommendation keeps the previously chosen (old recommended) dish.
- **One chosen per slot:** after every re-send, each slot has exactly one `is_chosen` option. A slot that is new in the re-send has its recommended option chosen.
- **Isolation:** after each changed re-send, A's other weeks and B's week match the snapshot: option ids, `is_chosen`, `saved_at` and `raw_payload`.
- **Identical:** after a swap and save, an identical re-send (same `p_raw`) returns the same `plan_id`. Option ids, the swapped `is_chosen`, `saved_at` and `received_at` stay unchanged. A re-send with the same JSON content but different key order is also a no-op.
- **Started:** a changed re-send of the week starting today raises `55000`/`week_started` and changes nothing. The same goes for the past week. An identical re-send of the week starting today returns its `plan_id` and changes nothing.
- **First delivery of a started week:** a new `week_start` in the past succeeds.
- **Recency:** A's `get_plan_recency` for the later upcoming week, run as authenticated A, is identical before and after the refused re-send of the started week.

### Success Criteria:

#### Automated Verification:

- Local Supabase applies the new migration cleanly: `npx supabase db reset`
- All pgTAP tests pass, including the new file and the adjusted `plan_choices.test.sql`: `npx supabase test db`

#### Manual Verification:

- In Studio's SQL editor (as `service_role`), an `ingest_weekly_plan` call with a changed body for an already-delivered started week raises `week_started`, and the stored week is unchanged

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Endpoint, page and docs

### Overview

Surface `week_started` as a 409 from the delivery endpoint and tell a stale page to reload. Extend and adjust the smoke test, then document the new rules for developers and for MO.

### Changes Required:

#### 1. Delivery endpoint

**File**: `src/pages/api/mo/deliveries.ts`

**Intent**: Map the ingest error `55000`/`week_started` to `409 {"error":"week_started"}`, before the generic 500. Update the handler's doc comment, if it lists responses.

**Contract**: New response `409 {"error":"week_started"}`. Other responses are unchanged. Nothing is logged as a storage failure for it. If anything is logged, a single line without the email.

#### 2. Stale-page message

**File**: `src/components/hooks/usePlanChoices.ts`

**Intent**: On a 404 from a save, revert the tap and show a message telling the user to reload, because the option ids no longer exist after a re-delivery.

**Contract**: A new constant `UPDATED_MESSAGE = "This plan was updated. Reload to see the latest version."`, used for `status === 404`. The 401, 409 and other branches are unchanged. `locked` is not set, so the page stays interactive.

#### 3. Smoke steps

**File**: `scripts/smoke.mjs`

**Intent**: Extend the delivery flow, where the existing steps already have the swapped upcoming week and the delivered current week, and flip the reset step to FR-018.

**Contract**:
- New step "identical re-delivery keeps the swap": before the changed re-delivery, `deliver(delivery)` returns 200 with the same `plan_id`, and the dashboard's "Next week" still shows `swapName` checked and "Saved ".
- New step "re-delivery of the current week is refused": `deliver(currentDelivery)` with one meal renamed returns 409 with `error: week_started`, and the "This week" tab still shows `currentName`.
- The existing step "re-delivery resets the swap" becomes "re-delivery keeps the swap": after the changed re-delivery (renamed meal, same `provider_meal_id`s), "Next week" still shows `swapName` checked and "Saved ", not "Not saved yet".
- New step "re-delivery leaves this week alone": after the changed re-delivery of the upcoming week, the "This week" tab still contains `currentName`.

The script's leading comment or the README list mention the new and changed steps.

#### 4. Developer and MO docs

**File**: `README.md`, `context/archive/2026-09-30-mo-weekly-delivery/mo-delivery-contract.md`

**Intent**: Document the rules where readers look for them.

**Contract**:
- README "MO delivery endpoint": the **Storage**/**Responses** bullets gain the identical no-op and `409 week_started`.
- README "Swapping and saving": the **Re-delivery** bullet (`README.md:211`) says:
  - a changed re-send of an upcoming week replaces its options;
  - a never-saved plan follows MO's new recommendations;
  - a saved plan keeps each chosen dish that is still offered, and stays saved;
  - an identical re-send changes nothing;
  - a started week is refused.
- README "Smoke test": the paragraph lists the new steps and the reworded re-delivery step.
- The contract's response table:
  - 409 row (MO should not retry; log it);
  - the 200 row's "A re-sent week replaces the earlier one" also mentions kept saved choices;
  - its check-order line ends with "storage (409, 500)".
- The contract's **Idempotency** note says that resending the same body is a no-op and that re-sending a week that has started is refused.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Unit tests pass: `npm test`
- Type check passes: `npx astro check`
- Build passes: `npm run build`
- Smoke passes against a preview on :4322 with Mailpit: `BASE_URL=http://localhost:4322 MO_INGEST_TOKEN=… npm run smoke`

#### Manual Verification:

- With "Next week" open in the browser, re-deliver that week with a renamed meal via curl, then tap an option: the tap reverts and the page shows "This plan was updated. Reload to see the latest version."; after reload the new meal is shown and a tap saves
- Re-send the same body via curl after swapping: the swap and "Saved <time>" survive a reload
- After swapping, re-send the week via curl with changed scores: the swap and the original "Saved <time>" survive a reload; on a never-saved week the same re-send keeps "Not saved yet" and follows the new recommendation

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Unit Tests:

- No new TypeScript logic beyond an error mapping and a message. Coverage comes from pgTAP and smoke rather than mocks.

### Integration Tests:

- pgTAP (`week_resubmission.test.sql`): every row of the end-state table, the carry-over and fallback cases, plus isolation snapshots and recency.
- Smoke: identical retry, the kept swap after a changed re-send, the refused current-week re-send, and "This week" untouched by an upcoming re-send, all over HTTP against the real Worker runtime.

### Manual Testing Steps:

1. Stale page: open "Next week", re-deliver it with a renamed meal, tap an option and see the reload message.
2. Identical retry after a swap: the swap and "Saved" survive.
3. Changed re-send after a swap: the swap and "Saved" survive. On a never-saved week, the choices follow the new recommendation.
4. Current week re-sent with a change: curl shows `409 {"error":"week_started"}`.

## Performance Considerations

Each delivery adds one indexed lookup (the unique `(user_id, week_start)`), a jsonb equality check on a body of about 40 KB, and a read of one plan's chosen rows (21 at most) before the delete. That's negligible.

## Migration Notes

- Production: push the migration with `npx supabase db push` after the PR's CI is green and **before** merging, as for every migration (README "Production setup").
  - The old Worker keeps working against the new function, because the signature is unchanged and it only adds a new error.
  - An old Worker would map `week_started` to 500, which MO retries and which then keeps failing harmlessly.
  - The carry-over needs no Worker change.
- Tell MO's operator about the new 409 `week_started` (no retry) when the PR merges.

## References

- Roadmap item: `context/foundation/roadmap.md` (S-06; FR-018 un-parked into it on 2026-10-06), issue [#9](https://github.com/malpiszon/meal-orchestrator-web/issues/9)
- PRD: FR-017, FR-018, US-07 (`context/foundation/prd.md:118-127,191-193`)
- Reset built by S-03: `context/archive/2026-10-03-swap-and-save-plan/plan.md`, `supabase/migrations/20261003120000_plan_choices.sql`
- MO contract: `context/archive/2026-09-30-mo-weekly-delivery/mo-delivery-contract.md`
- MO retry behaviour: `malpiszon/meal-orchestrator@a1842b1` `src/meal_orchestrator/delivery/mo_web.py`, `retries.py`, `workflow.py`
- Phase sub-issues: Phase 1 [#74](https://github.com/malpiszon/meal-orchestrator-web/issues/74), Phase 2 [#75](https://github.com/malpiszon/meal-orchestrator-web/issues/75) (blocked by #74)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database: re-send rules and pgTAP

#### Automated

- [x] 1.1 Local Supabase applies the new migration cleanly: `npx supabase db reset` — efbd449
- [x] 1.2 All pgTAP tests pass, including the new file and the adjusted `plan_choices.test.sql`: `npx supabase test db` — efbd449

#### Manual

- [x] 1.3 In Studio's SQL editor (as `service_role`), an `ingest_weekly_plan` call with a changed body for an already-delivered started week raises `week_started`, and the stored week is unchanged — efbd449

### Phase 2: Endpoint, page and docs

#### Automated

- [x] 2.1 Lint passes: `npm run lint` — d9c77e4
- [x] 2.2 Unit tests pass: `npm test` — d9c77e4
- [x] 2.3 Type check passes: `npx astro check` — d9c77e4
- [x] 2.4 Build passes: `npm run build` — d9c77e4
- [x] 2.5 Smoke passes against a preview on :4322 with Mailpit: `BASE_URL=http://localhost:4322 MO_INGEST_TOKEN=… npm run smoke` — d9c77e4

#### Manual

- [x] 2.6 With "Next week" open in the browser, re-deliver that week with a renamed meal via curl, then tap an option: the tap reverts and the page shows "This plan was updated. Reload to see the latest version."; after reload the new meal is shown and a tap saves — d9c77e4
- [x] 2.7 Re-send the same body via curl after swapping: the swap and "Saved <time>" survive a reload — d9c77e4
- [x] 2.8 After swapping, re-send the week via curl with changed scores: the swap and the original "Saved <time>" survive a reload; on a never-saved week the same re-send keeps "Not saved yet" and follows the new recommendation — d9c77e4
