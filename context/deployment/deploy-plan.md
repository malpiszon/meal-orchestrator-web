# First production deploy of mo-web to Cloudflare Workers

## Context

`context/foundation/infrastructure.md` picks Cloudflare **Workers + Static Assets** (never Pages). `tech-stack.md` confirms `deployment_target: cloudflare-workers`. The repo is ready for it: `wrangler.jsonc` names the Worker `mo-web`, and `session: false` means no KV namespace is needed. Three things are still missing:

- the production Supabase project
- the Worker's runtime secrets
- Supabase Auth settings that point at the deployed URL

The goal is a live `https://mo-web.<subdomain>.workers.dev` with working auth, and the infra doc's Pre-deploy To-Do updated to match.

Phase 1 is a manual deploy that proves the platform works. Phase 2 then creates the public GitHub repo, adds its secrets and a CI deploy job on `master`, as `ci_default_flow: auto-deploy-on-merge` requires. Keeping the phases separate means a failure points at either Cloudflare or CI, not both.

Out of scope: Resend SMTP, the Supabase free-tier pause mitigation, and PR preview deploys.

## Phase 0 — Save and commit this plan

0. **[me]** Copy this plan to `context/deployment/deploy-plan.md`. It's a new directory. Run prettier on it, since the pre-commit hook formats `*.md`, then commit it on `master` with the message "Add first-deployment plan".

## Phase 1 — Manual first deploy

**Legend:** **[user]** = you do it (dashboard or interactive login). **[me]** = I do it.

1. **[user] Refresh Cloudflare auth.** Run `! npx wrangler login`. The current token is missing `account:read`. I then check the login with `npx wrangler whoami`.
2. **[user] Create the cloud Supabase project** in an EU region (Frankfurt `eu-central-1`). Send me the project ref and URL. Keep email confirmation **on**.
3. **[me] Pre-flight checks:** `npm run lint`, `npx astro check`, `npm run build`. The `dist/` folder must contain the generated Worker config.
4. **[me] Deploy:** `npx wrangler deploy`. Never use `wrangler pages …`. I record the printed `workers.dev` URL and the version ID.
5. **[me + user] Set runtime secrets.** I run `npx wrangler secret put SUPABASE_URL` and `npx wrangler secret put SUPABASE_KEY`, and you paste the anon key at the prompt so it never appears in the transcript. Each secret put creates a new version, so no redeploy is needed. I then confirm with `npx wrangler secret list`, which shows names only.
6. **[user] Configure Supabase Auth.** You'll need the URL from step 4:
   - Set the Site URL to `https://mo-web.<subdomain>.workers.dev`.
   - Add `https://*-mo-web.<subdomain>.workers.dev/**` to the redirect allowlist.
   - Setting up Resend SMTP stays a separate open item. The deploy doesn't depend on it, but invites and resets will fail until it's done. I'll remind you.
7. **[me] Verify:**
   - `curl -I <url>/auth/signin` returns 200.
   - `curl -I <url>/dashboard` returns 302 to `/auth/signin`.
   - `curl -I <url>/` returns 200.
   - While running these checks, I watch `npx wrangler tail mo-web --format json` in the background for runtime errors.
   - I don't run `npm run smoke` against production, because it creates users. An optional manual sign-in check is up to you.
8. **[me] Update the docs** in `context/foundation/infrastructure.md`:
   - Record the project ref, the workers.dev URL and the first deployment version ID.
   - Tick off "Create cloud Supabase project", "Set Worker secrets" and "Configure Supabase Auth" in the Pre-deploy To-Do.
   - Leave the SMTP, GitHub secrets and pause-handling items open.

   I won't commit unless you ask.

## Phase 2 — GitHub + CI auto-deploy (only after Phase 1's checks pass)

9. **[me] Pre-publish check for the public repo.** Already done: `.env`, `.dev.vars`, `.wrangler/` and `dist/` are gitignored, and none of them has ever been committed. Before pushing, I re-run `git ls-files` and a quick grep for key-like strings.
10. **[me] Create the public repo and push.** Run `gh repo create malpiszon/meal-orchestrator-web --public --source . --remote origin --push`. The default branch will be `master`, which matches `ci.yml`.
11. **[user] Create a Cloudflare API token** in the dashboard with only _Account → Workers Scripts: Edit_ on this account. KV isn't needed because of `session: false`.
12. **Repository secrets.** You set the secret values yourself so they don't show up in the transcript:
    - **[me]** `gh secret set CLOUDFLARE_ACCOUNT_ID`. The account ID isn't sensitive; I take it from `wrangler whoami`.
    - **[user]** `! gh secret set CLOUDFLARE_API_TOKEN`, `! gh secret set SUPABASE_URL` and `! gh secret set SUPABASE_KEY`. Each one prompts for the value. These are the production values, which the `ci` job's build step reads.
