import type { CloudflareOptions } from "@sentry/cloudflare";
import { SENTRY_DATA_COLLECTION, scrubBreadcrumb, scrubEvent } from "@/lib/sentry-privacy";

export interface SentryEnv {
  PUBLIC_SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  SENTRY_RELEASE?: string;
}

// Only the production deploy has a DSN; everywhere else the SDK must stay silent.
export function sentryOptions(env: SentryEnv): CloudflareOptions {
  if (!env.PUBLIC_SENTRY_DSN) {
    // `enabled: false` keeps the SDK silent even if a `SENTRY_DSN` var appears, which the SDK reads by itself.
    return { enabled: false };
  }

  return {
    dsn: env.PUBLIC_SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT?.length ? env.SENTRY_ENVIRONMENT : "production",
    ...(env.SENTRY_RELEASE ? { release: env.SENTRY_RELEASE } : {}),
    dataCollection: SENTRY_DATA_COLLECTION,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}
