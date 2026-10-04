import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isJwtIssuedAtFuture, withPgrst303Retry } from "@/lib/postgrest-retry";

interface Result {
  data: string | null;
  error: { code?: string; message: string } | null;
}

const ok: Result = { data: "rows", error: null };
const issuedAtFuture: Result = { data: null, error: { code: "PGRST303", message: "JWT issued at future" } };

/** A `run` stub that returns `results` in order, one per call, each as a new promise. */
function scripted(...results: Result[]) {
  let call = 0;
  return vi.fn(() => Promise.resolve(results[Math.min(call++, results.length - 1)]));
}

/** Starts `withPgrst303Retry` and records when it settles, so tests can check the waits. */
function start(run: () => PromiseLike<Result>) {
  const outcome: { settled: boolean; value?: Result } = { settled: false };
  void withPgrst303Retry("test query", run).then((value) => {
    outcome.settled = true;
    outcome.value = value;
  });
  return outcome;
}

describe("isJwtIssuedAtFuture", () => {
  it("matches PGRST303 with an 'issued at future' message, in any case", () => {
    expect(isJwtIssuedAtFuture({ code: "PGRST303", message: "JWT issued at future" })).toBe(true);
    expect(isJwtIssuedAtFuture({ code: "PGRST303", message: "jwt ISSUED AT FUTURE" })).toBe(true);
  });

  it("rejects other PGRST303 claim errors and other codes", () => {
    expect(isJwtIssuedAtFuture({ code: "PGRST303", message: "JWT expired" })).toBe(false);
    expect(isJwtIssuedAtFuture({ code: "PGRST301", message: "JWT issued at future" })).toBe(false);
    expect(isJwtIssuedAtFuture({ message: "JWT issued at future" })).toBe(false);
  });
});

describe("withPgrst303Retry", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns a success on the first try without waiting or warning", async () => {
    const run = scripted(ok);
    const outcome = start(run);

    await vi.advanceTimersByTimeAsync(0);
    expect(outcome.settled).toBe(true);
    expect(outcome.value).toBe(ok);
    expect(run).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("retries once after 500 ms on PGRST303 'JWT issued at future', then returns the success", async () => {
    const run = scripted(issuedAtFuture, ok);
    const outcome = start(run);

    await vi.advanceTimersByTimeAsync(499);
    expect(outcome.settled).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("test query: PGRST303 JWT issued at future, retry 1/2 in 500 ms");

    await vi.advanceTimersByTimeAsync(1);
    expect(outcome.settled).toBe(true);
    expect(outcome.value).toBe(ok);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("retries twice (500 ms, then 1500 ms) and returns the success of the third try", async () => {
    const run = scripted(issuedAtFuture, issuedAtFuture, ok);
    const outcome = start(run);

    await vi.advanceTimersByTimeAsync(500);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1499);
    expect(outcome.settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(outcome.settled).toBe(true);
    expect(outcome.value).toBe(ok);
    expect(run).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenNthCalledWith(2, "test query: PGRST303 JWT issued at future, retry 2/2 in 1500 ms");
  });

  it("gives up after two retries and returns the last error result unchanged", async () => {
    const last: Result = { data: null, error: { code: "PGRST303", message: "JWT issued at future" } };
    const run = scripted(issuedAtFuture, issuedAtFuture, last);
    const outcome = start(run);

    await vi.advanceTimersByTimeAsync(2000);
    expect(outcome.settled).toBe(true);
    expect(outcome.value).toBe(last);
    expect(run).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it.each<[string, Result["error"]]>([
    ["another PGRST303 claim error", { code: "PGRST303", message: "JWT expired" }],
    ["PGRST301", { code: "PGRST301", message: "JWT expired" }],
    ["P0002 not_found", { code: "P0002", message: "not_found" }],
  ])("returns %s at once, without retrying", async (_name, error) => {
    const result: Result = { data: null, error };
    const run = scripted(result, ok);
    const outcome = start(run);

    await vi.advanceTimersByTimeAsync(0);
    expect(outcome.settled).toBe(true);
    expect(outcome.value).toBe(result);
    expect(run).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("builds a new request for every attempt", async () => {
    // Like a PostgREST builder, each request can be awaited only once.
    const requests: { awaited: number }[] = [];
    const results = [issuedAtFuture, issuedAtFuture, ok];
    const run = () => {
      const request = { awaited: 0 };
      requests.push(request);
      const result = results[requests.length - 1];
      return {
        then<T1 = Result, T2 = never>(
          onFulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
          onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
        ): PromiseLike<T1 | T2> {
          request.awaited += 1;
          return Promise.resolve(result).then(onFulfilled, onRejected);
        },
      };
    };
    const outcome = start(run);

    await vi.advanceTimersByTimeAsync(2000);
    expect(outcome.value).toBe(ok);
    expect(requests).toEqual([{ awaited: 1 }, { awaited: 1 }, { awaited: 1 }]);
  });
});
