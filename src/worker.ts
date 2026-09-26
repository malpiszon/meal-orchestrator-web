import { handle } from "@astrojs/cloudflare/handler";
import { pingSupabase } from "@/lib/keepalive";

interface KeepaliveEnv {
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
  const promise = pingSupabase(env.SUPABASE_URL, env.SUPABASE_KEY).then(
    () => {
      console.log(`keepalive ok (${controller.cron})`);
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`keepalive failed: ${message} (${controller.cron})`);
      throw error;
    },
  );

  ctx.waitUntil(promise);
  await promise;
}

export default { fetch: handle, scheduled };
