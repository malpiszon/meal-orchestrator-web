import * as Sentry from "@sentry/astro";
import { SENTRY_DATA_COLLECTION, scrubBreadcrumb, scrubEvent } from "./src/lib/sentry-privacy";

// The DSN exists only in the production deploy's build; everywhere else the SDK stays off.
const dsn = import.meta.env.PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: "production",
  dataCollection: SENTRY_DATA_COLLECTION,
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
});
