import type { APIRoute } from "astro";
import { MO_INGEST_TOKEN } from "astro:env/server";
import { handleMoDelivery } from "@/lib/services/mo-deliveries";
import { createServiceClient } from "@/lib/supabase";

export const prerender = false;

export const POST: APIRoute = async ({ request }) =>
  handleMoDelivery(request, { token: MO_INGEST_TOKEN, supabase: createServiceClient() });
