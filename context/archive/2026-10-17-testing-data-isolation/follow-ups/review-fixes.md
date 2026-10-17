# Review fixes queued for later phases

From `reviews/impl-review-phase-1.md`.

- **Phase 2 (F2):** `second_user_isolation.test.sql` covers every allowlist row of `exposed_surface.test.sql`, or comments why a row needs no case. The plan's list of comment-only rows (`keepalive`, `adjusted_score`) gains two:
  - **`graphql_public.graphql(text, text, jsonb, jsonb)`:** the Supabase stub when pg_graphql isn't installed. It returns only an error and reads no data.
  - **The MAINTAIN grant on the three tables:** VACUUM, ANALYZE, REINDEX and LOCK can't be issued through PostgREST, the same as REFERENCES and TRIGGER.
- **Phase 4 (F3):** test-plan §6.3 says that a schema added to `supabase/config.toml` `[api] schemas` (or exposed in the hosted dashboard) must be added to the `nspname` lists in `exposed_surface.test.sql`.
- **Phase 4 (F1):** the §6.3 bullet on grants mentions the pinned MAINTAIN grant (a Supabase default) and that a later revoke migration removes it from the allowlist.
