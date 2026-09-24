---
starter_id: 10x-astro-starter
package_manager: npm
project_name: meal-orchestrator-web
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-workers
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  default_branch: master
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
---

## Why this stack

mo-web is a small web app for a few personally-known users, built after hours on a 3-week MVP timeline, so it needs a starter that is agent-friendly and batteries-included rather than one assembled by hand. The 10x Astro Starter is the recommended default for a TypeScript web app and passes all four agent-friendly gates. It also covers the PRD's needs directly: Supabase provides Postgres and email/password auth, including the invite-only onboarding (FR-003) and emailed password reset (FR-005); Astro API routes can host the JSON endpoint MO calls (FR-001, FR-017); and TypeScript with Zod gives that submission an explicit schema. Auth is the only feature flag set, because AI is a PRD non-goal and plan states follow from dates rather than scheduled jobs, so the edge runtime's limit on long-running tasks does not apply. Supabase row-level security must be configured early to meet the per-user data-isolation requirement. Deployment uses Cloudflare Workers with Static Assets (the pinned `@astrojs/cloudflare` v14 adapter has no Pages build path; see `infrastructure.md`), with GitHub Actions deploying automatically on merge to `master`.
