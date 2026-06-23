import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { resolve } from "path";

// The embedded-wallet pay page. Builds into ../public/embedded so the Express
// app serves it as static assets under /embedded/. The rest of the app stays
// vanilla; this React bundle only powers the "create a wallet & pay" flow.
export default defineConfig({
  root: __dirname,
  base: "/embedded/",
  // Read VITE_* vars from the project root .env (not web/).
  envDir: resolve(__dirname, ".."),
  plugins: [
    react(),
    // @solana/web3.js + spl-token need Buffer/process in the browser.
    nodePolyfills({ globals: { Buffer: true, process: true } }),
  ],
  build: {
    outDir: resolve(__dirname, "../public/embedded"),
    emptyOutDir: true,
  },
});
