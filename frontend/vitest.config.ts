import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Unit tests of the screens (npm test): jsdom stands in for the browser,
// the API is replaced by a fake fetch, timers are faked where time matters.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    unstubGlobals: true,
  },
});
