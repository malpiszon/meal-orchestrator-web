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

After `npx supabase link`, the local stack runs the linked project's service versions, so locally, as in production, PostgREST is currently v14.5. Right after sign-in it can reject the new session once with `PGRST303 JWT issued at future`; the plan services retry that error and log `… PGRST303 JWT issued at future, retry n/2 …`.

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

Users can then sign in immediately after setting a password without a separate confirmation step.

### Auth routes

| Route                   | Description                                                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `/auth/signin`          | Email/password sign-in form, with a "Forgot or never set a password?" link to `/auth/forgot-password`                                         |
| `/auth/forgot-password` | Asks for an email and sends a link to set a new password; answers the same whether or not the account exists                                  |
| `/auth/set-password`    | Where invitation and password-reset emails link (`?token_hash=…&type=invite` or `recovery`): a password form (8+ characters); saving signs in |
| `/api/auth/confirm`     | Forwards old-style invitation and reset links, unverified, to `/auth/set-password`; it verifies nothing itself                                |
| `/dashboard`            | Example protected page (redirects to `/auth/signin` if unauthenticated)                                                                       |

Opening a reset link never uses its single-use token, so mail scanners that prefetch links can't burn it: the token is verified only when the new-password form is posted (`POST /api/auth/set-password`). A too-short password is refused before that, with the link still usable. Opening a used, replaced (a newer link of the same kind was sent), made-up or expired link shows "This link is invalid or has expired" and "Ask for a new link" on `/auth/set-password` itself, as does a link without a token; the page checks the token read-only and still never uses it. A link that dies while the form is open (it expires, or a newer one is sent) ends, on posting, on `/auth/forgot-password` with the same message. If Supabase refuses the password after the token was used (for example the current password again), the user keeps the session and, for 10 minutes, can retry on `/auth/set-password` without a token (the `mo-password-retry` cookie); a signed-in session alone can't change the password.

The check on open is the `auth_link_is_valid` Postgres function, called with the service-role key. It mirrors Supabase Auth's own rule (GoTrue v2.197.0): the token must have a row in `auth.one_time_tokens` and must have been sent less than an hour ago (`AUTH_LINK_LIFETIME_SECONDS` in `src/lib/set-password.ts`, equal to `otp_expiry` in `supabase/config.toml`). It reads the Supabase-managed tables `auth.one_time_tokens` and `auth.users`, which a Supabase upgrade may change. It fails open: if it can't run (service-role key missing, database error, 2 s timeout), the page shows the form, logs `auth link check …` in the Worker logs, and the post decides as before. The pgTAP test `supabase/tests/auth_link_is_valid.test.sql` and the smoke steps catch a change that breaks it in the local Supabase version, so in CI. A hosted Supabase upgrade isn't covered: if it made the check answer "not live" for valid links, the page would hide the form for every link. A sudden rise of `auth link check: link not live` lines in the Worker logs is the sign; dropping the function (`drop function public.auth_link_is_valid`) makes the page fail open at once.

There is no public sign-up: an invitation is the only way to get an account. The first MO delivery for an unknown email creates the account and sends it an invitation in the same step (Supabase Admin API `inviteUserByEmail`; the account is unconfirmed and carries `app_metadata.provisioned_by = "mo-delivery"`). The invitation links to `/auth/set-password?token_hash=…&type=invite`, which works like a reset link: opening it uses no token, and posting a valid password (`POST /api/auth/set-password`) verifies it, confirms the account and signs the user in on `/dashboard`. Later deliveries send no second invitation. If the invitation email can't be sent (for example the email rate limit), the delivery still stores the week and returns 200, the failure is only logged in the Worker logs, and the user can use "Forgot password?" on the sign-in page to get a password.

**Known risk:** Cloudflare Workers request logs record the full URLs of `/auth/set-password` and `/api/auth/confirm`, so a reset token that hasn't been used yet (valid for up to 1 hour) sits in logs readable by the Cloudflare account's admins.

Route protection is handled in `src/middleware.ts`. Add paths to the `PROTECTED_ROUTES` array there to require authentication.

