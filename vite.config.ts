import { defineConfig } from "vite";

export default defineConfig({
  // NewSimClaude (the free-market fork) serves on 5174 so it can run side by side with the
  // original CityWithLifeClaude on its default 5173 — two live sims open at once.
  server: { port: 5174, open: false },
});
