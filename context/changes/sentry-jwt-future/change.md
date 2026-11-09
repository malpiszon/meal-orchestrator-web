---
change_id: sentry-jwt-future
title: Retry PGRST303 "JWT issued at future" on MO delivery instead of reporting a key fault
status: implementing
created: 2026-11-09
updated: 2026-11-09
archived_at: null
---

## Notes

There is an issue related to JWT token that happens every week on MO delivery. More details in Sentry:

> MO-WEB-8 has regressed in release 78c2ad7d4c84.
> Error — handleMoDelivery: ingest_weekly_plan rejected the key: 401 PGRST303 JWT issued at future

- GitHub: #203
- Sentry: https://malpiszon.sentry.io/issues/MO-WEB-8 (2026-10-28, 2026-11-03; step `mo_delivery.config`)
