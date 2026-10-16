import { captureException, getIsolationScope, type Scope } from "@sentry/cloudflare";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { captureStreamErrors } from "@/lib/report-stream-errors";

const setTag = vi.fn();

// `withIsolationScope` records the scope the report ran in, so a test can tell which one was current.
const reportedIn: unknown[] = [];

vi.mock("@sentry/cloudflare", () => ({
  captureException: vi.fn(),
  getIsolationScope: vi.fn(),
  withIsolationScope: (isolationScope: Scope, callback: (scope: Scope) => unknown) => {
    reportedIn.push(isolationScope);
    return callback(isolationScope);
  },
  withScope: (callback: (scope: Scope) => unknown) => callback({ setTag } as unknown as Scope),
}));

const encoder = new TextEncoder();

// A body that sends `chunks`, then fails with `failure` on the next read, like Astro's `controller.error(e)`.
function failingBody(chunks: string[], failure: unknown): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index++]));
      } else {
        controller.error(failure);
      }
    },
  });
}

function cleanBody(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

/** Reads `response`'s body to the end: the decoded chunks, then the error it failed with, if any. */
async function drain(response: Response): Promise<{ chunks: string[]; failure: unknown }> {
  const decoder = new TextDecoder();
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const chunks: string[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return { chunks, failure: undefined };
      chunks.push(decoder.decode(value));
    }
  } catch (failure) {
    return { chunks, failure };
  }
}

describe("captureStreamErrors", () => {
  let error: MockInstance<typeof console.error>;

  beforeEach(() => {
    error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.mocked(captureException).mockReset();
    vi.mocked(getIsolationScope).mockReset();
    setTag.mockReset();
    reportedIn.length = 0;
    vi.restoreAllMocks();
  });

  it("reports an error after some chunks once, and passes the chunks and the error on", async () => {
    const failure = new Error("component threw");

    const { chunks, failure: received } = await drain(
      captureStreamErrors(new Response(failingBody(["<html>", "<body>"], failure))),
    );

    expect(chunks).toEqual(["<html>", "<body>"]);
    expect(received).toBe(failure);
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(failure, {
      mechanism: { handled: false, type: "auto.middleware.astro.stream" },
    });
    expect(setTag).toHaveBeenCalledWith("step", "render.stream");
    expect(error).toHaveBeenCalledWith("render.stream failed: component threw", failure.stack);
  });

  it("reports in the isolation scope current when the body was wrapped, not when it was read", async () => {
    const request = { name: "request" } as unknown as Scope;
    const later = { name: "default" } as unknown as Scope;
    vi.mocked(getIsolationScope).mockReturnValueOnce(request).mockReturnValue(later);

    await drain(captureStreamErrors(new Response(failingBody(["<html>"], new Error("component threw")))));

    expect(reportedIn).toEqual([request]);
  });

  it("delivers a clean stream intact and reports nothing", async () => {
    const { chunks, failure } = await drain(captureStreamErrors(new Response(cleanBody(["a", "b", "c"]))));

    expect(chunks).toEqual(["a", "b", "c"]);
    expect(failure).toBeUndefined();
    expect(captureException).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("returns a response without a body as the same object", () => {
    const response = new Response(null, { status: 302, headers: { location: "/auth/signin" } });

    expect(captureStreamErrors(response)).toBe(response);
  });

  it("keeps status, statusText and headers", () => {
    const headers = new Headers({ "content-type": "text/html", "set-cookie": "sb=1; Path=/" });
    const response = new Response(cleanBody(["x"]), { status: 404, statusText: "Not Found", headers });

    const wrapped = captureStreamErrors(response);

    expect(wrapped).not.toBe(response);
    expect(wrapped.status).toBe(404);
    expect(wrapped.statusText).toBe("Not Found");
    expect(wrapped.headers.get("content-type")).toBe("text/html");
    expect(wrapped.headers.get("set-cookie")).toBe("sb=1; Path=/");
  });

  it("forwards a cancel to the source stream", async () => {
    const cancel = vi.fn();
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(encoder.encode("chunk"));
      },
      cancel,
    });

    const reader = (captureStreamErrors(new Response(source)).body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    await reader.cancel("client gone");

    expect(cancel).toHaveBeenCalledWith("client gone");
    expect(captureException).not.toHaveBeenCalled();
  });

  it("masks an email in the log line and its stack", async () => {
    await drain(captureStreamErrors(new Response(failingBody([], new Error("no plan for jan@example.com")))));

    const logged = error.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
    expect(logged).toContain("render.stream failed: no plan for [email]");
    expect(logged).not.toContain("jan@example.com");
  });

  it("wraps a non-Error rejection in an Error", async () => {
    const failure = { message: "plain object", details: "secret-details" };

    const { failure: received } = await drain(captureStreamErrors(new Response(failingBody(["x"], failure))));

    expect(received).toBe(failure);
    const reported = vi.mocked(captureException).mock.calls[0]?.[0];
    expect(reported).toBeInstanceOf(Error);
    expect((reported as Error).message).toBe("render.stream failed: plain object");
    expect((reported as Error).cause).toBe(failure);
    // Sentry sends an Error's message and own fields; the original stays only in `cause`, which it doesn't send.
    expect(Object.keys(reported as Error)).toEqual([]);
    expect(error).toHaveBeenCalledWith("render.stream failed: plain object", undefined);
  });

  it("wraps a string rejection in an Error", async () => {
    await drain(captureStreamErrors(new Response(failingBody([], "render aborted"))));

    const reported = vi.mocked(captureException).mock.calls[0]?.[0];
    expect(reported).toBeInstanceOf(Error);
    expect((reported as Error).message).toBe("render.stream failed: render aborted");
  });
});
