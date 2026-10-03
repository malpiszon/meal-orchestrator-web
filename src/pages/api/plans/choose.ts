import type { APIRoute } from "astro";
import { z } from "zod";
import { handlePlanSave } from "@/lib/plan-save";
import { choosePlanOption } from "@/lib/services/plans";

export const prerender = false;

// planId only re-reads recency after the save; choose_plan_option checks the option's real plan and owner.
const chooseSchema = z.object({ planId: z.uuid(), optionId: z.uuid() });

/** Make an option the chosen one of its slot (cookie session). See `handlePlanSave` for responses. */
export const POST: APIRoute = (context) =>
  handlePlanSave(context, chooseSchema, (supabase, { optionId }) => choosePlanOption(supabase, optionId));
