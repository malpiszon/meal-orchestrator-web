<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Invite on first delivery

- **Plan**: context/changes/invite-on-first-delivery/plan.md
- **Scope**: Phase 2 of 3
- **Reviewed phases**: 2
- **Date**: 2026-10-04
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated rows 2.1-2.6 passed (lint, 111 tests, astro check, build, smoke on :4322, route grep); manual rows 2.7-2.9 confirmed by the user. Smoke assertions checked and are not vacuous; the service-role key is only sent as headers and never printed.

## Findings

### F1 — Stale "sign up" wording in Welcome copy

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/Welcome.astro:58
- **Detail**: Copy still says "auth with sign in, sign up, and protected routes". It is text, not a link, in a legacy-exception file that S-09 replaces.
- **Fix**: Drop "sign up" from the sentence, or leave for S-09.
- **Decision**: FIXED (Welcome copy now says "password reset")

### F2 — Plan text says to disable enable_signup under [auth.email] too

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: supabase/config.toml:169,204
- **Detail**: Deliberate deviation: `[auth.email] enable_signup` is GoTrue's email-provider switch, and false made every email sign-in fail ("Email logins are disabled", 12 smoke failures). Only `[auth]` is false. The plan's Phase 2 text is still literal about both keys.
- **Fix**: Mention the correction in README (Phase 3) so nobody re-applies it.
- **Decision**: ACCEPTED — note the correction in README during Phase 3
