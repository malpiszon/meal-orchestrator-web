import { reportHandledError } from "@/lib/report-handled-error";

// Module-level, so it lasts for the Worker isolate: one event per secret, not one per request.
const reported = new Set<string>();

/**
 * Reports each secret in `names` the first time this isolate finds it missing, as `supabase.config`
 * with code `missing_<NAME>`. Only the variable name is sent, never a value.
 */
export function reportMissingSecrets(names: readonly string[]): void {
  for (const name of names) {
    if (reported.has(name)) continue;
    reported.add(name);
    reportHandledError("supabase.config", new Error(`Secret not configured: ${name}`), {
      code: `missing_${name}`,
    });
  }
}

/** Tests only: forgets which secrets were reported. */
export function resetReportedSecrets(): void {
  reported.clear();
}
