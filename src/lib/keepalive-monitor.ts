import type { CheckIn, MonitorConfig } from "@sentry/core";

type CaptureCheckIn = (checkIn: CheckIn, monitorConfig: MonitorConfig) => unknown;

// One finished check-in per run, never `withMonitor`'s in-progress + ok pair: the Worker transport queues envelopes and sends
// them all at once when flushed, so the two arrive concurrently and, if "ok" is processed first, the run ends as a timeout
// although it succeeded (seen in production on 2026-10-13). A run that never reports is a missed check-in.
export async function reportRunToMonitor<T>(
  captureCheckIn: CaptureCheckIn,
  monitorSlug: string,
  monitorConfig: MonitorConfig,
  run: () => Promise<T>,
): Promise<T> {
  try {
    const result = await run();
    captureCheckIn({ monitorSlug, status: "ok" }, monitorConfig);
    return result;
  } catch (error) {
    captureCheckIn({ monitorSlug, status: "error" }, monitorConfig);
    throw error;
  }
}
