<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Email-link Callback

- **Plan**: context/changes/email-link-callback/plan.md
- **Scope**: Phase 1 of 3
- **Reviewed phases**: 1
- **Date**: 2026-10-03
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

All five planned changes match the plan (MATCH): `auth-link.ts` + tests, `confirm.ts`, both templates, `config.toml`, README. Unplanned files in `d0c284c` (`plan-brief.md`, `roadmap.md` F-01 status) are benign. Automated criteria re-run: `npm test` 54 passed, `npm run lint` 0 errors (2 `no-console` warnings, same as `deliveries.ts`), `astro check` 0 errors; no code change since the gated build. Manual rows 1.4–1.6 were confirmed by the user in-session.

## Findings

### F1 — Verifying on GET lets email link scanners use up the token

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/confirm.ts:24
- **Detail**: `verifyOtp` runs on the GET that the email link triggers, and the token is single-use. Mail security scanners (Microsoft Defender Safe Links, some corporate gateways) prefetch links in incoming mail. Such a prefetch uses up the token and gets the session cookies itself, so the real click lands on "This link is invalid or has expired". Supabase's docs note this for token_hash links. The plan chose a direct GET verify and didn't discuss prefetching. Gmail doesn't prefetch links this way, so the risk depends on the invitees' mail providers.
- **Fix A ⭐ Recommended**: Accept the risk for F-01 and add it to the Phase 3 handoff to S-04/S-05. Their set-password pages can take the `token_hash` on GET and call `verifyOtp` only on the form POST.
  - Strength: S-04/S-05 already replace the destination with a page of their own, so the interstitial costs nothing extra there. F-01 keeps its scope.
  - Tradeoff: until S-04 ships, an invitee behind a scanner gets the error and needs a new invite. No invitations are sent before S-04 anyway.
  - Confidence: MED — depends on who gets invited and when S-04 lands.
  - Blind spot: which mail providers the actual invitees use.
- **Fix B**: Now: on GET, render a small "Continue" page that POSTs `token_hash` + `type` to the route, and verify only on POST.
  - Strength: works with any scanner from day one.
  - Tradeoff: adds a page and a POST handler beyond the plan, plus one more click for the user. Phase 2's smoke steps would need to POST.
  - Confidence: HIGH — standard mitigation.
  - Blind spot: none significant.
- **Decision**: FIXED via Fix A — accepted for F-01; queued for the Phase 3 handoff in follow-ups/review-fixes.md

### F2 — roadmap.md committed without Prettier formatting

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: context/foundation/roadmap.md:44
- **Detail**: `in-progress` is wider than the At-a-glance Status column, so the F-01 row is misaligned. `prettier --check` fails (master's copy passes), and Phase 3's gate `npx prettier --check … context/foundation/roadmap.md` will go red. Formatting re-pads every row of the table, which can conflict with the S-03 worktree's roadmap edits.
- **Fix**: Run `npx prettier --write context/foundation/roadmap.md` in Phase 3, when the F-01 handoff line is added and the gate runs anyway, so the re-pad lands in one commit.
- **Decision**: FIXED — deferred to Phase 3 (queued in follow-ups/review-fixes.md), where the roadmap is edited and the Prettier gate runs

### F3 — Pre-commit hook is not installed

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: .husky/pre-commit
- **Detail**: `core.hooksPath` is unset in the shared git config, there is no `.husky/_`, and `package.json` has no `prepare` script. So husky + lint-staged (`eslint --fix`, `prettier --write`) never ran on `d0c284c`, even though CLAUDE.md lists it as the pre-commit step. That's why F2 got through. CI runs only `npm run lint`, not Prettier.
- **Fix**: Run `npx husky` once. It sets `core.hooksPath=.husky/_` in the shared `.git/config`, so the hook also turns on in the main checkout and the S-03 worktree.
- **Decision**: FIXED — ran `npx husky` (core.hooksPath=.husky/_ set in the shared git config; `.husky/_` now exists in this worktree only, so the main checkout and the S-03 worktree need `npx husky` there too)
