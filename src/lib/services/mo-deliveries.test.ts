import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import sample from "../../../scripts/fixtures/mo-delivery.sample.json";
import { reportHandledError } from "@/lib/report-handled-error";
import { handleMoDelivery } from "@/lib/services/mo-deliveries";

vi.mock("@/lib/report-handled-error", () => ({ reportHandledError: vi.fn() }));

// Expected statuses and bodies come from docs/mo-delivery-contract.md, "Responses and retry policy".

const TOKEN = "test-ingest-token";
const PLAN_ID = "00000000-0000-4000-8000-000000000001";
const MAX_BODY_BYTES = 256 * 1024;

interface RpcResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}

/** A service client whose `rpc` answers with `result`; never `P0002 unknown_user` (provisioning is S-10's). */
function stubClient(result: RpcResult) {
  const rpc = vi.fn((_fn: string, _args: Record<string, unknown>) => Promise.resolve(result));
  return { rpc, supabase: { rpc } as unknown as SupabaseClient };
}

/** A fresh, mutable copy of the sample payload. */
function sampleBody(): Record<string, unknown> {
  return structuredClone(sample);
}

function deliveryRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/mo/deliveries", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}`, ...headers },
    body,
  });
}

async function deliver(
  request: Request,
  result: RpcResult = { data: PLAN_ID, error: null },
  options: { token?: string | undefined } = { token: TOKEN },
) {
  const { rpc, supabase } = stubClient(result);
  const response = await handleMoDelivery(request, { token: options.token, supabase });
  return { response, body: (await response.json()) as unknown, rpc };
}

const validJson = () => JSON.stringify(sample);

