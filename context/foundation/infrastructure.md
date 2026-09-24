---
project: mo-web
researched_at: 2026-09-24
recommended_platform: Cloudflare Workers (with Static Assets)
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 7 (SSR, output "server") + React 19 islands
  runtime: Cloudflare workerd via @astrojs/cloudflare 14.3.1 / wrangler 4.131.1
---

## Recommendation

**Deploy on Cloudflare Workers (Workers + Static Assets, not Cloudflare Pages).**

Cloudflare Workers scored Pass on all five agent-friendly criteria. The repo is already set up for it (`wrangler.jsonc` with `main` + `assets` binding, `@astrojs/cloudflare` v14, `astro dev` running in workerd), so choosing it costs no migration work. The interview found no persistent-connection need, no strong cost-vs-DX preference, AWS familiarity with willingness to stay on Cloudflare, and a single region (EU). The data layer stays in external Supabase. For 2–4 users, those answers favour the zero-migration, free-tier option. The runners-up need an adapter swap (`@astrojs/vercel` / `@astrojs/netlify`), and each has a region or plan trap.

> **Stack contract correction (applied 2026-09-24):** `tech-stack.md` originally named `deployment_target: cloudflare-pages`; it now says `cloudflare-workers`. The pinned `@astrojs/cloudflare` 14.3.1 has no Pages build path (no `pages_build_output_dir`); it builds a Worker with Static Assets through `@cloudflare/vite-plugin` 1.54.8. Pages still exists but gets new features after Workers, and Cloudflare now points new projects to Workers. Treat "Pages" in upstream docs as meaning **Workers**. Never use `wrangler pages deploy` or Pages Git integration for this project.

## Platform Comparison

Hard filters: the persistent-connection filter didn't apply (interview Q1 = No). No platform was dropped for runtime. Every non-Cloudflare option requires replacing `@astrojs/cloudflare` with another adapter, which counts as a penalty, not a disqualification.

Scoring: Pass = 2, Partial = 1, Fail = 0. CLI, Managed and Deploy API are weighted ×2, Docs ×1 and MCP ×0.5, for a maximum of 15.

| Platform           | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | Weighted | Soft adjustments                                                         |
| ------------------ | --------- | ------------------ | ------------------- | ----------------- | ----------------- | -------- | ------------------------------------------------------------------------ |
| Cloudflare Workers | Pass      | Pass               | Pass                | Pass              | Pass              | **15**   | + no migration, + familiarity/acceptance, + free tier fits               |
| Vercel             | Pass      | Pass               | Pass                | Pass              | Partial           | 14.5     | − adapter swap, − must pin `fra1`, − middleware/ISR trap                 |
| Netlify            | Pass      | Pass               | Pass                | Pass              | Partial           | 14.5     | − adapter swap, − EU region is Pro-only (free = US-Ohio)                 |
| Render             | Partial   | Pass               | Pass                | Pass              | Pass              | 13       | − adapter swap, − free cold start ~60 s or $7/mo, − PR previews Pro-only |
| Railway            | Partial   | Pass               | Pass                | Pass              | Pass              | 13       | − adapter swap, − $5/mo minimum, − EU = Amsterdam only                   |
| Fly.io             | Pass      | Partial            | Pass                | Partial           | Partial           | 10.5     | − adapter swap + hand-written Dockerfile, − no free tier                 |

**Per-platform notes** (all statuses checked 2026-09-24):

