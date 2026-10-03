import { useRef, useState } from "react";
import { formatSavedAt } from "@/lib/plans";

/** The radio-group key of a meal slot: one per day and meal type, e.g. `2026-10-12:lunch`. */
export function slotKey(date: string, mealType: string): string {
  return `${date}:${mealType}`;
}

const LOCKED_MESSAGE = "This plan has started and can't be changed anymore. Reload to see it as this week's plan.";
const SIGNED_OUT_MESSAGE = "You're signed out. Reload the page and sign in again to save your plan.";
const FAILED_MESSAGE = "Couldn't save your plan. Please try again.";

interface UsePlanChoicesOptions {
  planId: string;
  /** Slot key (`slotKey`) → the chosen option id, as rendered by the server. */
  initialChosen: Record<string, string>;
  /** `formatSavedAt` of the plan's `saved_at`, or `null` when never saved. */
  initialSavedAtLabel: string | null;
  /** Option id → last earlier planned date (`YYYY-MM-DD`). */
  initialRecency: Record<string, string>;
}

type SaveResult = { ok: true; savedAt: string; recency: Record<string, string> | null } | { ok: false; status: number };

/** POST a plan write and narrow its answer; a network failure counts as status 0. */
async function postSave(path: string, body: Record<string, string>): Promise<SaveResult> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      return { ok: false, status: response.status };
    }
    const data = (await response.json()) as { saved_at?: unknown; recency?: unknown };
    if (typeof data.saved_at !== "string") {
      return { ok: false, status: 0 };
    }
    const recency =
      data.recency !== null && typeof data.recency === "object" ? (data.recency as Record<string, string>) : null;
    return { ok: true, savedAt: data.saved_at, recency };
  } catch {
    return { ok: false, status: 0 };
  }
}

/**
 * The upcoming week's choices, saved on every change through `/api/plans/choose` and `/api/plans/confirm`.
 * Choices update optimistically and revert on error. Only one request is in flight at a time (`pending`
 * disables every input), so two quick taps can't resolve out of order. A 409 means the week has started:
 * `locked` stays true and the inputs stay disabled.
 */
export function usePlanChoices({ planId, initialChosen, initialSavedAtLabel, initialRecency }: UsePlanChoicesOptions) {
  const [chosen, setChosen] = useState(initialChosen);
  const [savedAtLabel, setSavedAtLabel] = useState(initialSavedAtLabel);
  const [recency, setRecency] = useState(initialRecency);
  const [pending, setPending] = useState(false);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // State updates land on the next render; the ref blocks a second tap in the same tick.
  const inFlight = useRef(false);

  async function save(path: string, body: Record<string, string>, revert?: () => void): Promise<void> {
    inFlight.current = true;
    setPending(true);
    setError(null);
    const result = await postSave(path, body);
    if (result.ok) {
      setSavedAtLabel(formatSavedAt(result.savedAt));
      if (result.recency) {
        setRecency(result.recency);
      }
    } else {
      revert?.();
      if (result.status === 409) {
        setLocked(true);
        setError(LOCKED_MESSAGE);
      } else {
        setError(result.status === 401 ? SIGNED_OUT_MESSAGE : FAILED_MESSAGE);
      }
    }
    setPending(false);
    inFlight.current = false;
  }

  function choose(key: string, optionId: string): void {
    const previous = chosen[key];
    if (inFlight.current || locked || previous === optionId) return;
    setChosen((current) => ({ ...current, [key]: optionId }));
    void save("/api/plans/choose", { planId, optionId }, () => {
      setChosen((current) => ({ ...current, [key]: previous }));
    });
  }

  function confirm(): void {
    if (inFlight.current || locked) return;
    void save("/api/plans/confirm", { planId });
  }

  return { chosen, savedAtLabel, recency, pending, locked, error, choose, confirm };
}
