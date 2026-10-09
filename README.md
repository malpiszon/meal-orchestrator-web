# mo-web

The web companion to Meal Orchestrator (MO). MO emails each user a weekly meal recommendation; it also delivers that week to mo-web, where the user sees it next to how recently each meal was in their plan, swaps meals within the week's menu until the week starts, rates meals they had, and browses past weeks.

Accounts exist only by invitation: MO's first delivery for an email creates the account and emails an invitation to set a password.

## Tech stack

- [Astro](https://astro.build/) v7 (server output) with [React](https://react.dev/) v19 islands
- [TypeScript](https://www.typescriptlang.org/) v6, [Tailwind CSS](https://tailwindcss.com/) v4, [shadcn/ui](https://ui.shadcn.com/)
- [Supabase](https://supabase.com/): auth, Postgres (row-level security, plan logic in SQL functions)
- [Cloudflare Workers](https://workers.cloudflare.com/): hosting and the daily keep-alive Cron Trigger

## Getting started

Requires Node.js v22.23.3 (`.nvmrc`), and [Docker](https://www.docker.com/) with about 7 GB RAM for local Supabase.

```bash
npm install
cp .env.example .env
npx supabase start          # first run downloads the images; applies supabase/migrations
npx supabase status -o env  # prints the values for .env
```

Fill in `.env`, then copy it to `.dev.vars` (Cloudflare local dev reads secrets from there; both files are gitignored):

| Variable                    | Local value                                    | Needed for                                  |
| --------------------------- | ---------------------------------------------- | ------------------------------------------- |
| `SUPABASE_URL`              | `API_URL` (`http://127.0.0.1:54321`)           | Everything                                  |
| `SUPABASE_KEY`              | `ANON_KEY`                                     | Everything                                  |
| `SUPABASE_SERVICE_ROLE_KEY` | `SERVICE_ROLE_KEY` (server-only, bypasses RLS) | MO deliveries, the email-link check on open |
| `MO_INGEST_TOKEN`           | Any random string, e.g. `openssl rand -hex 32` | MO deliveries (the bearer token MO sends)   |

All four are server-only secrets declared through Astro's `astro:env`; none reach the client.

```bash
cp .env .dev.vars
npm run dev                 # http://localhost:4321
```

Local Supabase also serves Studio at `http://localhost:54323` and Mailpit (where local auth emails land) at `http://127.0.0.1:54324`. Stop it with `npx supabase stop`. There is no sign-up page: to sign in locally, follow the [dev walkthrough](docs/dev-walkthrough.md), which delivers a week for your email and gives the account a password.

After `npx supabase link`, the local stack runs the linked project's service versions, so locally, as in production, PostgREST is currently v14.5.

## Scripts

| Command                | Does                                                                     |
| ---------------------- | ------------------------------------------------------------------------ |
| `npm run dev`          | Dev server on the Cloudflare workerd runtime                             |
| `npm run build`        | Production build                                                         |
| `npm run preview`      | Serve the production build on the Cloudflare runtime                     |
| `npm test`             | Unit tests (Vitest)                                                      |
| `npx supabase test db` | Database tests (pgTAP, `supabase/tests/`), against local Supabase        |
| `npm run smoke`        | HTTP smoke test against a running server, see [testing](docs/testing.md) |
| `npm run lint`         | ESLint with type-checked rules (`lint:fix` to fix)                       |
| `npm run format`       | Prettier                                                                 |

A pre-commit hook (husky + lint-staged) runs `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}`.

## Project structure

```text
.
├── src/
│   ├── pages/            # Astro pages; api/ holds the JSON and form routes
│   ├── components/       # Astro and React components; ui/ is shadcn, hooks/ React hooks
│   ├── lib/              # Domain logic and helpers (unit-tested); services/ talk to Supabase
│   ├── layouts/
│   ├── styles/global.css # Design tokens
│   ├── middleware.ts     # Session lookup and PROTECTED_ROUTES
│   └── worker.ts         # Worker entry: Astro handler plus the scheduled keep-alive
├── supabase/
│   ├── migrations/       # Schema, RLS and the plan logic as Postgres functions
│   ├── tests/            # pgTAP
│   ├── templates/        # Invitation and password-reset emails
│   └── config.toml       # Local Supabase config
├── scripts/              # smoke.mjs and its MO delivery sample
├── docs/                 # Reference docs, below
├── context/              # Product docs: PRD, roadmap, per-change plans and their archive
└── wrangler.jsonc        # Worker config, Cron Trigger
```

## Documentation

- [Pages and API](docs/api.md): what each page shows and each route does, and the rules behind them (cut-off, re-delivery, recency notes, ratings, email links).
- [MO delivery contract](docs/mo-delivery-contract.md): the payload, responses and retry policy, for the MO side.
- [Deployment](docs/deployment.md): secrets, the order of migrations and deploys, Supabase dashboard settings, keep-alive, known risks.
- [Testing](docs/testing.md): unit, database and smoke tests, and CI.
- [Dev walkthrough](docs/dev-walkthrough.md): local steps from a first delivery to swaps, history and ratings.

## Deployment

Production is `https://mo-web.malpiszon.workers.dev`. Every merge to `master` deploys it: CI runs lint, tests, the smoke test and `npx wrangler deploy`. Migrations and Supabase dashboard settings a change needs are applied **after its CI is green and before merging**; see [deployment](docs/deployment.md).

## License

MIT
