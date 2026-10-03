<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Recency-annotated plan

- **Plan**: context/changes/recency-annotated-plan/plan.md
- **Scope**: Phase 2 of 3
- **Reviewed phases**: 2
- **Date**: 2026-10-02
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Notes: all planned items MATCH. The user approved three deviations during implementation: `NoUpcomingPlan.astro` was extracted; `RecencyNote.astro` uses `text-primary` plus a History icon instead of `text-muted-foreground`; the "Nothing planned" description is "You're freestyling this one.". Lint, `astro check`, 45 unit tests, the build and the smoke run (preview on :4322) were all re-run and pass.

## Findings

### F1 — A recency RPC failure blanks the whole dashboard

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard.astro:21-36
- **Detail**: `getPlanRecency` shares the try/catch with the two plan queries. If `get_plan_recency` fails, the user gets "Couldn't load your plan" even though both plans loaded; the notes are only an annotation. The cause can be transient, or the migration missing in production because the db push was skipped. This follows the plan ("Any failure keeps the existing … card"), so the plan itself chose the brittle option.
- **Fix A ⭐ Recommended**: Give the recency call its own try/catch. On failure, log `dashboard recency load failed: <code message>` and render both weeks without notes.
  - Strength: The dashboard keeps working when only the annotation fails. The log still surfaces the problem in Workers Logs.
  - Tradeoff: A silently missing note could hide a broken RPC from the user. It only shows in logs, and the smoke note check in Phase 3 will catch it in CI and in the post-deploy smoke.
  - Confidence: HIGH — a small, local change.
  - Blind spot: None significant.
- **Fix B**: Keep it as planned (any failure → error card).
  - Strength: Matches the plan literally; failures are loud.
  - Tradeoff: An optional feature can take down the main view.
  - Confidence: MED — acceptable only if the db push procedure is always followed.
  - Blind spot: Transient RPC errors.
- **Decision**: FIXED (Fix A)

### F2 — Lucide icon rendered as a React component from .astro, once per note

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/plan/RecencyNote.astro:2,13
- **Detail**: `<History>` from lucide-react has no client directive, so each note triggers its own React SSR render pass. There can be dozens per week, on the Workers free plan's 10 ms CPU budget. Badge and Card already pay this cost per option, so this is additive, not new. It is also the first use of lucide from an `.astro` file.
- **Fix**: Inline the History SVG markup in RecencyNote.astro (static, with `aria-hidden` and `size-3.5`), so notes cost no React render.
- **Decision**: FIXED

### F3 — "Nothing planned for this week" card inline while its twin was extracted

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/dashboard.astro:67-77
- **Detail**: `NoUpcomingPlan.astro` was extracted, but the "Nothing planned for this week" card stays inline in the dashboard.
- **Fix**: Extract it to `src/components/plan/NothingThisWeek.astro` for symmetry.
- **Decision**: FIXED

### F4 — PlanTabs comment overclaims no-JS readability

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/plan/PlanTabs.tsx:14-17
- **Detail**: The comment says both weeks are "readable before hydration". Only the active panel is visible. The inactive one is in the HTML, which is what the smoke needs, but it is hidden until JS runs.
- **Fix**: Reword it: "both weeks are in the server HTML (the smoke asserts on it); the active one is readable before hydration".
- **Decision**: FIXED

### F5 — Recency note uses the "positive" green accent

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/plan/RecencyNote.astro:12
- **Detail**: Raised by the user. `text-primary` is green and reads as "good". The theme has no neutral/informational accent token, so a proper fix needs a new token (e.g. `--info`) in `global.css` for light and dark mode. That's design-system work.
- **Fix**: Defer to the UI pass (S-09). Record it as a follow-up there.
- **Decision**: FIXED (deferred to S-09: follow-up comment on #18)
