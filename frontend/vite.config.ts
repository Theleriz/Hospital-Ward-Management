import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the API runs separately (uvicorn on port 8000);
// in Docker nginx serves the build and proxies /api the same way.
// Two pages: the staff app (index.html) and the corridor board (board.html),
// which nginx serves on its own port (nginx.conf).
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        // Relative to the frontend folder, where every build runs (npm scripts, Dockerfile)
        main: "index.html",
        board: "board.html",
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
    },
  },
});
