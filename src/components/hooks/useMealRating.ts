import { useRef, useState } from "react";
import type { RatingValue } from "@/lib/ratings";

const CLOSED_MESSAGE = "Rating for this meal has closed.";
const SIGNED_OUT_MESSAGE = "You're signed out. Reload the page and sign in again to rate your meal.";
const FAILED_MESSAGE = "Couldn't save your rating. Please try again.";

type RateResult = { ok: true; rating: number | null } | { ok: false; status: number };

/** POST a rating (or `null` to clear it) and narrow the answer; a network failure counts as status 0. */
async function postRating(optionId: string, rating: RatingValue | null): Promise<RateResult> {
  try {
    const response = await fetch("/api/ratings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ optionId, rating }),
    });
    if (!response.ok) {
      return { ok: false, status: response.status };
    }
    const data = (await response.json()) as { rating?: unknown };
    if (data.rating !== null && typeof data.rating !== "number") {
      return { ok: false, status: 0 };
    }
    return { ok: true, rating: data.rating };
  } catch {
    return { ok: false, status: 0 };
  }
}

/**
 * One meal's rating, saved on every tap through `/api/ratings`. The rating updates optimistically and
 * reverts on error; tapping the selected face clears it. Only one request is in flight at a time
 * (`pending` disables the faces). A 409 means the rating window has closed: `locked` stays true and the
 * faces stay disabled.
 */
export function useMealRating(optionId: string, initialRating: number | null) {
  const [rating, setRating] = useState(initialRating);
  const [pending, setPending] = useState(false);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // State updates land on the next render; the ref blocks a second tap in the same tick.
  const inFlight = useRef(false);

  async function rate(value: RatingValue): Promise<void> {
    if (inFlight.current || locked) return;
    inFlight.current = true;
    const previous = rating;
    const next = previous === value ? null : value;
    setRating(next);
    setPending(true);
    setError(null);
    const result = await postRating(optionId, next);
    if (result.ok) {
      setRating(result.rating);
    } else {
      setRating(previous);
      if (result.status === 409) {
        setLocked(true);
        setError(CLOSED_MESSAGE);
      } else {
        setError(result.status === 401 ? SIGNED_OUT_MESSAGE : FAILED_MESSAGE);
      }
    }
    setPending(false);
    inFlight.current = false;
  }

  return { rating, pending, locked, error, rate };
}
