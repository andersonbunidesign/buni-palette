import { defineConfig } from "vite";

// The prototype is published as one web page: React comes from the CDN (UMD globals),
// everything else is bundled into a single script that scripts/assemble.py inlines.
export default defineConfig({
  esbuild: { jsx: "transform", jsxFactory: "React.createElement", jsxFragment: "React.Fragment" },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: "src/main.tsx",
      external: ["react", "react-dom", "react-dom/client"],
      output: {
        format: "iife",
        entryFileNames: "app.js",
        assetFileNames: "app.[ext]",
        globals: { react: "React", "react-dom": "ReactDOM", "react-dom/client": "ReactDOM" },
      },
    },
  },
});
