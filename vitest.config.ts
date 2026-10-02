import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    // A negative UTC offset with no DST: a date formatted without `timeZone: "UTC"` would land on the
    // previous day, so the label tests prove runtime-timezone independence (Workers run in UTC).
    env: { TZ: "Pacific/Honolulu" },
  },
});
