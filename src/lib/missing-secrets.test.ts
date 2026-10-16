import { captureException } from "@sentry/cloudflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportMissingSecrets, resetReportedSecrets } from "@/lib/missing-secrets";

vi.mock("@sentry/cloudflare", () => ({ captureException: vi.fn() }));

describe("reportMissingSecrets", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    resetReportedSecrets();
    vi.mocked(captureException).mockReset();
    vi.restoreAllMocks();
  });

  it("reports a secret once per isolate", () => {
    reportMissingSecrets(["SUPABASE_URL"]);
    reportMissingSecrets(["SUPABASE_URL"]);

    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("reports a different secret too", () => {
    reportMissingSecrets(["SUPABASE_URL"]);
    reportMissingSecrets(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);

    expect(captureException).toHaveBeenCalledTimes(2);
    expect(vi.mocked(captureException).mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ fingerprint: ["handled", "supabase.config", "missing_SUPABASE_SERVICE_ROLE_KEY"] }),
    );
  });

  it("puts only the name in the message and tags", () => {
    reportMissingSecrets(["SUPABASE_KEY"]);

    const [reported, context] = vi.mocked(captureException).mock.calls[0] ?? [];
    expect((reported as Error).message).toBe("Secret not configured: SUPABASE_KEY");
    expect(context).toEqual({
      level: "error",
      fingerprint: ["handled", "supabase.config", "missing_SUPABASE_KEY"],
      tags: { step: "supabase.config", error_code: "missing_SUPABASE_KEY" },
    });
  });
});
