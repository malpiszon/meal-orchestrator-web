import type { ErrorEvent } from "@sentry/core";
import { describe, expect, it } from "vitest";
import { SENTRY_DATA_COLLECTION, scrubBreadcrumb, scrubEvent } from "@/lib/sentry-privacy";

const CONFIRM_URL = "https://mo-web.example/api/auth/confirm?token_hash=abc123&type=invite#top";

function errorEvent(fields: Omit<ErrorEvent, "type">): ErrorEvent {
  return { type: undefined, ...fields };
}

describe("SENTRY_DATA_COLLECTION", () => {
  it("collects no user, cookies, bodies or query values", () => {
    expect(SENTRY_DATA_COLLECTION).toMatchObject({
      userInfo: false,
      cookies: false,
      httpBodies: [],
      urlQueryParams: false,
    });
  });

  it("allows only harmless request headers and no response headers", () => {
    expect(SENTRY_DATA_COLLECTION.httpHeaders).toEqual({
      request: { allow: ["user-agent", "content-type", "accept"] },
      response: false,
    });
  });
});

describe("scrubEvent", () => {
  it("strips the query and fragment from the request url", () => {
    const scrubbed = scrubEvent(errorEvent({ request: { url: CONFIRM_URL, method: "GET" } }));
    expect(scrubbed.request).toEqual({ url: "https://mo-web.example/api/auth/confirm", method: "GET" });
  });

  it("drops the user, query string, cookies and body", () => {
    const scrubbed = scrubEvent(
      errorEvent({
        user: { id: "u1", email: "anna@example.com", ip_address: "203.0.113.7" },
        request: {
          url: "https://mo-web.example/api/mo/deliveries",
          query_string: "token_hash=abc123",
          cookies: { "sb-access-token": "secret" },
          data: { email: "anna@example.com", meals: [] },
          headers: { "user-agent": "MO/1.0" },
        },
      }),
    );
    expect(scrubbed).not.toHaveProperty("user");
    expect(scrubbed.request).toEqual({
      url: "https://mo-web.example/api/mo/deliveries",
      headers: { "user-agent": "MO/1.0" },
    });
  });

  it("masks emails in the message and exception values", () => {
    const scrubbed = scrubEvent(
      errorEvent({
        message: "delivery failed for anna.k+mo@example.co.uk",
        exception: {
          values: [
            { type: "Error", value: "inviteUserByEmail: user anna@example.com already exists" },
            { type: "Error" },
          ],
        },
      }),
    );
    expect(scrubbed.message).toBe("delivery failed for [email]");
    expect(scrubbed.exception?.values).toEqual([
      { type: "Error", value: "inviteUserByEmail: user [email] already exists" },
      { type: "Error" },
    ]);
  });

  it("strips query and fragment from stack frame filenames", () => {
    const scrubbed = scrubEvent(
      errorEvent({
        exception: {
          values: [
            {
              type: "Error",
              stacktrace: {
                frames: [{ filename: `${CONFIRM_URL}#x`, function: "?" }, { function: "noFilename" }],
              },
            },
          ],
        },
      }),
    );
    const frames = scrubbed.exception?.values?.[0]?.stacktrace?.frames;
    expect(frames?.[0]?.filename).toBe(CONFIRM_URL.split("?")[0]);
    expect(frames?.[1]).toEqual({ function: "noFilename" });
  });

  it("scrubs breadcrumb messages and urls", () => {
    const scrubbed = scrubEvent(
      errorEvent({
        breadcrumbs: [
          { category: "console", message: "keepalive failed for bob@example.com" },
          { category: "fetch", data: { url: CONFIRM_URL, method: "GET" } },
        ],
      }),
    );
    expect(scrubbed.breadcrumbs).toEqual([
      { category: "console", message: "keepalive failed for [email]" },
      { category: "fetch", data: { url: "https://mo-web.example/api/auth/confirm", method: "GET" } },
    ]);
  });

  it("tells Sentry not to infer the sender's IP, keeping the SDK info", () => {
    const scrubbed = scrubEvent(errorEvent({ sdk: { name: "sentry.javascript.cloudflare", version: "11.6.0" } }));
    expect(scrubbed.sdk).toEqual({
      name: "sentry.javascript.cloudflare",
      version: "11.6.0",
      settings: { infer_ip: "never" },
    });
  });

  it("does not mutate the input event", () => {
    const event = errorEvent({ user: { id: "u1" }, request: { url: CONFIRM_URL } });
    scrubEvent(event);
    expect(event).toEqual(errorEvent({ user: { id: "u1" }, request: { url: CONFIRM_URL } }));
  });

  it("passes an event without personal data through unchanged, apart from the IP setting", () => {
    const event = errorEvent({
      message: "boom",
      environment: "production",
      request: { url: "https://mo-web.example/dashboard", method: "GET" },
      exception: { values: [{ type: "TypeError", value: "x is undefined" }] },
      breadcrumbs: [{ category: "navigation", data: { from: "/", to: "/dashboard" } }],
    });
    expect(scrubEvent(event)).toEqual({ ...event, sdk: { settings: { infer_ip: "never" } } });
  });
});

describe("scrubBreadcrumb", () => {
  it("strips the query and fragment from navigation and fetch urls", () => {
    const scrubbed = scrubBreadcrumb({
      category: "navigation",
      data: { from: "/auth/set-password?token_hash=abc123&type=recovery", to: "/dashboard#week", url: CONFIRM_URL },
    });
    expect(scrubbed.data).toEqual({
      from: "/auth/set-password",
      to: "/dashboard",
      url: "https://mo-web.example/api/auth/confirm",
    });
  });

  it("masks emails in the message", () => {
    expect(scrubBreadcrumb({ message: "signin for anna@example.com" }).message).toBe("signin for [email]");
  });

  it("drops the raw console arguments, keeping the masked message", () => {
    const scrubbed = scrubBreadcrumb({
      category: "console",
      message: "mo delivery failed for anna@example.com",
      data: { arguments: ["mo delivery failed for anna@example.com"], logger: "console" },
    });
    expect(scrubbed).toEqual({
      category: "console",
      message: "mo delivery failed for [email]",
      data: { logger: "console" },
    });
  });

  it("drops the query and fragment a fetch breadcrumb keeps beside its url", () => {
    const scrubbed = scrubBreadcrumb({
      category: "fetch",
      data: { url: CONFIRM_URL, "url.query": "?token_hash=abc123", "url.fragment": "#top", method: "GET" },
    });
    expect(scrubbed.data).toEqual({ url: "https://mo-web.example/api/auth/confirm", method: "GET" });
  });

  it("masks url-encoded emails", () => {
    expect(scrubBreadcrumb({ message: "GET /history?email=anna%40example.com failed" }).message).toBe(
      "GET /history?email=[email] failed",
    );
  });

  it("leaves non-string data untouched", () => {
    const breadcrumb = { category: "fetch", data: { status_code: 500, url: undefined } };
    expect(scrubBreadcrumb(breadcrumb)).toEqual(breadcrumb);
  });
});