beforeEach(() => {
  vi.mocked(reportHandledError).mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("handleMoDelivery configuration", () => {
  it("answers 503 not_configured without a service client", async () => {
    const response = await handleMoDelivery(deliveryRequest(validJson()), { token: TOKEN, supabase: null });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "not_configured" });
  });

  it("answers 503 not_configured without a token", async () => {
    const { response, body, rpc } = await deliver(deliveryRequest(validJson()), undefined, { token: undefined });

    expect(response.status).toBe(503);
    expect(body).toEqual({ error: "not_configured" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("handleMoDelivery authentication", () => {
  it.each([
    ["missing", {}],
    ["malformed", { Authorization: TOKEN }],
    ["wrong", { Authorization: "Bearer not-the-token" }],
  ])("answers 401 unauthorized for a %s token", async (_case, headers: Record<string, string>) => {
    const request = deliveryRequest(validJson(), headers);
    if (!("Authorization" in headers)) request.headers.delete("Authorization");

    const { response, body, rpc } = await deliver(request);

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "unauthorized" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("handleMoDelivery body size", () => {
  it("answers 413 payload_too_large by Content-Length", async () => {
    const request = deliveryRequest(validJson(), { "Content-Length": String(MAX_BODY_BYTES + 1) });
    expect(request.headers.get("Content-Length")).toBe(String(MAX_BODY_BYTES + 1));

    const { response, body, rpc } = await deliver(request);

    expect(response.status).toBe(413);
    expect(body).toEqual({ error: "payload_too_large" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers 413 payload_too_large by the real byte length when Content-Length lies", async () => {
    // Multi-byte characters: under the cap in characters, over it in bytes.
    const oversized = JSON.stringify({ ...sampleBody(), padding: "ż".repeat(MAX_BODY_BYTES / 2 + 1) });
    expect(oversized.length).toBeLessThan(MAX_BODY_BYTES);
    const request = deliveryRequest(oversized, { "Content-Length": "100" });

    const { response, body, rpc } = await deliver(request);

    expect(response.status).toBe(413);
    expect(body).toEqual({ error: "payload_too_large" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("handleMoDelivery payload", () => {
  it('answers 400 invalid_payload with path "" for a body that isn\'t JSON', async () => {
    const { response, body, rpc } = await deliver(deliveryRequest("{not json"));

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "invalid_payload", issues: [{ path: "", message: expect.any(String) as string }] });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers 400 invalid_payload with the dotted path of each contract violation", async () => {
    const delivery = sampleBody() as { days: { meals: { type: string }[] }[] };
    delivery.days[0].meals[0].type = "brunch";

    const { response, body, rpc } = await deliver(deliveryRequest(JSON.stringify(delivery)));

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: "invalid_payload",
      issues: [{ path: "days.0.meals.0.type", message: expect.any(String) as string }],
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("handleMoDelivery storage", () => {
  it('answers 400 invalid_payload with path "" when Postgres can\'t store a character (22P05)', async () => {
    const { response, body } = await deliver(deliveryRequest(validJson()), {
      data: null,
      error: { code: "22P05", message: "unsupported Unicode escape sequence" },
    });

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "invalid_payload", issues: [{ path: "", message: expect.any(String) as string }] });
    expect(reportHandledError).not.toHaveBeenCalled();
  });

  it("answers 409 week_started for a changed re-send of a started week", async () => {
    const { response, body } = await deliver(deliveryRequest(validJson()), {
      data: null,
      error: { code: "55000", message: "week_started" },
    });

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: "week_started" });
    expect(reportHandledError).not.toHaveBeenCalled();
  });

  it.each([
    ["another 55000 message", { code: "55000", message: "something_else" }],
    ["any other error", { code: "57014", message: "canceling statement due to statement timeout" }],
  ])("answers 500 storage_failed for %s and reports it", async (_case, error) => {
    const { response, body } = await deliver(deliveryRequest(validJson()), { data: null, error });

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "storage_failed" });
    expect(reportHandledError).toHaveBeenCalledTimes(1);
    const [step, reported] = vi.mocked(reportHandledError).mock.calls[0] ?? [];
    expect(step).toBe("mo_delivery.ingest");
    expect((reported as Error).cause).toBe(error);
  });

  it("answers 500 storage_failed when the RPC returns no string plan id, reported as no_plan_id", async () => {
    const { response, body } = await deliver(deliveryRequest(validJson()), { data: 42, error: null });

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "storage_failed" });
    expect(reportHandledError).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportHandledError).mock.calls[0]?.[0]).toBe("mo_delivery.ingest");
    expect(vi.mocked(reportHandledError).mock.calls[0]?.[2]).toEqual({ code: "no_plan_id" });
  });
});

describe("handleMoDelivery success", () => {
  it("answers 200 with plan_id, week_start and account_created false for a known user", async () => {
    const { response, body, rpc } = await deliver(deliveryRequest(validJson()));

    expect(response.status).toBe(200);
    expect(body).toEqual({ plan_id: PLAN_ID, week_start: sample.week_start, account_created: false });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]?.[0]).toBe("ingest_weekly_plan");
    expect(reportHandledError).not.toHaveBeenCalled();
  });

  it("stores the body as received, unknown nested keys included", async () => {
    const delivery = sampleBody() as { days: { meals: { variants: Record<string, unknown>[] }[] }[] };
    delivery.days[0].meals[0].variants[0].future_field = { kept: true };

    const { response, rpc } = await deliver(deliveryRequest(JSON.stringify(delivery)));

    expect(response.status).toBe(200);
    const args = rpc.mock.calls[0]?.[1];
    expect(args.p_raw).toEqual(delivery);
    expect(args).toMatchObject({
      p_email: sample.user.email,
      p_provider: sample.provider,
      p_week_start: sample.week_start,
      p_week_end: sample.week_end,
      p_run_id: sample.run_id,
    });
  });

  it("passes p_run_id null when run_id is absent", async () => {
    const delivery = sampleBody();
    delete delivery.run_id;

    const { response, rpc } = await deliver(deliveryRequest(JSON.stringify(delivery)));

    expect(response.status).toBe(200);
    expect(rpc.mock.calls[0]?.[1].p_run_id).toBeNull();
  });
});
