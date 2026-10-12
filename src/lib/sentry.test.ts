import { describe, expect, it } from "vitest";
import { sentryOptions } from "@/lib/sentry";
import { SENTRY_DATA_COLLECTION, scrubBreadcrumb, scrubEvent } from "@/lib/sentry-privacy";

const DSN = "https://public@o0.ingest.sentry.io/0";

describe("sentryOptions", () => {
  it.each([{}, { PUBLIC_SENTRY_DSN: "" }])("is disabled without a DSN (%o)", (env) => {
    expect(sentryOptions({ ...env, SENTRY_ENVIRONMENT: "verification", SENTRY_RELEASE: "abc" })).toEqual({
      enabled: false,
    });
  });

  it("defaults to production with tracing off and the privacy hooks wired", () => {
    const options = sentryOptions({ PUBLIC_SENTRY_DSN: DSN });
    expect(options).toEqual({
      dsn: DSN,
      environment: "production",
      dataCollection: SENTRY_DATA_COLLECTION,
      beforeSend: scrubEvent,
      beforeBreadcrumb: scrubBreadcrumb,
    });
    expect(options).not.toHaveProperty("tracesSampleRate");
    expect(options).not.toHaveProperty("release");
  });

  it("treats an empty environment as unset", () => {
    expect(sentryOptions({ PUBLIC_SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: "" }).environment).toBe("production");
  });

  it("takes the environment and release from the env", () => {
    const options = sentryOptions({
      PUBLIC_SENTRY_DSN: DSN,
      SENTRY_ENVIRONMENT: "verification",
      SENTRY_RELEASE: "4f231e0",
    });
    expect(options).toMatchObject({ environment: "verification", release: "4f231e0" });
  });
});