13. **[me] Add a `deploy` job to `.github/workflows/ci.yml`** and commit it on `master`, since there's no branch protection yet:
    ```yaml
    deploy:
      needs: [ci, smoke]
      if: github.event_name == 'push' && github.ref == 'refs/heads/master'
      runs-on: ubuntu-latest
      concurrency: { group: deploy-production, cancel-in-progress: false }
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: 22, cache: npm }
        - run: npm ci
        - run: npm run build
        - run: npx wrangler deploy
          env:
            CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
            CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        - name: Post-deploy smoke
          run: |
            curl -sf -o /dev/null https://mo-web.<subdomain>.workers.dev/auth/signin
            test "$(curl -s -o /dev/null -w '%{http_code}' https://mo-web.<subdomain>.workers.dev/dashboard)" = 302
    ```
    - It uses the project-pinned wrangler through `npx`, not `wrangler-action`, so CI deploys with the same version as local.
    - It has no `wrangler pages` step.
    - Runtime secrets stay in Workers Secrets, set in step 5. CI never pushes them.
    - The post-deploy curl checks cover the "secrets missing but deploy succeeds" risk from the infra doc.
14. **[me] Verify the pipeline.** I push the ci.yml commit and follow it with `gh run watch`, which should show ci, smoke and deploy all green. Then `npx wrangler deployments list` should list a new version whose source is the CI token.
15. **[me] Docs.** In `infrastructure.md`, tick "Add GitHub repository secrets". I also note in the Operational Story that the deploy job exists. Preview deploys through `versions upload` stay out of scope.

## Rollback

Run `npx wrangler deployments list`, then `npx wrangler rollback <id>`. There's no previous version yet, so for the first deploy the fallback is to fix the problem and redeploy.

## Critical files

- `wrangler.jsonc`: stays unchanged.
- `astro.config.mjs`: stays unchanged. The env vars are still `optional: true`. That risk is noted in the infra doc; the curl checks in step 7 and the secret list in step 5 cover it for this deploy.
- `.github/workflows/ci.yml`: add the `deploy` job (Phase 2).
- `context/foundation/infrastructure.md`: status updates only.

## Outcome (2026-09-24)

All phases done. Production: `https://mo-web.malpiszon.workers.dev`. Repo: `malpiszon/meal-orchestrator-web` (public). Current state is tracked in `context/foundation/infrastructure.md`. How the actual run differed from the plan:

- **workers.dev subdomain.** The account had no subdomain, and wrangler's automatic `mo-web` registration failed because the name is taken. An auto-generated `summer-king-c16b` subdomain was used for the first deploy (version `0804df57-6abd-4549-9cfb-1e21730cfa29`), then the account subdomain was renamed to `malpiszon`. Supabase Auth URLs use `malpiszon`.
- **Worker secrets.** `SUPABASE_URL` was set from the project URL. The first `SUPABASE_KEY` attempt created a secret named after the key value; it was deleted and re-created as `SUPABASE_KEY` (publishable key). Verified with a bad-credentials sign-in returning `Invalid login credentials`.
- **GitHub.** `gh` uses a fine-grained token that can't create repos, so the repo was created in the web UI. The token was given Contents, Secrets and Workflows read/write plus Actions read on this repo; git pushes use it through `gh auth git-credential`.
- **Cloudflare CI token.** Account-scoped custom token with _Workers Scripts Write/Read_ and _Workers CI Write/Read_ (the older _Workers Scripts: Edit_ is labelled legacy).
- **Deploy job.** Added as planned, plus a post-deploy bad-credentials sign-in probe, which catches missing Worker secrets that a 302 check can't. First CI deploy: version `dfc49e6b-8327-47c6-b2b9-b45d637c0acf`.
- **Added beyond the plan:**
  - Resend SMTP in Supabase: sender `meal-orchestrator@notify.malpiszon.net`, rate limit 30/hour, verified with a sign-up to a non-team address; the test user was deleted.
  - Self sign-up disabled in production to match the PRD's invite-only rule.
  - An idle-availability NFR added to the PRD.
  - The custom domain recorded as an MVP non-goal.
  - CI actions bumped to Node 24 majors (`checkout`/`setup-node` v7, `supabase/setup-cli` v3 using the lockfile CLI version).
  - `site` set in `astro.config.mjs` so the sitemap is generated.
- **Left open:**
  - how to handle Supabase free-tier pausing
  - an `/auth/callback` route (PKCE code exchange) for FR-003/FR-005
  - removing `/auth/signup` when FR-003 is built
