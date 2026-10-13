import { handle } from "@astrojs/cloudflare/handler";
import * as Sentry from "@sentry/cloudflare";
import { pingSupabase } from "@/lib/keepalive";
import { reportRunToMonitor } from "@/lib/keepalive-monitor";
import { type SentryEnv, sentryOptions } from "@/lib/sentry";

const KEEPALIVE_FLUSH_TIMEOUT_MS = 10_000;

interface KeepaliveEnv extends SentryEnv {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
}

interface MinimalExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface MinimalScheduledController {
  cron: string;
}

async function scheduled(
  controller: MinimalScheduledController,
  env: KeepaliveEnv,
  ctx: MinimalExecutionContext,
): Promise<void> {
  // The monitor follows the trigger's own cron, so a schedule change in wrangler.jsonc can't leave it stale.
  const promise = reportRunToMonitor(
    Sentry.captureCheckIn,
    "supabase-keepalive",
    { schedule: { type: "crontab", value: controller.cron }, timezone: "UTC", checkinMargin: 5 },
    () =>
      pingSupabase(env.SUPABASE_URL, env.SUPABASE_KEY).then(
        () => {
          console.log(`keepalive ok (${controller.cron})`);
        },
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`keepalive failed: ${message} (${controller.cron})`);
          throw error;
        },
      ),
  );

  ctx.waitUntil(promise);
  try {
    await promise;
  } finally {
    // The transport sends only when flushed, and the SDK's own flush after the handler gives up after 2 s.
    await Sentry.flush(KEEPALIVE_FLUSH_TIMEOUT_MS);
  }
}

export default Sentry.withSentry((env: KeepaliveEnv) => sentryOptions(env), { fetch: handle, scheduled });
