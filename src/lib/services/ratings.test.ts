import { describe, expect, it } from "vitest";
import { ratingWriteErrorKind } from "@/lib/services/ratings";

describe("ratingWriteErrorKind", () => {
  it("maps rate_meal's deliberate errors", () => {
    expect(ratingWriteErrorKind({ code: "P0002", message: "not_found" })).toBe("not_found");
    expect(ratingWriteErrorKind({ code: "55000", message: "not_rateable" })).toBe("not_rateable");
  });

  it("maps anything else to failed", () => {
    expect(ratingWriteErrorKind({ code: "23514", message: "check constraint violation" })).toBe("failed");
    expect(ratingWriteErrorKind({ code: "P0002", message: "no rows" })).toBe("failed");
    expect(ratingWriteErrorKind({ message: "network" })).toBe("failed");
  });
});
