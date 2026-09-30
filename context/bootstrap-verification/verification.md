---
bootstrapped_at: 2026-09-23T20:12:30Z
starter_id: 10x-astro-starter
starter_name: 10x Astro Starter (Astro + Supabase + Cloudflare)
project_name: meal-orchestrator-web
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: npm audit --json
---

## Hand-off

**Frontmatter:**
- starter_id: 10x-astro-starter
- package_manager: npm
- project_name: meal-orchestrator-web
- language_family: js
- team_size: solo
- deployment_target: cloudflare-pages
- ci_provider: github-actions
- ci_default_flow: auto-deploy-on-merge
- bootstrapper_confidence: first-class
- path_taken: standard
- quality_override: false
- has_auth: true
- has_payments: false
- has_realtime: false
- has_ai: false
- has_background_jobs: false

**Why this stack:**

mo-web is a small web app for a few personally-known users, built after hours on a 3-week MVP timeline, so it needs a starter that is agent-friendly and batteries-included rather than one assembled by hand. The 10x Astro Starter is the recommended default for a TypeScript web app and passes all four agent-friendly gates. It also covers the PRD's needs directly: Supabase provides Postgres and email/password auth, including the invite-only onboarding (FR-003) and emailed password reset (FR-005); Astro API routes can host the JSON endpoint MO calls (FR-001, FR-017); and TypeScript with Zod gives that submission an explicit schema. Auth is the only feature flag set, because AI is a PRD non-goal and plan states follow from dates rather than scheduled jobs, so the edge runtime's limit on long-running tasks does not apply. Supabase row-level security must be configured early to meet the per-user data-isolation requirement. Deployment uses the starter's default, Cloudflare Pages, with GitHub Actions deploying automatically on merge to main.

## Pre-scaffold verification

| Signal      | Value                            | Severity | Notes                         |
| ----------- | -------------------------------- | -------- | ----------------------------- |
| GitHub repo | 10x-astro-starter last pushed 2026-09-12 | fresh    | from card.docs_url, 11 days ago |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`

**Strategy**: git-clone

**Exit code**: 0

**Files moved**: 15

**Conflicts (.scaffold siblings)**: AGENTS.md.scaffold, CLAUDE.md.scaffold

**.gitignore handling**: moved silently

**.bootstrap-scaffold cleanup**: deleted

## Post-scaffold audit

**Tool**: npm audit --json

**Summary**: 0 CRITICAL, 0 HIGH, 0 MODERATE, 0 LOW

**Direct vs transitive**: 0/0/0/0 direct of total 0/0/0/0

No vulnerabilities detected.

## Hints recorded but not acted on

| Hint                       | Value                                  |
| -------------------------- | -------------------------------------- |
| bootstrapper_confidence    | first-class                            |
| quality_override           | false                                  |
| path_taken                 | standard                               |
| self_check_answers         | null                                   |
| team_size                  | solo                                   |
| deployment_target          | cloudflare-pages                       |
| ci_provider                | github-actions                         |
| ci_default_flow            | auto-deploy-on-merge                   |
| has_auth                   | true                                   |
| has_payments               | false                                  |
| has_realtime               | false                                  |
| has_ai                     | false                                  |
| has_background_jobs        | false                                  |

These hints are carried forward for a future skill to act on. v1 records them without modification.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review any `.scaffold` siblings the conflict policy created and decide which version of each file to keep:
  - `CLAUDE.md` vs `CLAUDE.md.scaffold` — the project instructions file
  - `AGENTS.md.scaffold` — the starter's symlink to CLAUDE.md
- Address audit findings per your project's risk tolerance — none were found in this run.
- Review the starter's `README.md` and configuration files (Astro, Tailwind, TypeScript, etc.) to familiarize yourself with the stack.