- **Cloudflare Workers.** `wrangler deploy`, `wrangler rollback`, `wrangler versions list`, `wrangler tail` and `wrangler secret put` are all GA and scriptable. Docs are served as markdown via `developers.cloudflare.com/llms.txt` and per-product `llms.txt`. The official remote MCP servers (docs, bindings, observability, builds) are GA. The free plan allows 100k requests/day and **10 ms CPU per invocation**; Workers Paid costs $5/mo for 10M requests and 30M CPU-ms. There is no egress fee. Smart Placement is **beta**. [Pricing](https://developers.cloudflare.com/workers/platform/pricing/) · [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/) · [Pages→Workers](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)
- **Vercel.** `vercel --prod`, `vercel rollback` (Hobby can only roll back to the previous deployment), `vercel promote` and `vercel logs --json`. `vercel.com/llms.txt` is available. The Vercel MCP server is **public beta** and mostly read-only. Hobby is free but **non-commercial only**, with 1 h log retention. Functions default to `iad1` (US), and Hobby allows one configured region. `@astrojs/vercel` ≥ v11 is required for Astro 7. By default, middleware is bundled into the ISR function, so `middlewareMode: 'edge'` would be needed for the auth guard. WebSockets are **public beta**. Vercel KV is **deprecated**. [Hobby](https://vercel.com/docs/plans/hobby) · [Astro adapter](https://docs.astro.build/en/guides/integrations-guide/vercel/)
- **Netlify.** `netlify deploy` makes a draft by default and needs `--prod` to publish; any earlier deploy can be republished instantly. `docs.netlify.com/llms.txt` is available. The official MCP server has existed since June 2025 but its GA label is unclear (treat as beta-grade). Credit-based free tier: 300 credits/mo with a hard cap, after which the site pauses. **Picking the function region (EU) is Pro-only**; free runs in `cmh` (US-Ohio). Astro 7 is supported ([changelog 2026-06-22](https://www.netlify.com/changelog/2026-06-22-astro-7/)).
- **Render.** The native Node runtime is GA. The CLI covers deploys and logs; rollback is available through the API only. `llms.txt` is available and the MCP server is **GA (since 2025-08-21)**. Free services spin down after 15 min and take about 60 s to cold-start, which would hit every weekly MO POST; Starter is $7/mo. Preview Environments require **Pro**. Astro needs `HOST=0.0.0.0`.
- **Railway.** `railway up`, `railway logs`, `railway variables` and `railway redeploy`. Rolling back to an arbitrary earlier build is **dashboard-only**. Railpack is the default builder but is **beta**; app sleeping is **beta**. Hobby costs $5/mo plus usage. The only EU region is Amsterdam. The official MCP server looks GA.
- **Fly.io.** `fly deploy`, `fly logs` and `fly secrets set` work well. Rollback means redeploying an earlier image digest, and config is not rolled back. There is no free tier for new orgs (about $2/mo for shared-cpu-1x with auto-stop), and a pricing change takes effect 2026-10-01. `fly launch` does not reliably detect Astro, so expect to write the Dockerfile by hand. The `fly mcp` server is **experimental**, and Tigris is **beta**.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Passes every criterion, and it's already the configured target: `npm run build && npx wrangler deploy` works with the existing `wrangler.jsonc`. It fits the free tier for 2–4 users, and rollback is a versioned, one-command operation. Cloudflare's MCP servers are GA if structured log queries become useful later. There's no Node-adapter migration and no Dockerfile. The main costs are the 10 ms CPU limit on the free plan, and edge-runtime constraints on what libraries the code can use.

#### 2. Vercel

It matches Cloudflare on CLI, docs and deploy API, the free Hobby tier covers this scale, and a non-commercial personal project is allowed on Hobby. It came second because it needs an adapter swap, an explicit `fra1` region pin (the default is US), and `middlewareMode: 'edge'` so the auth middleware in `src/middleware.ts` runs on every request. Its MCP server is only in beta, and Hobby rollback is limited to the previous deployment.

#### 3. Netlify

It also scores 14.5 on the criteria. Deploys are drafts by default, which is a safer default for an agent, and rollbacks are instant. It came third because EU function placement is Pro-only: on the free plan, every SSR request would make its Supabase auth and data calls from US-Ohio to an EU project, adding latency to each request. The hard-capped free credit pool pauses the site if it runs out. It also needs an adapter swap.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **The free plan's 10 ms CPU limit per invocation.** An SSR request includes Astro and React rendering, `@supabase/ssr` cookie parsing and JWT handling. If annotation and recency computation (FR-008) or nutrition summaries (FR-014) also run in the Worker, heavy dashboard requests can fail intermittently with Error 1102. Fix: Workers Paid ($5/mo), or compute annotations in Postgres (a view or RPC).
2. **The stack contract doesn't match the platform.** `tech-stack.md` says Pages, but adapter v14 builds only for Workers. Agents following Pages tutorials (`wrangler pages deploy`, `pages_build_output_dir`, Pages Git integration) will produce broken deploy plans.
3. **Hidden KV resource.** `@astrojs/cloudflare` v14 turns on Astro sessions with a `SESSION` KV binding unless `session` is disabled or given a different driver (verified in `node_modules/@astrojs/cloudflare/dist/index.js`). The first deploy then needs a KV namespace, and the API token needs KV scope. The app doesn't use Astro sessions because auth lives in Supabase cookies.
4. **Secrets can be missing without any error.** `astro.config.mjs` declares `SUPABASE_URL`/`SUPABASE_KEY` as `optional: true`, and `createClient()` in `src/lib/supabase.ts` returns `null` when they're missing. A deploy without Worker secrets succeeds and serves pages, but auth is broken. CI injects the values only at build time, while `astro:env` secrets are read at runtime from the Worker's environment.
5. **Supabase email links only work on allowlisted URLs.** Invite and reset emails (FR-003/FR-005) redirect to the Supabase Site URL and allowlist. `*.workers.dev` preview URLs aren't on the list by default, so invite and reset flows can't be tested on previews without adding wildcard redirect entries.

### Pre-Mortem — How This Could Fail

The team shipped mo-web to Cloudflare by following "Cloudflare Pages" guides, because that's what the stack document said. The first deploy failed with a confusing config error, and the agent "fixed" it by hand-editing `wrangler.jsonc`. Their second attempt went through, but the Supabase secrets were never set as Worker secrets: CI had only set them at build time. The env schema marked the secrets optional, so the site came up and every login silently fell through to "unauthenticated". It took an evening to trace. Once auth worked, the dashboard grew: annotations, swaps, ratings, all computed in the Worker. On the free plan, the Sunday-evening planning session started returning intermittent 1102 errors. Nobody had checked CPU time, since "it's only four users". Meanwhile MO's weekly POST hit a Bot Fight Mode challenge after a custom domain was added, and the delivery failed without anyone noticing. The design called for manual retry, but nobody was watching, so a week of recommendations never arrived. Tired of chasing edge-runtime quirks, the team moved the MVP to a Node host in week five.

### Unknown Unknowns

- **Astro sessions backed by KV turn on silently in adapter v14.** Unless `session: false` is set (the adapter checks for it) or another driver is configured, deploys expect a `SESSION` KV namespace.
- **Bot protection vs. machine clients.** Turning on Bot Fight Mode, Super Bot Fight Mode or WAF managed challenges on a custom domain can block MO's non-browser `POST`. Keep the ingestion route exempt, or keep bot protection off.
- **Supabase free projects pause after about 7 days of inactivity.** MO's weekly cadence sits right at that threshold. A paused project makes the Worker return 5xx errors, which looks like a deploy failure but isn't one.
- **Preview URLs are public, and some branch names break aliases.** `wrangler versions upload --preview-alias <branch>` fails when the branch name contains `/` (workers-sdk issue #14345, still open). `workers.dev` preview URLs are publicly reachable unless protected with Cloudflare Access.
- **Version-specific behaviour.** `astro dev` already runs in workerd through `@cloudflare/vite-plugin`, so `wrangler dev` / `wrangler pages dev` aren't needed for local development. `Astro.locals.runtime` was removed in the v13/v14 line; use `astro:env/server` (as the code already does) or `import { env } from "cloudflare:workers"`. The `platformProxy` option cited by some guides does not exist in v14. `nodejs_compat` became default only for compatibility dates ≥ 2026-08-04; this project pins `2026-05-08` with the flag set explicitly, which is fine. Smart Placement is **beta**, and one source says it became default-on in March 2026, which I haven't confirmed. Don't rely on it either way.

## Operational Story

- **Preview deploys**: Run `npx wrangler versions upload --preview-alias <sanitized-branch>` from a GitHub Actions PR job. It produces `https://<alias>-mo-web.<subdomain>.workers.dev` without promoting to production. Sanitize branch names to `[a-z0-9-]`. Previews are public; put Cloudflare Access in front of `*.workers.dev` if real data is ever reachable. Fork PRs get no preview because they can't read the deploy token.
- **Secrets**: Runtime secrets (`SUPABASE_URL`, `SUPABASE_KEY`, and later the MO ingestion token and any Supabase service-role key needed for invites) live in Workers Secrets via `npx wrangler secret put <NAME>`. Only the account owner can read or rotate them in the dashboard, and each change creates a new deployed version. The CI deploy token (`CLOUDFLARE_API_TOKEN`, scoped to _Workers Scripts: Edit_ on this account, plus _Workers KV Storage: Edit_ only if the SESSION KV is kept) and `CLOUDFLARE_ACCOUNT_ID` live in GitHub Actions secrets. Local values go in `.dev.vars` (gitignored). To rotate, generate a new key in Supabase, `wrangler secret put`, then revoke the old key.
- **Rollback**: Run `npx wrangler deployments list` (or `npx wrangler versions list`) to find the last good version, then `npx wrangler rollback <version-id>`. It takes effect within seconds. Supabase migrations do **not** roll back with the Worker. Keep migrations backward-compatible (expand, then contract) so the previous version still runs against the new schema.
- **Production deploys (CI)**: The `deploy` job in `.github/workflows/ci.yml` runs on every push to `master` after `ci` and `smoke` pass. It runs `npm run build` + `npx wrangler deploy`, then a post-deploy smoke: `/auth/signin` 200, `/dashboard` 302, and a bad-credentials sign-in that must return `Invalid login credentials` (this catches missing Worker secrets). First CI deploy: version `dfc49e6b-8327-47c6-b2b9-b45d637c0acf` (2026-09-24).
- **Approval**: A human approves production deploys, either by merging to the default branch (CI deploys) or by explicitly OK-ing a manual `wrangler deploy`. Rotating the primary Supabase key, deleting the Worker or the KV namespace, and destructive Supabase operations (dropping tables, resetting the DB) are human-only. The agent may run these unattended: builds, `versions upload` previews, `wrangler tail`, `deployments list`, and secret reads by name (values are never shown).
- **Logs**: `npx wrangler tail mo-web --format json` streams live runtime logs. Persisted Workers Logs are enabled (`observability.enabled: true` in `wrangler.jsonc`) and can be queried in the dashboard or through the Cloudflare observability MCP server (`observability.mcp.cloudflare.com`, GA). Pipeline logs: `gh run view <id> --log`.

## Risk Register

| Risk                                                                                                                         | Source           | Likelihood | Impact | Mitigation                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Free plan's 10 ms CPU limit causes intermittent Error 1102 on dashboard SSR                                                  | Devil's advocate | M          | M      | Compute annotations and aggregates in Postgres (views or RPC). Watch CPU time in Workers Logs, and upgrade to Workers Paid ($5/mo) at the first 1102.                                                  |
| Agents follow Cloudflare **Pages** docs because `tech-stack.md` says `cloudflare-pages`                                      | Devil's advocate | L          | M      | **Done 2026-09-24:** `tech-stack.md` now says `cloudflare-workers`, and a CLAUDE.md hard rule says to deploy with Workers (`wrangler deploy`), never Pages.                                            |
| Adapter v14 auto-requires a `SESSION` KV namespace                                                                           | Unknown unknowns | L          | L      | **Done 2026-09-24:** `session: false` is set in `astro.config.mjs` (supported since Astro 7.2). No KV namespace or KV token scope is needed.                                                           |
| Missing Worker secrets → `createClient()` returns `null` → silent auth failure                                               | Pre-mortem       | M          | H      | Set secrets with `wrangler secret put` before the first deploy. Make the vars non-optional (or fail loudly at startup), and add a post-deploy smoke check for `/auth/signin`.                          |
| Supabase invite/reset links break on preview/custom domains                                                                  | Devil's advocate | M          | M      | Set the Supabase Auth Site URL to the production URL and add `https://*-mo-web.<subdomain>.workers.dev/**` to the redirect allowlist.                                                                  |
| MO's machine-to-machine POST blocked by bot protection/WAF                                                                   | Pre-mortem       | L          | H      | Keep Bot Fight Mode off, or add a skip rule for the ingestion path. Authenticate MO with a bearer token instead. Alert MO's operator when delivery gets a non-2xx response.                            |
| Invite/reset emails never reach users because Supabase's built-in mailer is limited (rate limit; team-members-only delivery) | Research finding | H          | H      | Configure Resend as custom SMTP in the production project (see Pre-deploy To-Do). After setup, send a test invite to a non-team address.                                                               |
| Supabase free project pauses after ~7 days idle                                                                              | Unknown unknowns | M          | H      | Weekly MO writes keep it borderline-active. Add a lightweight scheduled ping (GitHub Actions cron) or move to Supabase Pro if pauses occur.                                                            |
| Preview alias fails for branch names with `/`; previews are public                                                           | Unknown unknowns | M          | L      | Sanitize the alias in CI (`tr '/_' '--' \| tr A-Z a-z`). Put Cloudflare Access on previews once real data exists.                                                                                      |
| Smart Placement status (beta; default-on claim unverified)                                                                   | Research finding | L          | L      | Leave placement unset. Users and Supabase are both in the EU, so default routing is already close. Revisit only if measured latency to Supabase is high.                                               |
| CI triggers on `master`; stack contract said auto-deploy on merge to `main`                                                  | Research finding | L          | M      | **Resolved 2026-09-24:** the default branch is `master`. `tech-stack.md` now records `default_branch: master`, which matches `.github/workflows/ci.yml`, so the deploy job should trigger on `master`. |
| DB migrations don't roll back with `wrangler rollback`                                                                       | Research finding | L          | M      | Use expand/contract migrations, and test rollback against the migrated schema before destructive changes.                                                                                              |

## Pre-deploy To-Do

Open items that block the first production deploy. Tick each one off here as it's done.

> **First production deploy (2026-09-24):** `https://mo-web.malpiszon.workers.dev`, Cloudflare account subdomain `malpiszon`. First version ID `0804df57-6abd-4549-9cfb-1e21730cfa29` (deployed manually with `npx wrangler deploy`). Checked: `/` 200, `/auth/signin` 200, `/dashboard` 302 → `/auth/signin`, bad-credentials sign-in returns Supabase `Invalid login credentials`. Plan: `context/deployment/deploy-plan.md`.

> **Environments (decided 2026-09-24):** development runs against the **local Docker Supabase** stack (`npx supabase start`; migrations in `supabase/migrations/`; auth emails captured by Mailpit at `http://127.0.0.1:54324`). This is the same setup CI's `smoke` job uses. The cloud Supabase project is **production only**. Never point local dev, `npm run smoke` or experiments at it. Schema changes reach production via `npx supabase link --project-ref <ref>` + `npx supabase db push`.

- [x] ~~**Create the cloud Supabase project.**~~ Done 2026-09-24: project ref `yjttuawpwizrwlvsvqth` (`https://yjttuawpwizrwlvsvqth.supabase.co`).
- [x] ~~**Configure Supabase Auth for production.**~~ Done 2026-09-24: Site URL `https://mo-web.malpiszon.workers.dev`, redirect allowlist `https://*-mo-web.malpiszon.workers.dev/**`. Keep email confirmation **on** in production; it's only turned off for local development.
- [x] ~~**Configure custom SMTP via Resend in the production Supabase project.**~~ Done 2026-09-24: host `smtp.resend.com:465`, user `resend`, password = dedicated sending-only Resend API key for mo-web, sender `meal-orchestrator@notify.malpiszon.net` (domain `notify.malpiszon.net` verified in Resend; DKIM, SPF and MX in place, DMARC `p=none` inherited from `malpiszon.net`). Verified with a production sign-up to a non-team Gmail address: the email arrived, and the link went through `…supabase.co/auth/v1/verify` with `redirect_to=https://mo-web.malpiszon.workers.dev`. The test user was deleted afterwards. **Follow-up:** the app has no auth callback route. Supabase redirects email links to `/?code=…` (PKCE) and nothing exchanges the code. Sign-up is unaffected (the email is confirmed at Supabase, then the user signs in), but invites (FR-003) and password resets (FR-005) need an `/auth/callback` route that calls `exchangeCodeForSession`, with `redirect_to` / `emailRedirectTo` pointing to it.
- [x] ~~**Set Worker secrets from the cloud project**~~ (`SUPABASE_URL`, `SUPABASE_KEY` = publishable key). Done 2026-09-24. Because the vars are `optional: true`, a missing secret doesn't fail the deploy; auth just breaks silently. Verify with a bad-credentials sign-in, which must return `Invalid login credentials` rather than `Supabase is not configured`.
- [x] ~~**Add GitHub repository secrets**~~ Done 2026-09-24 on the public repo `malpiszon/meal-orchestrator-web`: `SUPABASE_URL` / `SUPABASE_KEY` (the `ci` job's build step reads them), plus `CLOUDFLARE_API_TOKEN` (custom token, only _Account → Workers Scripts: Edit_) / `CLOUDFLARE_ACCOUNT_ID` for the deploy job.
- [ ] **Decide how to handle Supabase free-tier pausing** (projects pause after ~7 days idle). See the risk register.
- [x] ~~Rename the Worker to `mo-web` in `wrangler.jsonc` (sets the `workers.dev` URL used by Supabase Auth).~~ Done 2026-09-24.
- [x] ~~Disable Astro sessions (`session: false`) so no `SESSION` KV is required.~~ Done 2026-09-24.
- [x] ~~Align `tech-stack.md` to Workers and `master`.~~ Done 2026-09-24.

## Getting Started

These steps apply to `astro` 7.3.2, `@astrojs/cloudflare` 14.3.1, `wrangler` 4.131.1 and `@cloudflare/vite-plugin` 1.54.8. Use the project-local wrangler via `npx`; no global install is needed.

1. **Worker name and sessions are already set.** `wrangler.jsonc` names the Worker `mo-web`, and Astro sessions are disabled with `session: false`, so no KV binding is needed. Local dev stays `npm run dev`, which already runs in workerd, so no `wrangler dev` is needed.
2. **Authenticate.** For interactive use, run `npx wrangler login`. For CI or agent use, export `CLOUDFLARE_API_TOKEN` (scoped to Workers Scripts: Edit on this account only) and `CLOUDFLARE_ACCOUNT_ID`. Check with `npx wrangler whoami`.
3. **Build and deploy.** Run `npm run build`, then `npx wrangler deploy`. The build writes the generated Worker config under `dist/`, and wrangler picks it up from the project root. This produces `https://mo-web.<subdomain>.workers.dev`. Do **not** use `wrangler pages deploy`.
4. **Set runtime secrets.** Run `npx wrangler secret put SUPABASE_URL` and `npx wrangler secret put SUPABASE_KEY` using the cloud Supabase project values. Then set the Supabase Auth Site URL and redirect allowlist to the `workers.dev` URL.
5. **Verify.** In one terminal run `npx wrangler tail mo-web`. In another, `curl -I https://mo-web.<subdomain>.workers.dev/auth/signin` should return 200 and `/dashboard` should return 302 to sign-in. Run `npm run smoke` only against local or preview environments, because it creates users. To roll back, run `npx wrangler deployments list` and then `npx wrangler rollback <id>`.

## Out of Scope

The following were not evaluated in this research:

- Docker image configuration
- CI/CD pipeline setup (including the GitHub Actions deploy job)
- Production-scale architecture (multi-region, HA, DR)
