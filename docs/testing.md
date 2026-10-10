# Testing

| Layer          | Command                           | Where                               | Needs                                    |
| -------------- | --------------------------------- | ----------------------------------- | ---------------------------------------- |
| Unit           | `npm test`                        | `src/**/*.test.ts` (Vitest)         | Nothing                                  |
| Database       | `npx supabase test db`            | `supabase/tests/*.test.sql` (pgTAP) | Local Supabase running                   |
| Smoke (HTTP)   | `npm run smoke`                   | `scripts/smoke.mjs`                 | A running server and Supabase, see below |
| Lint and types | `npm run lint`, `npx astro check` |                                     | `npx astro sync` once, as CI does        |

## Smoke test

`scripts/smoke.mjs` is a dependency-free Node script that drives the app over HTTP the way a browser and MO do. Run it after dependency upgrades and before opening a PR that touches a flow it covers:

```bash
npm run dev            # or: npm run build && npm run preview
BASE_URL=http://localhost:4321 MO_INGEST_TOKEN=<the server's token> \
  SUPABASE_URL=… SUPABASE_KEY=… SUPABASE_SERVICE_ROLE_KEY=… MAILPIT_URL=http://127.0.0.1:54324 \
  npm run smoke
```

| Variable                    | Required | Purpose                                                                                                        |
| --------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| `BASE_URL`                  | no       | Server under test; defaults to `http://localhost:4321`                                                         |
| `MO_INGEST_TOKEN`           | yes¹     | Must match the server's token                                                                                  |
| `SUPABASE_URL`              | yes¹     | The Supabase instance the server uses                                                                          |
| `SUPABASE_SERVICE_ROLE_KEY` | yes¹     | Creates the smoke user and generates email-link tokens through the Admin API (there is no sign-up)             |
| `SUPABASE_KEY`              | no       | The anon key; checks that it can't execute `ingest_weekly_plan` directly. Without it: `SKIP  anon grant check` |
| `MAILPIT_URL`               | no       | Reads one real reset email from local Supabase's Mailpit. Without it: `SKIP  real reset email`                 |
| `KEEPALIVE_EXPECT_FAILURE`  | no       | `1` runs only the keep-alive check and expects it to fail (CI points a preview at an unreachable Supabase)     |

For a full run the server under test needs `SUPABASE_SERVICE_ROLE_KEY` and `MO_INGEST_TOKEN` configured too.

¹ Not needed with `KEEPALIVE_EXPECT_FAILURE=1`, which only fires the keep-alive: the script then needs only `BASE_URL`, and the server only `SUPABASE_URL` and `SUPABASE_KEY` (CI sets an unreachable `SUPABASE_URL`).

What it covers, each with its error and edge cases (unauthenticated calls, other users' data, invalid bodies):

- **Landing and sign-in:** `/` in both states, the sign-in page and its reset link, sign-in, protected pages, sign-out.
- **MO delivery:** token check, account creation for a new email, deliveries of the past, current, upcoming and a later week, identical and changed re-deliveries, 409 `week_started`.
- **Dashboard and history:** "No upcoming plan yet", the "This week" and "Next week" tabs, "Next week" staying on the nearest week, `/history` and `/history/<id>` (including 404s).
- **Swap and save:** swapping, `plan_locked`, a swap surviving re-deliveries, recency notes only from saved plans.
- **Ratings:** rating, clearing, `not_rateable`, "Last rated" on "Next week", and rating-ordered options (a 5/5 meal first and re-picked, a 1/5 meal last).
- **Email links:** invitation and reset links opened without using the token, short passwords, used, replaced and made-up tokens, the token-less retry after a refused password, an account created by a delivery claiming itself, and (with `MAILPIT_URL`) one real reset email.
- **Keep-alive:** fires the Cron Trigger (`/cdn-cgi/handler/scheduled`) and expects success.

Local Supabase sends at most 2 auth emails per hour (`email_sent` in `supabase/config.toml`), so running it with `MAILPIT_URL` more often than that fails the real-email step.

The smoke test guards the flows end to end; it is not a substitute for unit and database tests of new logic.

## CI

`.github/workflows/ci.yml` runs on every push and PR to `master`:

- **ci:** `npm run lint`, `npm test`, `npx astro check`, `npm run build` (with the `SUPABASE_URL` and `SUPABASE_KEY` repository secrets).
- **smoke:** starts local Supabase with the Supabase CLI (Mailpit included), runs `supabase test db`, builds, serves the production preview on the Cloudflare runtime with a fixed test `MO_INGEST_TOKEN`, and runs `npm run smoke` with every variable above set. It then rebuilds against an unreachable `SUPABASE_URL` and runs the smoke with `KEEPALIVE_EXPECT_FAILURE=1`, proving failed pings are reported. No secrets needed. A PR that only changes docs (root-level `*.md`, `docs/`, `context/`, `.claude/`) skips this job; the **changes** job decides (renames count both paths), pushes to `master` always run it, and so does a PR whose **changes** job fails.
- **deploy** (pushes to `master` only, after both jobs pass): `npx wrangler deploy`, then a post-deploy smoke against production. It checks that `/auth/signin` loads, `/dashboard` redirects, a wrong sign-in reaches Supabase (`error=invalid_credentials`, not `not_configured`), and a token-less `POST /api/mo/deliveries` answers 401. There, 503 means the Worker secrets are missing; 403 or a challenge page means Cloudflare bot protection is blocking MO.
