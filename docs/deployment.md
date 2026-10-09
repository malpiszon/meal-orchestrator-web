# Deployment

mo-web runs as a Cloudflare **Worker** (`npx wrangler deploy`; never Pages) at `https://mo-web.malpiszon.workers.dev`, against a hosted Supabase project.

## How a change reaches production

Every push to `master` runs the `ci` and `smoke` jobs, then the `deploy` job: `npm run build`, `npx wrangler deploy`, and a post-deploy smoke against production (see [testing](testing.md#ci)). Changes reach `master` only through PRs, so **merging a PR deploys it**.

Anything the new code depends on outside the Worker must therefore be in place before the merge:

- **Migrations:** after the PR's CI is green and **before merging**, push them to production, so the deployed Worker never calls a function production doesn't have yet:

  ```bash
  npx supabase link --project-ref <project-ref>   # once per machine
  npx supabase db push
  ```

  Between the push and the deploy the old Worker runs against the new schema, so a migration must keep the old code working.

- **Supabase dashboard settings** (password length, link lifetime): after CI is green and before merging.
- **Email templates:** a change that only rewords an email can be pasted before merging. A change that moves the link to a new page is pasted only **after the deploy**, as until then the old Worker doesn't have that page.

## Secrets

**Worker secrets** (Cloudflare dashboard, or `npx wrangler secret put <NAME>`):

| Secret                      | Value                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`              | Production project URL                                                                             |
| `SUPABASE_KEY`              | Production `anon` key                                                                              |
| `SUPABASE_SERVICE_ROLE_KEY` | Production `service_role` key (server-only, bypasses RLS)                                          |
| `MO_INGEST_TOKEN`           | A token used only in production (`openssl rand -hex 32`); MO keeps it as `MO_WEB_TOKEN`, see below |

Without the last two, the MO delivery endpoint answers 503. MO reads its token from the env var that `delivery.mo_web.token_env` names in its config, `MO_WEB_TOKEN` by convention (see [`mo-delivery-contract.md`](mo-delivery-contract.md#configuration)); hand the token to MO's operator.

**GitHub repository secrets** (used by CI):

| Secret                                          | Used by                                  |
| ----------------------------------------------- | ---------------------------------------- |
| `SUPABASE_URL`, `SUPABASE_KEY`                  | The `ci` job's build step                |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | The `deploy` job's `npx wrangler deploy` |

## Email settings and templates

`supabase/config.toml` configures these for local Supabase only; the production project needs them set by hand in its Supabase dashboard.

1. **Authentication → Providers → Email:** **Minimum password length** `8`, and **Email OTP Expiration** `3600` seconds. The expiration must equal `AUTH_LINK_LIFETIME_SECONDS` in `src/lib/set-password.ts` and `otp_expiry` in `supabase/config.toml`: with a longer setting, `/auth/set-password` would show a link that still works as expired.
2. **Authentication → Emails → Templates:** replace the message body of
   - **Invite user** with `supabase/templates/invite.html` (subject: `You have been invited to Meal Orchestrator`)
   - **Reset password** with `supabase/templates/recovery.html` (subject: `Set a new Meal Orchestrator password`)

   Repeat a template's step whenever its file changes. The links use `{{ .SiteURL }}`, so they always point to the production Site URL. Supabase's default templates link elsewhere, and the user would never get signed in.

Public sign-up is off in the production project.

Worker logs drop query strings from request URLs (`observability.redact_query_string` in `wrangler.jsonc`), so the `token_hash` of an unused invitation or reset link on `/auth/set-password` and `/api/auth/confirm` never reaches them.

## Keep-alive Cron Trigger

The Worker runs a daily Cron Trigger (`0 3 * * *`, see `wrangler.jsonc`) that calls the `keepalive` Postgres function, keeping the free-tier Supabase project from pausing after about 7 days of inactivity. A successful run logs `keepalive ok`; a failure logs `keepalive failed: <message>` and the invocation is reported as failed.

To fire it locally against `npm run dev` or `npm run preview`:

```bash
curl -i http://localhost:4321/cdn-cgi/handler/scheduled
```

Or, without an Astro server, through Wrangler:

```bash
npx wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=0+3+*+*+*"
```

## Known risks

- **The link check depends on Supabase internals.** `auth_link_is_valid` (see [API](api.md#accounts-and-email-links)) reads `auth.one_time_tokens` and `auth.users`, which a Supabase upgrade may change. The pgTAP test `supabase/tests/auth_link_is_valid.test.sql` and the smoke steps catch a break in the local Supabase version, so in CI. A hosted Supabase upgrade isn't covered: if it made the check answer "not live" for valid links, the page would hide the form for every link. A sudden rise of `auth link check: link not live` lines in the Worker logs is the sign; dropping the function (`drop function public.auth_link_is_valid`) makes the page fail open at once.
- **A paused database.** If the keep-alive stops (a failed cron, a removed migration), a week without activity pauses the Supabase project and MO's next delivery fails.
