import { captureException } from "@sentry/cloudflare";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { reportHandledError } from "@/lib/report-handled-error";

vi.mock("@sentry/cloudflare", () => ({ captureException: vi.fn() }));

// A PostgrestError-like error: an Error with the PostgREST fields.
function postgrestError(fields: { code: string; message: string; hint?: string; details?: string }): Error {
  return Object.assign(new Error(fields.message), fields);
}

describe("reportHandledError", () => {
  let error: MockInstance<typeof console.error>;
  let warn: MockInstance<typeof console.warn>;

  beforeEach(() => {
    error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.mocked(captureException).mockReset();
    vi.restoreAllMocks();
  });

  function capturedTags(): Record<string, string> {
    const context = vi.mocked(captureException).mock.calls[0]?.[1] as { tags: Record<string, string> };
    return context.tags;
  }

  it("takes the code from the error itself", () => {
    reportHandledError("load", postgrestError({ code: "42P01", message: "relation missing" }));

    expect(capturedTags().error_code).toBe("42P01");
  });

  it("takes the code from a nested cause", () => {
    const original = postgrestError({ code: "57014", message: "statement timeout" });
    const wrapped = new Error("outer", { cause: new Error("middle", { cause: original }) });

    reportHandledError("load", wrapped);

    expect(capturedTags().error_code).toBe("57014");
    expect(error).toHaveBeenCalledWith("load failed: 57014 outer", wrapped.stack);
  });

  it("falls back to the HTTP status when no code is set", () => {
    reportHandledError("signin", Object.assign(new Error("Bad Gateway"), { status: 502 }));

    expect(capturedTags().error_code).toBe("http_502");
  });

  it("skips the empty code of a network failure", () => {
    // postgrest-js keeps the status (0) on the response, not on the error.
    const original = postgrestError({ code: "", message: "TypeError: fetch failed" });

    reportHandledError("load", new Error("weekly_plans query failed:  fetch failed", { cause: original }));

    expect(capturedTags().error_code).toBe("unknown");
  });

  it("stops at a cause that points back into the chain", () => {
    const outer = new Error("outer");
    const inner = Object.assign(new Error("inner", { cause: outer }), { code: "57014" });
    outer.cause = inner;

    reportHandledError("load", outer);

    expect(capturedTags().error_code).toBe("57014");
  });

  it("ignores a code that isn't a string", () => {
    reportHandledError("load", Object.assign(new Error("boom"), { code: 500, status: 503 }));

    expect(capturedTags().error_code).toBe("http_503");
  });

  it("prefers options.code over the error's own code", () => {
    reportHandledError("load", postgrestError({ code: "42P01", message: "relation missing" }), { code: "custom" });

    expect(capturedTags().error_code).toBe("custom");
  });

  it("falls back to unknown", () => {
    reportHandledError("load", new Error("plain"));

    expect(capturedTags().error_code).toBe("unknown");
  });

  it("logs with console.error and reports level error by default", () => {
    const failure = new Error("boom");

    reportHandledError("load", failure);

    expect(error).toHaveBeenCalledWith("load failed: unknown boom", failure.stack);
    expect(warn).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledWith(failure, expect.objectContaining({ level: "error" }));
  });

  it("logs with console.warn and reports level warning when asked", () => {
    const failure = new Error("boom");

    reportHandledError("load", failure, { level: "warning" });

    expect(warn).toHaveBeenCalledWith("load failed: unknown boom", failure.stack);
    expect(error).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledWith(failure, expect.objectContaining({ level: "warning" }));
  });

  it("groups by step and code, and tags them", () => {
    const failure = postgrestError({ code: "42P01", message: "relation missing" });

    reportHandledError("load", failure);

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(failure, {
      level: "error",
      fingerprint: ["handled", "load", "42P01"],
      tags: { step: "load", error_code: "42P01" },
    });
  });

  it("masks an email in the hint tag", () => {
    reportHandledError(
      "load",
      postgrestError({ code: "23505", message: "duplicate", hint: "Key (email)=(jan@example.com) exists" }),
    );

    expect(capturedTags().error_hint).toBe("Key (email)=([email]) exists");
  });

  it("cuts an over-long hint to 200 characters", () => {
    reportHandledError("load", postgrestError({ code: "XX000", message: "boom", hint: "h".repeat(300) }));

    expect(capturedTags().error_hint).toBe("h".repeat(200));
  });

  it("never reads details", () => {
    const failure = postgrestError({
      code: "23505",
      message: "duplicate",
      details: "Key (email)=(secret-details@example.com) already exists",
    });

    reportHandledError("load", new Error("wrapped", { cause: failure }));

    const captured = JSON.stringify(vi.mocked(captureException).mock.calls[0]?.[1]);
    const logged = JSON.stringify(error.mock.calls);
    expect(captured).not.toContain("secret-details");
    expect(logged).not.toContain("secret-details");
  });

  it("wraps a plain-object error, so Sentry never serialises its details", () => {
    // postgrest-js returns a database fault as a plain object, not an Error.
    const failure = {
      code: "23505",
      message: "duplicate key",
      details: "Key (email)=(secret-details@example.com) already exists",
    };

    reportHandledError("load", failure);

    const reported = vi.mocked(captureException).mock.calls[0]?.[0];
    expect(reported).toBeInstanceOf(Error);
    expect((reported as Error).message).toBe("load failed: 23505 duplicate key");
    expect((reported as Error).cause).toBe(failure);
    // Sentry sends an Error's message and own fields; the plain object stays only in `cause`, which it doesn't send.
    expect(Object.keys(reported as Error)).toEqual([]);
    expect(error).toHaveBeenCalledWith("load failed: 23505 duplicate key", undefined);
  });
});
