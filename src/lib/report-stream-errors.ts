import { captureException, getIsolationScope, withIsolationScope, withScope, type Scope } from "@sentry/cloudflare";
import { messageOf } from "@/lib/report-handled-error";
import { maskEmails } from "@/lib/sentry-privacy";

const STEP = "render.stream";

function reportStreamError(error: unknown, isolationScope: Scope): void {
  const message = error instanceof Error ? error.message : messageOf(error);
  const stack = error instanceof Error ? error.stack : undefined;

  // A render error can quote the email; `scrubEvent` masks the event, this masks the log line.
  console.error(`${STEP} failed: ${maskEmails(message)}`, stack === undefined ? undefined : maskEmails(stack));

  // Sentry serialises a non-Error input whole into `extra`, which `scrubEvent` doesn't touch.
  const reported = error instanceof Error ? error : new Error(`${STEP} failed: ${message}`, { cause: error });

  // Unhandled, like the middleware's own capture: the client only gets a cut-off page. The hint takes
  // either a mechanism or tags, not both, so the tag goes on a scope. Sentry has flushed the request
  // by now (an HTML response isn't a stream to it); it keeps a late event's send alive through the
  // request's `waitUntil` only when the request's isolation scope is current, so pin it.
  withIsolationScope(isolationScope, () => {
    withScope((scope) => {
      scope.setTag("step", STEP);
      captureException(reported, { mechanism: { handled: false, type: "auto.middleware.astro.stream" } });
    });
  });
}

/**
 * Astro streams a page body after `next()` has returned, so a throw in a component or island SSR
 * only errors the stream, with no log. This passes the body through unchanged, reports a read
 * failure once, then errors the returned stream with the same error. Status, statusText and headers
 * are kept (the adapter applies cookies to the outgoing response); a cancel reaches the source, so
 * a client disconnect still stops the render. A response without a body is returned as is. Call it
 * inside the request, so the report runs in the request's Sentry isolation scope.
 */
export function captureStreamErrors(response: Response): Response {
  if (response.body === null) return response;

  const isolationScope = getIsolationScope();
  const reader = response.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        reportStreamError(error, isolationScope);
        controller.error(error);
        return;
      }
      if (chunk.done) {
        controller.close();
      } else {
        controller.enqueue(chunk.value);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
}
