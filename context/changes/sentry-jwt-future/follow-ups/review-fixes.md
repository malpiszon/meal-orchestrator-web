# Review fixes (from reviews/impl-review-phase-1.md)

- [ ] **F1 → Phase 2**: in `docs/deployment.md` known risks, note that a delivery hitting PGRST303 "issued at future" can wait up to ~2 s per `ingest_weekly_plan` call (~4 s when provisioning a new user and both rounds retry), plus the GoTrue invite, against MO's 10 s client timeout; a timeout is safe (MO retries, re-send is a no-op).
- [ ] **F4 → separate change (not this PR)**: Astro now requires Node `>=22.23.4`; bump `.nvmrc` and the README's Node version from 22.23.3, and install that Node version locally. Until then `npm run build`, `astro check` and the end-of-turn hook fail locally on 22.23.3 (CI uses the latest Node 22).
