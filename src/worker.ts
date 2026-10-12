import { handle } from "@astrojs/cloudflare/handler";
import * as Sentry from "@sentry/cloudflare";
import { pingSupabase } from "@/lib/keepalive";
import { type SentryEnv, sentryOptions } from "@/lib/sentry";

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
  const promise = Sentry.withMonitor(
    "supabase-keepalive",
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
    {
      schedule: { type: "crontab", value: controller.cron },
      timezone: "UTC",
      checkinMargin: 5,
      maxRuntime: 5,
    },
  );

  ctx.waitUntil(promise);
  await promise;
}

export default Sentry.withSentry((env: KeepaliveEnv) => sentryOptions(env), { fetch: handle, scheduled });
