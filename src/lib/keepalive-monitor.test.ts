import { describe, expect, it, vi } from "vitest";
import { reportRunToMonitor } from "@/lib/keepalive-monitor";

const CONFIG = { schedule: { type: "crontab", value: "0 3 * * *" }, timezone: "UTC" } as const;

describe("reportRunToMonitor", () => {
  it("sends exactly one ok check-in, and no in-progress one, after a successful run", async () => {
    const captureCheckIn = vi.fn();

    await expect(reportRunToMonitor(captureCheckIn, "job", CONFIG, () => Promise.resolve("done"))).resolves.toBe(
      "done",
    );

    expect(captureCheckIn).toHaveBeenCalledTimes(1);
    expect(captureCheckIn).toHaveBeenCalledWith({ monitorSlug: "job", status: "ok" }, CONFIG);
  });

  it("sends one error check-in and rethrows when the run fails", async () => {
    const captureCheckIn = vi.fn();
    const failure = new Error("pingSupabase: boom");

    await expect(reportRunToMonitor(captureCheckIn, "job", CONFIG, () => Promise.reject(failure))).rejects.toBe(
      failure,
    );

    expect(captureCheckIn).toHaveBeenCalledTimes(1);
    expect(captureCheckIn).toHaveBeenCalledWith({ monitorSlug: "job", status: "error" }, CONFIG);
  });

  it("sends nothing until the run has finished", async () => {
    const captureCheckIn = vi.fn();
    let finish!: () => void;
    const running = reportRunToMonitor(
      captureCheckIn,
      "job",
      CONFIG,
      () => new Promise<void>((resolve) => (finish = resolve)),
    );

    await Promise.resolve();
    expect(captureCheckIn).not.toHaveBeenCalled();

    finish();
    await running;
    expect(captureCheckIn).toHaveBeenCalledTimes(1);
  });
});
