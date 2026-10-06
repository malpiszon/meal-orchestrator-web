<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Expired Link Notice on Open

- **Plan**: context/changes/expired-link-notice/plan.md
- **Scope**: Phase 2 of 3
- **Reviewed phases**: 2
- **Date**: 2026-10-06
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 1 observation

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Evidence

- Diff (`39e455d..80a2aa5`): all five planned files plus their tests. The only unplanned file is `eslint.config.js`: `auth-links.ts` was added to the existing Workers-Logs `no-console: off` list, the way every other logging file is handled.
- `AUTH_LINK_LIFETIME_SECONDS = 3600`, with a doc comment naming `otp_expiry` and the dashboard setting. The drift test reads only the `[auth.email]` section, so `[auth.sms]`'s `otp_expiry` can't satisfy it by accident.
- `isSetPasswordLinkLive` fails open when the client is missing, the RPC returns an error, or the RPC throws. Only an explicit `false` counts as dead. Warnings carry the type and code/message, never the token, and the tests assert that.
- Page: a dead link becomes `link = undefined`, so neither the form nor `tokenHash` receives the dead token. A user with the retry cookie gets the token-less form, as the plan requires. The title is now taken from the parsed URL `type`, so a dead invite link keeps "Set your password". This is a necessary adaptation: `link?.type` alone would have broken that contract.
- The `supabase.ts` comment narrows the rule to read-only, service-role-only RPCs that return yes/no, and gives the reason (no session on a link click).
- Phase 1 is unaffected: the RPC name and arguments match the migration.
- Re-run during review: `npm test` 118 passed, `npm run lint` clean (0 warnings), `npx astro check` 0 errors, `npm run build` PASS. The break check in the implementation session made both new guards fail.
- Manual 2.5 and 2.6 were confirmed by the user on `npm run dev`.

## Findings

### F1 — Link check has no timeout

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/auth-links.ts:20
- **Detail**: The helper fails open on errors, but a Supabase that stalls without erroring holds the page until the fetch gives up. No other Supabase call in the repo sets a timeout, so this matches existing behaviour. It is the one call on this page that is optional, though, so it could fail open on a stall too.
- **Fix**: Chain `.abortSignal(AbortSignal.timeout(2000))` on the `rpc(...)` call; the existing `catch`/error path then returns `true` with a warning.
- **Decision**: FIXED — `AUTH_LINK_CHECK_TIMEOUT_MS = 2000` via `.abortSignal(AbortSignal.timeout(…))`, plus a unit test; a real timeout against local Supabase returns an error, so the check fails open
