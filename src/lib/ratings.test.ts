import { describe, expect, it } from "vitest";
import { isRateable, RATING_FACES, ratingFace } from "@/lib/ratings";

describe("RATING_FACES", () => {
  it("lists the scale worst first, values 1 to 5", () => {
    expect(RATING_FACES.map((face) => [face.value, face.emoji, face.label])).toEqual([
      [1, "🤢", "Never again"],
      [2, "😕", "Meh"],
      [3, "😐", "Fine"],
      [4, "🙂", "Tasty"],
      [5, "😋", "Chef's kiss"],
    ]);
  });
});

describe("ratingFace", () => {
  it("finds the face of each value on the scale", () => {
    expect(ratingFace(1)?.label).toBe("Never again");
    expect(ratingFace(3)?.emoji).toBe("😐");
    expect(ratingFace(5)?.label).toBe("Chef's kiss");
  });

  it("returns undefined off the scale", () => {
    expect(ratingFace(0)).toBeUndefined();
    expect(ratingFace(6)).toBeUndefined();
  });
});

describe("isRateable", () => {
  // Wednesday 2026-10-14: the window is 2026-10-07 .. 2026-10-14.
  const today = "2026-10-14";

  it("today is rateable", () => {
    expect(isRateable("2026-10-14", today)).toBe(true);
  });

  it("today - 7 is rateable", () => {
    expect(isRateable("2026-10-07", today)).toBe(true);
  });

  it("today + 1 is not rateable", () => {
    expect(isRateable("2026-10-15", today)).toBe(false);
  });

  it("today - 8 is not rateable", () => {
    expect(isRateable("2026-10-06", today)).toBe(false);
  });

  it("works across a month boundary: on 2026-11-03 the window starts 2026-10-27", () => {
    expect(isRateable("2026-10-27", "2026-11-03")).toBe(true);
    expect(isRateable("2026-10-26", "2026-11-03")).toBe(false);
    expect(isRateable("2026-11-01", "2026-11-03")).toBe(true);
  });
});
