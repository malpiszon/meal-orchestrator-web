import type { APIRoute } from "astro";
import { z } from "zod";
import { handlePlanSave } from "@/lib/plan-save";
import { confirmPlan } from "@/lib/services/plans";

export const prerender = false;

const confirmSchema = z.object({ planId: z.uuid() });

/** Save the plan as it is, keeping every current choice (cookie session). See `handlePlanSave` for responses. */
export const POST: APIRoute = (context) =>
  handlePlanSave(context, confirmSchema, (supabase, { planId }) => confirmPlan(supabase, planId));
