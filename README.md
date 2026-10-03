# 10x Astro Starter

![](./public/template.png)

A modern, opinionated starter template for building fast, accessible web applications.

## Tech Stack

- [Astro](https://astro.build/) v7 - Modern web framework with server-first rendering
- [React](https://react.dev/) v19 - UI library for interactive components
- [TypeScript](https://www.typescriptlang.org/) v6 - Type-safe JavaScript
- [Tailwind CSS](https://tailwindcss.com/) v4 - Utility-first CSS framework
- [Supabase](https://supabase.com/) - Authentication and backend-as-a-service
- [Cloudflare Workers](https://workers.cloudflare.com/) - Edge deployment runtime

## Prerequisites

- Node.js v22.14.0 (as specified in `.nvmrc`)
- npm (comes with Node.js)

## Getting Started

1. Clone the repository:

```bash
git clone https://github.com/przeprogramowani/10x-astro-starter.git
cd 10x-astro-starter
```

2. Install dependencies:

```bash
npm install
```

3. Set up Supabase and configure environment variables — see [Supabase Configuration](#supabase-configuration) below.

4. Create a `.dev.vars` file for local Cloudflare dev secrets:

```bash
cp .env.example .dev.vars
```

5. Run the development server:

```bash
npm run dev
```

## Available Scripts

- `npm run dev` - Start development server (Cloudflare workerd runtime)
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint with type-checked rules
- `npm run lint:fix` - Auto-fix ESLint issues
- `npm run format` - Run Prettier
- `npm run smoke` - Smoke test the auth flow against a running server (`BASE_URL`, defaults to `http://localhost:4321`)

## Project Structure

```md
.
├── src/
│ ├── layouts/ # Astro layouts
│ ├── pages/ # Astro pages
│ │ └── api/ # API endpoints
│ ├── components/ # UI components (Astro & React)
│ └── assets/ # Static assets
├── public/ # Public assets
├── wrangler.jsonc # Cloudflare Workers config
```

## Supabase Configuration

This project uses [Supabase](https://supabase.com/) for authentication. Environment variables are declared via Astro's `astro:env` schema and are treated as **server-only secrets** — they are never exposed to the client.

### First-time setup (local, no cloud project needed)

Requires [Docker](https://www.docker.com/) and ~7 GB RAM.

1. Create your `.env` file:

```bash
cp .env.example .env
```

2. Initialize the local Supabase project (creates a `supabase/` config folder):

```bash
npx supabase init
```

3. Start the local stack (downloads Docker images on first run):

```bash
npx supabase start
```

4. Copy the credentials printed by the CLI into your `.env` (Node) or `.dev.vars` (Cloudflare local dev, gitignored). `npx supabase status -o env` prints them again later: `API_URL`, `ANON_KEY` and `SERVICE_ROLE_KEY`.

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
MO_INGEST_TOKEN=<any random string, e.g. openssl rand -hex 32>
```

The last two are only needed for the [MO delivery endpoint](#mo-delivery-endpoint).

5. To stop the stack when done:

```bash
npx supabase stop
```

The local Studio UI is available at `http://localhost:54323`.

`npx supabase start` applies the repo's migrations (the `keepalive` function pinged by the daily Cron Trigger, see [Deployment](#deployment), the weekly-plan tables with the `ingest_weekly_plan` function, and the `get_plan_recency` function behind the dashboard's recency notes) automatically. A hosted or production project needs them pushed explicitly — see below.

### Using a cloud Supabase project instead

If you prefer to use a hosted Supabase project, add these variables to your `.env` and `.dev.vars` files:

| Variable                    | Description                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `SUPABASE_URL`              | Project URL from Supabase dashboard → Settings → API                                      |
| `SUPABASE_KEY`              | `anon` public key from Supabase dashboard → Settings → API                                |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` key from Supabase dashboard → Settings → API (server-only, bypasses RLS)   |
| `MO_INGEST_TOKEN`           | Bearer token Meal Orchestrator sends to the [MO delivery endpoint](#mo-delivery-endpoint) |

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=<anon-key>
```

Push the repo's migrations to the hosted project (local development gets this for free from `npx supabase start`):

```bash
npx supabase link --project-ref <project-ref>
npx supabase db push
```

### Email confirmation in local development

By default Supabase requires email confirmation before a user can sign in. To skip this during local development:

1. Open the Supabase dashboard for your project
2. Go to **Authentication → Email → Confirm email**
3. Toggle it **off**

Users can then sign in immediately after sign-up without clicking a confirmation link.

### Auth routes

| Route                 | Description                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| `/auth/signin`        | Email/password sign-in form                                                                         |
| `/auth/signup`        | Email/password sign-up form                                                                         |
| `/auth/confirm-email` | Post-signup "check your inbox" page                                                                 |
| `/api/auth/confirm`   | Invitation and password-reset email links land here; signs the user in and forwards to `/dashboard` |
| `/dashboard`          | Example protected page (redirects to `/auth/signin` if unauthenticated)                             |

Route protection is handled in `src/middleware.ts`. Add paths to the `PROTECTED_ROUTES` array there to require authentication.

The invitation and password-reset email templates live in `supabase/templates/` and are wired up in `supabase/config.toml`. Local Supabase reads them only at start, so restart it (`npx supabase stop && npx supabase start`) after changing them. Local emails are not sent; they land in Mailpit at `http://127.0.0.1:54324`.

### MO delivery endpoint

`POST /api/mo/deliveries` is how Meal Orchestrator (MO) delivers a user's weekly plan: the week's full menu with every option's score. It is machine-to-machine: no cookie session, the middleware skips it, and it must never be added to `PROTECTED_ROUTES`.

- **Auth:** `Authorization: Bearer <MO_INGEST_TOKEN>`. A missing or wrong token returns 401.
- **Body:** payload v1, defined by `moDeliverySchema` in `src/lib/mo-delivery.ts`. An invalid body returns 400 with the validation issues. A sample is in `scripts/fixtures/mo-delivery.sample.json`.
- **Storage:** one call to the `ingest_weekly_plan` Postgres function through a service-role client. Re-sending a week for the same user replaces it. An email mo-web doesn't know yet becomes an unconfirmed account without a password (`app_metadata.provisioned_by = "mo-delivery"`), and no email is sent.
- **Responses:** 200 `{"plan_id","week_start","account_created"}`; 503 `not_configured` when `SUPABASE_SERVICE_ROLE_KEY` or `MO_INGEST_TOKEN` is missing; 413 `payload_too_large` over 256 KiB; 500 `storage_failed` on a database error (details in the Worker logs). The full response table, with what MO should retry, is in the contract linked below.

The full contract for the MO side is in `context/changes/mo-weekly-delivery/mo-delivery-contract.md`. To try it locally against `npm run dev` (rewrite the email to a local user's, or a new one to see provisioning):

```bash
curl -i http://localhost:4321/api/mo/deliveries \
  -H "Authorization: Bearer $MO_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  --data @scripts/fixtures/mo-delivery.sample.json
```

The sample's week is in the past, so the dashboard won't show it; the walkthrough below moves it to an upcoming week.

### Dev walkthrough: sign in as an account a delivery created

**Local development only** (`npm run dev` against local Supabase). It shows the dashboard exactly as a real user will see it: the account is created by a delivery, as in production, and then given a password with one Admin API call. That call stands in for the account invitation (roadmap item S-04), which doesn't exist yet. In production, accounts get their password only through that invitation; there are no manual accounts or test deliveries there.

1. Deliver the sample for your email and an upcoming week. `start` must be a Monday after today (Europe/Warsaw); the day dates are shifted to match. The response shows `"account_created":true`.

   ```bash
   jq --arg email you@example.com --arg start 2026-10-12 '
     ((($start + "T00:00:00Z") | fromdate) - ((.week_start + "T00:00:00Z") | fromdate)) as $shift
     | def move: ((. + "T00:00:00Z") | fromdate) + $shift | strftime("%Y-%m-%d");
     .user.email = $email | .week_start = $start | .week_end |= move | .days |= map(.date |= move)' \
     scripts/fixtures/mo-delivery.sample.json > /tmp/mo-delivery.json

   curl -i http://localhost:4321/api/mo/deliveries \
     -H "Authorization: Bearer $MO_INGEST_TOKEN" \
     -H "Content-Type: application/json" \
     --data @/tmp/mo-delivery.json
   ```

2. Give the account a password through the local Admin API, using the local `SERVICE_ROLE_KEY` (from `npx supabase status -o env`) as both `apikey` and bearer token. Find the user's `<id>` in Studio (**Authentication → Users**) or with the `GET` below.

   ```bash
   curl -s http://127.0.0.1:54321/auth/v1/admin/users \
     -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
     | jq -r '.users[] | select(.email == "you@example.com") | .id'

   curl -X PUT http://127.0.0.1:54321/auth/v1/admin/users/<id> \
     -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
     -H "Content-Type: application/json" \
     -d '{"password": "<a password>", "email_confirm": true}'
   ```

3. Sign in at `/auth/signin` with that email and password, and check that `/dashboard` shows the delivered week. A user without a delivered upcoming week sees "No upcoming plan yet" instead (in the "Next week" tab once a current week exists).

4. Deliver a second week to see recency notes: run step 1 again with `--arg start` set to this week's Monday (Europe/Warsaw; today counts if it is a Monday), and send `/tmp/mo-delivery.json` with the same `curl`. The response shows `"account_created":false`. Reload `/dashboard`: it now has two tabs. "This week" shows the plan for the current week and "Next week" (open by default) the upcoming one. Every recommended meal of the upcoming week was also recommended on the same weekday this week, so it carries a note such as "In your plan 14 days earlier (Mon 28 Sep)". A meal only gets a note when it was recommended earlier; the "This week" tab shows no notes.

## Deployment

This project deploys to [Cloudflare Workers](https://workers.cloudflare.com/).

1. Build the project:

```bash
npm run build
```

2. Deploy with Wrangler:

```bash
npx wrangler deploy
```

Set `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `MO_INGEST_TOKEN` as secrets in your Cloudflare dashboard or via `npx wrangler secret put <NAME>`. The production `MO_INGEST_TOKEN` must differ from any dev token (`openssl rand -hex 32`); hand it to MO's operator. Without the last two, the MO delivery endpoint answers 503.

In practice CI deploys: every push to `master` runs `npx wrangler deploy` once the `ci` and `smoke` jobs pass, then a post-deploy smoke checks production (see [CI](#ci)).

### Production setup for the MO delivery endpoint (one-time)

The weekly-plan tables, the `ingest_weekly_plan` function and the two Worker secrets must exist in production before the code that uses them is deployed. Nothing account- or user-specific is done in production: no manual accounts, no test deliveries.

**Timing:** the change ships in one PR, and every merge to `master` deploys to production. Run both steps **after that PR's CI is green and before merging it**, so the deploy lands on a database and Worker that are already prepared.

1. Push the migrations to the linked production project, **before** the Worker code that calls `ingest_weekly_plan` is deployed:

   ```bash
   npx supabase link --project-ref <project-ref>   # once per machine
   npx supabase db push
   ```

2. Set the two Worker secrets. Generate a fresh token for production and store it for MO as `MO_WEB_TOKEN` (the env var MO's `delivery.mo_web.token_env` points to, see `context/changes/mo-weekly-delivery/mo-delivery-contract.md`):

   ```bash
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY   # service_role key of the production project
   openssl rand -hex 32                                # the production token
   npx wrangler secret put MO_INGEST_TOKEN             # paste that token
   ```

Every later change that adds a migration (for example `get_plan_recency`, which the dashboard's recency notes call) follows the same timing: push it with `npx supabase db push` after the PR's CI is green and before merging, so the deployed Worker never calls a function production doesn't have yet.

After the merge, the post-deploy smoke expects `POST /api/mo/deliveries` without a token to answer 401. A 503 there means the Worker secrets are missing.

### Production setup for email links (one-time)

Invitation and password-reset emails link to `/api/auth/confirm` only if the production project uses the repo's templates; Supabase's default templates link elsewhere and the user never gets signed in. `supabase/config.toml` sets them for local Supabase only, so production needs them set by hand.

**Timing:** as with the migrations above, do it **after the PR's CI is green and before merging it**.

In the Supabase dashboard of the production project, go to **Authentication → Emails → Templates** and replace the message body of:

- **Invite user** with the contents of `supabase/templates/invite.html` (subject: `You have been invited to Meal Orchestrator`)
- **Reset password** with the contents of `supabase/templates/recovery.html` (subject: `Reset your Meal Orchestrator password`)

The links use `{{ .SiteURL }}`, so they always point to the production Site URL. Repeat this step only when those template files change.

### Keep-alive Cron Trigger

The Worker runs a daily Cron Trigger (`0 3 * * *`, see `wrangler.jsonc`) that calls the `keepalive` Postgres function via Supabase RPC, keeping the free-tier project from pausing after ~7 days of inactivity. Make sure the `keepalive` migration has been pushed to production (see [Supabase Configuration](#supabase-configuration)) **before** deploying the Worker.

To fire the scheduled handler locally, hit the trigger endpoint the Cloudflare Vite plugin exposes against `npm run dev` or `npm run preview`:

```bash
curl -i http://localhost:4321/cdn-cgi/handler/scheduled
```

Or, without an Astro dev/preview server, via Wrangler directly:

```bash
npx wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=0+3+*+*+*"
```

A successful run logs `keepalive ok`; a failure logs `keepalive failed: <message>` and the invocation is reported as failed.

## Smoke test

`scripts/smoke.mjs` is a dependency-free Node script that walks the whole auth flow (sign-up, sign-in, protected page, sign-out) and the MO delivery flow over HTTP. Run it against the dev server or the production preview after dependency upgrades:

```bash
npm run dev            # or: npm run build && npm run preview
BASE_URL=http://localhost:4321 MO_INGEST_TOKEN=<the server's token> npm run smoke
```

It needs a reachable Supabase instance (local or cloud) with email confirmation disabled, and a server configured with `SUPABASE_SERVICE_ROLE_KEY` and `MO_INGEST_TOKEN`. `MO_INGEST_TOKEN` must be set for the script too (it must match the server's); the script exits immediately without it. With `SUPABASE_URL` and `SUPABASE_KEY` (the anon key) also set, it checks that the anon key can't execute `ingest_weekly_plan` directly; CI sets both. With `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set, it also checks the email links (see below); CI sets it too.

The delivery steps load `scripts/fixtures/mo-delivery.sample.json`, move it to the first Monday at least 7 days ahead (and, for the history, to the current week's Monday) and check that: the signed-in user's dashboard starts at "No upcoming plan yet"; a delivery without a token gets 401; a delivery for a new email creates the account; a delivery of the same sample for the current week (Europe/Warsaw), with one meal renamed, shows the "This week" tab with that meal; a delivery of the upcoming week for the smoke user shows its recommended meal on the dashboard; the upcoming week then shows a recency note ("In your plan N days earlier (…"), N being the days between the two Mondays; and a re-delivery of the same week with a renamed meal replaces it.

The email-link steps open `/api/auth/confirm` the way a click in an invitation or password-reset email does, without sending any email: they generate the link's token through the Admin API (`generate_link`) with the service-role key. They check that: an invitation for a new email signs that user in and lands on a dashboard with "No upcoming plan yet"; a password-reset link for the smoke user signs them in and the dashboard shows their re-delivered week (so the session is theirs); and a reused password-reset link or a made-up token is sent back to `/auth/signin` with an error.

The script also fires the keep-alive Cron Trigger (`/cdn-cgi/handler/scheduled`) and expects it to succeed. With `KEEPALIVE_EXPECT_FAILURE=1` it runs only that check (no `MO_INGEST_TOKEN` needed) and expects a non-2xx response instead; CI uses this mode against a preview pointed at an unreachable `SUPABASE_URL`, proving failed pings are reported.

> **Note:** this script exists primarily to guard the development of the starter itself — it is a fast sanity check that dependency upgrades did not break the build, the Cloudflare adapter or the Supabase auth flow. It is **not** a substitute for a real test suite. Once you build your own product on top of this starter, add proper tests (unit, integration, end-to-end) suited to your application.

## CI

GitHub Actions runs two jobs on every push and PR to `master`:

- **ci** — lint, unit tests (`npm test`), `astro check` and build. Configure `SUPABASE_URL` and `SUPABASE_KEY` as repository secrets for the build step.
- **smoke** — starts a local Supabase via the Supabase CLI (its `SERVICE_ROLE_KEY` included), runs the pgTAP database tests in `supabase/tests/` (`npx supabase test db` locally), builds, serves the production preview on the Cloudflare runtime with a fixed test `MO_INGEST_TOKEN` and runs `npm run smoke` against it. No secrets required.

On pushes to `master`, a **deploy** job then runs `npx wrangler deploy` and a post-deploy smoke against production, including a token-less `POST /api/mo/deliveries` that must return 401 (503 means the Worker secrets are missing; 403 or a challenge page means Cloudflare bot protection is blocking MO).

## License

MIT
