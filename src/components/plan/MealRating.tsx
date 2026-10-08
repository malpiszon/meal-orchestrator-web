import { useId } from "react";
import { useMealRating } from "@/components/hooks/useMealRating";
import { Button } from "@/components/ui/button";
import { RATING_FACES } from "@/lib/ratings";
import { cn } from "@/lib/utils";

interface MealRatingProps {
  optionId: string;
  /** The user's stored rating of this meal (1-5), or `null` when not rated. */
  initialRating: number | null;
}

/**
 * "How was it?" and the five faces as toggle buttons, saved on every tap (see `useMealRating`).
 * The root carries `data-rating-option-id`, which the smoke test reads.
 */
export default function MealRating({ optionId, initialRating }: MealRatingProps) {
  const { rating, pending, locked, error, rate } = useMealRating(optionId, initialRating);
  const disabled = pending || locked;
  const promptId = useId();

  return (
    <div data-rating-option-id={optionId} className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <p id={promptId} className="text-muted-foreground text-sm">
          How was it?
        </p>
        <div role="group" aria-labelledby={promptId} className="flex gap-1.5">
          {RATING_FACES.map((face) => {
            const selected = rating === face.value;
            return (
              <Button
                key={face.value}
                type="button"
                size="icon"
                variant={selected ? "default" : "outline"}
                aria-pressed={selected}
                aria-label={face.label}
                title={face.label}
                disabled={disabled}
                onClick={() => {
                  void rate(face.value);
                }}
                className="size-8 text-base"
              >
                <span aria-hidden="true">{face.emoji}</span>
              </Button>
            );
          })}
        </div>
      </div>
      {error && (
        <p role="alert" className={cn("text-sm", locked ? "text-muted-foreground" : "text-destructive")}>
          {error}
        </p>
      )}
    </div>
  );
}
