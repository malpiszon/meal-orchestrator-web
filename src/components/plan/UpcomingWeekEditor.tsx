import { CircleAlert, History, Star } from "lucide-react";
import { slotKey, usePlanChoices } from "@/components/hooks/usePlanChoices";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRecency, mealTypeLabel } from "@/lib/plans";
import { cn } from "@/lib/utils";
import type { PlanDay, PlanMealOption, PlanSlot } from "@/types";

/** The fields of an option the editor shows; `meal_type` and `variant_index` are kept for grouping. */
export type EditorOption = Pick<
  PlanMealOption,
  | "id"
  | "meal_date"
  | "meal_type"
  | "variant_index"
  | "name"
  | "score"
  | "justifications"
  | "is_recommended"
  | "is_chosen"
>;

/** A grouped day plus its label, formatted on the server so the browser's ICU can't change it on hydration. */
export type EditorDay = PlanDay<EditorOption> & { label: string };

interface UpcomingWeekEditorProps {
  planId: string;
  /** `formatWeekRange` of the plan. */
  weekLabel: string;
  /** `formatEditableUntil` of the plan's `week_start`. */
  editableUntil: string;
  /** `formatSavedAt` of the plan's `saved_at`; `null` when never saved. */
  savedAtLabel: string | null;
  /** `groupPlanOptions` of the plan's options, each day with its `formatDayLabel`. */
  days: EditorDay[];
  /** Option id → last earlier planned date (`getPlanRecency`). */
  recency: Record<string, string>;
}

interface SlotFieldsetProps {
  slot: PlanSlot<EditorOption>;
  name: string;
  chosenId: string | undefined;
  recency: Record<string, string>;
  disabled: boolean;
  onChoose: (optionId: string) => void;
}

/** One meal slot: a native radio group with every option, best first. */
function SlotFieldset({ slot, name, chosenId, recency, disabled, onChoose }: SlotFieldsetProps) {
  return (
    <div className="border-t pt-4 first:border-t-0 first:pt-0">
      {/* min-w-0: a fieldset's default min-width is its content, which would overflow on a phone. */}
      <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-2">
        <legend className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
          {mealTypeLabel(slot.mealType)}
        </legend>
        {slot.options.map((option) => {
          const selected = option.id === chosenId;
          const lastPlannedOn = recency[option.id];
          return (
            <label
              key={option.id}
              className={cn(
                "has-focus-visible:ring-ring/50 flex items-start gap-3 rounded-lg border p-3 transition-colors has-focus-visible:ring-[3px]",
                selected ? "border-primary bg-accent text-accent-foreground" : "hover:bg-accent/50",
                disabled ? "cursor-not-allowed" : "cursor-pointer",
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.id}
                checked={selected}
                onChange={() => {
                  onChoose(option.id);
                }}
                className="accent-primary mt-0.5 size-4 shrink-0"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-start justify-between gap-2">
                  <span className={cn("min-w-0 break-words", selected && "font-medium")}>{option.name}</span>
                  <div className="flex shrink-0 items-center gap-1">
                    {option.score === slot.topScore && (
                      <Badge variant="outline">
                        <Star aria-hidden="true" className="text-primary fill-current" />
                        <span className="sr-only">Top score</span>
                      </Badge>
                    )}
                    <Badge variant={selected ? "default" : "secondary"}>
                      {option.score}/10<span className="sr-only"> score</span>
                    </Badge>
                  </div>
                </div>
                {lastPlannedOn && (
                  <span className="text-primary flex items-center gap-1 text-sm font-medium">
                    <History aria-hidden="true" className="size-3.5 shrink-0" />
                    {formatRecency(option.meal_date, lastPlannedOn)}
                  </span>
                )}
                {option.justifications.length > 0 && (
                  <ul className="text-muted-foreground flex flex-col gap-1 text-sm">
                    {option.justifications.map((justification, index) => (
                      <li key={index} className="flex gap-2">
                        <span aria-hidden="true">{justification.icon}</span>
                        <span>{justification.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </label>
          );
        })}
      </fieldset>
    </div>
  );
}

/**
 * The editable "Next week": every option of every slot as a native radio, saved on every change.
 * The root carries `data-plan-id` and each radio its option id as `value`, which the smoke test reads.
 */
export default function UpcomingWeekEditor({
  planId,
  weekLabel,
  editableUntil,
  savedAtLabel: initialSavedAtLabel,
  days,
  recency: initialRecency,
}: UpcomingWeekEditorProps) {
  // Per plan, as in WeekPlan.astro; useId would restart per island and could clash with PlanTabs.
  const headingId = `week-heading-${planId}`;
  const initialChosen = Object.fromEntries(
    days.flatMap((day) => day.slots.map((slot) => [slotKey(day.date, slot.mealType), slot.chosen.id])),
  );
  const { chosen, savedAtLabel, recency, pending, locked, error, choose, confirm } = usePlanChoices({
    planId,
    initialChosen,
    initialSavedAtLabel,
    initialRecency,
  });
  const disabled = pending || locked;

  let status: string;
  if (pending) {
    status = "Saving…";
  } else if (savedAtLabel) {
    status = `Saved ${savedAtLabel} · Editable until ${editableUntil}`;
  } else {
    status = `Not saved yet · Editable until ${editableUntil}`;
  }

  return (
    <section aria-labelledby={headingId} data-plan-id={planId} className="flex flex-col gap-4">
      <div>
        <p className="text-muted-foreground text-sm">Next week</p>
        <h2 id={headingId} className="text-xl font-semibold">
          {weekLabel}
        </h2>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p aria-live="polite" className="text-muted-foreground text-sm">
          {status}
        </p>
        {savedAtLabel === null && !locked && (
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={confirm}>
            Keep as recommended
          </Button>
        )}
      </div>
      {error && (
        <Alert variant={locked ? "default" : "destructive"}>
          <CircleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {days.length === 0 && <p className="text-muted-foreground text-sm">This plan has no meals to show.</p>}
      {days.map((day) => (
        <Card key={day.date} className="gap-4">
          <CardHeader>
            <CardTitle>
              <h3>{day.label}</h3>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {day.slots.map((slot) => {
              const key = slotKey(day.date, slot.mealType);
              return (
                <SlotFieldset
                  key={key}
                  slot={slot}
                  name={key}
                  chosenId={chosen[key]}
                  recency={recency}
                  disabled={disabled}
                  onChoose={(optionId) => {
                    choose(key, optionId);
                  }}
                />
              );
            })}
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
