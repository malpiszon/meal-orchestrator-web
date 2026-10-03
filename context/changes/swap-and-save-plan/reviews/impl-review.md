<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Swap and save the upcoming plan

- **Plan**: context/changes/swap-and-save-plan/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-03
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension           | Verdict               |
| ------------------- | --------------------- |
| Plan Adherence      | PASS                  |
| Scope Discipline    | PASS                  |
| Safety & Quality    | PASS (2 observations) |
| Architecture        | PASS                  |
| Pattern Consistency | PASS                  |
| Success Criteria    | PASS (1 observation)  |

Notes:

- Drift: every planned change is a MATCH. The extras are agreed adaptations: the server-side day `label`, trimmed editor props, the "re-delivery resets the swap" smoke step, the 401 message and the green star. `src/lib/plan-save.ts` and the `eslint.config.js` entry are a shared route handler and its `no-console` exception, both already reviewed in Phase 2.
- Automated criteria re-run on 2026-10-03: lint PASS, unit tests 53/53, `astro check` 0 errors, build PASS, smoke on :4323 all steps PASS, pgTAP 33/33. `npx supabase db reset` (Phase 1) was not run because the shared local stack forbids it; the CI smoke job's fresh `supabase start` covers it (Phase 1 review F1).
- Manual criteria: all ticked after the user's walkthrough on 2026-10-03 (`s03-manual@example.com`). This week's swap for 3.8 was set directly in the database, because a week starting today cannot exist on a Saturday.
- Checked and clean: security-definer functions (`search_path = ''`, ownership through `auth.uid()`, anon revoked), lock ordering between ingest and choose/confirm (plan row first everywhere), backfill before the partial unique index, the single in-flight request in the island, no hydration mismatch (labels formatted on the server), XSS (React escaping).

## Findings

### F1 — Editor props serialize every option twice

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard.astro:53-68
- **Detail**: `upcomingDays` passes whole `PlanSlot`s (`chosen`, `others`, `options`, `topScore`) to the `client:load` island. Astro's prop serializer does not deduplicate shared objects, so each option and its justifications appear twice in the HTML. The editor reads only `options`, `topScore`, `mealType` and `chosen.id`. The comment at :53 says the props are trimmed for size.
- **Fix**: Map each slot to `{ mealType, options, topScore, chosenId }` before passing it, and narrow `EditorDay` to match.
- **Decision**: FIXED — slots passed as `EditorSlot { mealType, options, topScore, chosenId }`; island props ≈21 KB on the walkthrough week

### F2 — No test pins the table-level write revoke the cut-off relies on

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/tests/plan_choices.test.sql:49
- **Detail**: The cut-off is enforced only inside `choose_plan_option` and `confirm_plan`. Direct writes are blocked because `20261001120000_weekly_plans.sql:53-54` revokes insert/update/delete from `authenticated` (verified: it holds only SELECT, REFERENCES and TRIGGER). The pgTAP privilege block checks function execute rights but not those table revokes, so a later migration that re-grants UPDATE would bypass the cut-off and no test would fail.
- **Fix**: Add `ok(not has_table_privilege('authenticated', 'public.plan_meal_options', 'update'))` and the same for `public.weekly_plans` to the privileges block, bumping `plan(n)`.
- **Decision**: FIXED — `has_table_privilege` update assertions for both tables; pgTAP now 35 tests

### F3 — CSRF protection of the plan routes depends on an unpinned Astro default

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/plan-save.ts:53-59, astro.config.mjs
- **Detail**: The cookie-session routes parse the body as JSON whatever the `Content-Type`. Cross-site `text/plain` form posts are blocked only by Astro's default `security.checkOrigin: true`, which `astro.config.mjs` does not set. If that default were disabled, the routes would accept cross-site form posts.
- **Fix**: Set `security: { checkOrigin: true }` explicitly in `astro.config.mjs`, with a comment naming the `/api/plans/*` cookie-session routes.
- **Decision**: FIXED — `security: { checkOrigin: true }` pinned in astro.config.mjs; cross-origin text/plain POST to /api/plans/confirm answers 403
