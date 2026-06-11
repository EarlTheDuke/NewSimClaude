import { defineConfig } from "vite";

export default defineConfig({
  // NewSimClaude (the free-market fork) serves on 5174 so it can run side by side with the
  // original CityWithLifeClaude on its default 5173 — two live sims open at once.
  server: {
    port: 5174,
    open: false,
    proxy: {
      // The spectator duel (?scenario=duel): the browser's LLM-CEO calls go same-origin to
      // /tinybox/... and the dev server forwards them to the Open WebUI box — no CORS games.
      "/tinybox": {
        target: "https://tinybox.silverstarindustries.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tinybox/, ""),
      },
    },
  },
});
