# Review fixes queued for later phases

From `reviews/impl-review-phase-1.md`.

## F3: Phase 3, `docs/deployment.md` § Known risks

Next to the up-to-30 s session check during an Auth outage, record how many events an outage sends. `auth.session` reports once for every request that carries a session cookie, and a protected page reports twice: once on the page and again on `/auth/signin`, because the cookies survive a retryable failure. There is no throttle, so it costs Sentry event quota. Sentry still groups the events into one issue per code (`http_0`, `http_<status>`, `unknown`).

## F4: Phase 2, sign-in rate-limit mapping

Done in the Phase 2 review (its F5).

`signInErrorCode` (`src/lib/signin-errors.ts`) maps only `over_request_rate_limit` to `rate_limited`. Phase 2's sign-in route will log any `isAuthRateLimit` error, meaning a 429 or a `*_rate_limit` code, as rate limited. Route `signInErrorCode`'s rate-limit check through `isAuthRateLimit` so that the page copy matches the log line. Add a `signin-errors.test.ts` case for a 429 with another code, for example `over_email_send_rate_limit`.

From `reviews/impl-review-phase-2.md`.

## F1: Phase 3, `docs/deployment.md` § Known risks and `docs/api.md`

An Auth outage that hits the token-less set-password retry produces 3 events in 2 issues. `auth.session` fires for the POST (middleware), then `auth.set_password.session` fires for the route's own `getUser()`, then `auth.session` fires again for the redirected GET. This was accepted rather than adding a locals flag. In `docs/api.md`, write that the page then shows "Couldn't check your link. Try again in a moment." with no form, plus the "Ask for a new link" fallback, and that a reload after the outage brings the form back.
