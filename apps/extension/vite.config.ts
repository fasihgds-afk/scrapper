import { defineConfig } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function copyManifestPlugin() {
  return {
    name: "copy-manifest",
    closeBundle() {
      const dist = resolve(__dirname, "dist");
      mkdirSync(dist, { recursive: true });
      copyFileSync(resolve(__dirname, "manifest.json"), resolve(dist, "manifest.json"));
      copyFileSync(
        resolve(__dirname, "src/popup/popup.html"),
        resolve(dist, "popup.html"),
      );
      copyFileSync(
        resolve(__dirname, "src/popup/popup.css"),
        resolve(dist, "popup.css"),
      );
      copyFileSync(
        resolve(__dirname, "icons/icon-128.png"),
        resolve(dist, "icon-128.png"),
      );
      const htmlPath = resolve(dist, "popup.html");
      const html = readFileSync(htmlPath, "utf8").replace(
        "./popup.ts",
        "./popup.js",
      );
      writeFileSync(htmlPath, html);
    },
  };
}

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        "service-worker": resolve(__dirname, "src/background/service-worker.ts"),
        content: resolve(__dirname, "src/content/content-entry.ts"),
        popup: resolve(__dirname, "src/popup/popup.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  plugins: [copyManifestPlugin()],
});
