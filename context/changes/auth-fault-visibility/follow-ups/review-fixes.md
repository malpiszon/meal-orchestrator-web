# Review fixes queued for later phases

From `reviews/impl-review-phase-1.md`.

## F3: Phase 3, `docs/deployment.md` § Known risks

Next to the up-to-30 s session check during an Auth outage, record how many events an outage sends. `auth.session` reports once for every request that carries a session cookie, and a protected page reports twice: once on the page and again on `/auth/signin`, because the cookies survive a retryable failure. There is no throttle, so it costs Sentry event quota. Sentry still groups the events into one issue per code (`http_0`, `http_<status>`, `unknown`).

## F4: Phase 2, sign-in rate-limit mapping

`signInErrorCode` (`src/lib/signin-errors.ts`) maps only `over_request_rate_limit` to `rate_limited`. Phase 2's sign-in route will log any `isAuthRateLimit` error, meaning a 429 or a `*_rate_limit` code, as rate limited. Route `signInErrorCode`'s rate-limit check through `isAuthRateLimit` so that the page copy matches the log line. Add a `signin-errors.test.ts` case for a 429 with another code, for example `over_email_send_rate_limit`.