The invitation and password-reset email templates live in `supabase/templates/` and are wired up in `supabase/config.toml`. Local Supabase reads them only at start, so restart it (`npx supabase stop && npx supabase start`) after changing them. Local emails are not sent; they land in Mailpit at `http://127.0.0.1:54324`.

### MO delivery endpoint

`POST /api/mo/deliveries` is how Meal Orchestrator (MO) delivers a user's weekly plan: the week's full menu with every option's score. It is machine-to-machine: no cookie session, the middleware skips it, and it must never be added to `PROTECTED_ROUTES`.

- **Auth:** `Authorization: Bearer <MO_INGEST_TOKEN>`. A missing or wrong token returns 401.
- **Body:** payload v1, defined by `moDeliverySchema` in `src/lib/mo-delivery.ts`. An invalid body returns 400 with the validation issues. A sample is in `scripts/fixtures/mo-delivery.sample.json`.
- **Storage:** one call to the `ingest_weekly_plan` Postgres function through a service-role client. Re-sending a week for the same user replaces it, unless the body is identical to the stored one (same JSON content, `run_id` included), which changes nothing, or the week has already started, which is refused. An email mo-web doesn't know yet becomes an unconfirmed account without a password (`app_metadata.provisioned_by = "mo-delivery"`), and no email is sent.
- **Responses:** 200 `{"plan_id","week_start","account_created"}`; 503 `not_configured` when `SUPABASE_SERVICE_ROLE_KEY` or `MO_INGEST_TOKEN` is missing; 413 `payload_too_large` over 256 KiB; 409 `week_started` for a changed re-send of a week whose Monday is today or earlier in Europe/Warsaw (nothing is stored; MO doesn't retry it); 500 `storage_failed` on a database error (details in the Worker logs). The full response table, with what MO should retry, is in the contract linked below.

The full contract for the MO side is in `context/archive/2026-09-30-mo-weekly-delivery/mo-delivery-contract.md`. To try it locally against `npm run dev` (rewrite the email to a local user's, or a new one to see provisioning):

```bash
curl -i http://localhost:4321/api/mo/deliveries \
  -H "Authorization: Bearer $MO_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  --data @scripts/fixtures/mo-delivery.sample.json
```

The sample's week is in the past, so the dashboard won't show it; the walkthrough below moves it to an upcoming week.

### Swapping and saving the upcoming plan

On `/dashboard`, the "Next week" tab lists every option of every meal slot. The user's choice is selected (MO's recommended option until they swap), and every option with the slot's top score has a star. Tapping another option saves it immediately; a plan nobody swapped can be saved as it is with "Keep as recommended". The status line shows "Not saved yet" or "Saved <time>", plus the last day the plan can be edited.

Both routes take a JSON body and use the signed-in user's cookie session. They are not in `PROTECTED_ROUTES`: they answer 401 themselves instead of redirecting.

| Route                     | Body                   | Effect                                                 |
| ------------------------- | ---------------------- | ------------------------------------------------------ |
| `POST /api/plans/choose`  | `{ planId, optionId }` | Makes the option the chosen one of its slot, and saves |
| `POST /api/plans/confirm` | `{ planId }`           | Saves the plan as it is, without changing any choice   |

- **Responses:** 200 `{"saved_at","recency"}`, where `recency` maps option ids to the date the meal was last chosen earlier (`null` if that re-read failed; the save still stands); 400 `invalid_request` with the validation issues; 401 `unauthorized`; 404 `not_found` (no such option or plan, or someone else's); 409 `plan_locked`; 413 `payload_too_large` over 4 KiB; 503 `not_configured`; 500 `save_failed`.
- **Cut-off:** a plan can be changed while its `week_start` is after today in Europe/Warsaw, so until Sunday 23:59 Warsaw time before the week starts, for every user. From Monday 00:00 it is "This week" and any save is answered 409. The `choose_plan_option` and `confirm_plan` Postgres functions enforce this and the ownership check, so a stale page can't bypass it.
- **Re-delivery:** when MO re-sends a week:
  - A changed re-send of an upcoming week replaces the week's options.
  - A plan that was never saved follows MO's new recommendations and stays "Not saved yet".
  - A saved plan (swapped or kept as recommended) keeps each chosen dish that the new delivery still offers in the same meal, and stays saved. Where the dish is gone, MO's new recommendation is chosen.
  - An identical re-send changes nothing.
  - A re-send of a week that has started is refused (409 `week_started`), so "This week" never changes.
  - On a page opened before the re-send, swapping a meal no longer works (the option ids are new): the tap shows "This plan was updated. Reload to see the latest version." "Keep as recommended" is not caught: it still saves, with the new delivery's choices.
- **Recency notes** count the meals the user chose in saved plans, not the ones MO recommended. A plan counts once it is saved (swapped, or kept as recommended), and from that moment on, including its own earlier days. Plans that were never saved, plans delivered too late to edit (their week had already started) and the upcoming plan's own earlier days until it is saved give no notes.

### Dev walkthrough: sign in as an account a delivery created

**Local development only** (`npm run dev` against local Supabase). It shows the dashboard exactly as a real user will see it: the account is created by a delivery, as in production, and the delivery also sends the account its invitation. The real path is to open that invitation in Mailpit (`http://127.0.0.1:54324`) and set a password on the page it links to; step 2 below is only a shortcut for local testing (local Supabase sends at most 2 auth emails per hour). In production, accounts get their password only through the invitation; there are no manual accounts or test deliveries there.

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

2. Either open the invitation in Mailpit and set a password, or give the account a password through the local Admin API, using the local `SERVICE_ROLE_KEY` (from `npx supabase status -o env`) as both `apikey` and bearer token. Find the user's `<id>` in Studio (**Authentication → Users**) or with the `GET` below.

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

4. Deliver a second week to see the tabs: run step 1 again with `--arg start` set to this week's Monday (Europe/Warsaw; today counts if it is a Monday), and send `/tmp/mo-delivery.json` with the same `curl`. The response shows `"account_created":false`. Reload `/dashboard`: it now has two tabs. "This week" shows the plan for the current week and "Next week" (open by default) the upcoming one. Neither shows recency notes yet: a week that has started can't be saved, and the upcoming one isn't saved.

5. Swap a meal: in "Next week", tap another option of any slot. The status line reads "Saved <time> · Editable until <Sunday before the week>". Reload `/dashboard`: the option is still selected. On a never-saved plan, "Keep as recommended" saves it without swapping. The "This week" plan from step 4 has no controls: it has started, so the API answers 409 for it. Saving makes the plan count for recency notes at once: choosing a meal that is also chosen on an earlier day of the same saved week gives the later one a note straight away, and on a plan that isn't saved yet the same meal gets none.

6. Deliver a later week to see the notes: run step 1 again with `--arg start` set to the Monday after the upcoming week you saved, and send `/tmp/mo-delivery.json` with the same `curl`. Reload `/dashboard`: "Next week" now shows this later week, and every meal you chose in the saved week carries a note such as "In your plan 7 days earlier (Mon 12 Oct)". The recommended option you swapped away has no note, and neither does anything from the "This week" plan, which was never saved. Had you not saved the earlier week, the later one would show no notes at all.

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

2. Set the two Worker secrets. Generate a fresh token for production and store it for MO as `MO_WEB_TOKEN` (the env var MO's `delivery.mo_web.token_env` points to, see `context/archive/2026-09-30-mo-weekly-delivery/mo-delivery-contract.md`):

   ```bash
   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY   # service_role key of the production project
   openssl rand -hex 32                                # the production token
   npx wrangler secret put MO_INGEST_TOKEN             # paste that token
   ```

Every later change that adds a migration (for example `get_plan_recency`, which the dashboard's recency notes call, or `auth_link_is_valid`, which `/auth/set-password` calls to check a link on open) follows the same timing: push it with `npx supabase db push` after the PR's CI is green and before merging, so the deployed Worker never calls a function production doesn't have yet.

After the merge, the post-deploy smoke expects `POST /api/mo/deliveries` without a token to answer 401. A 503 there means the Worker secrets are missing.

### Production setup for email links (one-time)

Invitation and password-reset emails link to the app only if the production project uses the repo's templates; Supabase's default templates link elsewhere and the user never gets signed in. `supabase/config.toml` sets them, the 8-character password minimum and the one-hour link lifetime for local Supabase only, so production needs them set by hand in the Supabase dashboard of the production project.

1. **Minimum password length.** Go to **Authentication → Providers → Email** and set **Minimum password length** to `8`. **Timing:** after the PR's CI is green and before merging it, as with the migrations above. Existing shorter passwords keep working until they are changed.
2. **Link lifetime.** Go to **Authentication → Providers → Email** and check that **Email OTP Expiration** is `3600` (seconds); set it if not. It must equal `AUTH_LINK_LIFETIME_SECONDS` in `src/lib/set-password.ts` and `otp_expiry` in `supabase/config.toml`: with a longer setting, `/auth/set-password` would show a link that still works as expired. **Timing:** after the PR's CI is green and before merging it, as with the migrations above.
3. **Templates.** Go to **Authentication → Emails → Templates** and replace the message body of:
   - **Invite user** with the contents of `supabase/templates/invite.html` (subject: `You have been invited to Meal Orchestrator`). Paste it only **after the deploy** of the invite-on-first-delivery change (see the timing note below)
   - **Reset password** with the contents of `supabase/templates/recovery.html` (subject: `Set a new Meal Orchestrator password`)

The links use `{{ .SiteURL }}`, so they always point to the production Site URL. Repeat a template's step whenever its file changes. **Timing:** a template change that only rewords the email can be pasted after the PR's CI is green and before merging it. A change that moves the link to a new page must be pasted only **after the deploy**: until then the old Worker doesn't have that page. The **Reset password** template of the password-reset change is such a case. It now links to `/auth/set-password`; until it is re-pasted, the production template still links to `/api/auth/confirm`, which the new code forwards to `/auth/set-password`, so resets keep working in between. The **Invite user** template of the invite-on-first-delivery change works the same way: it now links to `/auth/set-password?…&type=invite`, and until it is re-pasted the old production template links to `/api/auth/confirm?…&type=invite`, which the new code forwards there, so invitations keep working in between. Public sign-up is already off in the production project, and the app no longer has a sign-up page or API route.

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

`scripts/smoke.mjs` is a dependency-free Node script that walks the whole auth flow (sign-in, protected page, sign-out; the smoke user is created through the Admin API, since there is no sign-up) and the MO delivery flow over HTTP. Run it against the dev server or the production preview after dependency upgrades:

```bash
npm run dev            # or: npm run build && npm run preview
BASE_URL=http://localhost:4321 MO_INGEST_TOKEN=<the server's token> npm run smoke
```

It needs a reachable Supabase instance (local or cloud), `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set for the script too (it creates the smoke user through the Admin API and exits without them), and a server configured with `SUPABASE_SERVICE_ROLE_KEY` and `MO_INGEST_TOKEN`. `MO_INGEST_TOKEN` must be set for the script too (it must match the server's); the script exits immediately without it. With `SUPABASE_URL` and `SUPABASE_KEY` (the anon key) also set, it checks that the anon key can't execute `ingest_weekly_plan` directly; CI sets both. With `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set, it also checks the email links and the password reset (see below); CI sets it too. With `MAILPIT_URL` also set (local Supabase's Mailpit, `http://127.0.0.1:54324`), it reads one real reset email; without it the script prints `SKIP  real reset email (set MAILPIT_URL)`.

The delivery steps load `scripts/fixtures/mo-delivery.sample.json`, move it to the first Monday at least 7 days ahead (and to the current week's Monday and to the Monday 7 days after the upcoming week) and check that: the signed-in user's dashboard starts at "No upcoming plan yet"; a delivery without a token gets 401; a delivery for a new email creates the account; a delivery of the same sample for the current week (Europe/Warsaw), with one meal renamed, shows the "This week" tab with that meal; a delivery of the upcoming week for the smoke user shows its recommended meal on the dashboard; neither tab then shows a recency note, as the current week can't be saved and the upcoming one isn't saved yet; that `POST /api/plans/choose` without a session gets 401; that swapping an upcoming meal to a non-recommended option returns 200, and the dashboard then shows that option `checked` and "Saved "; that choosing an option of the current week gets 409 `plan_locked`, an unknown option 404 `not_found` and a non-JSON body 400 `invalid_request`; that an identical re-delivery of the upcoming week returns the same `plan_id` and keeps the swap and "Saved "; that a re-delivery of the current week with a renamed meal gets 409 `week_started` and "This week" still shows its meal; that a re-delivery of the upcoming week with a renamed meal replaces it but keeps the swap checked and "Saved " (not "Not saved yet"), and leaves "This week" alone; and that a delivery of a week 7 days after the saved upcoming week shows a recency note ("In your plan 7 days earlier (…") from it, with none on the recommended meal the swap replaced and none in "This week".

The email-link and password-reset steps open links the way a click in an invitation or password-reset email does, without sending any email: they generate the link's token through the Admin API (`generate_link`) with the service-role key. They check that: an invitation link for a new email, opened through `/api/auth/confirm`, is forwarded to `/auth/set-password?token_hash=…&type=invite` without signing anyone in, the page shows the form for it, posting a valid password there then lands on a dashboard with "No upcoming plan yet", and opening the used invitation link afterwards shows the invalid-link message without the form; `POST /api/auth/forgot-password` answers `?sent=1` for an unknown email and an error for `not-an-email`; an old-style reset link through `/api/auth/confirm` is forwarded to `/auth/set-password?token_hash=…`; that page shows the form; a 7-character password is sent back to the page with the same token and an error; a valid password then lands on `/dashboard` with the smoke user's re-delivered week (so the token survived the page's GET and the rejected password, and the session is theirs); while signed in without the `mo-password-retry` cookie, the page without a token shows the invalid-link message and a token-less save is sent to `/auth/forgot-password`, as it is after sign-out; the old password no longer signs in and the new one does; reusing the used token or posting a made-up one ends on `/auth/forgot-password` with an error, and opening either on the page shows the invalid-link message without the form; of two reset links generated in a row (for the invited account), the first shows the invalid-link message and the second the form; posting the current password with a fresh token is refused by Supabase but leaves a token-less retry open, which saves a new password and clears the retry cookie; the account created by the delivery for a new email claims itself with a reset link and sees its delivered week; and a garbage invitation link is forwarded to the set-password page, where saving with it ends on `/auth/forgot-password` with an error.

With `MAILPIT_URL` set, the script then asks for a reset of the smoke user through `/api/auth/forgot-password`, reads the newest email to that address from Mailpit's API (`/api/v1/search`, `/api/v1/message/<id>`), checks that its link is `/auth/set-password?…type=recovery` (only the path and query are used, as the link's host is Supabase's `site_url`) and posts a new password with it, which must land on `/dashboard`. Local Supabase sends at most 2 auth emails per hour (`email_sent` in `supabase/config.toml`), so more frequent local runs with `MAILPIT_URL` can fail that step.

The script also fires the keep-alive Cron Trigger (`/cdn-cgi/handler/scheduled`) and expects it to succeed. With `KEEPALIVE_EXPECT_FAILURE=1` it runs only that check (no `MO_INGEST_TOKEN` needed) and expects a non-2xx response instead; CI uses this mode against a preview pointed at an unreachable `SUPABASE_URL`, proving failed pings are reported.

> **Note:** this script exists primarily to guard the development of the starter itself — it is a fast sanity check that dependency upgrades did not break the build, the Cloudflare adapter or the Supabase auth flow. It is **not** a substitute for a real test suite. Once you build your own product on top of this starter, add proper tests (unit, integration, end-to-end) suited to your application.

## CI

GitHub Actions runs two jobs on every push and PR to `master`:

- **ci** — lint, unit tests (`npm test`), `astro check` and build. Configure `SUPABASE_URL` and `SUPABASE_KEY` as repository secrets for the build step.
- **smoke** — starts a local Supabase via the Supabase CLI (its `SERVICE_ROLE_KEY` and Mailpit included), runs the pgTAP database tests in `supabase/tests/` (`npx supabase test db` locally), builds, serves the production preview on the Cloudflare runtime with a fixed test `MO_INGEST_TOKEN` and runs `npm run smoke` against it, with `MAILPIT_URL` set. No secrets required.

On pushes to `master`, a **deploy** job then runs `npx wrangler deploy` and a post-deploy smoke against production, including a token-less `POST /api/mo/deliveries` that must return 401 (503 means the Worker secrets are missing; 403 or a challenge page means Cloudflare bot protection is blocking MO).

## License

MIT
