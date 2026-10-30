import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/types/**", "src/ui/**"],
      thresholds: {
        lines: 70,
        functions: 68,
        branches: 60,
      },
    },
  },
});
