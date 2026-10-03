<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Swap and save the upcoming plan

- **Plan**: context/changes/swap-and-save-plan/plan.md
- **Scope**: Phase 2 of 3
- **Reviewed phases**: 2
- **Date**: 2026-10-03
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

## Findings

### F1 — choose re-reads recency for the client's planId, not the option's plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/plan-save.ts:77-81, src/pages/api/plans/choose.ts:9
- **Detail**: `choose_plan_option` saves to the option's real plan, but the recency re-read uses the `planId` from the body, which is never checked against the option. A stale or buggy client that sends another of the user's own plans gets 200 with that plan's recency, and the island would apply the wrong week's notes. RLS still limits it to the user's own rows, so it isn't a security issue. The plan chose this design on purpose (plan.md:160).
- **Fix A ⭐ Recommended**: Accept as designed and keep the comment in choose.ts that explains it
  - Strength: The island always sends its own `planId`, so the mismatch needs a client bug. No schema change.
  - Tradeoff: A client bug would show stale notes until the next reload, and the server wouldn't detect it.
  - Confidence: HIGH — Phase 3's island has one `planId` prop, used for every request.
  - Blind spot: None significant.
- **Fix B**: Have `choose_plan_option` return `(plan_id, saved_at)`, drop `planId` from the choose body, and re-read recency for the returned id
  - Strength: The response can't come from a different plan than the one saved.
  - Tradeoff: Phase 1's function contract and pgTAP change. It needs a new migration, or an edit to the unpushed one plus a local re-apply.
  - Confidence: MED — straightforward, but it touches committed Phase 1 work.
  - Blind spot: The pgTAP assertions on the return type would need an update.
- **Decision**: FIXED via Fix A — accepted as designed; the island sends only its own planId

### F2 — No request-body size cap on the plan routes

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/plan-save.ts:47-52
- **Detail**: `request.json()` parses a body of any size. `deliveries.ts:14,66-74` caps bodies at 256 KiB (Worker CPU limit) and answers 413. Here only signed-in users get as far as parsing, which limits the exposure.
- **Fix**: Check `Content-Length` against a small cap (e.g. 4 KiB) before parsing, answering 413 `payload_too_large` as deliveries does.
- **Decision**: FIXED — 4 KiB cap (Content-Length and actual body) answering 413 payload_too_large

### F3 — Log line prints "undefined" when a Postgres error has no code

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/plans.ts:121
- **Detail**: `${result.error.code}` prints "undefined" on fetch or network errors. `deliveries.ts:51` uses `error.code ?? "unknown"`.
- **Fix**: Use `${result.error.code ?? "unknown"}`.
- **Decision**: DISMISSED — PostgrestError.code is typed `string` (supabase-js sets "" on fetch errors), so it is never undefined; `?? "unknown"` fails lint (no-unnecessary-condition). Reverted.

### F4 — 404 and 400 aren't covered by any automated test

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/plan-save.ts
- **Detail**: `handlePlanSave` has no unit test, and Phase 3's planned smoke steps cover only 401, 200 and 409. The 400 path was verified only by hand (2.4), and 404 `not_found` has not been verified end to end at all.
- **Fix**: In Phase 3's smoke steps, also send a random `optionId` (expect 404) and a non-JSON body (expect 400).
- **Decision**: FIXED — smoke steps 5 (404) and 6 (400) added to Phase 3 smoke contract in plan.md

### F5 — Phase 3 smoke gate names port 4322, which belongs to the F-01 agent

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/swap-and-save-plan/plan.md:251
- **Detail**: CLAUDE.local.md assigns port 4323 to this worktree. 4322 is the parallel F-01 agent's preview port.
- **Fix**: Run Phase 3's smoke gate on port 4323, and stop the preview with `npx astro preview stop` only after checking `status`.
- **Decision**: FIXED — Phase 3 smoke criterion and Progress 3.2 switched to port 4323
