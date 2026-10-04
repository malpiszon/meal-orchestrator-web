<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Invite on first delivery

- **Plan**: context/changes/invite-on-first-delivery/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-04
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Automated re-run: lint, `npm test` (111 passed), `astro check` (0 errors), Prettier on docs, and the removed-routes grep all pass. Build and smoke were not re-run (smoke passed in Phase 2).

## Findings

### F1 — Stale "Forgot or never set a password?" in README routes table

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: README.md:160
- **Detail**: The sign-in form now says "Forgot password?" but the Auth routes table still quotes the old wording.
- **Fix**: Change the table row to "Forgot password?".
- **Decision**: FIXED — kept the old "Forgot or never set a password?" wording (SignInForm.tsx reverted); the README row was already correct, since it covers accounts whose invitation failed

### F2 — Failed invitation is silent and permanent

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/mo/deliveries.ts:118
- **Detail**: If `inviteUserByEmail` fails (e.g. email rate limit), the fallback creates an unconfirmed account with no invitation; MO gets 200 and later deliveries never re-invite. Only a Worker log line records it. This is the plan's deliberate choice and is parked in the roadmap ("Invite email failure handling").
- **Fix**: Accept as planned (already documented in README and roadmap Parked).
  - Strength: Matches the plan and the 2–4 user scale; user can use "Forgot password?".
  - Tradeoff: A user may wait for an invitation that never comes.
  - Confidence: HIGH — decided in the plan.
  - Blind spot: Production email limits (30/hour via Resend) not hit yet.
- **Decision**: ACCEPTED — deliberate plan choice, parked in the roadmap

### F3 — Invitation sent before the payload is known to be storable

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/mo/deliveries.ts:108-150
- **Detail**: The account is provisioned (and invited) before the second `ingest()`. If that fails, the user holds an invitation with no plan and MO's retry sends no second email. Rare (e.g. a `\u0000` payload).
- **Fix**: Accept and optionally mention in the README.
- **Decision**: ACCEPTED

### F4 — Existing unconfirmed accounts are never invited

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/api/mo/deliveries.ts:108
- **Detail**: Invitation happens only on `unknown_user`. This is in the plan's "Not doing" list (production has no accounts).
- **Fix**: None needed.
- **Decision**: ACCEPTED — in the plan's Not-doing list

### F5 — No smoke assertion that anonymous sign-up is rejected

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke.mjs
- **Detail**: Production sign-up is a dashboard setting; the smoke user is now created via the Admin API, so nothing checks that anon `POST /auth/v1/signup` is refused. Plan said broader tests are out of scope.
- **Fix**: Optionally add one smoke step when `SUPABASE_URL` and `SUPABASE_KEY` are set.
- **Decision**: FIXED — added an "anon cannot sign up" smoke step (smoke passed locally)

## Notes (not findings)

- `[auth.email] enable_signup` stays `true` deliberately (recorded in the Phase 2 review, F2): `false` breaks email sign-in.
- Unplanned roadmap edits (S-09 `proposed` → `ready`, handoff row, risk line) are benign.
